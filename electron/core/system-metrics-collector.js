// ============================================================
// 系统指标采集器
// 职责：每30秒轮询系统CPU/内存/磁盘使用情况，写入 app_settings
// 依赖：Node.js os 模块、fs（statfsSync 磁盘统计）
// ============================================================

const os = require('os')
const fs = require('fs')
const appSettingDao = require('./../dao/app-setting-dao.js')
const logger = require('./../core/logger.js')

let collectorTimer = null
let lastCpuIdle = []
let lastCpuTimes = []

/**
 * 计算 CPU 使用率（基于两次采样的差值）
 * @returns {number} CPU 使用率百分比（0-100）
 */
function getCpuUsage () {
  const cpus = os.cpus()
  const currentIdle = cpus.map(cpu => cpu.times.idle)
  const currentTimes = cpus.map(cpu => ({
    user: cpu.times.user,
    nice: cpu.times.nice,
    sys: cpu.times.sys,
    idle: cpu.times.idle,
    irq: cpu.times.irq
  }))

  if (lastCpuTimes.length === 0) {
    lastCpuIdle = currentIdle
    lastCpuTimes = currentTimes
    return 0
  }

  let totalDiff = 0
  let idleDiff = 0
  for (let i = 0; i < cpus.length; i++) {
    const diff = {
      user: currentTimes[i].user - lastCpuTimes[i].user,
      nice: currentTimes[i].nice - lastCpuTimes[i].nice,
      sys: currentTimes[i].sys - lastCpuTimes[i].sys,
      idle: currentTimes[i].idle - lastCpuIdle[i],
      irq: currentTimes[i].irq - lastCpuTimes[i].irq
    }
    totalDiff += diff.user + diff.nice + diff.sys + diff.idle + diff.irq
    idleDiff += diff.idle
  }

  lastCpuIdle = currentIdle
  lastCpuTimes = currentTimes

  const usage = totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : 0
  return Math.round(usage * 10) / 10
}

/**
 * 计算内存使用率
 * @returns {{ memoryUsage: number, totalMemory: number, usedMemory: number }}
 */
function getMemoryUsage () {
  const totalMemory = os.totalmem()
  const freeMemory = os.freemem()
  const usedMemory = totalMemory - freeMemory
  const memoryUsage = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0
  return {
    memoryUsage: Math.round(memoryUsage * 10) / 10,
    totalMemory,
    usedMemory
  }
}

/**
 * 获取 C 盘磁盘使用率（仅 Windows）
 * @returns {{ diskUsage: number, totalDisk: number, usedDisk: number } | null}
 */
function getDiskUsage () {
  if (process.platform !== 'win32') {
    return null
  }
  try {
    // 使用 Node.js 原生 fs.statfsSync 获取文件系统统计信息
    // 替代已废弃的 wmic 命令（Windows 11 24H2+ 已移除 wmic）
    const stats = fs.statfsSync('C:\\')
    const totalDisk = stats.bsize * stats.blocks
    const freeDisk = stats.bsize * stats.bavail
    const usedDisk = totalDisk - freeDisk
    const diskUsage = totalDisk > 0 ? (usedDisk / totalDisk) * 100 : 0

    return {
      diskUsage: Math.round(diskUsage * 10) / 10,
      totalDisk,
      usedDisk
    }
  } catch (error) {
    logger.error('SystemMetrics', `获取磁盘使用率失败: ${error.message}`)
    return null
  }
}

/**
 * 执行一次数据采集并写入数据库
 */
function collectMetrics () {
  try {
    const cpuUsage = getCpuUsage()
    const memory = getMemoryUsage()
    const disk = getDiskUsage()

    const data = {
      cpuUsage,
      memoryUsage: memory.memoryUsage,
      totalMemory: memory.totalMemory,
      usedMemory: memory.usedMemory
    }

    if (disk) {
      data.diskUsage = disk.diskUsage
      data.totalDisk = disk.totalDisk
      data.usedDisk = disk.usedDisk
    } else {
      data.diskUsage = 0
      data.totalDisk = 0
      data.usedDisk = 0
    }

    appSettingDao.setJson('system_metrics', data)
    logger.debug('SystemMetrics', `指标已更新: CPU=${data.cpuUsage}% 内存=${data.memoryUsage}% 磁盘=${data.diskUsage}%`)
  } catch (error) {
    logger.error('SystemMetrics', `采集指标失败: ${error.message}`)
  }
}

/**
 * 启动系统指标采集器
 * 每30秒轮询一次，将最新数据存入 appSettingDao.set('system_metrics', data)
 */
function startMetricsCollector () {
  if (collectorTimer) {
    logger.warn('SystemMetrics', '采集器已在运行')
    return
  }

  logger.info('SystemMetrics', '启动系统指标采集器（30秒轮询）')

  // 首次立即采集一次，建立基准
  collectMetrics()

  collectorTimer = setInterval(collectMetrics, 30000)
}

/**
 * 停止系统指标采集器
 */
function stopMetricsCollector () {
  if (collectorTimer) {
    clearInterval(collectorTimer)
    collectorTimer = null
    logger.info('SystemMetrics', '系统指标采集器已停止')
  }
}

module.exports = {
  startMetricsCollector,
  stopMetricsCollector
}