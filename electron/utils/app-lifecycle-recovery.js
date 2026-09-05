// ============================================================
// 应用生命周期恢复监视器（独立模块）
//                Services/AppLifecycleRecoverySignalClassifier.cs +
//                Services/AppRelaunchService.cs
// 职责：
//   1. 监听 Electron powerMonitor 的 suspend/resume/lock-screen/unlock-screen 信号
//   2. 将信号分类为稳定恢复原因（'resume' / 'session-unlock' / ...）
//   3. 多个信号经 debounce 合并后回调 recoveryAction(reasons)
//   4. 提供 scheduleRelaunch() 通过 app.relaunch + app.quit 重启应用
// 依赖：Electron powerMonitor / app + Node.js EventEmitter + setTimeout
// 类型映射：
//   C# DispatcherQueueTimer                → Node.js setTimeout
//   C# Win32 WM_POWERBROADCAST / WM_WTSSESSIONCHANGE → Electron powerMonitor 事件
//   C# WTSRegisterSessionNotification      → powerMonitor 内置监听
//   C# AppUpdateService.PrepareDetachedUpdaterHelper → app.relaunch()（Electron 内置）
// ============================================================

const { EventEmitter } = require('events')
const logger = require('../core/logger.js')

const RECOVERY_DELAY_MS = 420

// ============================================================
// 信号分类器
// 移植自 C# AppLifecycleRecoverySignalClassifier
// 原始实现把 Win32 消息号 + wParam 映射为稳定原因字符串
// Electron 中没有 Win32 消息，改为把 powerMonitor 事件名映射为同一组原因
// 保留原 Win32 消息号常量便于跨平台对照与测试
// ============================================================

// Win32 消息号常量（对齐 C# AppLifecycleRecoverySignalClassifier）
const WM_POWER_BROADCAST = 0x0218
const WM_WTS_SESSION_CHANGE = 0x02B1
const WM_DISPLAY_CHANGE = 0x007E
const WM_DPI_CHANGED = 0x02E0

// WM_POWERBROADCAST wParam 事件值
const PBT_RESUME_AUTOMATIC = 0x0012
const PBT_RESUME_SUSPEND = 0x0007
const PBT_RESUME_CRITICAL = 0x0006

// WM_WTSSESSIONCHANGE wParam 事件值
const WTS_SESSION_UNLOCK = 0x0008
const WTS_SESSION_LOGON = 0x0005
const WTS_SESSION_REMOTE_CONNECT = 0x0009

// Electron powerMonitor 事件名 → 恢复原因
const ELECTRON_EVENT_REASON_MAP = {
  resume: 'resume',
  'unlock-screen': 'session-unlock',
  'lock-screen': null, // 锁屏不触发恢复，仅日志
  suspend: null        // 挂起不触发恢复，仅日志
}

/**
 * 按 Win32 消息号 + wParam 分类恢复原因
 * 移植自 C# AppLifecycleRecoverySignalClassifier.ResolveRecoveryReason
 * 保留原始签名以便单元测试与未来需要 Win32 子类时复用
 * @param {number} message - Win32 消息号
 * @param {number} wParam - 消息参数
 * @param {number} taskbarCreatedMessage - TaskbarCreated 自定义消息号
 * @returns {string|null} 恢复原因，null 表示无需恢复
 */
function resolveRecoveryReasonByMessage (message, wParam, taskbarCreatedMessage) {
  const eventValue = wParam >>> 0

  if (message === WM_POWER_BROADCAST &&
    (eventValue === PBT_RESUME_AUTOMATIC ||
      eventValue === PBT_RESUME_SUSPEND ||
      eventValue === PBT_RESUME_CRITICAL)) {
    return 'resume'
  }

  if (message === WM_WTS_SESSION_CHANGE &&
    (eventValue === WTS_SESSION_UNLOCK ||
      eventValue === WTS_SESSION_LOGON ||
      eventValue === WTS_SESSION_REMOTE_CONNECT)) {
    return eventValue === WTS_SESSION_UNLOCK ? 'session-unlock' : 'session-reconnect'
  }

  if (message === WM_DISPLAY_CHANGE || message === WM_DPI_CHANGED) {
    return 'display-message'
  }

  return message === taskbarCreatedMessage ? 'explorer-restart' : null
}

/**
 * 按 Electron powerMonitor 事件名分类恢复原因
 * Electron 适配版：把 'resume' / 'unlock-screen' 等事件名映射为稳定原因
 * @param {string} eventName - Electron powerMonitor 事件名
 * @returns {string|null} 恢复原因，null 表示无需恢复
 */
