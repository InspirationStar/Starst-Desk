// ============================================================
// 日志服务
// 基于 electron-log 实现：按日期分文件、保留 7 天、级别过滤、文件+控制台双输出
// 对外接口：logger.info(module, message) / warn / error / debug
// ============================================================

const path = require('path')
const fs = require('fs')

// 日志保留天数
const LOG_RETENTION_DAYS = 7
// 单文件大小上限（按日期分文件后通常不会触发，作为兜底防日志风暴）
const LOG_MAX_SIZE = 10 * 1024 * 1024 // 10MB

// 根据环境确定日志级别：生产环境 info，开发环境 debug
const isDevelopment = process.env.NODE_ENV === 'development'
const logLevel = isDevelopment ? 'debug' : 'info'

// ---- 尝试接入 electron-log，失败则降级为 console 占位 ----
let log = null
try {
  log = require('electron-log/main')
} catch (e) {
  // electron-log 不可用时降级为 console，保证应用可启动
  log = null
}

if (log) {
  // ---- 文件 transport 配置 ----
  const fileTransport = log.transports.file
  // 日志级别过滤
  fileTransport.level = logLevel
  // 异步写入，避免阻塞主进程
  fileTransport.sync = false
  // 单文件大小上限
  fileTransport.maxSize = LOG_MAX_SIZE

  // 按日期分文件：文件名格式 main-YYYY-MM-DD.log
  // resolvePathFn 在首次写日志时才调用，此时 app 已 ready，路径可正常解析
  fileTransport.resolvePathFn = (variables) => {
    const date = new Date()
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return path.join(variables.libraryDefaultDir, `main-${dateStr}.log`)
  }

  // ---- 控制台 transport 配置 ----
  log.transports.console.level = logLevel

  // ---- 7 天日志清理：app ready 后启动，每天检查一次 ----
  startLogCleanup()
}

/**
 * 启动日志清理调度
 * 在 app ready 后立即清理一次，之后每 24 小时清理一次
 * 非 Electron 环境（如单元测试）跳过
 */
function startLogCleanup () {
  let app
  try {
    app = require('electron').app
  } catch (e) {
    return
  }
  if (!app) return

  if (app.isReady && app.isReady()) {
    scheduleCleanup()
  } else if (app.once) {
    app.once('ready', scheduleCleanup)
  }
}

/**
 * 调度清理任务：立即执行一次，之后每 24 小时执行一次
 */
function scheduleCleanup () {
  cleanupOldLogs()
  const timer = setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000)
  // 不阻止进程退出
  if (timer && typeof timer.unref === 'function') {
    timer.unref()
  }
}

/**
 * 清理超过保留天数的日志文件
 * 按文件最后修改时间判断，删除 7 天前的 .log / .old.log 文件
 */
function cleanupOldLogs () {
  try {
    const app = require('electron').app
    const logsDir = path.join(app.getPath('userData'), 'logs')
    if (!fs.existsSync(logsDir)) return

    const now = Date.now()
    const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

    for (const file of fs.readdirSync(logsDir)) {
      // 仅清理日志文件（main-YYYY-MM-DD.log 及大小轮转产生的 .old.log）
      if (!file.endsWith('.log') && !file.endsWith('.old.log')) continue
      const filePath = path.join(logsDir, file)
      try {
        const stat = fs.statSync(filePath)
        if (now - stat.mtimeMs > retentionMs) {
          fs.unlinkSync(filePath)
        }
      } catch (e) {
        // 忽略单个文件清理失败，继续处理其他文件
      }
    }
  } catch (e) {
    // 忽略清理失败，避免影响主流程
  }
}

// ============================================================
// 对外接口：保持 logger.info(module, message) 等签名不变
// 内部拼接为 [模块名] 消息 交由 electron-log 输出
// electron-log 会自动加上时间戳与级别前缀，最终格式：
//   [2026-08-29 15:40:02.123] [info] [Main] 应用启动完成
// ============================================================
const logger = log
  ? {
      info: (module, message) => log.info(`[${module}]`, message),
      warn: (module, message) => log.warn(`[${module}]`, message),
      error: (module, message) => log.error(`[${module}]`, message),
      debug: (module, message) => log.debug(`[${module}]`, message)
    }
  : {
      // electron-log 不可用时的降级实现（与原占位一致）
      info: (module, message) => console.info(`[${module}]`, message),
      warn: (module, message) => console.warn(`[${module}]`, message),
      error: (module, message) => console.error(`[${module}]`, message),
      debug: (module, message) => console.debug(`[${module}]`, message)
    }

module.exports = logger
