// ============================================================
// 通用媒体模板服务（主进程）
// 职责：定义主流生图/生视频 API 格式模板，提供统一调用接口
// 支持提供商：Agnes AI、OpenAI DALL-E 3、Stability AI 等
// Agnes 系列委托给 agnes-media-service，其他模板通过 HTTP 直接调用
// 设计依据：plan.md 任务 3
// ============================================================

const https = require('https')
const http = require('http')
const { agnesMediaService } = require('./agnes-media-service.js')
const cryptoService = require('./../core/crypto-service.js')
const logger = require('./../core/logger.js')

// ============================================================
// 工具函数
// ============================================================

/**
 * HTTP POST 请求
 * @param {string} url 完整 URL
 * @param {object} body 请求体
 * @param {object} headers 请求头
 * @param {number} timeout 超时时间（毫秒）
 * @returns {Promise<object>} 响应 JSON
 */
function httpPost (url, body, headers = {}, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const transport = isHttps ? https : http

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }

    const req = transport.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(new Error(`响应解析失败: ${err.message}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy()
      reject(new Error(`请求超时（${timeout / 1000}秒）`))
    })
    req.write(JSON.stringify(body))
    req.end()
  })
}

/**
 * HTTP GET 请求
 * @param {string} url 完整 URL
 * @param {object} headers 请求头
 * @param {number} timeout 超时时间（毫秒）
 * @returns {Promise<object>} 响应 JSON
 */
function httpGet (url, headers = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const transport = isHttps ? https : http

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers
    }

    const req = transport.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(new Error(`响应解析失败: ${err.message}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy()
      reject(new Error(`请求超时（${timeout / 1000}秒）`))
    })
    req.end()
  })
}

/**
 * 规范化 extra_config：确保返回对象
 * @param {*} extraConfig
 * @returns {object}
 */
function _normalizeExtraConfig (extraConfig) {
  if (!extraConfig || typeof extraConfig !== 'object') return {}
  return extraConfig
}

// ============================================================
// 媒体 API 格式模板
// 每个模板定义如何组装请求体、解析响应、调用端点
// Agnes 系列通过 handler: 'agnesMediaService' 委托给 agnes-media-service
// ============================================================

const MEDIA_TEMPLATES = {
  // ---------- Agnes 系列（委托给 agnes-media-service） ----------
  'agnes-image-2.1-flash': {
    provider: 'agnes',
    category: 'image',
    label: 'Agnes Image 2.1 Flash',
    handler: 'agnesMediaService'
  },
  'agnes-image-2.0-flash': {
    provider: 'agnes',
    category: 'image',
    label: 'Agnes Image 2.0 Flash',
    handler: 'agnesMediaService'
  },
  'agnes-video-v2.0': {
    provider: 'agnes',
    category: 'video',
    label: 'Agnes Video V2.0',
    handler: 'agnesMediaService'
  },
  'agnes-video-2.5-flash': {
    provider: 'agnes',
    category: 'video',
    label: 'Agnes Video 2.5 Flash',
    handler: 'agnesMediaService'
  },

  // ---------- OpenAI DALL-E 3 ----------
  'dall-e-3': {
    provider: 'openai',
    category: 'image',
    label: 'OpenAI DALL-E 3',
    endpoint: '/v1/images/generations',
    method: 'POST',
    // 默认端点 base，可被 config.api_endpoint 覆盖
    baseUrl: 'https://api.openai.com',
    bodyBuilder: (config) => ({
      model: 'dall-e-3',
      prompt: config.prompt,
      size: _normalizeExtraConfig(config.extra_config).size || '1024x1024',
      quality: _normalizeExtraConfig(config.extra_config).quality || 'standard',
      n: _normalizeExtraConfig(config.extra_config).n || 1
    }),
    responseParser: (resp) => {
      if (resp.data && resp.data.length > 0) {
        return { url: resp.data[0].url, b64_json: resp.data[0].b64_json }
      }
      throw new Error('DALL-E 3 返回数据为空')
    }
  },

  // ---------- Stability AI (SD3 Stable Image Core) ----------
  'stable-image-core': {
    provider: 'stability',
    category: 'image',
    label: 'Stability AI Stable Image Core',
    endpoint: '/v2beta/stable-image/generate/core',
    method: 'POST',
    baseUrl: 'https://api.stability.ai',
    headers: { Accept: 'image/png' },
    bodyBuilder: (config) => ({
      prompt: config.prompt,
      ..._normalizeExtraConfig(config.extra_config)
    }),
    responseParser: (resp) => {
      if (resp.image) {
        return { b64_json: resp.image }
      }
      if (resp.artifacts && resp.artifacts.length > 0) {
        return { b64_json: resp.artifacts[0].base64 }
      }
      throw new Error('Stability AI 返回数据为空')
    }
  }

  // 可扩展更多模板...
}

