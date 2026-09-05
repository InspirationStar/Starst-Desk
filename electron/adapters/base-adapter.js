// ============================================================
// AI 适配器抽象基类
// 职责：定义统一接口契约，所有具体适配器（Ollama/DeepSeek/Custom）继承此类
// 设计依据：design.md 2.6.3 节，多模型统一接口
// ============================================================

const logger = require('./../core/logger.js')

/**
 * AI 适配器基类
 * 子类必须实现：
 *   - chatStream(messages, options, onChunk, signal) 流式对话
 *   - chat(messages, options, signal) 非流式对话（可选，默认基于 chatStream 实现）
 *   - testConnection() 测试连接
 */
class BaseAdapter {
  /**
   * @param {object} config AI 模型配置（来自 ai_configs 表）
   *   - id: 配置 ID
   *   - provider_type: 'ollama' | 'deepseek' | 'custom'
   *   - name: 配置名称
   *   - api_endpoint: API 端点
   *   - api_key_encrypted: 加密的 API 密钥
   *   - model_name: 模型名称
   */
  constructor (config) {
    if (!config) {
      throw new Error('适配器配置不能为空')
    }
    this.config = config
    this.providerType = config.provider_type
    this.apiEndpoint = config.api_endpoint
    this.modelName = config.model_name
    // api_key 解密后的明文（子类按需使用）
    this.apiKey = null
  }

  /**
   * 设置解密后的 API 密钥
   * @param {string} apiKey 明文 API 密钥
   */
  setApiKey (apiKey) {
    this.apiKey = apiKey || null
  }

  /**
   * 流式对话（子类必须实现）
   * @param {Array<{role: string, content: string}>} messages 消息列表
   * @param {object} [options] 选项 { temperature, max_tokens, system_prompt }
   * @param {Function} [onChunk] chunk 回调 (chunkText) => void
   * @param {AbortSignal} [signal] 中断信号
   * @returns {Promise<string>} 完整的响应内容
   */
  async chatStream (messages, options = {}, onChunk = null, signal = null) {
    throw new Error('chatStream() 必须由子类实现')
  }

  /**
   * 非流式对话（默认基于 chatStream 实现，子类可重写以优化）
   * @param {Array<{role: string, content: string}>} messages 消息列表
   * @param {object} [options] 选项
   * @param {AbortSignal} [signal] 中断信号
   * @returns {Promise<string>} 完整的响应内容
   */
  async chat (messages, options = {}, signal = null) {
    return await this.chatStream(messages, options, null, signal)
  }

  /**
   * 测试连接（子类可重写）
   * @returns {Promise<{ ok: boolean, message?: string, latency?: number }>}
   */
  async testConnection () {
    const start = Date.now()
    try {
      await this.chatStream(
        [{ role: 'user', content: 'Hi' }],
        { max_tokens: 8 },
        null,
        null
      )
      return { ok: true, latency: Date.now() - start }
    } catch (error) {
      return { ok: false, message: error.message, latency: Date.now() - start }
    }
  }

  /**
   * 获取模型列表（子类可重写，仅 Ollama 支持）
   * @returns {Promise<Array<string>>}
   */
  async listModels () {
    return []
  }

  // ============================================================
  // 通用辅助方法
  // ============================================================

  /**
   * 构建请求消息（合并 system prompt）
   * @param {Array} messages 消息列表
   * @param {string} [systemPrompt] 系统提示词
   * @returns {Array} 合并后的消息列表
   */
  buildMessages (messages, systemPrompt) {
    const result = []
    if (systemPrompt && systemPrompt.trim()) {
      result.push({ role: 'system', content: systemPrompt.trim() })
    }
    // 仅保留 role 和 content 字段，过滤无效消息
    for (const msg of messages) {
      if (msg && msg.role && msg.content != null) {
        result.push({ role: msg.role, content: String(msg.content) })
      }
    }
    return result
  }

  /**
   * 统一错误处理：包装为带 code 的 Error
   * @param {Error} error 原始错误
   * @param {string} [defaultCode] 默认错误码
   * @returns {Error} 包装后的错误
   */
  wrapError (error, defaultCode = 'AI_ADAPTER_ERROR') {
    const err = new Error(error.message || 'AI 适配器错误')
    err.code = error.code || this.classifyErrorCode(error)
    err.original = error
    return err
  }

  /**
   * 根据原始错误分类错误码
   * @param {Error} error
   * @returns {string}
   */
  classifyErrorCode (error) {
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('aborted') || error.name === 'AbortError') return 'AI_ABORTED'
    if (msg.includes('econnrefused') || msg.includes('connect')) return 'AI_SERVICE_UNREACHABLE'
    if (msg.includes('timeout') || msg.includes('etimedout')) return 'AI_TIMEOUT'
    if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('api key')) return 'AI_AUTH_FAILED'
    if (msg.includes('404') || msg.includes('not found')) return 'AI_MODEL_NOT_FOUND'
    if (msg.includes('429') || msg.includes('rate limit')) return 'AI_RATE_LIMIT'
    return 'AI_ADAPTER_ERROR'
  }

  /**
   * 日志辅助方法
   * @param {string} level 日志级别
   * @param {string} message 日志消息
   */
  log (level, message) {
    logger[level]('AIAdapter', `[${this.providerType}] ${message}`)
  }
}

// ============================================================
// 端点规范化工具（静态方法）
// ============================================================

/**
 * 规范化 OpenAI 兼容端点 URL
 * 智能补全路径，避免用户只填 base URL 导致 404
 * 规则：
 *   - 去掉末尾斜杠
 *   - 已以 /chat/completions 结尾：直接返回
 *   - 路径包含 /v1 段：追加 /chat/completions
 *   - 其他（base URL）：追加 /v1/chat/completions
 * 示例：
 *   https://api.openai.com -> https://api.openai.com/v1/chat/completions
 *   https://api.openai.com/v1 -> https://api.openai.com/v1/chat/completions
 *   https://api.deepseek.com/v1/chat/completions -> 不变
 *   https://my.proxy.com/api/v1 -> https://my.proxy.com/api/v1/chat/completions
 * @param {string} endpoint 用户配置的端点
 * @returns {string} 规范化后的端点
 */
function normalizeOpenAiEndpoint (endpoint) {
  if (!endpoint || typeof endpoint !== 'string') return endpoint
  let url = endpoint.replace(/\/+$/, '')
  if (/\/chat\/completions$/.test(url)) return url
  if (/\/v1(\/|$)/.test(url)) {
    return url + '/chat/completions'
  }
  return url + '/v1/chat/completions'
}

// 挂载为静态方法，便于子类通过 BaseAdapter.normalizeOpenAiEndpoint 调用
BaseAdapter.normalizeOpenAiEndpoint = normalizeOpenAiEndpoint

module.exports = BaseAdapter
