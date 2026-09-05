// ============================================================
// 通用媒体 IPC 通道
// 注册 media:* 系列 IPC 处理器
// 包含通用媒体生成、模板列表查询、视频轮询等操作
// 通过 mediaTemplateService 路由到对应模板（Agnes / DALL-E / Stability 等）
// ============================================================

const { register, success, failure } = require('./registry.js')
const mediaTemplateService = require('./../services/media-template-service.js')
const logger = require('./../core/logger.js')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { app } = require('electron')
const fs = require('fs')
const path = require('path')

// ============================================================
// 本地媒体资产存储目录
// 位于 app.getPath('userData')/media-assets/，用于持久化 AI 生成的图片/视频
// ============================================================
// 本地媒体资产存储目录
// 优先读取用户配置的路径（app_settings.media_asset_storage_path），
// 否则回退到 app.getPath('userData')/media-assets/
// ============================================================
const STORAGE_PATH_KEY = 'media_asset_storage_path'
const DEFAULT_MEDIA_DIR = 'media-assets'

function getMediaAssetsDir () {
  // 读取用户配置的路径
  try {
    const appSettingDao = require('./../dao/app-setting-dao.js')
    const customPath = appSettingDao.get(STORAGE_PATH_KEY)
    if (customPath && typeof customPath === 'string' && customPath.trim()) {
      const dir = customPath.trim()
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      logger.info('MediaChannels', `使用用户配置的媒体存储路径: ${dir}`)
      return dir
    }
  } catch (err) {
    logger.warn('MediaChannels', `读取媒体存储路径配置失败，使用默认路径: ${err.message}`)
  }
  // 回退到默认路径
  const dir = path.join(app.getPath('userData'), DEFAULT_MEDIA_DIR)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 根据 content-type 推断文件扩展名
 * @param {string} contentType - MIME 类型
 * @returns {string} 扩展名（含点），如 '.png'
 */
function extFromContentType (contentType) {
  if (!contentType) return '.png'
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg'
  if (contentType.includes('mp4')) return '.mp4'
  if (contentType.includes('webm')) return '.webm'
  if (contentType.includes('gif')) return '.gif'
  if (contentType.includes('webp')) return '.webp'
  return '.png'
}

/**
 * 根据文件扩展名推断 content-type
 * @param {string} ext - 扩展名（含点），如 '.png'
 * @returns {string} MIME 类型
 */
function contentTypeFromExt (ext) {
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
  }
  return map[ext.toLowerCase()] || 'application/octet-stream'
}

/**
 * 生成随机文件名（时间戳 + 随机串 + 扩展名）
 * @param {string} ext - 扩展名（含点）
 * @returns {string} 文件名
 */
function generateRandomFilename (ext) {
  const random = Math.random().toString(36).slice(2, 10)
  return `${Date.now()}-${random}${ext}`
}

/**
 * 基于内容哈希生成文件名（SHA-256 前 32 字符 + 扩展名）
 * 同一内容始终生成同一文件名，天然去重，进程重启后仍有效
 * @param {Buffer} buffer - 文件内容
 * @param {string} ext - 扩展名（含点）
 * @returns {string} 文件名
 */
function hashFilename (buffer, ext) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 32)
  return `${hash}${ext}`
}

// ============================================================
// media:generate
// 通用媒体生成（根据 template_id / model_name 路由到对应模板）
// 支持图片生成（同步返回）和视频生成（异步任务，返回 task_id）
// ============================================================
register('media:generate', async (event, data) => {
  try {
    if (!data.prompt) {
      return failure('REQUIRED_FIELDS', 'prompt 不能为空')
    }
    if (!data.template_id && !data.model_name) {
      return failure('TEMPLATE_REQUIRED', 'template_id 或 model_name 不能为空')
    }
    const result = await mediaTemplateService.generate(data, {
      apiKey: data.apiKey,
      configId: data.configId || data.config_id
    })
    return success(result)
  } catch (error) {
    logger.error('MediaChannels', `media:generate 失败: ${error.message}`)
    return failure('MEDIA_GENERATE_ERROR', error.message)
  }
})

// ============================================================
// media:templates
// 返回可用模板列表（按类别分组或过滤）
// 参数：{ category?: 'image' | 'video' }
// ============================================================
register('media:templates', async (event, data) => {
  try {
    const category = data && data.category
    const templates = mediaTemplateService.listTemplates(category)
    return success(templates)
  } catch (error) {
    logger.error('MediaChannels', `media:templates 失败: ${error.message}`)
    return failure('MEDIA_TEMPLATES_ERROR', error.message)
  }
})

