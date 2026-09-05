// ============================================================
// AI 适配器工厂
// 职责：
//   1. 根据 provider_type 创建对应适配器实例
//   2. 解密 API 密钥并注入适配器
//   3. 管理流式请求的 AbortController（按 sessionId 索引）
//   4. 提供 stopGeneration(sessionId) 方法
//   5. 统一错误处理
// 设计依据：design.md 2.6.3 节
// ============================================================

const OllamaAdapter = require('./../adapters/ollama-adapter.js')
const DeepSeekAdapter = require('./../adapters/deepseek-adapter.js')
const OpenAIAdapter = require('./../adapters/openai-adapter.js')
const AnthropicAdapter = require('./../adapters/anthropic-adapter.js')
const GeminiAdapter = require('./../adapters/gemini-adapter.js')
const CustomAdapter = require('./../adapters/custom-adapter.js')
const cryptoService = require('./crypto-service.js')
const logger = require('./logger.js')

// 适配器类注册表
const ADAPTER_REGISTRY = {
  ollama: OllamaAdapter,
  deepseek: DeepSeekAdapter,
  openai: OpenAIAdapter,
  anthropic: AnthropicAdapter,
  gemini: GeminiAdapter,
  custom: CustomAdapter
}

// AbortController 实例映射：sessionId -> AbortController
const abortControllers = new Map()

// ============================================================
// 适配器创建
// ============================================================

/**
 * 根据 AI 配置创建适配器实例
 * @param {object} config AI 模型配置（来自 ai_configs 表）
 * @returns {BaseAdapter} 适配器实例
 * @throws {Error} 若 provider_type 不支持
 */
function createAdapter (config) {
  if (!config) {
    throw new Error('AI 配置不能为空')
  }
  const AdapterClass = ADAPTER_REGISTRY[config.provider_type]
  if (!AdapterClass) {
    throw new Error(`不支持的提供商类型: ${config.provider_type}`)
  }

  const adapter = new AdapterClass(config)

  // 解密 API 密钥并注入适配器（Ollama 不需要密钥）
  if (config.provider_type !== 'ollama' && config.api_key_encrypted) {
    try {
      const apiKey = cryptoService.decrypt(config.api_key_encrypted)
      adapter.setApiKey(apiKey)
    } catch (error) {
      logger.error('AIAdapterFactory', `API 密钥解密失败: ${error.message}`)
      throw new Error('API 密钥解密失败，请重新配置')
    }
  }

  return adapter
}

// ============================================================
// 流式对话（含 AbortController 管理）
// ============================================================

/**
 * 发起流式对话
 * @param {object} config AI 模型配置
 * @param {string} sessionId 会话 ID（用于 AbortController 索引）
 * @param {Array} messages 消息列表（已构建为适配器格式，支持多模态）
 * @param {object} [options] 选项 { temperature, max_tokens, system_prompt, enable_vision }
 * @param {Function} [onChunk] chunk 回调 (chunkText) => void
 * @returns {Promise<{ content: string, stopped: boolean }>} 完整内容与是否被中断
 */
