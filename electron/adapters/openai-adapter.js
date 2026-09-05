// ============================================================
// OpenAI 官方适配器
// 端点：https://api.openai.com/v1/chat/completions
// 格式：OpenAI 兼容，SSE 流式响应（data: {...}）
// 支持模型：gpt-4o、gpt-4o-mini、gpt-4-turbo、gpt-3.5-turbo 等
// 高级选项：
//   - enable_vision: 启用图片输入（gpt-4o 系列）
//   - enable_thinking: 启用推理模式（o1/o3 系列，通过 reasoning_effort 表达）
// 设计依据：design.md 2.6.3 节
// ============================================================

const BaseAdapter = require('./base-adapter.js')

// OpenAI 默认端点
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

class OpenAIAdapter extends BaseAdapter {
  constructor (config) {
    super(config)
    // 端点规范化：智能补全 /v1/chat/completions 路径
    this.apiEndpoint = BaseAdapter.normalizeOpenAiEndpoint(config.api_endpoint || DEFAULT_ENDPOINT)
    if (!config.api_key_encrypted) {
      this.log('warn', 'OpenAI 适配器未设置 API 密钥')
    }
  }

  /**
   * 流式对话（OpenAI 官方格式）
   * @param {Array} messages 消息列表（支持多模态格式）
   * @param {object} options { temperature, max_tokens, system_prompt, enable_thinking, enable_vision }
   * @param {Function} onChunk chunk 回调
   * @param {AbortSignal} signal 中断信号
   * @returns {Promise<string>} 完整响应内容
   */
  async chatStream (messages, options = {}, onChunk = null, signal = null) {
    if (!this.apiKey) {
      throw this.wrapError(new Error('OpenAI API 密钥未设置'), 'AI_AUTH_FAILED')
    }

    // 构建消息列表，支持多模态
    const builtMessages = this._buildMultimodalMessages(messages, options.system_prompt)

    const body = {
      model: this.modelName,
      messages: builtMessages,
      stream: true
    }
    if (options.temperature != null) body.temperature = options.temperature
    if (options.max_tokens != null) body.max_tokens = options.max_tokens
    if (options.tools && Array.isArray(options.tools)) body.tools = options.tools

    // 推理模型思考模式
    if (options.enable_thinking != null) {
      if (/^o[13]/.test(this.modelName)) {
        // OpenAI o1/o3 系列：使用 reasoning_effort，不支持 temperature/max_tokens
        if (options.enable_thinking) {
          body.reasoning_effort = options.reasoning_effort || 'medium'
          delete body.temperature
          delete body.max_tokens
        }
      } else {
        // 其他 OpenAI 兼容模型（如 DeepSeek V4 通过 OpenAI adapter 连接）：使用 thinking.type
        body.thinking = { type: options.enable_thinking ? 'enabled' : 'disabled' }
        // 思考强度：启用思考时透传 reasoning_effort（low/medium/high/max）
        if (options.enable_thinking && options.reasoning_effort) {
          body.reasoning_effort = options.reasoning_effort
        }
      }
    }

    this.log('debug', `发起 OpenAI 流式请求，模型: ${body.model}，端点: ${this.apiEndpoint}，消息数: ${builtMessages.length}`)

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
      throw this.wrapError(new Error(`OpenAI HTTP ${response.status}: ${errText || response.statusText}`))
    }

