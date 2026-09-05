// ============================================================
// 缓存管理服务
// 职责：管理 Electron/Chromium 缓存目录的清理
// 可清理的目录：Cache、Code Cache、GPUCache、DawnCache 系列等
// ============================================================

const fs = require('fs')
const path = require('path')
const { app, session, BrowserWindow } = require('electron')
const logger = require('../core/logger.js')

// 用户数据目录（AppData\Roaming\starst-desk）
// 使用 app.getPath('userData') 而非硬编码，确保与应用实际数据目录一致
const cacheRoot = app.getPath('userData')

// 可安全清理的缓存目录列表
const CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache'
]

/**
 * 获取用户数据目录路径
 * @returns {string}
 */
function getCacheRoot () {
  return cacheRoot
}

/**
 * 计算目录大小（字节）
 * @param {string} dirPath
 * @returns {number}
 */
function getDirSize (dirPath) {
  let size = 0
  try {
    if (!fs.existsSync(dirPath)) return 0
    const items = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name)
      if (item.isDirectory()) {
        size += getDirSize(fullPath)
      } else {
        // Dirent 不含 size 属性，需通过 statSync 获取
        size += fs.statSync(fullPath).size
      }
    }
  } catch (e) {
    logger.warn('CacheService', `计算目录大小失败 ${dirPath}: ${e.message}`)
  }
  return size
}

/**
 * 获取缓存统计信息
 * @returns {{totalMB: number, dirs: Array<{name: string, sizeMB: number}>}}
 */
function getCacheStats () {
  const result = { totalMB: 0, dirs: [] }
  for (const dirName of CACHE_DIRS) {
    const dirPath = path.join(cacheRoot, dirName)
    const sizeBytes = getDirSize(dirPath)
    const sizeMB = Math.round(sizeBytes / 1024 / 1024 * 100) / 100
    result.dirs.push({ name: dirName, sizeMB })
    result.totalMB += sizeMB
  }
  return result
}

/**
 * 判断是否处于运行时（窗口已创建，Chromium 持有缓存文件句柄）
 * 运行时磁盘上的 Cache/GPUCache/Dawn* 目录会被占用，fs.rmSync 会 EPERM
 * @returns {boolean}
 */
function isRuntime () {
  try {
    return app.isReady() && BrowserWindow.getAllWindows().length > 0
  } catch (_) {
    return false
  }
}

/**
 * 仅删除磁盘上的缓存目录（不调用 session API）
 * 适用于应用启动早期（Chromium 未占用）或退出时（句柄已释放），
 * 此时能真正释放磁盘空间。
 * @param {string[]} dirNames 要清理的目录名列表
 * @returns {{clearedMB: number, cleared: string[], skipped: string[]}}
 */
function cleanupDiskCache (dirNames = CACHE_DIRS) {
  const cleared = []
  const skipped = []
  let clearedMB = 0
  for (const dirName of dirNames) {
    const dirPath = path.join(cacheRoot, dirName)
    const sizeBefore = getDirSize(dirPath)
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true })
        logger.info('CacheService', `已删除缓存目录: ${dirPath}`)
      }
      // 仅对真正删除成功的目录累加释放量
      clearedMB += Math.round(sizeBefore / 1024 / 1024 * 100) / 100
      cleared.push(dirName)
    } catch (e) {
      // 文件被占用（EPERM/EBUSY）属于正常情况，静默跳过，不打 warn 避免刷屏
      const code = e.code || ''
      if (code === 'EPERM' || code === 'EBUSY' || /Permission denied|busy/i.test(e.message)) {
        logger.debug('CacheService', `缓存目录 ${dirName} 被占用，跳过磁盘删除: ${e.message}`)
      } else {
        logger.warn('CacheService', `删除缓存目录失败 ${dirName}: ${e.message}`)
      }
      skipped.push(dirName)
    }
  }
  return { clearedMB, cleared, skipped }
}

/**
 * 清除指定类型的缓存
 * 运行时：优先使用 Electron 原生 session API 清理内存缓存（安全，不会 EPERM），
 *         磁盘删除仅尝试未被占用的目录，被占用目录推迟到退出/下次启动时清理
 * 非运行时：直接删除磁盘缓存目录（用于定时清理 / 启动早期 / 退出场景）
 * @param {'all'|'browser'|'code'|'gpu'} type
 * @returns {Promise<{clearedMB: number, dirs: string[]}>}
 */