// ============================================================
// media:video:poll
// 通用视频轮询（等待异步视频任务完成）
// 通过 event.sender.send 推送进度事件 media:video:progress
// 参数：{ video_id, template_id?, model_name?, poll_interval?, max_attempts?, configId? }
// ============================================================
register('media:video:poll', async (event, data) => {
  try {
    if (!data.video_id) {
      return failure('VIDEO_ID_REQUIRED', 'video_id 不能为空')
    }
    const result = await mediaTemplateService.pollVideoResult(data, {
      apiKey: data.apiKey,
      configId: data.configId || data.config_id,
      onProgress: (progress, pollResult, attempts) => {
        // 向渲染进程推送进度事件
        event.sender.send('media:video:progress', {
          video_id: data.video_id,
          progress,
          attempts,
          status: pollResult.status || pollResult.code
        })
      }
    })
    return success(result)
  } catch (error) {
    logger.error('MediaChannels', `media:video:poll 失败: ${error.message}`)
    return failure('MEDIA_VIDEO_POLL_ERROR', error.message)
  }
})

// ============================================================
// ============================================================
// 全局缓存（所有 media:* IPC handler 共用）
// ============================================================
// 缓存已保存的 URL → { localPath, dataUrl } 映射（防止重复下载）
// 注意：dataUrl 仅在 urlCache 中存在时快速返回，避免重复 readFileSync
const urlCache = new Map()

// 正在进行的下载：URL → Promise（防止并发请求同一 URL 导致重复下载）
const pendingDownloads = new Map()

// ============================================================
// media:fetch-as-data-url
// 主进程下载外部 URL 返回 base64 data URL（绕过渲染进程 CORS 限制）
// 参数：{ url }
// 返回：{ dataUrl }  如 "data:image/png;base64,xxxx"
// 缓存：命中 urlCache 时直接返回，与 saveToLocal 共用同一缓存
// ============================================================
register('media:fetch-as-data-url', async (event, data) => {
  try {
    if (!data || !data.url) {
      return failure('URL_REQUIRED', 'url 不能为空')
    }
    const url = data.url
    // data: / blob: URL 无需转换
    if (/^(data|blob):/.test(url)) {
      return success({ dataUrl: url })
    }

    // 命中 urlCache 缓存（与 saveToLocal 共用）
    if (urlCache.has(url)) {
      const cached = urlCache.get(url)
      if (cached.localPath && fs.existsSync(cached.localPath)) {
        logger.info('MediaChannels', `media:fetch-as-data-url 命中缓存: ${cached.localPath}`)
        // 直接使用缓存的 dataUrl，避免重复读盘生成 base64
        return success({ dataUrl: cached.dataUrl })
      }
      // 文件不存在，清除缓存继续下载
      urlCache.delete(url)
    }

    // 没有本地缓存，直接下载（saveToLocal 会持久化，后续命中缓存）
    // 并发去重：如果同一 URL 正在下载，等待共享结果
    if (pendingDownloads.has(url)) {
      const pending = await pendingDownloads.get(url)
      return success({ dataUrl: pending.dataUrl })
    }

    const downloadPromise = new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const transport = isHttps ? https : http
      const req = transport.get(url, (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const contentType = res.headers['content-type'] || 'image/png'
          resolve({ buffer, contentType })
        })
      })
      req.on('error', reject)
      req.setTimeout(60000, () => {
        req.destroy()
        reject(new Error('下载超时（60秒）'))
      })
    })
    pendingDownloads.set(url, downloadPromise)

    let result
    try {
      result = await downloadPromise
    } finally {
      pendingDownloads.delete(url)
    }

    // 下载到本地并持久化，基于内容哈希命名实现天然去重
    const ext = extFromContentType(result.contentType)
    const filename = hashFilename(result.buffer, ext)
    const localPath = path.join(getMediaAssetsDir(), filename)
    if (!fs.existsSync(localPath)) {
      fs.writeFileSync(localPath, result.buffer)
    }
    const dataUrl = `data:${result.contentType};base64,${result.buffer.toString('base64')}`
    urlCache.set(url, { localPath, dataUrl })

    return success({ dataUrl })
  } catch (error) {
    logger.error('MediaChannels', `media:fetch-as-data-url 失败: ${error.message}`)
    return failure('FETCH_ERROR', error.message)
  }
})


