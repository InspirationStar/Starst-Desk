// ============================================================
// LLM 上下文窗口动态感知 + token 估算截断
// 职责：
//   1. estimateTokens —— 轻量 token 估算（不依赖 tokenizer，混合中英文近似）
//   2. MODEL_CONTEXT_PRESETS —— 2026 主流模型上下文窗口预设表
//   3. getModelContextWindow —— 获取上下文窗口（用户配置优先 → 预设匹配 → 默认）
//   4. truncateByTokenBudget —— 按 token 预算从最早丢弃，保留最新
// 数据来源：联网搜索各厂商官方文档（2026 年最新窗口规格）
//   - OpenAI GPT-5.6 系列 1.05M 窗口
//   - Anthropic Claude Opus/Sonnet/Fable 5 代 1M，Haiku 4.5 200K
//   - DeepSeek V4 系列 1M 窗口
//   - Google Gemini 1.5 Pro 2M，2.0/1.5 Flash 1M
//   - Agnes AI 512K
// ============================================================

// ============================================================
// 2026 主流模型上下文窗口预设表
// match: 模型名片段数组（小写包含匹配）；context: 上下文窗口 token；output: 最大输出 token
// ============================================================
const MODEL_CONTEXT_PRESETS = [
  // OpenAI（2026：GPT-5.6 系列 1.05M 窗口）
  { match: ['gpt-5.6', 'gpt-5'], context: 1050000, output: 128000 },
  { match: ['gpt-4o-mini'], context: 128000, output: 16384 },
  { match: ['gpt-4o'], context: 128000, output: 16384 },
  { match: ['gpt-4-turbo'], context: 128000, output: 4096 },
  { match: ['gpt-4'], context: 8192, output: 4096 },
  { match: ['gpt-3.5'], context: 16384, output: 4096 },
  // Anthropic Claude（2026：Opus/Sonnet/Fable 5 代 1M，Haiku 4.5 200K）
  { match: ['claude-fable', 'claude-opus-5', 'claude-sonnet-5'], context: 1000000, output: 128000 },
  { match: ['claude-haiku-4', 'claude-4.6', 'claude-4.7', 'claude-4.8'], context: 200000, output: 64000 },
  { match: ['claude-3-5-sonnet', 'claude-3.5-sonnet', 'claude-sonnet-4'], context: 200000, output: 8192 },
  { match: ['claude-3-opus', 'claude-3.5-opus', 'claude-opus-4'], context: 200000, output: 4096 },
  { match: ['claude-3-haiku', 'claude-3.5-haiku', 'claude-haiku-3'], context: 200000, output: 4096 },
  { match: ['claude'], context: 200000, output: 8192 },
  // DeepSeek（2026：V4 系列 1M 窗口）
  { match: ['deepseek-v4', 'deepseek-v3.5'], context: 1000000, output: 384000 },
  { match: ['deepseek-chat', 'deepseek-v3'], context: 64000, output: 8192 },
  { match: ['deepseek-reasoner', 'deepseek-r1'], context: 64000, output: 8192 },
  { match: ['deepseek'], context: 64000, output: 8192 },
  // Agnes AI（512K 窗口）
  { match: ['agnes'], context: 512000, output: 65536 },
  // Google Gemini（1.5 Pro 2M，2.0/1.5 Flash 1M）
  { match: ['gemini-1.5-pro', 'gemini-pro'], context: 2000000, output: 8192 },
  { match: ['gemini-2', 'gemini-1.5-flash'], context: 1000000, output: 8192 },
  { match: ['gemini'], context: 1000000, output: 8192 },
  // 通用本地模型
  { match: ['llama'], context: 128000, output: 4096 },
  { match: ['qwen'], context: 128000, output: 8192 },
  { match: ['mistral', 'mixtral'], context: 32000, output: 4096 }
]

/**
 * 轻量 token 估算（不依赖 tokenizer，混合中英文近似）
 * 中文约 1.5 token/字，ASCII 约 1 token/3.5 字符
 * @param {string|object} text
 * @returns {number}
 */
function estimateTokens (text) {
  if (!text) return 0
  const str = typeof text === 'string' ? text : JSON.stringify(text)
  let cjk = 0
  let other = 0
  for (const ch of str) {
    const code = ch.codePointAt(0)
    if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0xF900 && code <= 0xFAFF) || (code >= 0x3000 && code <= 0x303F)) {
      cjk++
    } else {
      other++
    }
  }
  return Math.ceil(cjk * 1.5 + other / 3.5)
}

/**
 * 获取模型上下文窗口（用户高级配置优先，否则按模型名匹配预设，再否则用默认）
 * @param {object} config - AI 配置（含 model_name, provider_type, context_tokens, max_tokens）
 * @returns {{ context: number, output: number, source: string }}
 */
function getModelContextWindow (config) {
  // 1. 用户高级配置优先：context_tokens > 0 表示用户手动配了窗口大小
  const userCtx = Number(config?.context_tokens)
  if (Number.isFinite(userCtx) && userCtx > 0) {
    return { context: userCtx, output: Number(config?.max_tokens) || 4096, source: 'user-config' }
  }
  // 2. 预设匹配
  const modelName = String(config?.model_name || '').toLowerCase()
  if (modelName) {
    for (const preset of MODEL_CONTEXT_PRESETS) {
      if (preset.match.some(m => modelName.includes(m))) {
        return { context: preset.context, output: preset.output, source: 'preset' }
      }
    }
  }
  // 3. 默认（保守 128K，适配多数中端模型）
  return { context: 128000, output: 4096, source: 'default' }
}

/**
 * 按 token 预算截断消息数组（从最早开始丢弃，保留最新）
 * @param {Array} messages - 消息数组 [{ role, content, ... }]
 * @param {number} budgetTokens - 历史消息可用的 token 预算
 * @returns {{ messages: Array, dropped: number, tokens: number }}
 */
function truncateByTokenBudget (messages, budgetTokens) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], dropped: 0, tokens: 0 }
  }
  if (budgetTokens <= 0) {
    // 预算不足，至少保留最新一条避免空上下文
    const last = messages[messages.length - 1]
    return { messages: [last], dropped: messages.length - 1, tokens: estimateTokens(last.content) + 4 }
  }
  // 从最新往最早累加，超预算时截断
  let acc = 0
  let keepFrom = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i]?.content) + 4 // +4 消息结构开销
    if (acc + t > budgetTokens) {
      keepFrom = i + 1
      break
    }
    acc += t
  }
  return {
    messages: messages.slice(keepFrom),
    dropped: keepFrom,
    tokens: acc
  }
}

module.exports = {
  MODEL_CONTEXT_PRESETS,
  estimateTokens,
  getModelContextWindow,
  truncateByTokenBudget
}