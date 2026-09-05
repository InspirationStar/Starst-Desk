// ============================================================
// 会话管理 IPC 通道
// 注册 chat:* 系列 IPC 处理器
// 包含流式生成入口 chat:message:generate，通过 webContents.send 推送流式增量
// 设计依据：design.md 2.1.3.3 / 2.10.4 节
// ============================================================

const { register, success, failure } = require('./registry.js')
const { BrowserWindow } = require('electron')
const chatSessionDao = require('./../dao/chat-session-dao.js')
const chatMessageDao = require('./../dao/chat-message-dao.js')
const chatAttachmentDao = require('./../dao/chat-attachment-dao.js')
const aiConfigDao = require('./../dao/ai-config-dao.js')
const aiAdapterFactory = require('./../core/ai-adapter.js')
const logger = require('./../core/logger.js')
const petWindowManager = require('./../core/pet-window-manager.js')
const { getMediaTools } = require('./../core/media-tools.js')
const dateUtils = require('./../utils/date-utils.js')
const { getModelContextWindow, estimateTokens, truncateByTokenBudget } = require('./../utils/context-manager.js')

// 流式事件通道名
const EVENT_STREAM_START = 'ai:stream:start'
const EVENT_STREAM_CHUNK = 'ai:stream:chunk'
const EVENT_STREAM_END = 'ai:stream:end'
const EVENT_STREAM_ERROR = 'ai:stream:error'
const EVENT_TOOL_CALL = 'ai:tool-call'
const EVENT_CONTEXT_INJECT = 'ai:context-inject'
const EVENT_MESSAGES_CHANGED = 'chat:messages-changed'

// 上下文长度默认上限（消息条数），配置未指定时使用
const DEFAULT_MAX_CONTEXT_MESSAGES = 50

// 桌宠助手常驻会话标题（与前端 pet-ai-prompt.js 保持一致）
const PET_ASSISTANT_SESSION_TITLE = '__pet_assistant__'

/**
 * 向所有 BrowserWindow 广播消息变更事件（跨窗口同步）
 * @param {string} sessionId 发生变更的会话 ID
 * @param {string} action 变更类型：'send' | 'generate' | 'clear'
 */
function broadcastMessagesChanged (sessionId, action) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(EVENT_MESSAGES_CHANGED, { session_id: sessionId, action })
    }
  }
}