async function clearCache (type = 'all') {
  const clearedDirs = []
  let clearedMB = 0

  const dirsToClear = new Set()
  if (type === 'all' || type === 'browser') {
    CACHE_DIRS.forEach(d => dirsToClear.add(d))
  } else if (type === 'code') {
    dirsToClear.add('Code Cache')
  } else if (type === 'gpu') {
    dirsToClear.add('GPUCache')
    CACHE_DIRS.filter(d => d.startsWith('Dawn')).forEach(d => dirsToClear.add(d))
  }
  const dirList = Array.from(dirsToClear)

  // 1. 优先使用 Electron 原生 session API 清理（安全，不会 EPERM）
  try {
    const ses = session.defaultSession
    if (ses && typeof ses.clearCache === 'function') {
      await ses.clearCache()
      logger.info('CacheService', '已通过 session.clearCache() 清理 HTTP 缓存')
    }
    if (ses && typeof ses.clearCodeCache === 'function') {
      await ses.clearCodeCache()
      logger.info('CacheService', '已通过 session.clearCodeCache() 清理 JS 编译缓存')
    }
    if (ses && typeof ses.clearStorageData === 'function') {
      // 仅清理缓存类型 storage，不清理 cookies/localStorage 等用户数据
      await ses.clearStorageData({
        storages: ['shadercache', 'serviceworkers']
      })
      logger.info('CacheService', '已通过 session.clearStorageData() 清理 shader/service 缓存')
    }
  } catch (e) {
    logger.warn('CacheService', `session API 清理失败，回退到磁盘删除: ${e.message}`)
  }

  // 2. 磁盘删除
  // 运行时 Chromium 持有 Cache/GPUCache/Dawn* 句柄，fs.rmSync 会 EPERM，
  // session API 已清理内存缓存；真正磁盘释放推迟到退出时 / 下次启动早期（见 cleanupDiskCache）
  const diskResult = cleanupDiskCache(dirList)
  clearedMB += diskResult.clearedMB
  diskResult.cleared.forEach(d => clearedDirs.push(d))

  const skippedRuntime = isRuntime() ? diskResult.skipped : []
  if (skippedRuntime.length > 0) {
    logger.info('CacheService', `运行时以下目录被占用，已由 session API 清理内存缓存，磁盘将在退出/下次启动时清理: ${skippedRuntime.join(', ')}`)
  }

  logger.info('CacheService', `缓存清理完成，释放约 ${clearedMB} MB`)
  // skipped: 运行时被占用、已由 session API 清理内存但磁盘将延迟到退出/启动时释放的目录
  return { clearedMB, dirs: clearedDirs, skipped: skippedRuntime }
}

/**
 * 定时清理配置键名
 */
const SCHEDULED_CLEAR_INTERVAL_KEY = 'scheduled_cache_clear_interval'
const LAST_CLEAR_TIME_KEY = 'last_cache_clear_time'

/**
 * 获取定时清理间隔（小时），默认 24 小时
 * @returns {number}
 */
function getScheduledClearInterval () {
  const val = require('./../dao/app-setting-dao.js').get(SCHEDULED_CLEAR_INTERVAL_KEY)
  if (val === null) return 24
  const num = parseInt(val, 10)
  return isNaN(num) || num < 1 ? 24 : num
}

/**
 * 设置定时清理间隔（小时）
 * @param {number} hours
 */
function setScheduledClearInterval (hours) {
  require('./../dao/app-setting-dao.js').set(SCHEDULED_CLEAR_INTERVAL_KEY, String(hours))
}

/**
 * 获取上次清理时间
 * @returns {string|null}
 */
function getLastClearTime () {
  return require('./../dao/app-setting-dao.js').get(LAST_CLEAR_TIME_KEY)
}

/**
 * 更新上次清理时间
 */
function updateLastClearTime () {
  require('./../dao/app-setting-dao.js').set(LAST_CLEAR_TIME_KEY, new Date().toISOString())
}

/**
 * 检查是否到期需要清理
 * @returns {boolean}
 */
function shouldClear () {
  const lastClear = getLastClearTime()
  if (!lastClear) return true
  const intervalHours = getScheduledClearInterval()
  const lastTime = new Date(lastClear).getTime()
  const now = Date.now()
  return (now - lastTime) >= intervalHours * 60 * 60 * 1000
}

module.exports = {
  getCacheRoot,
  getCacheStats,
  clearCache,
  cleanupDiskCache,
  getScheduledClearInterval,
  setScheduledClearInterval,
  getLastClearTime,
  updateLastClearTime,
  shouldClear
}