async function chatStream (config, sessionId, messages, options = {}, onChunk = null) {
  const adapter = createAdapter(config)

  // 注入配置级高级选项
  const mergedOptions = { ...options }
  // options.enable_thinking 优先于 config.enable_thinking（前端按钮可覆盖配置默认值）
  if (mergedOptions.enable_thinking == null && config.enable_thinking != null) {
    mergedOptions.enable_thinking = Number(config.enable_thinking) === 1
  }
  // reasoning_effort 仅由前端 options 透传，不从 config 读取（config 无此字段）
  // 此处无需额外处理，mergedOptions 已通过 { ...options } 包含 reasoning_effort
  if (config.enable_vision != null) {
    mergedOptions.enable_vision = Number(config.enable_vision) === 1
  }
  // 输出 Token 上限：配置级 max_tokens 作为默认值，调用方 options.max_tokens 优先
  const configMaxTokens = Number(config.max_tokens)
  if (Number.isFinite(configMaxTokens) && configMaxTokens > 0 && mergedOptions.max_tokens == null) {
    mergedOptions.max_tokens = configMaxTokens
  }
  // 如果消息包含图片附件，强制启用 vision
  if (messages && _hasImageContent(messages)) {
    mergedOptions.enable_vision = true
  }

  // 为本次会话创建 AbortController
  const controller = new AbortController()
  abortControllers.set(sessionId, controller)

  let fullContent = ''
  let fullThinking = ''
  let toolCalls = null
  let stopped = false

  try {
    const result = await adapter.chatStream(
      messages,
      mergedOptions,
      (chunk) => {
        if ((typeof onChunk === 'function')) onChunk(chunk)
      },
      controller.signal
    )
    // 适配器可能返回字符串（旧版）或 { content, thinking?, toolCalls? }（新版）
    if (typeof result === 'string') {
      fullContent = result
    } else {
      fullContent = result.content || ''
      fullThinking = result.thinking || ''
      toolCalls = result.toolCalls || null
    }
  } catch (error) {
    if (error.code === 'AI_ABORTED' || error.message === 'aborted' || error.name === 'AbortError') {
      stopped = true
      logger.info('AIAdapterFactory', `会话 ${sessionId} 流式请求被中断`)
    } else {
      throw error
    }
  } finally {
    abortControllers.delete(sessionId)
  }

  return { content: fullContent, thinking: fullThinking, toolCalls, stopped }
}

// ============================================================
// 停止生成
// ============================================================

/**
 * 停止指定会话的流式生成
 * @param {string} sessionId 会话 ID
 * @returns {boolean} 是否成功发送中断信号
 */
function stopGeneration (sessionId) {
  const controller = abortControllers.get(sessionId)
  if (controller) {
    controller.abort()
    logger.info('AIAdapterFactory', `已发送中断信号至会话 ${sessionId}`)
    return true
  }
  return false
}

/**
 * 检查指定会话是否正在生成
 * @param {string} sessionId 会话 ID
 * @returns {boolean}
 */
function isGenerating (sessionId) {
  return abortControllers.has(sessionId)
}

// ============================================================
// 测试连接
// ============================================================

/**
 * 测试 AI 配置连接
 * @param {object} config AI 模型配置
 * @returns {Promise<{ ok: boolean, message?: string, latency?: number }>}
 */
async function testConnection (config) {
  try {
    // 媒体模型（agnes-image/agnes-video/agnes-all）没有对应的适配器类
    // 直接返回成功，API Key 有效性在实际生成时验证
    const mediaProviderTypes = ['agnes-image', 'agnes-video', 'agnes-all']
    if (mediaProviderTypes.includes(config.provider_type)) {
      logger.info('AIAdapterFactory', `媒体模型测试连接: ${config.provider_type}（直接通过）`)
      return { ok: true, message: '媒体模型配置已保存，将在生成时验证 API Key' }
    }

    const adapter = createAdapter(config)
    return await adapter.testConnection()
  } catch (error) {
    logger.error('AIAdapterFactory', `测试连接失败: ${error.message}`)
    return { ok: false, message: error.message }
  }
}

/**
 * 获取模型列表（仅 Ollama 支持）
 * @param {object} config AI 模型配置
 * @returns {Promise<Array<string>>}
 */
async function listModels (config) {
  try {
    const adapter = createAdapter(config)
    return await adapter.listModels()
  } catch (error) {
    logger.error('AIAdapterFactory', `获取模型列表失败: ${error.message}`)
    return []
  }
}

module.exports = {
  createAdapter,
  chatStream,
  stopGeneration,
  isGenerating,
  testConnection,
  listModels
}

/**
 * 检测消息列表中是否包含图片内容
 * @param {Array} messages 消息列表
 * @returns {boolean}
 */
function _hasImageContent (messages) {
  if (!Array.isArray(messages)) return false
  return messages.some(msg => {
    if (!msg || !msg.content) return false
    // 检查 content 是否为数组（多模态格式）
    if (Array.isArray(msg.content)) {
      return msg.content.some(part => part.type === 'image_url' || part.type === 'image')
    }
    // 检查 content 对象中是否有图片附件
    if (typeof msg.content === 'object' && msg.content.attachments) {
      return msg.content.attachments.some(att => att.type === 'image' && att.base64)
    }
    return false
  })
}
