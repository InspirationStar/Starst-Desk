// ============================================================
// AI 对话 Pinia Store
// 职责：管理会话列表、当前会话、消息列表、流式生成状态
// 监听主进程流式推送事件，实时更新消息内容
// 设计依据：design.md 2.7.3.2 节
// ============================================================

import { defineStore } from 'pinia'
import dayjs from 'dayjs'
import { chatApi, mediaApi, mediaAssetApi, on } from '@/utils/ipc-client'
import { isUrlFailed, markUrlFailed } from '@/utils/media-loader'
import { PET_ASSISTANT_SESSION_TITLE } from '@/utils/pet-ai-prompt'

// 流式事件通道名
const EVENT_STREAM_START = 'ai:stream:start'
const EVENT_STREAM_CHUNK = 'ai:stream:chunk'
const EVENT_STREAM_END = 'ai:stream:end'
const EVENT_STREAM_ERROR = 'ai:stream:error'
const EVENT_TOOL_CALL = 'ai:tool-call'
const EVENT_CONTEXT_INJECT = 'ai:context-inject'

/**
 * 将前端附件对象转换为后端 chat:message:send 期望的格式
 * 图片附件从 data URL 提取 mime_type 与 base64，用于多模态消息内容
 */
function toBackendAttachment (att) {
  const result = {
    type: att.type || 'file',
    name: att.name || 'attachment',
    file_url: att.url || att.file_url || null,
    file_path: att.file_path || null,
    file_size: att.size || att.file_size || 0,
    mime_type: att.mime_type || null,
    width: att.width || null,
    height: att.height || null
  }
  // 从 data URL 提取 base64 与 mime_type（图片多模态必需）
  if (result.type === 'image' && typeof result.file_url === 'string' && result.file_url.startsWith('data:')) {
    const match = result.file_url.match(/^data:([^;]+);base64,(.*)$/)
    if (match) {
      result.mime_type = match[1]
      result.base64 = match[2]
    }
  }
  return result
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    // 会话列表（按 updated_at 倒序）
    sessions: [],
    // 当前会话
    currentSession: null,
    // 当前会话的消息列表
    messages: [],
    // 流式生成状态
    streaming: {
      isStreaming: false,        // 是否正在流式生成
      sessionId: null,           // 当前流式会话 ID
      messageId: null,           // 正在生成的 assistant 消息 ID
      accumulatedContent: '',    // 已累积的完整内容
      accumulatedThinking: '',   // 已累积的思考过程（推理模型）
      error: null                // 错误信息
    },
    // 加载状态
    loading: false,
    // 最近一次错误
    error: null,
    // 当前模型类别（language / image / video）
    currentModelCategory: 'language',
    // 当前选中的图生/视频模型配置 ID（仅当 currentModelCategory 非 language 时使用）
    selectedMediaConfigId: null,
    // 媒体生成状态（图生/视频生异步流程）
    mediaGenerating: {
      isGenerating: false,     // 是否正在生成媒体
      type: null,              // 生成类型 'image' | 'video'
      messageId: null,         // 占位消息 ID
      progress: 0,             // 进度百分比 0-100
      taskId: null,            // 异步任务 ID（视频轮询用）
      error: null              // 错误信息
    },
    // 事件监听取消函数列表（用于卸载时清理）
    _unsubscribers: [],
    // 待处理的工具调用（AI 主动请求生成媒体时弹出确认框）
    pendingToolCall: null,
    // 缓冲的上下文注入事件（message_id → array），在消息占位添加后回放
    _pendingContextInjects: {},
    // 缓冲的工具调用事件（message_id → array），在消息占位添加后回放
    _pendingToolCalls: {}
  }),

  getters: {
    /**
     * 是否正在生成
     * @returns {boolean}
     */
    isGenerating (state) {
      return state.streaming.isStreaming
    },

    /**
     * 流式累积内容
     * @returns {string}
     */
    streamingContent (state) {
      return state.streaming.accumulatedContent
    },

    /**
     * 流式累积思考过程（推理模型）
     * @returns {string}
     */
    streamingThinking (state) {
      return state.streaming.accumulatedThinking
    },

    /**
     * 是否有会话
     * @returns {boolean}
     */
    hasSessions (state) {
      return state.sessions.length > 0
    },

    /**
     * 当前会话 ID
     * @returns {string|null}
     */
    currentSessionId (state) {
      return state.currentSession?.id || null
    },

    /**
     * 是否为语言模型类别
     * @returns {boolean}
     */
    isLanguageCategory (state) {
      return state.currentModelCategory === 'language'
    },

    /**
     * 是否为图生模型类别
     * @returns {boolean}
     */
    isImageCategory (state) {
      return state.currentModelCategory === 'image'
    },

    /**
     * 是否为视频模型类别
     * @returns {boolean}
     */
    isVideoCategory (state) {
      return state.currentModelCategory === 'video'
    },

    /**
     * 是否为媒体生成类别（图生或视频）
     * @returns {boolean}
     */
    isMediaCategory (state) {
      return state.currentModelCategory === 'image' || state.currentModelCategory === 'video'
    },

    /**
     * 是否正在生成媒体（图生/视频）
     * @returns {boolean}
     */
    isMediaGenerating (state) {
      return state.mediaGenerating.isGenerating
    },

    /**
     * 媒体生成进度
     * @returns {number}
     */
    mediaProgress (state) {
      return state.mediaGenerating.progress
    }
  },

  actions: {
    // ============================================================
    // 事件监听初始化与清理
    // ============================================================

    /**
     * 初始化流式事件监听（在组件挂载时调用）
     */
    initStreamListeners () {
      // 避免重复注册
      if (this._unsubscribers.length > 0) return

      const unsub1 = on(EVENT_STREAM_START, (payload) => this._onStreamStart(payload))
      const unsub2 = on(EVENT_STREAM_CHUNK, (payload) => this._onStreamChunk(payload))
      const unsub3 = on(EVENT_STREAM_END, (payload) => this._onStreamEnd(payload))
      const unsub4 = on(EVENT_STREAM_ERROR, (payload) => this._onStreamError(payload))
      const unsub5 = on(EVENT_TOOL_CALL, (payload) => this._onToolCall(payload))
      const unsub6 = on(EVENT_CONTEXT_INJECT, (payload) => this._onContextInject(payload))
      const unsub7 = on('chat:messages-changed', (payload) => this._onMessagesChanged(payload))

      this._unsubscribers = [unsub1, unsub2, unsub3, unsub4, unsub5, unsub6, unsub7]
    },

    /**
     * 清理流式事件监听（在组件卸载时调用）
     */
    destroyStreamListeners () {
      for (const unsub of this._unsubscribers) {
        if (typeof unsub === 'function') unsub()
      }
      this._unsubscribers = []
    },

    // ============================================================
    // 会话管理
    // ============================================================

    /**
     * 拉取会话列表
     * @returns {Promise<Array>}
     */
    async fetchSessions () {
      this.loading = true
      this.error = null
      try {
        const result = await chatApi.listSessions()
        this.sessions = result.list || []
        return this.sessions
      } catch (err) {
        this.error = err.message
        console.error('[chat-store] fetchSessions 失败:', err)
        return []
      } finally {
        this.loading = false
      }
    },

    /**
     * 创建会话
     * @param {object} data { title, model_config_id, system_prompt? }
     * @returns {Promise<object|null>}
     */
    async createSession (data) {
      this.error = null
      try {
        const session = await chatApi.createSession(data)
        this.sessions.unshift(session)
        return session
      } catch (err) {
        this.error = err.message
        console.error('[chat-store] createSession 失败:', err)
        return null
      }
    },

    /**
     * 删除会话
     * @param {string} id 会话 ID
     * @returns {Promise<boolean>}
     */
    async deleteSession (id) {
      this.error = null
      try {
        // 保护常驻会话（桌宠助手）不可删除
        const session = this.sessions.find(s => s.id === id)
        if (session && session.title === PET_ASSISTANT_SESSION_TITLE) {
          this.error = '常驻会话不可删除'
          return false
        }
        await chatApi.deleteSession(id)
        this.sessions = this.sessions.filter(s => s.id !== id)
        // 如果删除的是当前会话，清空当前会话
        if (this.currentSession?.id === id) {
          this.currentSession = null
          this.messages = []
        }
      return true
      } catch (err) {
        this.error = err.message
        console.error('[chat-store] deleteSession 失败:', err)
        return false
      }
    },

    /**
     * 批量删除会话
     * @param {Array<string>} ids 会话 ID 数组
     * @returns {Promise<{success: number, failed: number}>}
     */
    async bulkDeleteSessions (ids) {
      this.error = null
      let success = 0
      let failed = 0
      try {
        // 过滤掉常驻会话
        const protectedIds = ids.filter(id => {
          const session = this.sessions.find(s => s.id === id)
          return session && session.title === PET_ASSISTANT_SESSION_TITLE
        })
        const deletableIds = ids.filter(id => {
          const session = this.sessions.find(s => s.id === id)
          return session && session.title !== PET_ASSISTANT_SESSION_TITLE
        })

        if (protectedIds.length > 0) {
          ElMessage.warning('常驻会话不可删除')
        }

        if (deletableIds.length > 0) {
          const result = await chatApi.bulkDeleteSessions(deletableIds)
          success = result.deleted || 0
          failed = deletableIds.length - success

          // 从本地列表中移除
          this.sessions = this.sessions.filter(s => !deletableIds.includes(s.id))

          // 如果删除的是当前会话，清空当前会话
          if (this.currentSession && deletableIds.includes(this.currentSession.id)) {
            this.currentSession = null
            this.messages = []
          }
        }

        return { success, failed }
      } catch (err) {
        this.error = err.message
        console.error('[chat-store] bulkDeleteSessions 失败:', err)
        return { success: 0, failed: ids.length }
      }
    },

    /**
     * 清空指定会话的所有消息（保留会话本身）
     * 用于常驻会话（桌宠助手）清空记录
     * @param {string} sessionId 会话 ID
     * @returns {Promise<boolean>}
     */
    async clearMessages (sessionId) {
      this.error = null
      try {
        await chatApi.clearMessagesBySession(sessionId)
        // 如果清空的是当前会话，同步清空消息列表
        if (this.currentSession?.id === sessionId) {
          this.messages = []
        }
        return true
      } catch (err) {
        this.error = err.message
        console.error('[chat-store] clearMessages 失败:', err)
        return false
      }
    },

    /**
     * 确保桌宠助手常驻会话存在（查找或创建）
     * 统一入口：PetApp 和 ChatView 共用，避免各自创建导致冲突
     * @param {object} data - { system_prompt? }
     * @returns {Promise<object|null>} { session, messages, configId } 或 null
     */
    async ensurePetAssistantSession (data) {
      try {
        const result = await chatApi.ensurePetAssistantSession(data)
        if (result?.session) {
          // 同步到 sessions 列表
          const idx = this.sessions.findIndex(s => s.id === result.session.id)
          if (idx >= 0) {
            this.sessions[idx] = result.session
          } else {
            this.sessions.unshift(result.session)
          }
          return result
        }
        return null
      } catch (err) {
        console.error('[chat-store] ensurePetAssistantSession 失败:', err)
        return null
      }
    },

    /**
     * 切换会话
     * @param {object} session 会话对象
     * @returns {Promise<Array>} 会话消息列表
     */
    async switchSession (session) {
      this.currentSession = session
      return await this.fetchMessages(session.id)
    },

    /**
     * 更新会话（标题、系统提示词）
     * @param {object} data { id, title?, system_prompt? }
     * @returns {Promise<object|null>}
     */
    async updateSession (data) {
      this.error = null
      try {
        const session = await chatApi.updateSession(data)
        // 本地同步更新
        const index = this.sessions.findIndex(s => s.id === data.id)
        if (index !== -1) {
          this.sessions[index] = { ...this.sessions[index], ...session }
        }
        if (this.currentSession?.id === data.id) {
          this.currentSession = { ...this.currentSession, ...session }
        }
        return session
      } catch (err) {
        this.error = err.message
        console.error('[chat-store] updateSession 失败:', err)
        return null
      }
    },

    // ============================================================
    // 消息管理
    // ============================================================

    /**
     * 拉取当前会话的消息列表
     * @param {string} sessionId 会话 ID
     * @returns {Promise<Array>}
     */
    async fetchMessages (sessionId) {

      this.error = null
      try {
        const result = await chatApi.listMessages(sessionId)
        const list = result.list || []
        // 从 content 解析媒体类型，恢复 mediaType/mediaStatus/mediaMetadata（数据库不存储这些字段）
        // 同时恢复 contextInjections / toolCallContexts（持久化在 chat_messages 表中）
        for (const msg of list) {
          // 恢复上下文注入记录
          if (msg.context_injections) {
            try {
              msg.contextInjections = JSON.parse(msg.context_injections)
            } catch { /* 忽略 JSON 解析错误 */ }
            delete msg.context_injections
          }
          // 恢复工具调用上下文记录
          if (msg.tool_call_contexts) {
            try {
              msg.toolCallContexts = JSON.parse(msg.tool_call_contexts)
            } catch { /* 忽略 JSON 解析错误 */ }
            delete msg.tool_call_contexts
          }
          if (msg.role === 'assistant' && msg.content) {
            // 图片：![生成图片](url)
            const imgMatch = msg.content.match(/^!\[[^\]]*\]\(([^)]+)\)/)
            if (imgMatch) {
              msg.mediaType = 'image'
              msg.mediaStatus = 'success'
              msg.mediaProgress = 100
              msg.mediaMetadata = { url: imgMatch[1] }
              continue
            }
            // 视频：<video src="url" ...>
            const videoMatch = msg.content.match(/<video[^>]+src=["']([^"']+)["']/)
            if (videoMatch) {
              msg.mediaType = 'video'
              msg.mediaStatus = 'success'
              msg.mediaProgress = 100
              msg.mediaMetadata = { url: videoMatch[1] }
            }
          }
        }
        // 批量查询 media_assets 获取本地文件路径
        const messageIds = list
          .filter(msg => msg.mediaType)
          .map(msg => msg.id)
        if (messageIds.length > 0) {
          try {
            const { list: assets } = await mediaAssetApi.findByMessageIds(messageIds)
            // 建立 message_id → file_path 映射
            const assetMap = {}
            for (const asset of assets) {
              if (asset.file_path) {
                assetMap[asset.message_id] = asset.file_path
              }
            }
            // 设置 localPath 到 mediaMetadata
            for (const msg of list) {
              if (msg.mediaType && assetMap[msg.id]) {
                msg.mediaMetadata = msg.mediaMetadata || {}
                msg.mediaMetadata.localPath = assetMap[msg.id]
              }
            }
          } catch (err) {
            console.warn('[chat-store] 查询 media_assets 失败，不影响消息加载:', err)
          }
        }
        // backfill：对有 mediaType 但无 localPath 的历史消息，异步下载保存到本地（不阻塞消息显示）
        const needBackfill = list.filter(msg =>
          msg.mediaType &&
          msg.mediaMetadata?.url &&
          !msg.mediaMetadata?.localPath
        )
        if (needBackfill.length > 0) {
          this._backfillMediaLocalPath(needBackfill, sessionId)
        }
        this.messages = list

        return this.messages
      } catch (err) {
        this.error = err.message
        console.error('[chat-store] fetchMessages 失败:', err)
        return []
      }
    },

    /**
     * 异步补全历史媒体消息的本地文件路径
     * 对没有 localPath 的媒体消息，下载 URL 保存到本地，更新 media_assets 记录
     * 不阻塞消息显示，完成后更新 msg.mediaMetadata.localPath
     * @param {Array} messages 需要补全的消息列表
     * @param {string} sessionId 当前会话 ID
     */
    async _backfillMediaLocalPath (messages, sessionId) {
      for (const msg of messages) {
        try {
          const url = msg.mediaMetadata.url
          // 跳过 data:/blob: URL
          if (/^(data|blob):/.test(url)) continue
          // 跳过已标记为失败的 URL（避免每次切换会话都重试 404）
          if (isUrlFailed(url)) {
            msg.mediaMetadata = msg.mediaMetadata || {}
            msg.mediaMetadata.loadFailed = true
            continue
          }

          // 先查询 media_assets 记录，判断资产是否已被用户删除
          const { list: existingAssets } = await mediaAssetApi.findByMessageIds([msg.id])
          if (existingAssets && existingAssets.length > 0) {
            const asset = existingAssets[0]
            if (asset.file_path) {
              // 已有记录且有 file_path：直接使用，无需下载
              msg.mediaMetadata = msg.mediaMetadata || {}
              msg.mediaMetadata.localPath = asset.file_path
            } else {
              // 已有记录但 file_path 为空：下载并更新
              let localPath
              try {
                const result = await mediaApi.saveToLocal(url)
                localPath = result?.localPath
              } catch (downloadErr) {
                markUrlFailed(url)
                msg.mediaMetadata = msg.mediaMetadata || {}
                msg.mediaMetadata.loadFailed = true
                console.warn('[chat-store] backfill: URL 已失效:', msg.id, downloadErr.message)
                continue
              }
              if (localPath) {
                await mediaAssetApi.updatePath(asset.id, localPath)
                msg.mediaMetadata = msg.mediaMetadata || {}
                msg.mediaMetadata.localPath = localPath
              }
            }
          } else {
            // 无 media_assets 记录：资产已被用户删除（或从未保存）
            // 不自动下载和创建记录，由 MessageBubble 显示"已删除"占位 + "重新加载到资产盒子"按钮
            msg.mediaMetadata = msg.mediaMetadata || {}
            msg.mediaMetadata.assetDeleted = true
          }
        } catch (err) {
          console.warn('[chat-store] backfill: 媒体下载失败，不影响显示:', msg.id, err)
        }
      }
    },

    /**
     * 发送消息（保存用户消息 + 触发 AI 流式生成）
     * @param {string} content 用户消息内容
     * @param {object} [options] 生成选项 { config_id?, temperature?, max_tokens?, attachments? }
     * @param {Array} [options.attachments] 附件列表（图片等，随消息存入 DB 并构建多模态内容）
     * @returns {Promise<boolean>}
     */
    async sendMessage (content, options = {}) {
      if (!this.currentSession) {
        this.error = '未选择会话'
        return false
      }
      if (!content || !content.trim()) {
        this.error = '消息内容不能为空'
        return false
      }
      if (this.streaming.isStreaming) {
        this.error = '正在生成中，请稍候'
        return false
      }

      this.error = null
      const sessionId = this.currentSession.id

      try {
        // 1. 保存用户消息（携带附件，接通多模态链路）
        const attachments = Array.isArray(options.attachments) && options.attachments.length > 0
          ? options.attachments.map(toBackendAttachment)
          : undefined
        const userMessage = await chatApi.sendMessage({
          session_id: sessionId,
          content: content.trim(),
          ...(attachments ? { attachments } : {})
        })
        this.messages.push(userMessage)

        // 2. 触发 AI 流式生成（附件已随消息存入 DB，generate 从历史读取多模态 content）
        const generateResult = await chatApi.generateMessage({
          session_id: sessionId,
          config_id: options.config_id,
          options: {
            temperature: options.temperature,
            max_tokens: options.max_tokens,
            enable_thinking: options.enable_thinking,
            reasoning_effort: options.reasoning_effort
          }
        })

        // 3. 后端已创建 assistant 占位消息（在 chat:message:generate 中），
        // 流式增量将更新此消息，我们只需设置流式状态
        // 注意：不要在此处创建 assistant 消息，否则会导致消息重复
        this.streaming = {
          isStreaming: true,
          sessionId,
          messageId: generateResult.message_id,
          accumulatedContent: '',
          error: null
        }

        // 4. 确保 assistant 占位消息在 messages 中（后端已创建，前端需要添加）
        // 如果消息列表中还没有这个消息，添加一个占位
        const existingAssistant = this.messages.find(m => m.id === generateResult.message_id)
        if (!existingAssistant) {
          this.messages.push({
            id: generateResult.message_id,
            session_id: sessionId,
            role: 'assistant',
            content: '',
            is_complete: 0,
            created_at: dayjs().format('YYYY-MM-DD HH:mm:ss')
          })
        }

        // 5. 回放缓冲的上下文注入和工具调用事件
        this._replayPendingEvents(generateResult.message_id)

        return true
      } catch (err) {
        this.error = err.message
        console.error('[chat-store] sendMessage 失败:', err)
        // 错误时也添加一条错误提示消息（前端可识别 code 引导配置）
        return false
      }
    },

    /**
     * 停止生成
     * @returns {Promise<boolean>}
     */
    async stopGeneration () {
      if (!this.streaming.isStreaming) return false
      try {
        await chatApi.stopGeneration(this.streaming.sessionId)
        // 流式状态由 _onStreamEnd / _onStreamError 清理
        return true
      } catch (err) {
        console.error('[chat-store] stopGeneration 失败:', err)
        return false
      }
    },

    /**
     * 重新生成最后一条 AI 回复
     * 删除最后一条 assistant 消息，重新触发生成
     * @returns {Promise<boolean>}
     */
    async regenerate () {
      if (!this.currentSession) return false
      if (this.streaming.isStreaming) {
        this.error = '正在生成中，请稍候'
        return false
      }

      // 找到最后一条 assistant 消息
      const lastAssistantIndex = this.messages.findIndex(
        (m, i) => m.role === 'assistant' && i === this.messages.length - 1
      )
      if (lastAssistantIndex === -1) {
        this.error = '没有可重新生成的 AI 回复'
        return false
      }

      const lastAssistant = this.messages[lastAssistantIndex]

      try {
        // 删除最后一条 assistant 消息
        await chatApi.deleteMessage(lastAssistant.id)
        this.messages.splice(lastAssistantIndex, 1)

        // 触发重新生成
        const generateResult = await chatApi.generateMessage({
          session_id: this.currentSession.id
        })

        // 添加新的 assistant 占位消息
        const assistantMessage = {
          id: generateResult.message_id,
          session_id: this.currentSession.id,
          role: 'assistant',
          content: '',
          is_complete: 0,
          created_at: dayjs().format('YYYY-MM-DD HH:mm:ss')
        }
        this.messages.push(assistantMessage)

        this.streaming = {
          isStreaming: true,
          sessionId: this.currentSession.id,
          messageId: generateResult.message_id,
          accumulatedContent: '',
          error: null
        }

        // 回放缓冲的上下文注入和工具调用事件
        this._replayPendingEvents(generateResult.message_id)

        return true
      } catch (err) {
        this.error = err.message
        console.error('[chat-store] regenerate 失败:', err)
        return false
      }
    },

    // ============================================================
    // 流式事件处理
    // ============================================================

    /**
     * 流式开始事件
     * @param {object} payload { session_id, message_id, config_id }
     */
    _onStreamStart (payload) {
      // 仅处理当前会话的流式事件
      if (payload.session_id !== this.currentSessionId) return
      this.streaming.isStreaming = true
      this.streaming.sessionId = payload.session_id
      this.streaming.messageId = payload.message_id
      this.streaming.accumulatedContent = ''
      this.streaming.accumulatedThinking = ''
      this.streaming.error = null
    },

    /**
     * 流式增量事件
     * @param {object} payload { session_id, message_id, chunk, accumulated }
     */
    _onStreamChunk (payload) {
      if (payload.session_id !== this.currentSessionId) return
      // 更新累积内容
      this.streaming.accumulatedContent = payload.accumulated || (this.streaming.accumulatedContent + payload.chunk)
      // 更新累积思考过程（推理模型分离传输）
      if (payload.thinkingAccumulated !== undefined && payload.thinkingAccumulated !== null) {
        this.streaming.accumulatedThinking = payload.thinkingAccumulated
      }
      // 实时更新对应消息的内容
      const message = this.messages.find(m => m.id === payload.message_id)
      if (message) {
        message.content = this.streaming.accumulatedContent
      }
    },

    /**
     * 流式结束事件
     * @param {object} payload { session_id, message_id, content, stopped }
     */
    _onStreamEnd (payload) {
      if (payload.session_id !== this.currentSessionId) {
        // 即使不是当前会话也清理状态（避免卡住）
        if (this.streaming.sessionId === payload.session_id) {
          this._resetStreaming()
        }
        return
      }

      // 更新最终内容
      const message = this.messages.find(m => m.id === payload.message_id)
      if (message) {
        message.content = payload.content || this.streaming.accumulatedContent
        message.is_complete = payload.stopped ? 0 : 1
      }

      this._resetStreaming()

      // 刷新会话列表（updated_at 变化）
      this.fetchSessions().catch(() => {})
    },

    /**
     * 上下文注入事件（每轮调用模型前推送，显示注入了什么内容）
     * @param {object} payload { session_id, message_id, iteration, toolCallCount, contextItems, title, description }
     */
    _onContextInject (payload) {
      if (payload.session_id !== this.currentSessionId) return

      const injection = {
        iteration: payload.iteration || 0,
        toolCallCount: payload.toolCallCount || 0,
        contextItems: payload.contextItems || [],
        title: payload.title || '上下文注入',
        description: payload.description || '',
        timestamp: Date.now()
      }

      // 将上下文注入信息追加到对应消息的 contextInjections 数组中
      const message = this.messages.find(m => m.id === payload.message_id)
      if (message) {
        if (!message.contextInjections) {
          message.contextInjections = []
        }
        message.contextInjections.push(injection)
      } else {
        // 消息尚未添加（事件在 generateMessage 响应之前到达），缓冲等待回放
        if (!this._pendingContextInjects[payload.message_id]) {
          this._pendingContextInjects[payload.message_id] = []
        }
        this._pendingContextInjects[payload.message_id].push(injection)
      }
    },

    /**
     * 工具调用事件（AI 主动请求调用媒体生成工具）
     * @param {object} payload { session_id, message_id, tool_call_id, name, type, prompt, iteration, toolCallCount, status, args, contextInfo }
     */
    _onToolCall (payload) {
      if (payload.session_id !== this.currentSessionId) return

      const toolCallContext = {
        toolCallId: payload.tool_call_id,
        name: payload.name,
        type: payload.type,
        prompt: payload.prompt,
        iteration: payload.iteration || 0,
        toolCallCount: payload.toolCallCount || 1,
        status: payload.status || 'pending',
        args: payload.args || {},
        contextInfo: payload.contextInfo || null,
        timestamp: Date.now()
      }

      // 将工具调用上下文追加到对应消息的 toolCallContexts 数组中
      const message = this.messages.find(m => m.id === payload.message_id)
      if (message) {
        if (!message.toolCallContexts) {
          message.toolCallContexts = []
        }
        message.toolCallContexts.push(toolCallContext)
      } else {
        // 消息尚未添加，缓冲等待回放
        if (!this._pendingToolCalls[payload.message_id]) {
          this._pendingToolCalls[payload.message_id] = []
        }
        this._pendingToolCalls[payload.message_id].push(toolCallContext)
      }

      // 存储工具调用信息，供 ChatView 弹出确认框
      this.pendingToolCall = {
        toolCallId: payload.tool_call_id,
        name: payload.name,
        type: payload.type,
        prompt: payload.prompt,
        messageId: payload.message_id,
        iteration: payload.iteration || 0,
        toolCallCount: payload.toolCallCount || 1,
        contextInfo: payload.contextInfo || null
      }
    },

    /**
     * 更新工具调用状态
     * @param {string} messageId 消息 ID
     * @param {string} toolCallId 工具调用 ID
     * @param {string} status 新状态
     */
    updateToolCallStatus (messageId, toolCallId, status) {
      const message = this.messages.find(m => m.id === messageId)
      if (message && message.toolCallContexts) {
        const ctx = message.toolCallContexts.find(c => c.toolCallId === toolCallId)
        if (ctx) ctx.status = status
      }
    },

    /**
     * 清除待处理的工具调用
     */
    clearPendingToolCall () {
      this.pendingToolCall = null
    },

    /**
     * 回放缓冲的上下文注入和工具调用事件
     * 在 sendMessage/regenerate 添加 assistant 占位消息后调用
     * @param {string} messageId 消息 ID
     */
    _replayPendingEvents (messageId) {
      const message = this.messages.find(m => m.id === messageId)
      if (!message) return

      // 回放上下文注入
      const pendingInjects = this._pendingContextInjects[messageId]
      if (pendingInjects && pendingInjects.length > 0) {
        if (!message.contextInjections) {
          message.contextInjections = []
        }
        message.contextInjections.push(...pendingInjects)
        delete this._pendingContextInjects[messageId]
      }

      // 回放工具调用
      const pendingToolCalls = this._pendingToolCalls[messageId]
      if (pendingToolCalls && pendingToolCalls.length > 0) {
        if (!message.toolCallContexts) {
          message.toolCallContexts = []
        }
        message.toolCallContexts.push(...pendingToolCalls)
        delete this._pendingToolCalls[messageId]
      }
    },

    /**
     * 流式错误事件
     * @param {object} payload { session_id, message_id, error, partial }
     */
    _onStreamError (payload) {
      if (payload.session_id !== this.currentSessionId) {
        if (this.streaming.sessionId === payload.session_id) {
          this._resetStreaming()
        }
        return
      }

      // 保留已接收的部分内容
      const message = this.messages.find(m => m.id === payload.message_id)
      if (message) {
        message.content = payload.partial || this.streaming.accumulatedContent
        message.is_complete = 0
      }

      this.streaming.error = payload.error
      this._resetStreaming()
    },

    /**
     * 重置流式状态
     */
    _resetStreaming () {
      this.streaming.isStreaming = false
      this.streaming.sessionId = null
      this.streaming.messageId = null
      this.streaming.accumulatedContent = ''
      this.streaming.accumulatedThinking = ''
    },

    /**
     * 消息变更事件处理（跨窗口同步：桌宠对话框操作时刷新 AI 对话页面）
     */
    async _onMessagesChanged (payload) {
      if (!payload || !this.currentSession) return
      if (payload.session_id !== this.currentSession.id) return
      // 流式生成中不刷新（流式结束后本地已更新）
      if (this.streaming.isStreaming) return
      // 重新从 DB 加载消息
      try {
        await this.fetchMessages(this.currentSession.id)
      } catch (e) {
        // 忽略加载失败
      }
    },

    /**
     * 清空错误状态
     */
    clearError () {
      this.error = null
      this.streaming.error = null
    },

    // ============================================================
    // 模型类别管理
    // ============================================================

    /**
     * 设置当前模型类别
     * @param {string} category 模型类别（language / image / video）
     */
    setCurrentCategory (category) {
      if (!['language', 'image', 'video'].includes(category)) {
        console.warn('[chat-store] 无效的模型类别:', category)
        return
      }
      this.currentModelCategory = category
    },

    /**
     * 设置当前选中的媒体模型配置 ID
     * @param {string|null} configId 配置 ID
     */
    setSelectedMediaConfigId (configId) {
      this.selectedMediaConfigId = configId
    },

    // ============================================================
    // 媒体生成状态管理
    // ============================================================

    /**
     * 开始媒体生成
     * @param {string} type 生成类型 'image' | 'video'
     * @param {string} configId 配置 ID
     * @param {string} prompt 提示词
     * @returns {string} 占位消息 ID
     */
    startMediaGeneration (type, configId, prompt) {
      const messageId = `local-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      this.mediaGenerating = {
        isGenerating: true,
        type,
        messageId,
        progress: 0,
        taskId: null,
        error: null
      }
      // 同步媒体类别（保证 store 类别与生成类型一致）
      if (type === 'image' || type === 'video') {
        this.currentModelCategory = type
      }
      if (configId) {
        this.selectedMediaConfigId = configId
      }
      console.log('[chat-store] startMediaGeneration:', { type, configId, messageId, prompt })
      return messageId
    },

    /**
     * 设置媒体生成的任务 ID（用于视频轮询）
     * @param {string} taskId 任务 ID
     */
    setMediaTaskId (taskId) {
      this.mediaGenerating.taskId = taskId
    },

    /**
     * 更新媒体生成进度
     * @param {number} progress 进度百分比 0-100
     */
    updateMediaProgress (progress) {
      const p = Math.max(0, Math.min(100, Number(progress) || 0))
      this.mediaGenerating.progress = p
    },

    /**
     * 完成媒体生成
     * @param {object} [result] 生成结果 { url, taskId }
     */
    finishMediaGeneration (result = {}) {
      this.mediaGenerating.isGenerating = false
      this.mediaGenerating.progress = 100
      this.mediaGenerating.error = null
      // 保留 taskId 与 messageId 便于组件清理
      if (result?.taskId) {
        this.mediaGenerating.taskId = result.taskId
      }
    },

    /**
     * 取消媒体生成（用户主动停止或异常）
     * 清理所有生成状态
     */
    cancelMediaGeneration () {
      console.log('[chat-store] cancelMediaGeneration:', JSON.parse(JSON.stringify(this.mediaGenerating)))
      this.mediaGenerating = {
        isGenerating: false,
        type: null,
        messageId: null,
        progress: 0,
        taskId: null,
        error: null
      }
    },

    /**
     * 设置媒体生成错误
     * @param {string} error 错误信息
     */
    setMediaError (error) {
      this.mediaGenerating.isGenerating = false
      this.mediaGenerating.error = error
    },

    // ============================================================
    // AI 回复意图检测
    // ============================================================

    /**
     * 检测 AI 回复中是否包含媒体生成意图
     * 支持格式：
     *   - JSON 标记：{"intent": "generate_image", "prompt": "..."} 或 {"intent": "generate_video", "prompt": "..."}
     *   - Markdown 标记：![生成图片](prompt) 或 <video>prompt</video>
     * @param {string} content AI 回复内容
     * @returns {{hasIntent: boolean, type: 'image'|'video'|null, prompt: string}|null}
     */
    detectMediaIntent (content) {
      if (!content || typeof content !== 'string') return null

      // 尝试解析 JSON 标记
      try {
        const jsonMatch = content.match(/\{[^}]*"intent"[^}]*\}/)
        if (jsonMatch) {
          const intentData = JSON.parse(jsonMatch[0])
          if (intentData.intent === 'generate_image' && intentData.prompt) {
            return { hasIntent: true, type: 'image', prompt: intentData.prompt, url: intentData.url }
          }
          if (intentData.intent === 'generate_video' && intentData.prompt) {
            return { hasIntent: true, type: 'video', prompt: intentData.prompt, url: intentData.url }
          }
        }
      } catch (e) {
        // JSON 解析失败，继续尝试其他格式
      }

      // 尝试解析 Markdown 图片标记：![生成图片](url) 或 ![描述](url)
      const imgMatch = content.match(/!\[([^\]]*)\]\((.+?)\)/)
      if (imgMatch) {
        const description = imgMatch[1] || '生成图片'
        const url = imgMatch[2]
        return { hasIntent: true, type: 'image', prompt: description, url: url, isDirectUrl: true }
      }

      // 尝试解析 HTML video 标记
      const videoMatch = content.match(/<video[^>]*src=["']([^"']+)["'][^>]*>(.*?)<\/video>/)
      if (videoMatch) {
        return { hasIntent: true, type: 'video', prompt: videoMatch[2] || '生成视频', url: videoMatch[1], isDirectUrl: true }
      }

      return null
    }
  }
})

export default useChatStore
