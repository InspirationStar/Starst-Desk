// ============================================================
// Agnes Media Service（主进程）
// 职责：调用 Agnes AI API 生成图片和视频
// 支持 4 个模型：agnes-image-2.1-flash、agnes-image-2.0-flash、
//               agnes-video-v2.0、agnes-video-2.5-flash
// 模型特定参数从 ai_configs 表的 extra_config 字段（JSON）读取
// ============================================================

const https = require('https')
const http = require('http')
const fs = require('fs').promises
const path = require('path')
const os = require('os')
const aiConfigDao = require('./../dao/ai-config-dao.js')
const cryptoService = require('./../core/crypto-service.js')
const logger = require('./../core/logger.js')

// ============================================================
// 配置
// ============================================================

const AGNES_API_BASE = 'https://api.agnes-ai.cn'
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'starst-screenshots')

// ============================================================
// 4 个模型的参数规格定义
// 供前端表单动态生成及后端参数校验使用
// ============================================================

const AGNES_MODELS = {
  // 图像生成 - 2.1 Flash：size 用档位（1K/2K/3K/4K），可传 ratio
  'agnes-image-2.1-flash': {
    type: 'image',
    endpoint: '/v1/images/generations',
    sizes: ['1K', '2K', '3K', '4K'],
    ratios: ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'],
    supportsImageInput: true,
    defaultSize: '2K',
    defaultRatio: '1:1'
  },
  // 图像生成 - 2.0 Flash：size 用精确尺寸
  'agnes-image-2.0-flash': {
    type: 'image',
    endpoint: '/v1/images/generations',
    exactSizes: ['1024x768', '1024x1024', '768x1024'],
    supportsImageInput: true,
    defaultSize: '1024x1024'
  },
  // 视频生成 - v2.0：height/width/num_frames/frame_rate
  'agnes-video-v2.0': {
    type: 'video',
    endpoint: '/v1/videos',
    queryEndpoint: '/agnesapi',
    modes: ['auto', 'text2video', 'image2video', 'keyframe'],
    resolutions: ['480p', '720p', '1080p'],
    maxNumFrames: 441,
    frameRateRange: [1, 60],
    defaultHeight: 768,
    defaultWidth: 1152,
    defaultNumFrames: 81,
    defaultFrameRate: 24,
    defaultMode: 'auto'
  },
  // 视频生成 - 2.5 Flash：mode 必填，size 固定 720P，seconds/aspect_ratio
  'agnes-video-2.5-flash': {
    type: 'video',
    endpoint: '/v1/videos',
    queryEndpoint: '/agnesapi',
    modes: ['auto', 'text', 'keyframe', 'reference'],
    fixedSize: '720P',
    secondsRange: ['4', '12'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    maxImages: 5,
    defaultMode: 'auto',
    defaultSeconds: '4',
    defaultAspectRatio: '16:9'
  }
}

// 默认模型名（未指定 model_name 时回退）
const DEFAULT_IMAGE_MODEL = 'agnes-image-2.1-flash'
const DEFAULT_VIDEO_MODEL = 'agnes-video-v2.0'

// ============================================================
// 工具函数
// ============================================================

/**
 * HTTP POST 请求
 * @param {string} url
 * @param {object} body
 * @param {object} headers
 * @returns {Promise<object>}
 */
function httpPost (url, body, headers = {}) {
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

    logger.info('AgnesMediaService', `POST ${url}`)
    logger.info('AgnesMediaService', `请求体: ${JSON.stringify(body)}`)

    const req = transport.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        logger.info('AgnesMediaService', `HTTP ${res.statusCode} 响应: ${data.substring(0, 500)}`)
        try {
          const parsed = JSON.parse(data)
          // 检查 HTTP 状态码，非 2xx 时提取错误信息
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            const errMsg = parsed.error?.message || parsed.message || parsed.error || `HTTP ${res.statusCode}`
            reject(new Error(`API HTTP ${res.statusCode}: ${errMsg}`))
            return
          }
          resolve(parsed)
        } catch (err) {
          reject(new Error(`响应解析失败 (HTTP ${res.statusCode}): ${err.message}, 原始响应: ${data.substring(0, 200)}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(60000, () => {
      req.destroy()
      reject(new Error('请求超时（60秒）'))
    })
    req.write(JSON.stringify(body))
    req.end()
  })
}

/**
 * HTTP GET 请求
 * @param {string} url
 * @param {object} headers
 * @returns {Promise<object>}
 */
function httpGet (url, headers = {}) {
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

    logger.info('AgnesMediaService', `GET ${url}`)

    const req = transport.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        logger.info('AgnesMediaService', `HTTP ${res.statusCode} 响应: ${data.substring(0, 500)}`)
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            const errMsg = parsed.error?.message || parsed.message || parsed.error || `HTTP ${res.statusCode}`
            reject(new Error(`API HTTP ${res.statusCode}: ${errMsg}`))
            return
          }
          resolve(parsed)
        } catch (err) {
          reject(new Error(`响应解析失败 (HTTP ${res.statusCode}): ${err.message}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(30000, () => {
      req.destroy()
      reject(new Error('请求超时（30秒）'))
    })
    req.end()
  })
}

/**
 * 确保截图目录存在
 */
async function ensureScreenshotDir () {
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true })
  } catch (err) {
    logger.warn('AgnesMediaService', `创建截图目录失败: ${err.message}`)
  }
}