function resolveRecoveryReasonByEvent (eventName) {
  if (Object.prototype.hasOwnProperty.call(ELECTRON_EVENT_REASON_MAP, eventName)) {
    return ELECTRON_EVENT_REASON_MAP[eventName]
  }
  // 未知事件不触发恢复
  return null
}

// ============================================================
// AppLifecycleRecoveryWatcher
// 移植自 C# AppLifecycleRecoveryWatcher
// 职责：监听 powerMonitor 事件，debounce 合并原因后回调 recoveryAction
// ============================================================

class AppLifecycleRecoveryWatcher extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {function(string): void} [options.recoveryAction] - 恢复回调，参数为逗号分隔的原因
   * @param {function(string): void} [options.endSessionAction] - 结束会话回调（query/end-session）
   * @param {object} [options.powerMonitor] - 注入 powerMonitor（便于测试）
   * @param {number} [options.recoveryDelayMs] - 恢复去抖延迟
   */
  constructor (options = {}) {
    super()
    this.recoveryAction = typeof options.recoveryAction === 'function' ? options.recoveryAction : null
    this.endSessionAction = typeof options.endSessionAction === 'function' ? options.endSessionAction : null
    this.recoveryDelayMs = options.recoveryDelayMs || RECOVERY_DELAY_MS

    this.powerMonitor = options.powerMonitor || null
    this.isDisposed = false
    this.isAttached = false
    this.pendingReasons = ''
    this.timer = null

    // 绑定的事件处理器（便于 dispose 时解绑）
    this._handlers = {}
  }

  /**
   * 启动监听
   * 移植自 C# 构造函数中的子类化 + WTSRegisterSessionNotification
   * @returns {boolean} 是否成功附加监听
   */
  start () {
    if (this.isDisposed || this.isAttached) return this.isAttached

    const powerMonitor = this.powerMonitor || safeGetPowerMonitor()
    if (!powerMonitor || typeof powerMonitor.on !== 'function') {
      logger.warn('Lifecycle', 'powerMonitor 不可用，生命周期恢复监听未启动')
      return false
    }
    this.powerMonitor = powerMonitor

    // 监听恢复相关事件
    const eventsToListen = ['resume', 'suspend', 'lock-screen', 'unlock-screen']
    for (const evt of eventsToListen) {
      const handler = (/* args */) => this.onPowerMonitorEvent(evt)
      this._handlers[evt] = handler
      powerMonitor.on(evt, handler)
    }

    this.isAttached = true
    logger.info('Lifecycle', `Recovery watcher attached events=${eventsToListen.join(',')}`)
    return true
  }

  /**
   * powerMonitor 事件处理器
   * @param {string} eventName
   */
  onPowerMonitorEvent (eventName) {
    if (this.isDisposed) return

    // 锁屏 / 挂起仅记录日志，不触发恢复（对齐 C# WtsSessionLock/Logoff 分支）
    if (eventName === 'lock-screen' || eventName === 'suspend') {
      logger.info('Lifecycle', `${eventName} 信号：延迟外部状态恢复`)
      return
    }

    const reason = resolveRecoveryReasonByEvent(eventName)
    if (reason) {
      this.queueRecovery(reason)
    }
  }

  /**
   * 排队恢复请求（合并原因 + debounce）
   * 移植自 C# QueueRecovery
   * @param {string} reason
   */
  queueRecovery (reason) {
    if (this.isDisposed) return

    if (!this.pendingReasons || this.pendingReasons.trim() === '') {
      this.pendingReasons = reason
    } else if (!this.pendingReasons.split(',').includes(reason)) {
      this.pendingReasons += ',' + reason
    }

    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.onRecoveryTimer(), this.recoveryDelayMs)
  }

  /**
   * 恢复定时器触发
   * 移植自 C# RecoveryTimer_Tick
   */
  onRecoveryTimer () {
    this.timer = null
    if (this.isDisposed || !this.pendingReasons || this.pendingReasons.trim() === '') return

    const reasons = this.pendingReasons
    this.pendingReasons = ''
    if (!this.recoveryAction) {
      this.emit('recovery', reasons)
      return
    }
    try {
      this.recoveryAction(reasons)
      // 同时 emit 便于外部 EventEmitter 订阅
      this.emit('recovery', reasons)
    } catch (err) {
      logger.error('Lifecycle', `Recovery callback failed: ${err.message}`)
    }
  }

  /**
   * 触发结束会话回调
   * 移植自 C# InvokeEndSessionAction
   * @param {string} reason
   */
  invokeEndSessionAction (reason) {
    if (!this.endSessionAction) return
    try {
      this.endSessionAction(reason)
    } catch (err) {
      logger.error('Lifecycle', `End-session callback failed: ${err.message}`)
    }
  }

  /**
   * 释放资源
   * 移植自 C# Dispose
   */
  dispose () {
    if (this.isDisposed) return
    this.isDisposed = true

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.isAttached && this.powerMonitor && typeof this.powerMonitor.off === 'function') {
      for (const [evt, handler] of Object.entries(this._handlers)) {
        try {
          this.powerMonitor.off(evt, handler)
        } catch {
          // best effort
        }
      }
      this.isAttached = false
    }
    this._handlers = {}
    this.removeAllListeners()
  }
}

