// ============================================================
// Ollama 本地模型适配器
// 端点：http://localhost:11434/api/chat（流式 NDJSON）
// 模型列表：GET /api/tags
// 设计依据：design.md 2.6.3 节
// ============================================================

const BaseAdapter = require('./base-adapter.js')
const logger = require('./../core/logger.js')

// Ollama 默认端点
const DEFAULT_ENDPOINT = 'http://localhost:11434'

class OllamaAdapter extends BaseAdapter {
  constructor (config) {
    super(config)
    // 端点规范化：去掉末尾斜杠，确保以 /api/chat 结尾的请求路径正确
    this.baseEndpoint = (config.api_endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')
    // chat 端点：用户配置可能是 base URL 或完整 chat URL
    if (this.baseEndpoint.endsWith('/api/chat')) {
      this.chatEndpoint = this.baseEndpoint
      this.baseEndpoint = this.baseEndpoint.slice(0, -'/api/chat'.length)
    } else {
      this.chatEndpoint = this.baseEndpoint + '/api/chat'
    }
    this.log('info', `Ollama 适配器初始化，端点: ${this.chatEndpoint}`)
  }

  /**
   * 流式对话
   * Ollama 流式响应格式：NDJSON，每行一个 JSON 对象
   * { model, message: { role, content }, done: false }
   * 最后一行：{ ..., done: true, total_duration, ... }
   * @param {Array} messages 消息列表
   * @param {object} options { temperature, max_tokens, system_prompt }
   * @param {Function} onChunk chunk 回调
   * @param {AbortSignal} signal 中断信号
   * @returns {Promise<string>} 完整响应内容
   */
  async chatStream (messages, options = {}, onChunk = null, signal = null) {
    const body = {
      model: this.modelName,
      messages: this.buildMessages(messages, options.system_prompt),
      stream: true
    }
    if (options.temperature != null) body.options = { temperature: options.temperature }
    if (options.max_tokens != null) {
      body.options = { ...(body.options || {}), num_predict: options.max_tokens }
    }

    this.log('debug', `发起流式请求，消息数: ${body.messages.length}`)

    const response = await fetch(this.chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw this.wrapError(new Error(`Ollama HTTP ${response.status}: ${errText || response.statusText}`))
    }

    // 解析 NDJSON 流
    return await this._parseNdjsonStream(response, onChunk, signal)
  }

  /**
   * 解析 NDJSON 流式响应
   * @param {Response} response fetch 响应
   * @param {Function} onChunk chunk 回调
   * @param {AbortSignal} signal 中断信号
   * @returns {Promise<string>} 完整内容
   */
  async _parseNdjsonStream (response, onChunk, signal) {
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
        // 按行分割（NDJSON 每行一个 JSON）
        const lines = buffer.split('\n')
        // 保留最后一行（可能不完整）
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const data = JSON.parse(trimmed)
            // 提取内容增量（Ollama 无思考过程，只包 content）
            if (data.message && data.message.content) {
              const chunk = { content: data.message.content }
              fullContent += chunk.content
              if (onChunk) onChunk(chunk)
            }
            // done=true 表示流结束
            if (data.done) {
              this.log('debug', `流式响应完成，总长度: ${fullContent.length}`)
            }
          } catch (parseErr) {
            // 单行解析失败不中断流，记录警告
            this.log('warn', `NDJSON 行解析失败: ${parseErr.message}`)
          }
        }
      }
      // 处理缓冲区中剩余的最后一行
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer.trim())
          if (data.message && data.message.content) {
            const chunk = { content: data.message.content }
            fullContent += chunk.content
            if (onChunk) onChunk(chunk)
          }
        } catch {
          // 忽略末尾不完整数据
        }
      }
    } finally {
      reader.releaseLock()
    }

    return { content: fullContent, thinking: fullThinking }
  }

  /**
   * 获取本地模型列表
   * GET /api/tags
   * @returns {Promise<Array<string>>} 模型名称列表
   */
  async listModels () {
    try {
      const response = await fetch(this.baseEndpoint + '/api/tags', { method: 'GET' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      // Ollama /api/tags 返回 { models: [{ name, ... }] }
      return (data.models || []).map(m => m.name)
    } catch (error) {
      this.log('error', `获取模型列表失败: ${error.message}`)
      throw this.wrapError(error, 'AI_LIST_MODELS_FAILED')
    }
  }

  /**
   * 测试连接（重写：检查 /api/tags 可达性）
   */
  async testConnection () {
    const start = Date.now()
    try {
      const response = await fetch(this.baseEndpoint + '/api/tags', { method: 'GET' })
      if (response.ok) {
        return { ok: true, latency: Date.now() - start, message: 'Ollama 服务可达' }
      }
      return { ok: false, latency: Date.now() - start, message: `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, latency: Date.now() - start, message: error.message }
    }
  }
}

module.exports = OllamaAdapter
