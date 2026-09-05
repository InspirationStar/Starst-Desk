// ============================================================
// 统一媒体资源加载器
// 职责：为聊天消息、资产盒子等提供统一的图片/视频资源加载逻辑
// 加载策略：
//   1. 本地路径（localPath / filePath）→ mediaApi.readLocalFile（快速磁盘 IO）
//   2. localPathCache（内存中已知路径，避免重复查 DB）→ readLocalFile
//   3. 远程 URL → mediaApi.saveToLocal（主进程下载并持久化到磁盘）
// 并发去重：pendingRequests 防止同一 URL 并发重复下载
// 设计原则：不在内存中缓存 dataUrl（图片可能很大），只在内存中缓存 localPath
// ============================================================

import { mediaApi } from '@/utils/ipc-client'

// 内存缓存：url → localPath（远程下载后保存的本地路径，避免重复查 DB）
const localPathCache = new Map()

// 进行中的请求：url → Promise<dataUrl>（并发去重，同一 URL 只发一次请求）
const pendingRequests = new Map()

// 失败的 URL 集合：缓存已失败的 URL，避免重复尝试（尤其是 404 永久失效）
const failedUrls = new Set()

/**
 * 统一加载媒体资源，返回 CSP 兼容的 data URL
 * 优先级：data: URL 直接返回 → 本地路径 → localPathCache → 远程下载（并持久化）
 *
 * @param {Object} options
 * @param {string} [options.url] - 远程资源 URL
 * @param {string} [options.localPath] - 本地文件路径（优先使用）
 * @returns {Promise<string>} data URL（以 "data:" 开头），失败返回空字符串
 */
export async function loadMediaDataUrl ({ url, localPath } = {}) {
  // data: 或 blob: URL 直接返回
  if (url && /^(data|blob):/.test(url)) {
    return url
  }

  // 优先从本地路径读取（快速磁盘 IO，不占内存）
  if (localPath) {
    try {
      const result = await mediaApi.readLocalFile(localPath)
      if (result && result.dataUrl) {
        return result.dataUrl
      }
    } catch (err) {
      console.warn('[media-loader] 本地文件读取失败，回退到 URL 下载:', err.message)
    }
  }

  // 没有 URL 则无法继续
  if (!url) return ''

  // 如果 URL 之前已失败（如 404），不再重试
  if (failedUrls.has(url)) return ''

  // 如果没有 localPath，检查 localPathCache（之前远程下载时保存的本地路径）
  // 也覆盖 localPath 有值但读取失败的场景（文件已被删除等）
  if (localPathCache.has(url)) {
    const cachedPath = localPathCache.get(url)
    try {
      const result = await mediaApi.readLocalFile(cachedPath)
      if (result && result.dataUrl) {
        return result.dataUrl
      }
    } catch {
      // 本地文件可能已被删除，继续走 URL 下载
    }
  }

  // 检查是否有进行中的请求（并发去重）
  if (pendingRequests.has(url)) {
    return pendingRequests.get(url)
  }

  // 发起远程下载请求（同时保存到本地磁盘持久化）
  const promise = (async () => {
    try {
      const saveResult = await mediaApi.saveToLocal(url)
      if (saveResult && saveResult.localPath) {
        // 仅缓存路径，不缓存 dataUrl（避免大图片占用内存）
        localPathCache.set(url, saveResult.localPath)
        // 从刚保存的文件读取 dataUrl
        const readResult = await mediaApi.readLocalFile(saveResult.localPath)
        if (readResult && readResult.dataUrl) {
          return readResult.dataUrl
        }
      }
      return ''
    } catch (err) {
      console.warn('[media-loader] URL 下载失败:', url, err.message)
      failedUrls.add(url)
      return ''
    } finally {
      pendingRequests.delete(url)
    }
  })()

  pendingRequests.set(url, promise)
  return promise
}

/**
 * 预加载资源到本地磁盘（下载并持久化）
 * 用于首次生成后将远程资源保存到本地，后续加载走快速磁盘路径
 *
 * @param {string} url - 远程资源 URL
 * @param {string} [filename] - 可选文件名
 * @returns {Promise<{localPath: string}|null>}
 */
export async function saveMediaToLocal (url, filename) {
  if (!url || /^(data|blob):/.test(url)) return null
  try {
    const result = await mediaApi.saveToLocal(url, filename)
    if (result && result.localPath) {
      // 仅缓存路径，不缓存 dataUrl
      localPathCache.set(url, result.localPath)
      return result
    }
    return null
  } catch (err) {
    console.warn('[media-loader] 保存到本地失败:', url, err.message)
    return null
  }
}

/**
 * 获取 URL 对应的本地文件路径（如果之前已下载并持久化）
 * @param {string} url - 远程资源 URL
 * @returns {string|null} 本地文件路径，或 null
 */
export function getLocalPath (url) {
  return localPathCache.get(url) || null
}

/**
 * 清除指定 URL 的本地路径缓存（用于资产删除后清理过期缓存）
 * 同时清理进行中的请求，防止清除后被回填
 * 并通知主进程清理 urlCache
 * @param {string} [url] - 指定 URL；不传则清除全部缓存
 */
export function clearMediaCache (url) {
  if (url) {
    localPathCache.delete(url)
    pendingRequests.delete(url)
    failedUrls.delete(url)
    mediaApi.clearCache(url).catch(() => {})
  } else {
    localPathCache.clear()
    pendingRequests.clear()
    failedUrls.clear()
    mediaApi.clearCache().catch(() => {})
  }
}

/**
 * 检查 URL 是否已标记为失败
 * @param {string} url - 远程资源 URL
 * @returns {boolean}
 */
export function isUrlFailed (url) {
  return failedUrls.has(url)
}

/**
 * 标记 URL 为失败（如 backfill 下载 404 时调用，避免后续重复尝试）
 * @param {string} url - 远程资源 URL
 */
export function markUrlFailed (url) {
  if (url) failedUrls.add(url)
}

export default {
  loadMediaDataUrl,
  saveMediaToLocal,
  getLocalPath,
  clearMediaCache,
  isUrlFailed,
  markUrlFailed
}