// ============================================================
// AppRelaunchService
// 移植自 C# AppRelaunchService
// 职责：在当前进程退出后调度应用重启
// Electron 实现：直接调用 app.relaunch() + app.quit()，无需外部 updater helper
// ============================================================

/**
 * 应用重启调度结果
 * 移植自 C# AppRelaunchScheduleResult
 */
class AppRelaunchScheduleResult {
  /**
   * @param {boolean} started - 是否已成功调度
   * @param {string|null} errorMessage - 失败原因
   */
  constructor (started, errorMessage) {
    this.started = started
    this.errorMessage = errorMessage
  }

  static startedSuccessfully () {
    return new AppRelaunchScheduleResult(true, null)
  }

  static failed (errorMessage) {
    return new AppRelaunchScheduleResult(false, errorMessage)
  }
}

/**
 * 安全获取 electron.app
 * @returns {object|null}
 */
function safeGetApp () {
  try {
    return require('electron').app || null
  } catch {
    return null
  }
}

/**
 * 安全获取 electron.powerMonitor
 * @returns {object|null}
 */
function safeGetPowerMonitor () {
  try {
    return require('electron').powerMonitor || null
  } catch {
    return null
  }
}

/**
 * 调度应用在当前进程退出后重启
 * 移植自 C# AppRelaunchService.ScheduleAfterCurrentProcessExit
 * 简化：直接使用 Electron app.relaunch({ args }) + app.quit()
 * @param {object} [options]
 * @param {string[]} [options.args] - 重启时附加的命令行参数
 * @param {object} [options.app] - 注入 electron.app（便于测试）
 * @returns {AppRelaunchScheduleResult}
 */
function scheduleRelaunch (options = {}) {
  const app = options.app || safeGetApp()
  if (!app) {
    return AppRelaunchScheduleResult.failed('electron.app 不可用')
  }
  if (typeof app.relaunch !== 'function' || typeof app.quit !== 'function') {
    return AppRelaunchScheduleResult.failed('electron.app 缺少 relaunch/quit 方法')
  }

  try {
    const relaunchOpts = {}
    if (Array.isArray(options.args)) {
      relaunchOpts.args = options.args
    }
    app.relaunch(relaunchOpts)
    app.quit()
    return AppRelaunchScheduleResult.startedSuccessfully()
  } catch (err) {
    logger.error('Relaunch', `Failed to schedule app restart: ${err.message}`)
    return AppRelaunchScheduleResult.failed(err.message)
  }
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
  // 主服务
  AppLifecycleRecoveryWatcher,
  AppRelaunchScheduleResult,
  // 信号分类
  resolveRecoveryReasonByMessage,
  resolveRecoveryReasonByEvent,
  // 重启
  scheduleRelaunch,
  // 工具函数（导出便于测试）
  safeGetApp,
  safeGetPowerMonitor,
  // 常量
  RECOVERY_DELAY_MS,
  // Win32 消息号常量（保留便于跨平台对照）
  WM_POWER_BROADCAST,
  WM_WTS_SESSION_CHANGE,
  WM_DISPLAY_CHANGE,
  WM_DPI_CHANGED,
  PBT_RESUME_AUTOMATIC,
  PBT_RESUME_SUSPEND,
  PBT_RESUME_CRITICAL,
  WTS_SESSION_UNLOCK,
  WTS_SESSION_LOGON,
  WTS_SESSION_REMOTE_CONNECT,
  ELECTRON_EVENT_REASON_MAP
}