    return await this._parseSseStream(response, onChunk, signal)
  }

  /**
   * 解析 SSE 流式响应（OpenAI 兼容格式）
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
    let currentToolCallName = ''
    let currentToolCallArgs = ''
    let currentToolCallId = ''

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

          // 检查是否有工具调用
          const toolCall = this._parseToolCallEvent(event)
          if (toolCall) {
            if (toolCall.type === 'start') {
              currentToolCallIndex = toolCall.index
              currentToolCallName = toolCall.name || ''
              currentToolCallArgs = ''
              currentToolCallId = toolCall.id || ''
              toolCalls[currentToolCallIndex] = {
                id: currentToolCallId,
                type: 'function',
                function: {
                  name: currentToolCallName,
                  arguments: ''
                }
              }
            } else if (toolCall.type === 'args_delta' && currentToolCallIndex !== null) {
              currentToolCallArgs += toolCall.delta
              if (toolCalls[currentToolCallIndex]) {
                toolCalls[currentToolCallIndex].function.arguments = currentToolCallArgs
              }
            } else if (toolCall.type === 'done' && currentToolCallIndex !== null) {
              currentToolCallIndex = null
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
        const toolCall = this._parseToolCallEvent(buffer)
        if (toolCall) {
          if (toolCall.type === 'start') {
            currentToolCallIndex = toolCall.index
            currentToolCallName = toolCall.name || ''
            currentToolCallArgs = ''
            currentToolCallId = toolCall.id || ''
            toolCalls[currentToolCallIndex] = {
              id: currentToolCallId,
              type: 'function',
              function: {
                name: currentToolCallName,
                arguments: ''
              }
            }
          } else if (toolCall.type === 'args_delta' && currentToolCallIndex !== null) {
            currentToolCallArgs += toolCall.delta
            if (toolCalls[currentToolCallIndex]) {
              toolCalls[currentToolCallIndex].function.arguments = currentToolCallArgs
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    this.log('debug', `OpenAI 流式响应完成，总长度: ${fullContent.length}，思考过程长度: ${fullThinking.length}，工具调用数: ${toolCalls.length}`)
    return { content: fullContent, thinking: fullThinking, toolCalls: toolCalls.length > 0 ? toolCalls : null }
  }

  /**
   * 构建支持多模态的消息列表
   * @param {Array} messages 原始消息列表
   * @param {string} [systemPrompt] 系统提示词
   * @returns {Array} 处理后的消息列表
   */
  _buildMultimodalMessages (messages, systemPrompt) {
    const result = []
    // 添加系统提示
    if (systemPrompt && systemPrompt.trim()) {
      result.push({ role: 'system', content: systemPrompt.trim() })
    }
    // 处理每条消息
    for (const msg of messages) {
      if (!msg || !msg.role || msg.content == null) continue

      // 如果 content 已经是数组（多模态格式），直接使用
      if (Array.isArray(msg.content)) {
        result.push({ role: msg.role, content: msg.content })
        continue
      }

      // 如果 content 是对象，检查是否包含图片附件
      if (typeof msg.content === 'object' && msg.content !== null) {
        const parts = []
        // 提取文本内容
        if (msg.content.text) {
          parts.push({ type: 'text', text: msg.content.text })
        }
        // 提取图片附件
        if (msg.content.attachments && Array.isArray(msg.content.attachments)) {
          for (const att of msg.content.attachments) {
            if (att.type === 'image' && att.base64) {
              const mimeType = att.mime_type || 'image/png'
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${att.base64}` }
              })
            }
          }
        }
        // 如果构建了多模态内容，使用数组格式；否则退化为纯文本
        if (parts.length > 0) {
          result.push({ role: msg.role, content: parts })
        } else {
          result.push({ role: msg.role, content: String(msg.content) })
        }
        continue
      }

      // 字符串内容，直接使用
      result.push({ role: msg.role, content: String(msg.content) })
    }
    return result
  }

  /**
   * 解析单个 SSE 事件
   * OpenAI 格式：choices[0].delta.content
   * 推理模型可能输出 choices[0].delta.reasoning_content（思考过程），与正式回复分离
   * @param {string} event SSE 事件文本
   * @returns {{content?: string, thinking?: string}|null} 内容增量（content=正式回复，thinking=思考过程）
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
        // 分离正式回复与思考过程（推理模型 o1/o3 系列）
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
   * 解析 SSE 事件中的工具调用
   * OpenAI 格式：choices[0].delta.tool_calls[].function.{name,arguments}
   * @param {string} event SSE 事件文本
   * @returns {{type: 'start'|'args_delta'|'done', index?: number, name?: string, id?: string, delta?: string}|null}
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
   * 测试连接（发送轻量非流式请求）
   */
  async testConnection () {
    const start = Date.now()
    try {
      const body = {
        model: this.modelName,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
        stream: false
      }
      // 推理模型不支持 max_tokens，移除
      if (/^o[13]/.test(this.modelName)) {
        delete body.max_tokens
      }
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      })
      if (response.ok) {
        return { ok: true, latency: Date.now() - start, message: 'OpenAI 连接正常' }
      }
      const errText = await response.text().catch(() => '')
      return { ok: false, latency: Date.now() - start, message: `HTTP ${response.status}: ${errText.slice(0, 100)}` }
    } catch (error) {
      return { ok: false, latency: Date.now() - start, message: error.message }
    }
  }
}

module.exports = OpenAIAdapter