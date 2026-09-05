// ============================================================
// Google Gemini 适配器
// 使用 Google 官方提供的 OpenAI 兼容端点：
//   https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
// 鉴权：Bearer {api_key}（与 OpenAI 一致）
// 格式：OpenAI 兼容 SSE 流式响应
// 支持模型：gemini-1.5-pro、gemini-1.5-flash、gemini-2.0-flash 等
// 高级选项：
//   - enable_vision: 启用图片输入（gemini-1.5/2.0 系列原生支持多模态）
//   - enable_thinking: 启用思考模式（gemini-2.0-flash-thinking 等模型）
// 设计依据：design.md 2.6.3 节
// ============================================================

const OpenAIAdapter = require('./openai-adapter.js')

// Gemini OpenAI 兼容端点
const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

class GeminiAdapter extends OpenAIAdapter {
  constructor (config) {
    super(config)
    // 端点规范化：Gemini 兼容端点路径为 /v1beta/openai/chat/completions
    this.apiEndpoint = this._normalizeGeminiEndpoint(config.api_endpoint || DEFAULT_ENDPOINT)
    if (!config.api_key_encrypted) {
      this.log('warn', 'Gemini 适配器未设置 API 密钥')
    }
  }

  /**
   * 规范化 Gemini 端点
   * 规则：
   *   - 已以 /chat/completions 结尾：直接返回
   *   - 包含 /v1beta 或 /v1 段：追加 /openai/chat/completions 或 /chat/completions
   *   - base URL：追加 /v1beta/openai/chat/completions
   * @param {string} endpoint
   * @returns {string}
   */
  _normalizeGeminiEndpoint (endpoint) {
    if (!endpoint) return endpoint
    let url = endpoint.replace(/\/+$/, '')
    if (/\/chat\/completions$/.test(url)) return url
    if (/\/v1beta(\/|$)/.test(url)) {
      // 已含 /v1beta，追加 /openai/chat/completions
      if (/\/openai(\/|$)/.test(url)) {
        return url + '/chat/completions'
      }
      return url + '/openai/chat/completions'
    }
    if (/\/v1(\/|$)/.test(url)) {
      return url + '/chat/completions'
    }
    return url + '/v1beta/openai/chat/completions'
  }

  /**
   * 测试连接（重写：使用 Gemini 端点）
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
        return { ok: true, latency: Date.now() - start, message: 'Gemini 连接正常' }
      }
      const errText = await response.text().catch(() => '')
      return { ok: false, latency: Date.now() - start, message: `HTTP ${response.status}: ${errText.slice(0, 100)}` }
    } catch (error) {
      return { ok: false, latency: Date.now() - start, message: error.message }
    }
  }
}

module.exports = GeminiAdapter