/**
 * 获取 Agnes API Key（从ai_configs表读取）
 * 优先查找 provider_type 为 agnes-* 的配置，避免误用其他提供商的 Key
 * @returns {Promise<string|null>}
 */
async function getImageApiKey () {
  try {
    // 优先查找 Agnes 专用配置（agnes-image / agnes-video / agnes-all）
    const agnesTypes = ['agnes-image', 'agnes-video', 'agnes-all']
    let config = null
    for (const type of agnesTypes) {
      config = aiConfigDao.findByProviderType(type)
      if (config) break
    }

    // 回退：如果没有 Agnes 专用配置，使用活跃配置
    if (!config) {
      config = aiConfigDao.findActive()
    }

    if (!config) {
      logger.warn('AgnesMediaService', '未找到 Agnes AI 配置')
      return null
    }
    // 解密API密钥
    if (config.api_key_encrypted) {
      return cryptoService.decrypt(config.api_key_encrypted)
    }
    return null
  } catch (error) {
    logger.error('AgnesMediaService', `获取API Key失败: ${error.message}`)
    return null
  }
}

/**
 * 解析完整配置：合并传入 config 与 DB 配置（通过 configId）
 * 传入的 config 优先级高于 DB 配置
 * @param {object} config - 调用方传入的配置
 * @param {object} options - { apiKey?, configId? }
 * @returns {Promise<{model_name: string, extra_config: object, apiKey: string|null}>}
 */
async function resolveConfig (config, options = {}) {
  const result = {
    model_name: config.model_name,
    extra_config: { ...(config.extra_config || {}) },
    apiKey: options.apiKey || null
  }

  // 从 DB 读取配置（通过 configId，兼容 config_id 命名）
  const configId = options.configId || config.configId || config.config_id
  if (configId) {
    const dbConfig = aiConfigDao.getById(configId)
    if (!dbConfig) {
      throw new Error(`配置不存在: ${configId}`)
    }
    // 模型名：传入优先，否则用 DB 的
    result.model_name = config.model_name || dbConfig.model_name
    // 合并 extra_config：DB 的为基础，传入的覆盖
    result.extra_config = { ...(dbConfig.extra_config || {}), ...(config.extra_config || {}) }
    // API Key：从 DB 解密
    if (dbConfig.api_key_encrypted) {
      result.apiKey = cryptoService.decrypt(dbConfig.api_key_encrypted)
    }
    // 保留 provider_type 供后续逻辑使用
    result.provider_type = dbConfig.provider_type
  }

  // 如果仍然没有 API Key，回退到 getImageApiKey
  if (!result.apiKey) {
    result.apiKey = await getImageApiKey()
  }

  return result
}

/**
 * 校验 num_frames 是否符合 8n+1 规则（1, 9, 17, 25, ...）
 * @param {number} numFrames
 * @throws {Error} 校验失败时抛出
 */
