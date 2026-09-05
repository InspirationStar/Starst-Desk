// ============================================================
// 输入校验工具
// 提供 URL、文件路径、数值范围、颜色标签、模块类型等校验
// ============================================================

/**
 * 校验 URL 格式
 * @param {string} url
 * @returns {boolean}
 */
function isUrl (url) {
  if (!url || typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * 校验文件路径是否存在（异步版本，返回 Promise）
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
function isFileExists (filePath) {
  const fs = require('fs')
  return new Promise((resolve) => {
    if (!filePath || typeof filePath !== 'string') {
      resolve(false)
      return
    }
    fs.access(filePath, fs.constants.F_OK, (err) => {
      resolve(!err)
    })
  })
}

/**
 * 同步校验文件路径是否存在
 * @param {string} filePath
 * @returns {boolean}
 */
function isFileExistsSync (filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  try {
    require('fs').accessSync(filePath, require('fs').constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 校验数值是否在指定范围内
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
function isInRange (value, min, max) {
  if (typeof value !== 'number' || isNaN(value)) return false
  return value >= min && value <= max
}

/**
 * 校验颜色标签是否合法
 * @param {string} colorTag
 * @returns {boolean}
 */
function isValidColorTag (colorTag) {
  const validColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple']
  return validColors.includes(colorTag)
}

/**
 * 校验模块类型是否合法
 * @param {string} moduleType
 * @returns {boolean}
 */
function isValidModuleType (moduleType) {
  const validModules = ['water', 'sedentary', 'eye', 'stretch', 'sleep', 'diet']
  return validModules.includes(moduleType)
}

/**
 * 校验任务类型是否合法
 * @param {string} taskType
 * @returns {boolean}
 */
function isValidTaskType (taskType) {
  return ['one_shot', 'recurring'].includes(taskType)
}

/**
 * 校验动作类型是否合法
 * @param {string} actionType
 * @returns {boolean}
 */
function isValidActionType (actionType) {
  const validActions = ['message', 'open_app', 'exec_command', 'open_url', 'shutdown']
  return validActions.includes(actionType)
}

/**
 * 校验 AI 提供商类型是否合法
 * 支持的提供商：
 *   - ollama: Ollama 本地模型
 *   - deepseek: DeepSeek API（OpenAI 兼容）
 *   - openai: OpenAI 官方
 *   - anthropic: Anthropic Claude
 *   - gemini: Google Gemini
 *   - custom: 自定义 OpenAI 兼容服务
 *   - agnes-image: Agnes AI 图像生成
 *   - agnes-video: Agnes AI 视频生成
 *   - agnes-all: Agnes AI 全能（图像+视频）
 * @param {string} providerType
 * @returns {boolean}
 */
function isValidProviderType (providerType) {
  const validProviders = [
    'ollama', 'deepseek', 'openai', 'anthropic', 'gemini', 'custom',
    'agnes-image', 'agnes-video', 'agnes-all'
  ]
  return validProviders.includes(providerType)
}

/**
 * 校验模型类别是否合法
 * @param {string} category - 'language' / 'image' / 'video'
 * @returns {boolean}
 */
function isValidModelCategory (category) {
  return ['language', 'image', 'video'].includes(category)
}

/**
 * 校验 extra_config 字段合法性（按模型类别）
 * - language：不强制校验具体字段
 * - image：校验 size、ratio 等字段（如存在）
 * - video：校验 num_frames（≤441 且符合 8n+1 规则）、frame_rate（1-60）等
 * @param {string} category - 模型类别
 * @param {object|null} extraConfig - 扩展配置对象
 * @returns {{ valid: boolean, error?: string, message?: string }}
 */
function isValidExtraConfig (category, extraConfig) {
  // null/undefined 视为合法（允许不配置扩展参数）
  if (extraConfig == null) return { valid: true }
  if (typeof extraConfig !== 'object' || Array.isArray(extraConfig)) {
    return { valid: false, error: 'EXTRA_CONFIG_INVALID', message: 'extra_config 必须是对象' }
  }

  // 视频类别：校验 num_frames 和 frame_rate
  if (category === 'video') {
    if (extraConfig.num_frames != null) {
      const numFrames = Number(extraConfig.num_frames)
      if (!Number.isInteger(numFrames) || numFrames < 1 || numFrames > 441) {
        return { valid: false, error: 'EXTRA_CONFIG_INVALID', message: 'num_frames 应为 1-441 的整数' }
      }
      // Agnes 视频要求 num_frames 符合 8n+1 规则（1, 9, 17, 25, ...）
      if ((numFrames - 1) % 8 !== 0) {
        return { valid: false, error: 'EXTRA_CONFIG_INVALID', message: 'num_frames 应符合 8n+1 规则（如 1, 9, 17, 25, ...）' }
      }
    }
    if (extraConfig.frame_rate != null) {
      const frameRate = Number(extraConfig.frame_rate)
      if (!isInRange(frameRate, 1, 60)) {
        return { valid: false, error: 'EXTRA_CONFIG_INVALID', message: 'frame_rate 应在 1-60 之间' }
      }
    }
  }

  return { valid: true }
}

/**
 * 判断指定提供商类型是否需要 API 密钥
 * Ollama 本地模型无需密钥，其余均需密钥
 * @param {string} providerType
 * @returns {boolean}
 */
function isApiKeyRequired (providerType) {
  return providerType !== 'ollama'
}

/**
 * 校验便签内容（title 和 body 至少有一个不为空）
 * @param {object} data
 * @returns {boolean}
 */
function isValidNoteContent (data) {
  if (!data) return false
  const hasTitle = data.title && data.title.trim().length > 0
  const hasBody = data.body && data.body.trim().length > 0
  return hasTitle || hasBody
}

/**
 * 校验便签提醒时间不早于当前时间
 * @param {string} reminderTime
 * @returns {boolean}
 */
function isReminderTimeValid (reminderTime) {
  if (!reminderTime) return true // 没有设置提醒时间视为合法
  const now = new Date()
  const reminder = new Date(reminderTime)
  return reminder >= now
}

/**
 * 校验健康配置字段范围
 * @param {string} moduleType
 * @param {object} config
 * @returns {{ valid: boolean, error?: string }}
 */
function validateHealthConfig (moduleType, config) {
  if (!isValidModuleType(moduleType)) {
    return { valid: false, error: 'HEALTH_INVALID_MODULE' }
  }

  if (moduleType === 'water') {
    // 喝水：目标 1-100000ml，间隔 1-1440min（仅安全底线，不限定业务范围）
    if (!isInRange(config.target_ml, 1, 100000)) {
      return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '饮水目标应大于 0ml' }
    }
    if (!isInRange(config.interval_minutes, 1, 1440)) {
      return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '饮水间隔应在 1-1440 分钟之间' }
    }
  }

  if (moduleType === 'sedentary') {
    // 久坐伸展：间隔 1-120min，custom_content 可选（最长 200 字）
    if (!isInRange(config.interval_minutes, 1, 120)) {
      return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '久坐间隔应在 1-120 分钟之间' }
    }
    if (config.custom_content && typeof config.custom_content === 'string' && config.custom_content.length > 200) {
      return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '自定义提醒内容不能超过 200 字' }
    }
  }

  if (moduleType === 'eye') {
    // 护眼：间隔 1-1440min，单次时长 1-1440min（仅安全底线，不限定业务范围）
    if (!isInRange(config.interval_minutes, 1, 1440)) {
      return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '护眼间隔应在 1-1440 分钟之间' }
    }
    if (!isInRange(config.duration_minutes, 1, 1440)) {
      return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '护眼时长应大于 0 分钟' }
    }
  }

  if (moduleType === 'stretch') {
    // 运动伸展：间隔 1-1440min（仅安全底线，不限定业务范围）
    if (!isInRange(config.interval_minutes, 1, 1440)) {
      return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '运动伸展间隔应在 1-1440 分钟之间' }
    }
  }

  if (moduleType === 'sleep') {
    // 睡眠：理想入睡/起床时间在合理范围内
    if (config.target_bedtime) {
      const parts = config.target_bedtime.split(':')
      if (parts.length !== 2) {
        return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '入睡时间格式应为 HH:mm' }
      }
      const hour = parseInt(parts[0], 10)
      if (hour < 0 || hour > 23) {
        return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '入睡时间小时应在 0-23 之间' }
      }
    }
    if (config.target_wakeup) {
      const parts = config.target_wakeup.split(':')
      if (parts.length !== 2) {
        return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '起床时间格式应为 HH:mm' }
      }
      const hour = parseInt(parts[0], 10)
      if (hour < 0 || hour > 23) {
        return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: '起床时间小时应在 0-23 之间' }
      }
    }
  }

  if (moduleType === 'diet') {
    // 饮食：三餐时间格式校验
    const mealTimes = ['breakfast', 'lunch', 'dinner']
    for (const meal of mealTimes) {
      if (config[meal]) {
        const parts = config[meal].split(':')
        if (parts.length !== 2) {
          return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: `${meal}时间格式应为 HH:mm` }
        }
        const hour = parseInt(parts[0], 10)
        if (hour < 0 || hour > 23) {
          return { valid: false, error: 'HEALTH_CONFIG_INVALID', message: `${meal}时间小时应在 0-23 之间` }
        }
      }
    }
  }

  return { valid: true }
}

module.exports = {
  isUrl,
  isFileExists,
  isFileExistsSync,
  isInRange,
  isValidColorTag,
  isValidModuleType,
  isValidTaskType,
  isValidActionType,
  isValidProviderType,
  isValidModelCategory,
  isValidExtraConfig,
  isApiKeyRequired,
  isValidNoteContent,
  isReminderTimeValid,
  validateHealthConfig
}