// ============================================================
// 模板注册表（允许动态注册自定义模板）
// ============================================================

const customTemplates = {}

/**
 * 动态注册自定义模板
 * @param {string} id 模板 ID（如 'my-custom-image'）
 * @param {object} template 模板定义
 * @returns {boolean} 是否注册成功
 */
function registerTemplate (id, template) {
  if (!id || typeof id !== 'string') {
    logger.warn('MediaTemplateService', 'registerTemplate: 模板 ID 不能为空')
    return false
  }
  if (!template || typeof template !== 'object') {
    logger.warn('MediaTemplateService', `registerTemplate: 模板定义无效: ${id}`)
    return false
  }
  if (!template.provider || !template.category) {
    logger.warn('MediaTemplateService', `registerTemplate: 模板缺少 provider 或 category: ${id}`)
    return false
  }
  customTemplates[id] = { ...template, custom: true }
  logger.info('MediaTemplateService', `已注册自定义模板: ${id}`)
  return true
}

/**
 * 注销自定义模板
 * @param {string} id 模板 ID
 * @returns {boolean} 是否注销成功
 */
function unregisterTemplate (id) {
  if (customTemplates[id]) {
    delete customTemplates[id]
    logger.info('MediaTemplateService', `已注销自定义模板: ${id}`)
    return true
  }
  return false
}

/**
 * 获取模板定义（合并内置与自定义）
 * @param {string} id 模板 ID
 * @returns {object|null}
 */
function getTemplate (id) {
  return customTemplates[id] || MEDIA_TEMPLATES[id] || null
}

/**
 * 列出所有可用模板
 * @param {string} [category] 类别过滤（'image' / 'video'），不传则返回全部
 * @returns {Array<object>} 模板列表
 */
function listTemplates (category) {
  const allTemplates = { ...MEDIA_TEMPLATES, ...customTemplates }
  const result = []
  for (const [id, template] of Object.entries(allTemplates)) {
    if (category && template.category !== category) continue
    result.push({
      id,
      provider: template.provider,
      category: template.category,
      label: template.label || id,
      custom: template.custom || false
    })
  }
  return result
}

// ============================================================
// 统一调用接口
// ============================================================

/**
 * 生成媒体内容（图片或视频）
 * 根据 config.model_name 或 config.template_id 查找模板并调用
 * @param {object} config - { model_name?, template_id?, prompt, api_endpoint?, api_key_encrypted?, extra_config? }
 * @param {object} [options] - { apiKey? }
 * @returns {Promise<object>} 生成结果
 *   - 图片：{ url?, b64_json? }
 *   - 视频：{ video_id, task_id }（异步任务，需轮询 getVideoResult 获取最终结果）
 */
async function generate (config, options = {}) {
  if (!config) {
    throw new Error('generate: config 不能为空')
  }
  if (!config.prompt) {
    throw new Error('generate: prompt 不能为空')
  }

  // 查找模板：优先 template_id，其次 model_name
  const templateId = config.template_id || config.model_name
  if (!templateId) {
    throw new Error('generate: 必须指定 template_id 或 model_name')
  }

  const template = getTemplate(templateId)
  if (!template) {
    throw new Error(`未找到媒体模板: ${templateId}`)
  }

  logger.info('MediaTemplateService', `调用模板 ${templateId}（provider=${template.provider}, category=${template.category}）`)

  // Agnes 系列：委托给 agnesMediaService
  if (template.handler === 'agnesMediaService') {
    return await _invokeAgnes(template, config, options)
  }

  // 其他模板：通过 HTTP 直接调用
  return await _invokeHttpTemplate(template, config, options)
}