function validateNumFrames (numFrames) {
  const n = Number(numFrames)
  if (!Number.isInteger(n) || n < 1 || n > 441) {
    throw new Error('num_frames 应为 1-441 的整数')
  }
  if ((n - 1) % 8 !== 0) {
    throw new Error('num_frames 应符合 8n+1 规则（如 1, 9, 17, 25, ...）')
  }
}

/**
 * 校验 frame_rate 是否在合法范围
 * @param {number} frameRate
 * @throws {Error} 校验失败时抛出
 */
function validateFrameRate (frameRate) {
  const r = Number(frameRate)
  if (isNaN(r) || r < 1 || r > 60) {
    throw new Error('frame_rate 应在 1-60 之间')
  }
}

// ============================================================
// AgnesMediaService 类
// ============================================================

class AgnesMediaService {
  /**
   * 获取模型参数规格
   * @param {string} modelName - 模型名
   * @returns {object|null} 模型规格定义，不存在返回 null
   */
  getModelSpec (modelName) {
    return AGNES_MODELS[modelName] || null
  }

  /**
   * 生成图片
   * 支持从 config.model_name 或 options.configId 读取模型名
   * 从 extra_config 读取 size、ratio、image（图生图）、return_base64 等参数
   * @param {object} config - { prompt, model_name?, extra_config?, configId? }
   * @param {object} options - { apiKey?, configId? }
   * @returns {Promise<{url?: string, b64_json?: string}>}
   */
  async generateImage (config, options = {}) {
    const { prompt } = config

    if (!prompt) {
      throw new Error('生成图片需要提供 prompt')
    }

    // 解析完整配置（合并 DB 配置）
    const resolved = await resolveConfig(config, options)
    const apiKey = resolved.apiKey

    if (!apiKey) {
      throw new Error('未找到有效的 API Key')
    }

    // 确定模型名
    const modelName = resolved.model_name || DEFAULT_IMAGE_MODEL
    const spec = AGNES_MODELS[modelName]
    if (!spec || spec.type !== 'image') {
      throw new Error(`不支持的图像模型: ${modelName}`)
    }

    // 从 extra_config 读取参数
    const ec = resolved.extra_config || {}
    const extraBody = { ...(ec.extra_body || {}) }

    try {
      logger.info('AgnesMediaService', `开始生成图片（${modelName}）: ${prompt.substring(0, 50)}...`)

      // 组装请求体
      const body = {
        model: modelName,
        prompt,
        extra_body: extraBody
      }

      // 根据模型选择参数组装逻辑
      if (modelName === 'agnes-image-2.1-flash') {
        // 2.1-flash：size 用档位（1K/2K/3K/4K），可传 ratio
        body.size = ec.size || spec.defaultSize
        if (ec.ratio) {
          body.ratio = ec.ratio
        }
      } else if (modelName === 'agnes-image-2.0-flash') {
        // 2.0-flash：size 用精确尺寸，仅支持 1024x768/1024x1024/768x1024
        // 校验 ec.size 是否在文档支持的尺寸列表内，不在则回退到默认尺寸
        if (ec.size && spec.exactSizes && spec.exactSizes.includes(ec.size)) {
          body.size = ec.size
        } else {
          if (ec.size) {
            logger.warn('AgnesMediaService', `agnes-image-2.0-flash 不支持的尺寸 ${ec.size}，回退到默认 ${spec.defaultSize}`)
          }
          body.size = spec.defaultSize
        }
      }

      // 图生图：image 放在 extra_body.image 中（文档要求）
      if (ec.image) {
        body.extra_body.image = Array.isArray(ec.image) ? ec.image : [ec.image]
      }

      // 默认返回 URL 格式，除非用户要求 base64
      if (ec.return_base64) {
        body.extra_body.response_format = 'b64_json'
      } else if (!body.extra_body.response_format) {
        body.extra_body.response_format = 'url'
      }

      logger.debug('AgnesMediaService', `图片请求体: ${JSON.stringify(body)}`)

      const response = await httpPost(
        `${AGNES_API_BASE}${spec.endpoint}`,
        body,
        { 'Authorization': `Bearer ${apiKey}` }
      )

      logger.debug('AgnesMediaService', `图片API响应: ${JSON.stringify(response).substring(0, 500)}`)

      // 检查 API 错误响应
      if (response.error) {
        const errMsg = response.error.message || response.error.type || JSON.stringify(response.error)
        throw new Error(`API 错误: ${errMsg}`)
      }

      if (response.data && response.data.length > 0) {
        const result = response.data[0]
        logger.info('AgnesMediaService', `图片生成成功: ${result.url || 'base64'}`)
        return {
          url: result.url,
          b64_json: result.b64_json
        }
      }

      throw new Error(`API 返回数据为空: ${JSON.stringify(response).substring(0, 200)}`)
    } catch (error) {
      logger.error('AgnesMediaService', `generateImage 失败: ${error.message}`)

      throw error
    }
  }

