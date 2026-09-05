// ============================================================
// 定时缓存清理调度器
// 职责：定时检查并清理 Electron/Chromium 缓存
// 通过检查应用启动时间与上次清理时间的间隔来决定是否执行清理
// ============================================================

const logger = require('../core/logger.js')
const cacheService = require('../services/cache-service.js')

let timer = null
let isRunning = false

/**
 * 启动定时清理检查
 */
function start () {
  if (isRunning) {
    logger.warn('ScheduledCacheCleaner', '定时清理已在运行，无需重复启动')
    return
  }
  isRunning = true

  // 启动时检查一次（仅当已配置定时清理时才执行）
  checkAndClear()

  // 每 5 分钟检查一次是否需要清理
  timer = setInterval(checkAndClear, 5 * 60 * 1000)

  logger.info('ScheduledCacheCleaner', '定时清理调度器已启动，检查间隔 5 分钟')
}

/**
 * 停止定时清理
 */
function stop () {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  isRunning = false
  logger.info('ScheduledCacheCleaner', '定时清理调度器已停止')
}

/**
 * 检查是否需要清理并执行
 * 仅当用户启用了定时清理（配置键存在）且到期时才执行
 */
async function checkAndClear () {
  try {
    // 先检查是否启用了定时清理
    const appSettingDao = require('../dao/app-setting-dao.js')
    const rawVal = appSettingDao.get('scheduled_cache_clear_interval')
    if (rawVal === null || rawVal === undefined) {
      // 未启用定时清理，跳过
      return
    }

    if (!cacheService.shouldClear()) {
      return
    }

    const intervalHours = cacheService.getScheduledClearInterval()
    logger.info('ScheduledCacheCleaner', `执行定时缓存清理，间隔: ${intervalHours} 小时`)

    const result = await cacheService.clearCache('all')
    cacheService.updateLastClearTime()

    logger.info('ScheduledCacheCleaner', `定时清理完成，释放 ${result.clearedMB} MB`)
  } catch (error) {
    logger.error('ScheduledCacheCleaner', `定时清理异常: ${error.message}`)
  }
}

module.exports = {
  start,
  stop,
  checkAndClear
}