/**
 * 查询视频生成结果（异步任务轮询）
 * 仅适用于支持异步任务的模板（如 Agnes 视频）
 * @param {object} config - { template_id?, model_name?, video_id, api_key_encrypted? }
 * @param {object} [options] - { apiKey? }
 * @returns {Promise<object>} 视频生成结果
 */
async function getVideoResult (config, options = {}) {
  if (!config || !config.video_id) {
    throw new Error('getVideoResult: video_id 不能为空')
  }

  const templateId = config.template_id || config.model_name
  if (!templateId) {
    throw new Error('getVideoResult: 必须指定 template_id 或 model_name')
  }

  const template = getTemplate(templateId)
  if (!template) {
    throw new Error(`未找到媒体模板: ${templateId}`)
  }

  // Agnes 系列：委托给 agnesMediaService
  if (template.handler === 'agnesMediaService') {
    return await agnesMediaService.getVideoResult(
      { configId: config.configId || config.config_id || options.configId },
      config.video_id,
      { apiKey: options.apiKey, configId: config.configId || options.configId }
    )
  }

  // 其他模板：若定义了 resultEndpoint，通过 HTTP 查询
  if (template.resultEndpoint) {
    const apiKey = options.apiKey || await _resolveApiKey(config)
    const baseUrl = config.api_endpoint || template.baseUrl
    const url = `${baseUrl}${template.resultEndpoint}/${config.video_id}`
    const headers = _buildHeaders(template, apiKey)
    const response = await httpGet(url, headers)
    if (template.resultParser) {
      return template.resultParser(response)
    }
    return response
  }

  throw new Error(`模板 ${templateId} 不支持查询视频结果`)
}

/**
 * 轮询等待视频生成完成
 * @param {object} config - { template_id?, model_name?, video_id, poll_interval?, max_attempts?, configId? }
 * @param {object} [options] - { apiKey?, configId?, onProgress? }
 * @returns {Promise<object>} 视频生成最终结果
 */
async function pollVideoResult (config, options = {}) {
  if (!config || !config.video_id) {
    throw new Error('pollVideoResult: video_id 不能为空')
  }

  const templateId = config.template_id || config.model_name
  const template = templateId ? getTemplate(templateId) : null

  // Agnes 视频系列：直接委托给 agnesMediaService.pollVideoResult（已支持 onProgress、configId）
  if (template && template.handler === 'agnesMediaService' && template.category === 'video') {
    return await agnesMediaService.pollVideoResult(config, {
      apiKey: options.apiKey,
      configId: config.configId || config.config_id || options.configId,
      model_name: config.model_name || config.template_id,
      pollInterval: config.poll_interval || 5000,
      maxAttempts: config.max_attempts || 120,
      onProgress: options.onProgress
    })
  }

  // 通用轮询逻辑（适用于其他异步模板）
  const pollInterval = config.poll_interval || 5000
  const maxAttempts = config.max_attempts || 60
  const { onProgress } = options
  let attempts = 0

  logger.info('MediaTemplateService', `开始轮询视频结果: video_id=${config.video_id}，间隔=${pollInterval}ms，最大次数=${maxAttempts}`)

  while (attempts < maxAttempts) {
    attempts++
    logger.debug('MediaTemplateService', `轮询第 ${attempts} 次...`)

    const result = await getVideoResult(config, options)
    const status = result.status || result.code
    const progress = result.progress || 0

    // 推送进度回调
    if (onProgress && typeof onProgress === 'function') {
      onProgress(progress, result, attempts)
    }

    // 成功状态
    if (status === 'succeeded' || status === 'completed' || status === 1 || result.progress === 100) {
      logger.info('MediaTemplateService', '视频生成完成')
      return result
    }

    // 失败状态
    if (status === 'failed' || status === -1) {
      throw new Error(`视频生成失败: ${result.error?.message || result.error || '未知错误'}`)
    }

    // 等待下一次轮询
    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }

  throw new Error('视频生成超时')
}