// ============================================================
// chat:session:list
// ============================================================
register('chat:session:list', async (event, data) => {
  try {
    const result = chatSessionDao.list(data)
    return success(result)
  } catch (error) {
    logger.error('ChatChannels', `chat:session:list 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:session:create
// ============================================================
register('chat:session:create', async (event, data) => {
  try {
    if (!data.title || !data.model_config_id) {
      return failure('REQUIRED_FIELDS', 'title 和 model_config_id 不能为空')
    }
    // 校验 model_config_id 是否存在于 ai_configs 表，避免 FOREIGN KEY constraint failed
    const configExists = aiConfigDao.getById(data.model_config_id)
    if (!configExists) {
      return failure('CONFIG_NOT_FOUND', `AI 配置 ${data.model_config_id} 不存在，无法创建会话`)
    }
    const session = chatSessionDao.create(data)
    return success(session)
  } catch (error) {
    logger.error('ChatChannels', `chat:session:create 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:session:delete
// 级联删除会话及其所有消息
// ============================================================
register('chat:session:delete', async (event, data) => {
  try {
    if (!data.id) {
      return failure('SESSION_ID_REQUIRED', '会话 ID 不能为空')
    }
    // 先删除关联消息
    chatMessageDao.deleteBySession(data.id)
    const result = chatSessionDao.del(data.id)
    return success({ deleted: result })
  } catch (error) {
    logger.error('ChatChannels', `chat:session:delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:session:bulk-delete
// 批量删除会话及其所有消息
// ============================================================
register('chat:session:bulk-delete', async (event, data) => {
  try {
    if (!data.ids || !Array.isArray(data.ids) || data.ids.length === 0) {
      return failure('SESSION_IDS_REQUIRED', '会话 ID 列表不能为空')
    }
    // 先删除关联消息
    for (const id of data.ids) {
      chatMessageDao.deleteBySession(id)
    }
    const deletedCount = chatSessionDao.bulkDelete(data.ids)
    return success({ deleted: deletedCount, ids: data.ids })
  } catch (error) {
    logger.error('ChatChannels', `chat:session:bulk-delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:session:update
// 更新会话标题或系统提示词
// ============================================================
register('chat:session:update', async (event, data) => {
  try {
    if (!data.id) {
      return failure('SESSION_ID_REQUIRED', '会话 ID 不能为空')
    }
    const session = chatSessionDao.update(data.id, data)
    if (!session) {
      return failure('SESSION_NOT_FOUND', '会话不存在')
    }
    return success(session)
  } catch (error) {
    logger.error('ChatChannels', `chat:session:update 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:session:ensure-pet-assistant
// 查找或创建桌宠助手常驻会话，统一入口（PetApp 和 ChatView 共用）
// 返回 { session, messages } 或失败（无可用 AI 配置时）
// ============================================================
register('chat:session:ensure-pet-assistant', async (event, data) => {
  try {
    // 获取 language 类别的可用配置（优先活跃的，否则第一个）
    const langConfigs = aiConfigDao.findByModelCategory('language')
    const activeConfig = langConfigs?.find(c => c.is_active) || langConfigs?.[0] || null
    const configId = activeConfig?.id || null

    // 查找已有的桌宠助手会话
    const allSessions = chatSessionDao.list({ page: 1, size: 200 })
    const existing = allSessions.list?.find(s => s.title === PET_ASSISTANT_SESSION_TITLE)

    if (existing) {
      // 会话存在：检查 model_config_id 是否仍有效，无效则更新
      if (configId && existing.model_config_id !== configId) {
        const oldConfigExists = aiConfigDao.getById(existing.model_config_id)
        if (!oldConfigExists) {
          chatSessionDao.update(existing.id, { model_config_id: configId })
          existing.model_config_id = configId
        }
      }
      // 加载消息
      const messages = chatMessageDao.findBySession(existing.id)
      return success({ session: existing, messages: messages?.list || [], configId })
    }

    // 会话不存在，需要创建
    if (!configId) {
      return failure('NO_AI_CONFIG', '无可用 AI 模型配置，请先在配置页添加 language 类别的模型')
    }

    const session = chatSessionDao.create({
      title: PET_ASSISTANT_SESSION_TITLE,
      model_config_id: configId,
      system_prompt: data?.system_prompt || null
    })
    return success({ session, messages: [], configId })
  } catch (error) {
    logger.error('ChatChannels', `chat:session:ensure-pet-assistant 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:message:list
// ============================================================
register('chat:message:list', async (event, data) => {
  try {
    if (!data.session_id) {
      return failure('SESSION_ID_REQUIRED', '会话 ID 不能为空')
    }
    const result = chatMessageDao.findBySession(data.session_id, data)
    return success(result)
  } catch (error) {
    logger.error('ChatChannels', `chat:message:list 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:message:create
// 直接保存消息到数据库（用于媒体生成消息，不触发 AI 生成）
// 参数：{ session_id, role, content, is_complete? }
// 返回：创建的消息对象（含数据库生成的 id）
// ============================================================
register('chat:message:create', async (event, data) => {
  try {
    if (!data.session_id || !data.role) {
      return failure('REQUIRED_FIELDS', 'session_id 和 role 不能为空')
    }
    const message = chatMessageDao.create({
      session_id: data.session_id,
      role: data.role,
      content: data.content || '',
      is_complete: data.is_complete !== undefined ? data.is_complete : 1
    })
    return success(message)
  } catch (error) {
    logger.error('ChatChannels', `chat:message:create 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:message:update
// 更新消息内容并标记完成（用于媒体生成完成后更新占位消息）
// 参数：{ id, content, is_complete? }
// ============================================================
register('chat:message:update', async (event, data) => {
  try {
    if (!data.id) {
      return failure('MESSAGE_ID_REQUIRED', '消息 ID 不能为空')
    }
    const message = chatMessageDao.update(data.id, data.content || '')
    if (data.is_complete) {
      chatMessageDao.markComplete(data.id)
    }
    return success(chatMessageDao.getById(data.id))
  } catch (error) {
    logger.error('ChatChannels', `chat:message:update 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:message:send
// 保存用户消息（不触发 AI 生成，由 chat:message:generate 单独触发）
// 支持 attachments 参数（附件列表），包含图片等
// ============================================================
register('chat:message:send', async (event, data) => {
  try {
    if (!data.session_id || !data.content) {
      return failure('REQUIRED_FIELDS', 'session_id 和 content 不能为空')
    }

    // 解析 content：如果为 JSON 字符串，保持对象格式；否则保持字符串
    let contentValue = data.content
    if (typeof contentValue === 'string') {
      try {
        contentValue = JSON.parse(contentValue)
      } catch {
        // 保持原字符串
      }
    }

    const message = chatMessageDao.create({
      session_id: data.session_id,
      role: 'user',
      content: contentValue
    })

    // 处理附件：如果有附件，保存并构建多模态 content
    if (data.attachments && Array.isArray(data.attachments) && data.attachments.length > 0) {
      const attachments = []
      for (const attachment of data.attachments) {
        const record = chatAttachmentDao.create({
          message_id: message.id,
          session_id: data.session_id,
          type: attachment.type || 'file',
          name: attachment.name || 'attachment',
          file_path: attachment.file_path || null,
          file_url: attachment.file_url || null,
          file_size: attachment.file_size || 0,
          mime_type: attachment.mime_type || null,
          width: attachment.width || null,
          height: attachment.height || null
        })
        attachments.push(record)

        // 如果是图片附件且有 base64 数据，将其加入消息 content 作为元数据
        if (attachment.type === 'image' && attachment.base64) {
          const base64Data = attachment.base64
          if (!contentValue || typeof contentValue === 'string') {
            // 将字符串内容转换为对象格式，保留文本并添加附件信息
            contentValue = {
              text: typeof contentValue === 'string' ? contentValue : '',
              attachments: [
                {
                  type: 'image',
                  mime_type: attachment.mime_type || 'image/png',
                  base64: base64Data
                }
              ]
            }
          } else if (typeof contentValue === 'object') {
            // 已有附件数组则追加
            if (!contentValue.attachments) {
              contentValue.attachments = []
            }
            contentValue.attachments.push({
              type: 'image',
              mime_type: attachment.mime_type || 'image/png',
              base64: base64Data
            })
          }
          // 更新消息内容（包含附件元数据）
          chatMessageDao.update(message.id, contentValue)
        }
      }
      return success({ ...message, attachments })
    }

    broadcastMessagesChanged(data.session_id, 'send')
    return success(message)
  } catch (error) {
    logger.error('ChatChannels', `chat:message:send 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:message:generate
// 触发 AI 流式生成：
//   1. 加载会话历史消息
//   2. 加载会话关联的 AI 配置（或使用传入的 config_id）
//   3. 创建 assistant 占位消息
//   4. 调用适配器流式请求，通过 webContents.send 推送 chunk
//   5. 完成后更新 assistant 消息内容
// 返回：assistant 消息 ID（流式增量通过事件通道推送）
// ============================================================
register('chat:message:generate', async (event, data) => {
  try {
    if (!data.session_id) {
      return failure('SESSION_ID_REQUIRED', '会话 ID 不能为空')
    }

    const session = chatSessionDao.getById(data.session_id)
    if (!session) {
      return failure('SESSION_NOT_FOUND', '会话不存在')
    }

    // 解析 AI 配置：优先使用传入的 config_id，否则使用会话关联的配置
    let config = null
    if (data.config_id) {
      config = aiConfigDao.getById(data.config_id)
    } else if (session.model_config_id) {
      config = aiConfigDao.getById(session.model_config_id)
    } else {
      config = aiConfigDao.findActive()
    }
    if (!config) {
      return failure('NO_AI_CONFIG', '未配置可用的 AI 模型，请先在配置页添加')
    }

    // 加载历史消息（用于构建上下文）
    const historyResult = chatMessageDao.findBySession(data.session_id)
    let historyMessages = historyResult.list || []

    // 上下文动态感知 + token 预算截断
    // 1. 获取模型上下文窗口（用户高级配置优先 → 预设匹配 → 默认）
    const ctxInfo = getModelContextWindow(config)
    // 2. 估算 system prompt + 桌宠上下文注入的 token（它们占用窗口，需从预算扣除）
    const systemPromptText = `${session.system_prompt || ''}\n\n${data.options?.pet_context || ''}`
    const systemTokens = estimateTokens(systemPromptText)
    // 3. 输出预留（max_tokens 或预设 output，保底 4096）
    const outputReserve = ctxInfo.output > 0 ? ctxInfo.output : 4096
    // 4. 历史消息可用预算 = 窗口 - system - 输出预留 - 安全余量(512)
    const budgetForHistory = ctxInfo.context - systemTokens - outputReserve - 512
    // 5. 按 token 预算截断（从最早丢弃）
    const truncateResult = truncateByTokenBudget(historyMessages, budgetForHistory)
    historyMessages = truncateResult.messages
    logger.info('ChatChannels', `上下文窗口: ${ctxInfo.context} (来源: ${ctxInfo.source}), system: ${systemTokens}t, 输出预留: ${outputReserve}t, 历史预算: ${budgetForHistory}t, 保留 ${historyMessages.length}/${truncateResult.dropped + historyMessages.length} 条, 丢弃 ${truncateResult.dropped} 条`)

    // 将截断信息附加到 options，供 _runStreamGeneration 在上下文注入事件中展示丢弃记录
    data.options = data.options || {}
    data.options._contextTruncation = {
      window: ctxInfo.context,
      source: ctxInfo.source,
      systemTokens,
      outputReserve,
      budget: budgetForHistory,
      kept: historyMessages.length,
      dropped: truncateResult.dropped,
      total: truncateResult.dropped + historyMessages.length
    }

    // 转换为适配器消息格式（支持多模态）
    const messages = _buildAdapterMessages(historyMessages)

    // 桌宠自动对话：user_message 通过 options 传递，不保存到数据库（不在历史会话中显示）
    // 仅追加到 messages 数组供 AI 可见
    const userMessageOption = data.options?.user_message
    if (userMessageOption) {
      messages.push({ role: 'user', content: userMessageOption })
    }

    // 检测当前最新用户消息是否包含图片附件（用于多模态检测）
    const latestUserMsg = userMessageOption
      ? { content: userMessageOption }
      : historyMessages[historyMessages.length - 1]
    const hasImageAttachment = latestUserMsg && _hasImageAttachment(latestUserMsg.content)

    // 创建 assistant 占位消息（is_complete = 0）
    const assistantMessage = chatMessageDao.create({
      session_id: data.session_id,
      role: 'assistant',
      content: '',
      is_complete: 0
    })

    // 获取发送事件的 BrowserWindow，用于推送流式增量
    const win = BrowserWindow.fromWebContents(event.sender)
    const sessionId = data.session_id
    const messageId = assistantMessage.id

    // 推送流式开始事件
    if (win && !win.isDestroyed()) {
      win.webContents.send(EVENT_STREAM_START, { session_id: sessionId, message_id: messageId, config_id: config.id })
    }

    // 异步发起流式请求（不阻塞 IPC 响应）
    _runStreamGeneration(win, sessionId, messageId, config, messages, session.system_prompt, data.options || {}, hasImageAttachment)

    // 立即返回 assistant 消息 ID，渲染进程据此监听流式增量
    return success({ message_id: messageId, session_id: sessionId, config_id: config.id })
  } catch (error) {
    logger.error('ChatChannels', `chat:message:generate 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

/**
 * 执行流式生成（异步，不阻塞 IPC 响应）
 * @param {BrowserWindow|null} win 目标窗口
 * @param {string} sessionId 会话 ID
 * @param {string} messageId assistant 消息 ID
 * @param {object} config AI 配置
 * @param {Array} messages 历史消息列表
 * @param {string} systemPrompt 系统提示词
 * @param {object} options 生成选项
 * @param {boolean} hasImageAttachment 是否包含图片附件
 */
async function _runStreamGeneration (win, sessionId, messageId, config, messages, systemPrompt, options, hasImageAttachment = false) {
  let accumulated = ''
  // 思考过程与正式回复分离累积（推理模型 DeepSeek-R1 / Claude thinking / o1 等）
  let contentAccumulated = ''
  let thinkingAccumulated = ''
  const mediaTools = getMediaTools()
  let currentMessages = [...messages]
  const MAX_TOOL_ITERATIONS = 3
  let toolCallCount = 0

  // 桌宠上下文注入：将 pet_context 合并到系统提示词中（AI 可见），同时显示在上下文注入框中
  const petContext = options?.pet_context || ''
  let effectiveSystemPrompt = petContext
    ? `${systemPrompt ? systemPrompt + '\n\n' : ''}${petContext}`
    : systemPrompt

  // 丰富系统提示词：注入当前本地时间上下文（桌宠对话由 petContext 已含时间，普通对话在此注入）
  // 让 AI 感知当前时间，避免每次回复雷同，提升上下文相关性
  if (!petContext) {
    const timeContext = `[当前时间 - ${dateUtils.nowISO()}]`
    effectiveSystemPrompt = effectiveSystemPrompt
      ? `${effectiveSystemPrompt}\n\n${timeContext}`
      : timeContext
  }

  // 确保温度参数有合理默认值，提升回复多样性（避免温度过低导致回复雷同）
  // 仅在调用方未指定 temperature 时填充默认值 0.7
  if (options.temperature == null) {
    options = { ...options, temperature: 0.7 }
  }

  try {
    for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
      accumulated = ''
      contentAccumulated = ''
      thinkingAccumulated = ''

      // 每轮调用前，推送上下文注入事件（显示在聊天栏中）
      if (win && !win.isDestroyed()) {
        const contextItems = []

        // 1. 系统提示词
        if (effectiveSystemPrompt) {
          contextItems.push({
            key: '系统提示词',
            value: effectiveSystemPrompt.length > 50 ? effectiveSystemPrompt.slice(0, 50) + '...' : effectiveSystemPrompt
          })
        }

        // 2. 桌宠上下文（完整内容，展开可查看）
        if (petContext) {
          contextItems.push({
            key: '桌宠上下文',
            value: petContext.length > 80 ? petContext.slice(0, 80) + '...' : petContext,
            fullValue: petContext
          })
        }

        // 2.5 桌宠自动对话指令（不保存到 DB，但 AI 可见，展开可查看完整内容）
        const userMessageOption = options?.user_message
        if (userMessageOption) {
          contextItems.push({
            key: '自动对话指令',
            value: userMessageOption.length > 80 ? userMessageOption.slice(0, 80) + '...' : userMessageOption,
            fullValue: userMessageOption
          })
        }

        // 3. 历史消息
        contextItems.push({
          key: '历史消息',
          value: `${currentMessages.length} 条消息`
        })

        // 3.5 上下文截断记录（token 预算截断，显示丢弃情况）
        const truncation = options?._contextTruncation
        if (truncation) {
          contextItems.push({
            key: '上下文截断',
            value: `窗口 ${truncation.window} (${truncation.source})，保留 ${truncation.kept}/${truncation.total} 条${truncation.dropped > 0 ? `，丢弃 ${truncation.dropped} 条` : ''}`,
            fullValue: `上下文窗口: ${truncation.window} tokens (来源: ${truncation.source})\n系统提示词: ${truncation.systemTokens} tokens\n输出预留: ${truncation.outputReserve} tokens\n历史预算: ${truncation.budget} tokens\n保留: ${truncation.kept}/${truncation.total} 条\n丢弃: ${truncation.dropped} 条`
          })
        }

        // 4. 工具定义
        contextItems.push({
          key: '可用工具',
          value: mediaTools.map(t => t.name).join('、')
        })

        // 5. 工具调用历史（非首轮）
        if (iteration > 0) {
          const toolHistory = currentMessages.filter(m => m.role === 'tool')
          contextItems.push({
            key: '工具调用结果',
            value: `${toolHistory.length} 条结果`
          })
        }

        const injectionTitle = iteration === 0
          ? `上下文注入（${currentMessages.length} 条历史消息）`
          : `第 ${iteration + 1} 轮上下文注入（含工具结果）`
        const injectionDescription = iteration === 0
          ? `注入 ${currentMessages.length} 条历史消息 + ${mediaTools.length} 个工具定义`
          : `注入工具调用结果，继续第 ${iteration + 1} 轮对话`

        const injectionData = {
          iteration,
          toolCallCount,
          contextItems,
          title: injectionTitle,
          description: injectionDescription,
          timestamp: Date.now()
        }

        win.webContents.send(EVENT_CONTEXT_INJECT, {
          session_id: sessionId,
          message_id: messageId,
          ...injectionData
        })

        // 持久化到数据库（切换会话后切回来仍可显示）
        chatMessageDao.appendContextInjection(messageId, injectionData)

        logger.info('ChatChannels', `已推送上下文注入事件: iteration=${iteration}, messageId=${messageId}`)
      }

      const result = await aiAdapterFactory.chatStream(
        config,
        sessionId,
        currentMessages,
        { ...options, system_prompt: effectiveSystemPrompt, enable_vision: hasImageAttachment, tools: mediaTools },
        (chunk) => {
          // chunk 为 { content?, thinking? } 对象，分离累积
          if (chunk && chunk.content) contentAccumulated += chunk.content
          if (chunk && chunk.thinking) thinkingAccumulated += chunk.thinking
          accumulated = contentAccumulated // 兼容旧字段
          if (win && !win.isDestroyed()) {
            win.webContents.send(EVENT_STREAM_CHUNK, {
              session_id: sessionId,
              message_id: messageId,
              chunk,
              accumulated, // 兼容旧字段（= contentAccumulated）
              contentAccumulated, // 正式回复累积
              thinkingAccumulated, // 思考过程累积
              iteration,
              toolCallCount
            })
          }
        }
      )

      const finalContent = result.content || contentAccumulated
      const finalThinking = result.thinking || thinkingAccumulated
      const isComplete = !result.stopped

      // 如果没有工具调用，完成生成
      if (!result.toolCalls || result.toolCalls.length === 0) {
        // 持久化：思考过程用  IMD  标记包裹，放在正式内容前（与 DeepSeek 官方格式一致）
        const persistedContent = finalThinking
          ? ` IMD ${finalThinking} IMD \n\n${finalContent}`
          : finalContent
        chatMessageDao.update(messageId, persistedContent)
        if (isComplete) {
          chatMessageDao.markComplete(messageId)
        }

        // 推送最终完成事件，包含上下文信息
        if (win && !win.isDestroyed()) {
          win.webContents.send(EVENT_STREAM_END, {
            session_id: sessionId,
            message_id: messageId,
            content: persistedContent,
            stopped: result.stopped,
            contextSummary: toolCallCount > 0 ? `AI已调用${toolCallCount}次工具` : null
          })
        }

        logger.info('ChatChannels', `会话 ${sessionId} 流式生成完成，内容长度: ${finalContent.length}，思考过程长度: ${finalThinking.length}，工具调用次数: ${toolCallCount}`)
        broadcastMessagesChanged(sessionId, 'generate')
        return
      }

      // 有工具调用：统计并推送事件给前端
      for (const tc of result.toolCalls) {
        if (tc && tc.function) {
          toolCallCount++
          let args = {}
          try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* 忽略 */ }
          const toolType = tc.function.name === 'generate_image' ? 'image' : 'video'

          // 推送工具调用上下文事件（显示在聊天栏中）
          if (win && !win.isDestroyed()) {
            const toolCallContext = {
              toolCallId: tc.id,
              name: tc.function.name,
              type: toolType,
              prompt: args.prompt || '',
              iteration,
              toolCallCount,
              status: 'pending',
              args,
              contextInfo: {
                title: `AI 调用 ${tc.function.name === 'generate_image' ? '生图' : '生视频'} 工具`,
                description: `AI 判断需要生成${toolType === 'image' ? '图片' : '视频'}，正在请求调用工具`,
                injectedContext: [
                  { key: '工具名称', value: tc.function.name },
                  { key: '媒体类型', value: toolType === 'image' ? '图片' : '视频' },
                  { key: '提示词', value: args.prompt || '' },
                  { key: '调用轮次', value: `第 ${iteration + 1} 轮（共 ${toolCallCount} 次）` }
                ],
                message: '已将工具调用记录注入对话上下文，AI 将基于此结果继续回复'
              },
              timestamp: Date.now()
            }

            win.webContents.send(EVENT_TOOL_CALL, {
              session_id: sessionId,
              message_id: messageId,
              tool_call_id: tc.id,
              name: tc.function.name,
              type: toolType,
              prompt: args.prompt || '',
              iteration,
              toolCallCount,
              status: 'pending',
              args,
              contextInfo: toolCallContext.contextInfo
            })

            // 持久化到数据库
            chatMessageDao.appendToolCallContext(messageId, toolCallContext)
          }
          logger.info('ChatChannels', `会话 ${sessionId} 工具调用 [${toolCallCount}]: ${tc.function.name}(${args.prompt})`)
        }
      }

      // 将 assistant 的工具调用消息加入上下文，继续下一轮
      currentMessages.push({
        role: 'assistant',
        content: finalContent || null,
        tool_calls: result.toolCalls
      })
      // 为每个工具调用添加占位的 tool 响应（前端确认后会被替换）
      for (const tc of result.toolCalls) {
        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ status: 'pending', message: '等待用户确认' })
        })
      }
    }

    // 达到最大迭代次数，结束生成
    // 持久化：思考过程用  IMD  标记包裹，放在正式内容前
    const maxIterPersisted = thinkingAccumulated
      ? ` IMD ${thinkingAccumulated} IMD \n\n${contentAccumulated}`
      : contentAccumulated
    chatMessageDao.update(messageId, maxIterPersisted)
    chatMessageDao.markComplete(messageId)
    if (win && !win.isDestroyed()) {
      win.webContents.send(EVENT_STREAM_END, {
        session_id: sessionId,
        message_id: messageId,
        content: maxIterPersisted,
        stopped: false,
        contextSummary: `已调用${toolCallCount}次工具（达到最大迭代次数）`
      })
    }
    broadcastMessagesChanged(sessionId, 'generate')
  } catch (error) {
    logger.error('ChatChannels', `会话 ${sessionId} 流式生成错误: ${error.message}`)

    if (contentAccumulated) {
      chatMessageDao.update(messageId, contentAccumulated)
    }

    if (win && !win.isDestroyed()) {
      win.webContents.send(EVENT_STREAM_ERROR, {
        session_id: sessionId,
        message_id: messageId,
        error: { code: error.code || 'AI_GENERATE_ERROR', message: error.message },
        partial: contentAccumulated
      })
    }
    broadcastMessagesChanged(sessionId, 'generate')
  }
}

// ============================================================
// chat:message:stop
// 停止指定会话的流式生成
// ============================================================
register('chat:message:stop', async (event, data) => {
  try {
    if (!data.session_id) {
      return failure('SESSION_ID_REQUIRED', '会话 ID 不能为空')
    }
    const stopped = aiAdapterFactory.stopGeneration(data.session_id)
    return success({ stopped })
  } catch (error) {
    logger.error('ChatChannels', `chat:message:stop 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:message:delete
// 删除指定消息（用于重新生成场景）
// ============================================================
register('chat:message:delete', async (event, data) => {
  try {
    if (!data.id) {
      return failure('MESSAGE_ID_REQUIRED', '消息 ID 不能为空')
    }
    const result = chatMessageDao.del(data.id)
    return success({ deleted: result })
  } catch (error) {
    logger.error('ChatChannels', `chat:message:delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:message:clear-by-session
// 清空指定会话的所有消息（用于常驻会话清空记录）
// ============================================================
register('chat:message:clear-by-session', async (event, data) => {
  try {
    if (!data.session_id) {
      return failure('SESSION_ID_REQUIRED', '会话 ID 不能为空')
    }
    const result = chatMessageDao.deleteBySession(data.session_id)
    broadcastMessagesChanged(data.session_id, 'clear')
    return success({ deleted: result })
  } catch (error) {
    logger.error('ChatChannels', `chat:message:clear-by-session 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// 辅助函数
// ============================================================

/**
 * 构建适配器消息格式，支持多模态内容
 * 过滤未完成的空占位消息（如正在生成的 assistant 消息），避免污染上下文导致接续聊天混乱
 * @param {Array} messages 数据库消息列表
 * @returns {Array} 适配器格式的消息列表
 */
function _buildAdapterMessages (messages) {
  return messages
    // 过滤未完成的空 assistant 占位消息，避免把空回复传给 LLM 影响接续聊天
    .filter(m => {
      if (m.role === 'assistant' && Number(m.is_complete) === 0) {
        const content = typeof m.content === 'string' ? m.content.trim() : ''
        if (!content) return false
      }
      return true
    })
    .map(m => {
      const msg = { role: m.role }
      // 如果 content 是对象且有 attachments，构建多模态格式
      if (typeof m.content === 'object' && m.content !== null && !Array.isArray(m.content)) {
        const parts = []
        if (m.content.text) {
          parts.push({ type: 'text', text: m.content.text })
        }
        if (m.content.attachments && Array.isArray(m.content.attachments)) {
          for (const att of m.content.attachments) {
            if (att.type === 'image' && att.base64) {
              const mimeType = att.mime_type || 'image/png'
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${att.base64}` }
              })
            }
          }
        }
        // 如果没有图片，退化为纯文本
        if (parts.length === 0 || (parts.length === 1 && parts[0].type === 'text')) {
          msg.content = m.content.text || String(m.content)
        } else {
          msg.content = parts
        }
      } else {
        msg.content = String(m.content)
      }
      return msg
    })
}

/**
 * 检测消息内容是否包含图片附件
 * @param {*} content 消息内容
 * @returns {boolean}
 */
function _hasImageAttachment (content) {
  if (typeof content !== 'object' || content === null) return false
  if (content.attachments && Array.isArray(content.attachments)) {
    return content.attachments.some(att => att.type === 'image' && att.base64)
  }
  return false
}

// ============================================================
// ai-chat:generate-plan
// 调用 AI 生成规划（短期或长期），返回结构化规划结果
// ============================================================
register('ai-chat:generate-plan', async (event, data) => {
  try {
    const { prompt, longTerm = false } = data || {}
    if (!prompt) {
      return failure('PROMPT_REQUIRED', '规划描述不能为空')
    }

    // 查找活跃的 AI 配置
    const activeConfig = aiConfigDao.getActive()
    if (!activeConfig) {
      return failure('NO_ACTIVE_CONFIG', '请先在 AI 模型配置中激活一个模型')
    }

    // 构造系统提示词
    const systemPrompt = longTerm
      ? `你是一个项目管理助手。用户会描述一个目标，你需要生成一个结构化的长期计划。输出 JSON：{ "title": "计划标题", "summary": "概览", "longPlan": { "goal": "目标说明", "totalCycles": 周期数, "cycleLengthDays": 每周期天数, "roadmap": ["阶段1", "阶段2"], "cycles": [{ "title": "周期标题", "goal": "周期目标", "days": [{ "day": 天数, "focus": "专注主题", "tasks": [{ "title": "任务标题", "meta": "备注" }] }] } ] } }`
      : `你是一个任务管理助手。用户会描述目标，你需要生成短期计划。输出 JSON：{ "tasks": [{ "title": "任务标题", "meta": "备注" }], "groups": [{ "name": "流程名", "description": "描述", "steps": [{ "name": "步骤名", "duration": 分钟数 }] }], "projects": [{ "name": "项目名", "description": "描述", "milestones": [{ "title": "里程碑" }] }] }`

    // 调用 AI 流式生成（非流式，等待完整结果）
    const result = await aiAdapterFactory.chatStream(
      activeConfig,
      `plan-gen-${Date.now()}`,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.7, max_tokens: 4000 },
      null  // 无 chunk 回调
    )

    // 解析 AI 返回的 JSON
    let plan = null
    if (result?.content) {
      try {
        const jsonMatch = result.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
        const jsonStr = jsonMatch ? jsonMatch[1] : result.content
        plan = JSON.parse(jsonStr)
      } catch (e) {
        logger.warn('ChatChannels', `AI 规划 JSON 解析失败: ${e.message}`)
        plan = { raw: result.content }
      }
    }

    return success({ plan })
  } catch (error) {
    logger.error('ChatChannels', `ai-chat:generate-plan 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}
