// ============================================================
// DeepSeek API 适配器
// 端点：https://api.deepseek.com/v1/chat/completions
// 格式：OpenAI 兼容，SSE 流式响应（data: {...}）
// 支持模型：deepseek-chat、deepseek-reasoner
// 设计依据：design.md 2.6.3 节
// ============================================================

const BaseAdapter = require('./base-adapter.js')

// DeepSeek 默认端点
const DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'

class DeepSeekAdapter extends BaseAdapter {
  constructor (config) {
    super(config)
    // 端点规范化：智能补全 /v1/chat/completions 路径，避免用户填 base URL 时 404
    this.apiEndpoint = BaseAdapter.normalizeOpenAiEndpoint(config.api_endpoint || DEFAULT_ENDPOINT)
    if (!this.apiKey) {
      this.log('warn', 'DeepSeek 适配器未设置 API 密钥')
    }
  }

  /**
   * 流式对话
   * DeepSeek 使用 OpenAI 兼容格式，SSE 流式响应
   * @param {Array} messages 消息列表
   * @param {object} options { temperature, max_tokens, system_prompt, tools }
   * @param {Function} onChunk chunk 回调
   * @param {AbortSignal} signal 中断信号
   * @returns {Promise<{content: string, toolCalls: Array|null}>} 完整内容与工具调用列表
   */
  async chatStream (messages, options = {}, onChunk = null, signal = null) {
    if (!this.apiKey) {
      throw this.wrapError(new Error('DeepSeek API 密钥未设置'), 'AI_AUTH_FAILED')
    }

    const body = {
      model: this.modelName,
      messages: this.buildMessages(messages, options.system_prompt),
      stream: true
    }
    if (options.temperature != null) body.temperature = options.temperature
    if (options.max_tokens != null) body.max_tokens = options.max_tokens
    if (options.tools && Array.isArray(options.tools)) body.tools = options.tools
    // 思考模式：DeepSeek V4 使用 thinking.type 参数控制
    // 文档：https://api-docs.deepseek.com/guides/thinking_mode
    // 默认启用（type: "enabled"），可显式关闭（type: "disabled"）
    if (options.enable_thinking != null) {
      body.thinking = { type: options.enable_thinking ? 'enabled' : 'disabled' }
      // 思考强度：启用思考时透传 reasoning_effort（low/medium/high/max）
      if (options.enable_thinking && options.reasoning_effort) {
        body.reasoning_effort = options.reasoning_effort
      }
    }

    this.log('debug', `发起 DeepSeek 流式请求，模型: ${body.model}`)

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
      throw this.wrapError(new Error(`DeepSeek HTTP ${response.status}: ${errText || response.statusText}`))
    }

    // 解析 SSE 流
    return await this._parseSseStream(response, onChunk, signal)
  }

  /**
   * 解析 SSE 流式响应
   * 格式：data: {json}\n\n
   * 内容字段：choices[0].delta.content
   * 结束标记：data: [DONE]
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
    const toolCalls = []
    let currentToolCallIndex = null

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
          const toolCall = this._parseToolCallEvent(event)
          if (toolCall) {
            if (toolCall.type === 'start') {
              currentToolCallIndex = toolCall.index
              toolCalls[currentToolCallIndex] = {
                id: toolCall.id || '',
                type: 'function',
                function: { name: toolCall.name || '', arguments: '' }
              }
            } else if (toolCall.type === 'args_delta' && currentToolCallIndex !== null) {
              if (toolCalls[currentToolCallIndex]) {
                toolCalls[currentToolCallIndex].function.arguments += toolCall.delta
              }
            }
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

    this.log('debug', `DeepSeek 流式响应完成，总长度: ${fullContent.length}，思考过程长度: ${fullThinking.length}，工具调用数: ${toolCalls.length}`)
    return { content: fullContent, thinking: fullThinking, toolCalls: toolCalls.length > 0 ? toolCalls : null }
  }

  /**
   * 解析单个 SSE 事件
   * DeepSeek-R1（deepseek-reasoner）会输出 reasoning_content（思考过程），与正式回复分离
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
        // 分离正式回复与思考过程（DeepSeek-R1 reasoning_content）
        const result = {}
        if (delta.content) result.content = delta.content
        if (delta.reasoning_content) result.thinking = delta.reasoning_content
        if (result.content || result.thinking) return result
      } catch {
        // 忽略解析失败的非 JSON 行
      }
    }
    return null
  }

  /**
   * 解析 SSE 事件中的工具调用（OpenAI 兼容格式）
   * @param {string} event SSE 事件文本
   * @returns {{type: 'start'|'args_delta', index?: number, name?: string, id?: string, delta?: string}|null}
   */
  _parseToolCallEvent (event) {
    const lines = event.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return null
      try {
        const json = JSON.parse(data)
        const delta = json.choices && json.choices[0] && json.choices[0].delta
        if (!delta || !delta.tool_calls) continue
        for (const tc of delta.tool_calls) {
          if (tc.id && tc.function && tc.function.name) {
            return { type: 'start', index: tc.index, name: tc.function.name, id: tc.id }
          }
          if (tc.function && tc.function.arguments) {
            return { type: 'args_delta', index: tc.index, delta: tc.function.arguments }
          }
        }
      } catch {
        // 忽略解析失败
      }
    }
    return null
  }

  /**
   * 测试连接（重写：发送轻量请求）
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
        return { ok: true, latency: Date.now() - start, message: 'DeepSeek 连接正常' }
      }
      const errText = await response.text().catch(() => '')
      return { ok: false, latency: Date.now() - start, message: `HTTP ${response.status}: ${errText.slice(0, 100)}` }
    } catch (error) {
      return { ok: false, latency: Date.now() - start, message: error.message }
    }
  }
}

module.exports = DeepSeekAdapter