// ============================================================
// 内部调用实现
// ============================================================

/**
 * 调用 Agnes 媒体服务（委托）
 * 将 template_id/model_name、extra_config、configId 完整传递给 agnesMediaService
 * 由 agnesMediaService 内部 resolveConfig 处理 DB 配置合并与 API Key 解密
 * @param {object} template 模板定义
 * @param {object} config 调用配置
 * @param {object} options 选项
 * @returns {Promise<object>}
 */
async function _invokeAgnes (template, config, options = {}) {
  // 确定模型名：优先 model_name，其次 template_id
  const modelName = config.model_name || config.template_id

  // 组装传递给 agnesMediaService 的配置：保留 prompt、model_name、extra_config、configId
  const agnesConfig = {
    prompt: config.prompt,
    model_name: modelName,
    extra_config: _normalizeExtraConfig(config.extra_config),
    configId: config.configId || config.config_id || options.configId
  }

  // 传递 options（含 apiKey、configId），让 agnesMediaService.resolveConfig 处理 DB 合并
  const agnesOptions = {
    apiKey: options.apiKey,
    configId: config.configId || config.config_id || options.configId
  }

  if (template.category === 'image') {
    return await agnesMediaService.generateImage(agnesConfig, agnesOptions)
  } else if (template.category === 'video') {
    // 视频生成（异步任务，返回 { video_id, task_id }）
    return await agnesMediaService.generateVideo(agnesConfig, agnesOptions)
  }

  throw new Error(`Agnes 模板不支持类别: ${template.category}`)
}

/**
 * 调用 HTTP 模板（DALL-E、Stability 等）
 * @param {object} template 模板定义
 * @param {object} config 调用配置
 * @param {object} options 选项
 * @returns {Promise<object>}
 */
async function _invokeHttpTemplate (template, config, options = {}) {
  if (!template.bodyBuilder) {
    throw new Error(`模板 ${config.template_id || config.model_name} 缺少 bodyBuilder`)
  }
  if (!template.responseParser) {
    throw new Error(`模板 ${config.template_id || config.model_name} 缺少 responseParser`)
  }

  const apiKey = options.apiKey || await _resolveApiKey(config)
  const baseUrl = config.api_endpoint || template.baseUrl
  if (!baseUrl) {
    throw new Error('未配置 API 端点（api_endpoint 或模板 baseUrl）')
  }

  // 组装请求体
  const body = template.bodyBuilder(config)
  // 组装请求头
  const headers = _buildHeaders(template, apiKey)

  // 构建完整 URL
  const url = `${baseUrl}${template.endpoint}`
  logger.debug('MediaTemplateService', `HTTP ${template.method || 'POST'} ${url}`)

  // 发起请求
  const response = await httpPost(url, body, headers)

  // 解析响应
  return template.responseParser(response)
}

/**
 * 解析 API Key（从 config.api_key_encrypted 解密，或直接使用 options.apiKey）
 * @param {object} config
 * @returns {Promise<string|null>}
 */
async function _resolveApiKey (config) {
  if (config.api_key_encrypted) {
    try {
      return cryptoService.decrypt(config.api_key_encrypted)
    } catch (error) {
      logger.error('MediaTemplateService', `API Key 解密失败: ${error.message}`)
      throw new Error('API Key 解密失败，请重新配置')
    }
  }
  return null
}

/**
 * 构建请求头（注入 Authorization）
 * @param {object} template 模板定义
 * @param {string} apiKey API Key
 * @returns {object} 请求头
 */
function _buildHeaders (template, apiKey) {
  const headers = { ...(template.headers || {}) }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
  // 模板管理
  getTemplate,
  listTemplates,
  registerTemplate,
  unregisterTemplate,
  // 统一调用接口
  generate,
  getVideoResult,
  pollVideoResult,
  // 内置模板（只读引用）
  MEDIA_TEMPLATES
}