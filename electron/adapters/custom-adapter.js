// ============================================================
// 第三方 OpenAI 兼容适配器
// 适用于任何 OpenAI API 兼容服务（如 OpenAI、Azure OpenAI、Moonshot、智谱等）
// 用户自定义 API 端点、密钥、模型名
// 流式响应：SSE 格式（data: {...}）
// 设计依据：design.md 2.6.3 节
// ============================================================

const BaseAdapter = require('./base-adapter.js')

class CustomAdapter extends BaseAdapter {
  constructor (config) {
    super(config)
    if (!config.api_endpoint) {
      throw new Error('自定义适配器必须配置 API 端点')
    }
    // 端点规范化：智能补全 /v1/chat/completions 路径
    // 修复用户只填 base URL（如 https://api.openai.com）导致 POST 到根路径返回 404 的问题
    this.apiEndpoint = BaseAdapter.normalizeOpenAiEndpoint(config.api_endpoint)
    if (!config.api_key_encrypted) {
      this.log('warn', '自定义适配器未设置 API 密钥')
    }
  }

  /**
   * 流式对话（OpenAI 兼容格式）
   * @param {Array} messages 消息列表
   * @param {object} options { temperature, max_tokens, system_prompt }
   * @param {Function} onChunk chunk 回调
   * @param {AbortSignal} signal 中断信号
   * @returns {Promise<{content: string, toolCalls: Array|null}>} 完整响应内容与工具调用列表
   */
  async chatStream (messages, options = {}, onChunk = null, signal = null) {
    if (!this.apiKey) {
      throw this.wrapError(new Error('API 密钥未设置'), 'AI_AUTH_FAILED')
    }

    const body = {
      model: this.modelName,
      messages: this.buildMessages(messages, options.system_prompt),
      stream: true
    }
    if (options.temperature != null) body.temperature = options.temperature
    if (options.max_tokens != null) body.max_tokens = options.max_tokens
    // 思考模式：自定义适配器兼容多种 OpenAI 兼容端点
    // Agnes 2.5 Flash：chat_template_kwargs.enable_thinking
    // DeepSeek V4 自建：thinking.type
    // 同时发送两种格式，API 会忽略不认识的参数
    if (options.enable_thinking != null) {
      body.chat_template_kwargs = { enable_thinking: options.enable_thinking }
      body.thinking = { type: options.enable_thinking ? 'enabled' : 'disabled' }
      // 思考强度：启用思考时透传 reasoning_effort（low/medium/high/max）
      if (options.enable_thinking && options.reasoning_effort) {
        body.reasoning_effort = options.reasoning_effort
      }
    }

    this.log('debug', `发起自定义适配器流式请求，端点: ${this.apiEndpoint}，模型: ${body.model}`)

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw this.wrapError(new Error(`HTTP ${response.status}: ${errText || response.statusText}`))
    }

    return await this._parseSseStream(response, onChunk, signal)
  }

  /**
   * 解析 SSE 流式响应（与 DeepSeek 相同的 OpenAI 兼容格式）
   * @param {Response} response fetch 响应
   * @param {Function} onChunk chunk 回调
   * @param {AbortSignal} signal 中断信号
   * @returns {Promise<{content: string, toolCalls: Array|null}>} 完整内容与工具调用列表
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

    this.log('debug', `自定义适配器流式响应完成，总长度: ${fullContent.length}，思考过程长度: ${fullThinking.length}`)
    return { content: fullContent, thinking: fullThinking, toolCalls: null }
  }

  /**
   * 解析单个 SSE 事件
   * OpenAI 兼容格式，部分推理模型会输出 reasoning_content（思考过程），与正式回复分离
   * @param {string} event SSE 事件文本
   * @returns {{content?: string, thinking?: string}|null} content=正式回复，thinking=思考过程
   */
  _parseSseEvent (event) {
    const lines = event.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return null
      try {
        const json = JSON.parse(data)
        const delta = json.choices && json.choices[0] && json.choices[0].delta
        if (!delta) continue
        // 分离正式回复与思考过程（兼容推理模型 reasoning_content）
        const result = {}
        if (delta.content) result.content = delta.content
        if (delta.reasoning_content) result.thinking = delta.reasoning_content
        if (result.content || result.thinking) return result
      } catch {
        // 忽略解析失败
      }
    }
    return null
  }

  /**
   * 测试连接
   */
  async testConnection () {
    const start = Date.now()
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
          stream: false
        })
      })
      if (response.ok) {
        return { ok: true, latency: Date.now() - start, message: '连接正常' }
      }
      const errText = await response.text().catch(() => '')
      return { ok: false, latency: Date.now() - start, message: `HTTP ${response.status}: ${errText.slice(0, 100)}` }
    } catch (error) {
      return { ok: false, latency: Date.now() - start, message: error.message }
    }
  }
}

module.exports = CustomAdapter
