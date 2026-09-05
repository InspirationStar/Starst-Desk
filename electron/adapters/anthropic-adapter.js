// ============================================================
// Anthropic Claude 适配器
// 端点：https://api.anthropic.com/v1/messages
// 鉴权头：x-api-key + anthropic-version
// 请求体：system 为顶层字段（非 messages 内 role:system）
// 流式响应：SSE 事件（message_start / content_block_delta / message_stop）
// 高级选项：
//   - enable_thinking: 启用扩展思考（claude-3-7-sonnet 等支持 thinking.budget_tokens）
//   - enable_vision: 启用图片输入（messages content 数组形式）
// 设计依据：design.md 2.6.3 节
// ============================================================

const BaseAdapter = require('./base-adapter.js')

// Anthropic 默认端点
const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages'
// API 版本
const ANTHROPIC_VERSION = '2023-06-01'

class AnthropicAdapter extends BaseAdapter {
  constructor (config) {
    super(config)
    // 端点规范化：补全 /v1/messages 路径
    this.apiEndpoint = this._normalizeEndpoint(config.api_endpoint || DEFAULT_ENDPOINT)
    if (!this.apiKey) {
      this.log('warn', 'Anthropic 适配器未设置 API 密钥')
    }
  }

  /**
   * 规范化 Anthropic 端点
   * @param {string} endpoint
   * @returns {string}
   */
  _normalizeEndpoint (endpoint) {
    if (!endpoint) return endpoint
    let url = endpoint.replace(/\/+$/, '')
    if (/\/messages$/.test(url)) return url
    if (/\/v1(\/|$)/.test(url)) {
      return url + '/messages'
    }
    return url + '/v1/messages'
  }

  /**
   * 流式对话
   * @param {Array} messages 消息列表（role: user/assistant）
   * @param {object} options { temperature, max_tokens, system_prompt, enable_thinking }
   * @param {Function} onChunk chunk 回调
   * @param {AbortSignal} signal 中断信号
   * @returns {Promise<string>} 完整响应内容
   */
  async chatStream (messages, options = {}, onChunk = null, signal = null) {
    if (!this.apiKey) {
      throw this.wrapError(new Error('Anthropic API 密钥未设置'), 'AI_AUTH_FAILED')
    }

    // Anthropic 要求 max_tokens 必填
    const maxTokens = options.max_tokens != null ? options.max_tokens : 4096

    // 构建消息体：system 单独字段，messages 仅 user/assistant
    const body = {
      model: this.modelName,
      max_tokens: maxTokens,
      messages: this._buildAnthropicMessages(messages),
      stream: true
    }
    if (options.temperature != null) body.temperature = options.temperature
    if (options.system_prompt && options.system_prompt.trim()) {
      body.system = options.system_prompt.trim()
    }

    // 扩展思考模式（claude-3-7-sonnet 等支持）
    // 注意：启用 thinking 时 temperature 必须为 1
    if (options.enable_thinking) {
      body.thinking = { type: 'enabled', budget_tokens: 10000 }
      body.temperature = 1
    }

    this.log('debug', `发起 Anthropic 流式请求，模型: ${body.model}，端点: ${this.apiEndpoint}`)

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw this.wrapError(new Error(`Anthropic HTTP ${response.status}: ${errText || response.statusText}`))
    }

    return await this._parseSseStream(response, onChunk, signal)
  }

  /**
   * 构建 Anthropic 消息列表
   * Anthropic 不支持 role:system，需过滤；system 通过顶层 system 字段传递
   * @param {Array} messages
   * @returns {Array}
   */
  _buildAnthropicMessages (messages) {
    const result = []
    for (const msg of messages) {
      if (!msg || !msg.role || msg.content == null) continue
      if (msg.role === 'system') continue
      result.push({ role: msg.role, content: String(msg.content) })
    }
    return result
  }

  /**
   * 解析 Anthropic SSE 流式响应
   * 事件类型：
   *   - content_block_delta: { delta: { type: "text_delta", text: "..." } }
   *   - content_block_delta: { delta: { type: "thinking_delta", thinking: "..." } }（思考过程）
   * @param {Response} response
   * @param {Function} onChunk
   * @param {AbortSignal} signal
   * @returns {Promise<string>}
   */
  async _parseSseStream (response, onChunk, signal) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let fullContent = ''
    let fullThinking = ''

    try {
      while (true) {
        if (signal && signal.aborted) {
          throw new Error('aborted')
        }
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          const chunk = this._parseSseEvent(event)
          if (chunk) {
            // chunk 为 { content?, thinking? } 对象，分离累积
            if (chunk.content) fullContent += chunk.content
            if (chunk.thinking) fullThinking += chunk.thinking
            if (onChunk) onChunk(chunk)
          }
        }
      }
      if (buffer.trim()) {
        const chunk = this._parseSseEvent(buffer)
        if (chunk) {
          if (chunk.content) fullContent += chunk.content
          if (chunk.thinking) fullThinking += chunk.thinking
          if (onChunk) onChunk(chunk)
        }
      }
    } finally {
      reader.releaseLock()
    }

    this.log('debug', `Anthropic 流式响应完成，总长度: ${fullContent.length}，思考过程长度: ${fullThinking.length}`)
    return { content: fullContent, thinking: fullThinking }
  }

  /**
   * 解析单个 SSE 事件
   * Anthropic 事件格式：
   *   event: content_block_delta
   *   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
   * @param {string} event
   * @returns {{content?: string, thinking?: string}|null} content=正式回复，thinking=思考过程
   */
  _parseSseEvent (event) {
    const lines = event.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') return null
      try {
        const json = JSON.parse(data)
        if (json.type !== 'content_block_delta') continue
        const delta = json.delta
        if (!delta) continue
        // 文本增量（正式回复）
        if (delta.type === 'text_delta' && delta.text) return { content: delta.text }
        // 思考过程增量（分离返回，便于前端折叠显示）
        if (delta.type === 'thinking_delta' && delta.thinking) return { thinking: delta.thinking }
      } catch {
        // 忽略解析失败
      }
    }
    return null
  }

  /**
   * 测试连接（发送轻量非流式请求）
   */
  async testConnection () {
    const start = Date.now()
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION
        },
        body: JSON.stringify({
          model: this.modelName,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
          stream: false
        })
      })
      if (response.ok) {
        return { ok: true, latency: Date.now() - start, message: 'Anthropic 连接正常' }
      }
      const errText = await response.text().catch(() => '')
      return { ok: false, latency: Date.now() - start, message: `HTTP ${response.status}: ${errText.slice(0, 100)}` }
    } catch (error) {
      return { ok: false, latency: Date.now() - start, message: error.message }
    }
  }
}

module.exports = AnthropicAdapter