  /**
   * 创建视频生成任务
   * 支持从 config.model_name 或 options.configId 读取模型名
   * 从 extra_config 读取模型特定参数
   * @param {object} config - { prompt, model_name?, extra_config?, configId? }
   * @param {object} options - { apiKey?, configId? }
   * @returns {Promise<{video_id: string, task_id: string}>}
   */
  async generateVideo (config, options = {}) {
    const { prompt } = config

    if (!prompt) {
      throw new Error('生成视频需要提供 prompt')
    }

    // 解析完整配置（合并 DB 配置）
    const resolved = await resolveConfig(config, options)
    const apiKey = resolved.apiKey

    if (!apiKey) {
      throw new Error('未找到有效的 API Key')
    }

    // 确定模型名
    const modelName = resolved.model_name || DEFAULT_VIDEO_MODEL
    const spec = AGNES_MODELS[modelName]
    if (!spec || spec.type !== 'video') {
      throw new Error(`不支持的视频模型: ${modelName}`)
    }

    // 从 extra_config 读取参数
    const ec = resolved.extra_config || {}

    try {
      logger.info('AgnesMediaService', `开始创建视频生成任务（${modelName}）: ${prompt.substring(0, 50)}...`)

      // 组装请求体
      const body = {
        model: modelName,
        prompt
      }

      // 根据模型选择参数组装逻辑
      if (modelName === 'agnes-video-v2.0') {
        // v2.0：height/width/num_frames/frame_rate/mode/image
        // 文档说 mode 是可选的，auto 时不传 mode 让 API 自动判断
        const mode = ec.mode || spec.defaultMode
        if (mode && mode !== 'auto') {
          body.mode = mode
        }
        body.height = ec.height != null ? Number(ec.height) : spec.defaultHeight
        body.width = ec.width != null ? Number(ec.width) : spec.defaultWidth
        body.num_frames = ec.num_frames != null ? Number(ec.num_frames) : spec.defaultNumFrames
        body.frame_rate = ec.frame_rate != null ? Number(ec.frame_rate) : spec.defaultFrameRate

        // 校验 num_frames 和 frame_rate
        validateNumFrames(body.num_frames)
        validateFrameRate(body.frame_rate)

        // 图生视频：image 放在顶层（文档要求）
        if (ec.image) {
          body.image = ec.image
        }
        // 可选参数
        if (ec.seed != null) body.seed = Number(ec.seed)
        if (ec.negative_prompt) body.negative_prompt = ec.negative_prompt
      } else if (modelName === 'agnes-video-2.5-flash') {
        // 2.5-flash：mode（必填）、size 固定 "720P"、seconds、aspect_ratio
        // auto 模式：根据是否有图片输入自动选择 text 或 reference
        let mode = ec.mode || spec.defaultMode
        if (mode === 'auto') {
          const hasImageInput = !!(ec.first_frame || ec.last_frame || ec.images)
          mode = hasImageInput ? 'reference' : 'text'
        }
        body.mode = mode
        body.size = spec.fixedSize
        body.seconds = ec.seconds || spec.defaultSeconds
        body.aspect_ratio = ec.aspect_ratio || spec.defaultAspectRatio

        // 可选参数
        if (ec.first_frame) body.first_frame = ec.first_frame
        if (ec.last_frame) body.last_frame = ec.last_frame
        if (ec.images) {
          // images 数量不超过 maxImages
          const images = Array.isArray(ec.images) ? ec.images : [ec.images]
          if (images.length > spec.maxImages) {
            throw new Error(`images 数量不能超过 ${spec.maxImages}`)
          }
          body.images = images
        }
        if (ec.audios) body.audios = ec.audios
        if (ec.seed != null) body.seed = Number(ec.seed)
      }

      logger.debug('AgnesMediaService', `视频请求体: ${JSON.stringify(body)}`)

      const response = await httpPost(
        `${AGNES_API_BASE}${spec.endpoint}`,
        body,
        { 'Authorization': `Bearer ${apiKey}` }
      )

      logger.debug('AgnesMediaService', `视频API响应: ${JSON.stringify(response).substring(0, 500)}`)

      // 检查 API 错误响应
      if (response.error) {
        let errMsg = response.error.message || response.error.type || JSON.stringify(response.error)
        // 对 "No available channel" 错误给出更友好的提示
        if (errMsg.includes('No available channel')) {
          errMsg = `模型 ${modelName} 不可用（可能 API Key 不支持此模型或模型已下线）。建议尝试 agnes-video-2.5-flash`
        }
        throw new Error(`API 错误: ${errMsg}`)
      }

      const { video_id, task_id } = response
      if (!video_id && !task_id) {
        throw new Error(`API 未返回 video_id/task_id: ${JSON.stringify(response).substring(0, 200)}`)
      }
      logger.info('AgnesMediaService', `视频任务已创建: video_id=${video_id}, task_id=${task_id}`)

      return { video_id, task_id }
    } catch (error) {
      logger.error('AgnesMediaService', `generateVideo 失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 查询视频生成结果
   * @param {object} config - { video_id, apiKey?, configId? }
   * @param {string} videoId
   * @param {object} options - { apiKey?, configId? }
   * @returns {Promise<object>}
   */
  async getVideoResult (config, videoId, options = {}) {
    if (!videoId) {
      throw new Error('需要提供 video_id')
    }

    // 解析 API Key（支持 configId，兼容 config_id 命名）
    const configId = options.configId || config.configId || config.config_id
    let resolvedApiKey = options.apiKey || config.apiKey

    if (!resolvedApiKey && configId) {
      const dbConfig = aiConfigDao.getById(configId)
      if (dbConfig && dbConfig.api_key_encrypted) {
        resolvedApiKey = cryptoService.decrypt(dbConfig.api_key_encrypted)
      }
    }

    if (!resolvedApiKey) {
      resolvedApiKey = await getImageApiKey()
    }

    if (!resolvedApiKey) {
      throw new Error('未找到有效的 API Key')
    }

    try {
      // 根据模型名选择查询端点（兼容 config.model_name / config.model_name）
      const modelName = config.model_name || options.model_name || DEFAULT_VIDEO_MODEL
      const spec = AGNES_MODELS[modelName] || AGNES_MODELS[DEFAULT_VIDEO_MODEL]
      const queryEndpoint = spec.queryEndpoint || '/agnesapi'
      let url = `${AGNES_API_BASE}${queryEndpoint}?video_id=${videoId}`
      // 添加 model_name 参数（API 文档建议，特别是使用非默认模型时）
      if (modelName && modelName !== DEFAULT_VIDEO_MODEL) {
        url += `&model_name=${encodeURIComponent(modelName)}`
      }
      logger.info('AgnesMediaService', `查询视频结果: video_id=${videoId}, model=${modelName}`)

      const response = await httpGet(url, {
        'Authorization': `Bearer ${resolvedApiKey}`
      })

      logger.debug('AgnesMediaService', `视频结果响应: ${JSON.stringify(response).substring(0, 500)}`)

      // 检查 API 错误响应
      if (response.error) {
        const errMsg = response.error.message || response.error.type || JSON.stringify(response.error)
        throw new Error(`API 错误: ${errMsg}`)
      }

      return response
    } catch (error) {
      logger.error('AgnesMediaService', `getVideoResult 失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 检查视频是否生成完成
   * @param {object} config - { video_id }
   * @param {string} videoId
   * @param {object} options - { apiKey?, configId? }
   * @returns {Promise<boolean>}
   */
  async isVideoReady (config, videoId, options = {}) {
    try {
      const result = await this.getVideoResult(config, videoId, options)
      // 根据 API 返回状态判断，通常有 status 或 progress 字段
      const status = result.status || result.code
      return status === 'succeeded' || status === 'completed' || status === 1 || result.progress === 100
    } catch (error) {
      logger.warn('AgnesMediaService', `isVideoReady 检查失败: ${error.message}`)
      return false
    }
  }

  /**
   * 轮询等待视频生成完成
   * 兼容旧接口：pollVideoResult(config, pollInterval, maxAttempts)
   * 新接口：pollVideoResult(config, options) 其中 options 包含 pollInterval/maxAttempts/apiKey/configId/onProgress
   * @param {object} config - { video_id, pollInterval?, maxAttempts?, apiKey?, configId? }
   * @param {number|object} pollIntervalOrOptions - 轮询间隔（毫秒）或 options 对象
   * @param {number} maxAttempts - 最大轮询次数，默认 60（5分钟）
   * @returns {Promise<object>}
   */
   async pollVideoResult (config, pollIntervalOrOptions = 5000, maxAttempts = 120) {
     const { video_id } = config

     // 兼容旧接口：第二参数为数字（pollInterval）或对象（options）
     let pollInterval = 5000
     let options = {}

     if (typeof pollIntervalOrOptions === 'object' && pollIntervalOrOptions !== null) {
       options = pollIntervalOrOptions
       pollInterval = options.pollInterval || 5000
       maxAttempts = options.maxAttempts || 120
     } else {
       pollInterval = pollIntervalOrOptions
     }

     // 合并 config 中的 configId/apiKey/model_name 到 options
     if (config.configId && !options.configId) options.configId = config.configId
     if (config.apiKey && !options.apiKey) options.apiKey = config.apiKey
     if (config.model_name && !options.model_name) options.model_name = config.model_name

     const { onProgress } = options
     let attempts = 0
     let consecutiveErrors = 0

     logger.info('AgnesMediaService', `开始轮询视频结果: video_id=${video_id}, 最大 ${maxAttempts} 次`)

     while (attempts < maxAttempts) {
       attempts++
       logger.debug('AgnesMediaService', `轮询第 ${attempts} 次...`)

       try {
         const result = await this.getVideoResult(config, video_id, options)
         consecutiveErrors = 0 // 重置错误计数
         const status = result.status || result.code
         const progress = result.progress || 0

         // 推送进度回调
         if (onProgress && typeof onProgress === 'function') {
           onProgress(progress, result, attempts)
         }

         if (status === 'succeeded' || status === 'completed' || status === 1 || result.progress === 100) {
           logger.info('AgnesMediaService', '视频生成完成')
           return result
         }

           if (status === 'failed' || status === -1) {
            throw new Error(`视频生成失败: ${result.error?.message || result.error || '未知错误'}`)
          }

          // 等待下一次轮询
          await new Promise(resolve => setTimeout(resolve, pollInterval))
        } catch (err) {
          consecutiveErrors++
          logger.warn('AgnesMediaService', `轮询第 ${attempts} 次失败(${consecutiveErrors}): ${err.message}`)
          // 连续错误超过 5 次，抛出错误
          if (consecutiveErrors >= 5) {
            throw new Error(`视频轮询连续失败 ${consecutiveErrors} 次: ${err.message}`)
          }
          // 等待后继续重试
          await new Promise(resolve => setTimeout(resolve, pollInterval))
        }
      }

      throw new Error('视频生成超时')
    }

  /**
   * 保存 base64 图片到临时目录
   * @param {string} b64Json - base64 编码的图片数据
   * @param {string} filename - 文件名
   * @returns {Promise<string>} 文件路径
   */
  async saveBase64Image (b64Json, filename = 'image.png') {
    await ensureScreenshotDir()

    // 移除 data URI 前缀
    const base64Data = b64Json.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    const filePath = path.join(SCREENSHOT_DIR, filename)
    await fs.writeFile(filePath, buffer)

    logger.info('AgnesMediaService', `图片已保存: ${filePath}`)
    return filePath
  }
}

// ============================================================
// 单例导出
// ============================================================

const agnesMediaService = new AgnesMediaService()

module.exports = {
  AgnesMediaService,
  agnesMediaService,
  ensureScreenshotDir,
  SCREENSHOT_DIR,
  AGNES_MODELS
}