// ============================================================
// media:save-to-local
// 下载 URL 内容保存到本地磁盘（使用用户配置的路径）
// 支持 data: 开头的 base64 data URL 直接解码保存
// 参数：{ url, filename? }
// 返回：{ localPath, dataUrl }
//   - localPath: 绝对文件路径
//   - dataUrl: base64 data URL（供首次显示用，避免再下载一次）
// ============================================================
register('media:save-to-local', async (event, data) => {
  let url = ''
  try {
    if (!data || !data.url) {
      return failure('URL_REQUIRED', 'url 不能为空')
    }
    url = data.url
    const assetsDir = getMediaAssetsDir()

    // 去重：如果同一 URL 已保存过，直接返回已有的 localPath
    if (urlCache.has(url)) {
      const cached = urlCache.get(url)
      if (cached.localPath && fs.existsSync(cached.localPath)) {
        logger.info('MediaChannels', `media:save-to-local 命中缓存: ${cached.localPath}`)
        const buffer = fs.readFileSync(cached.localPath)
        return success({ localPath: cached.localPath, dataUrl: cached.dataUrl })
      }
      // 文件不存在或缓存无效，清除后继续下载
      urlCache.delete(url)
    }

    let buffer
    let contentType
    let ext

    if (url.startsWith('data:')) {
      // data URL 直接解码：data:image/png;base64,xxxx
      const match = url.match(/^data:([^;]+);base64,(.*)$/)
      if (!match) {
        return failure('INVALID_DATA_URL', 'data URL 格式无效')
      }
      contentType = match[1]
      buffer = Buffer.from(match[2], 'base64')
      ext = extFromContentType(contentType)
    } else {
      // 远程 URL：复用 http/https 下载逻辑
      // 并发去重：如果同一 URL 正在下载，等待共享结果
      if (pendingDownloads.has(url)) {
        const pending = await pendingDownloads.get(url)
        buffer = pending.buffer
        contentType = pending.contentType
        ext = extFromContentType(contentType)
      } else {
        const downloadPromise = new Promise((resolve, reject) => {
          const parsedUrl = new URL(url)
          const isHttps = parsedUrl.protocol === 'https:'
          const transport = isHttps ? https : http
          const req = transport.get(url, (res) => {
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
              reject(new Error(`HTTP ${res.statusCode}`))
              return
            }
            const chunks = []
            res.on('data', (chunk) => chunks.push(chunk))
            res.on('end', () => {
              const buf = Buffer.concat(chunks)
              const ct = res.headers['content-type'] || 'image/png'
              resolve({ buffer: buf, contentType: ct })
            })
          })
          req.on('error', reject)
          req.setTimeout(60000, () => {
            req.destroy()
            reject(new Error('下载超时（60秒）'))
          })
        })
        pendingDownloads.set(url, downloadPromise)
        try {
          const result = await downloadPromise
          buffer = result.buffer
          contentType = result.contentType
          ext = extFromContentType(contentType)
        } finally {
          pendingDownloads.delete(url)
        }
      }
    }

    // 确定文件名：优先使用传入的 filename，否则基于内容哈希命名（天然去重）
    let filename = data.filename
    if (!filename) {
      filename = hashFilename(buffer, ext)
    } else if (!path.extname(filename)) {
      // 传入的 filename 无扩展名时补上
      filename = filename + ext
    }

    const localPath = path.join(assetsDir, filename)
    // 哈希文件名命中已存在文件时跳过写入，避免重复 IO
    if (!fs.existsSync(localPath)) {
      fs.writeFileSync(localPath, buffer)
    }

    const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`

    // 缓存到内存，避免重复下载
    urlCache.set(url, { localPath, dataUrl, size: buffer.length })

    logger.info('MediaChannels', `media:save-to-local 保存成功: ${localPath} (${buffer.length} bytes)`)
    return success({ localPath, dataUrl })
  } catch (error) {
    logger.error('MediaChannels', `media:save-to-local 失败: ${error.message} (url: ${url})`)
    return failure('SAVE_LOCAL_ERROR', error.message)
  }
})

// ============================================================
// media:read-local-file
// 读取本地媒体文件返回 base64 data URL
// 参数：{ localPath }
// 返回：{ dataUrl }
// ============================================================
register('media:read-local-file', async (event, data) => {
  try {
    if (!data || !data.localPath) {
      return failure('PATH_REQUIRED', 'localPath 不能为空')
    }
    const localPath = data.localPath
    if (!fs.existsSync(localPath)) {
      return failure('FILE_NOT_FOUND', '本地文件不存在')
    }
    const buffer = fs.readFileSync(localPath)
    const ext = path.extname(localPath)
    const contentType = contentTypeFromExt(ext)
    const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`
    return success({ dataUrl })
  } catch (error) {
    logger.error('MediaChannels', `media:read-local-file 失败: ${error.message}`)
    return failure('READ_LOCAL_ERROR', error.message)
  }
})

// ============================================================
// media:clear-cache
// 清除指定 URL 或全部媒体缓存（用于资产删除后清理过期缓存）
// 参数：{ url? } — 指定 URL 则只清该条目；不传则清除全部
// ============================================================
register('media:clear-cache', async (event, data) => {
  try {
    const url = data && data.url
    if (url) {
      urlCache.delete(url)
      pendingDownloads.delete(url)
    } else {
      urlCache.clear()
      pendingDownloads.clear()
    }
    return success({})
  } catch (error) {
    logger.error('MediaChannels', `media:clear-cache 失败: ${error.message}`)
    return failure('CLEAR_CACHE_ERROR', error.message)
  }
})

module.exports = {}