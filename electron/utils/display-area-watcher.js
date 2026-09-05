// ============================================================
// 显示区域监听服务（独立模块）
//                Services/DisplayTopologyTransitionCoordinator.cs
// 职责：
//   1. 周期性轮询显示器拓扑（数量/分辨率/DPI/工作区）
//   2. 拓扑变化时经 debounce 触发 'displaysChanged' 事件
//   3. 合并多个恢复请求为基于 generation 的稳定恢复操作
// 依赖：Electron screen API（getAllDisplays）+ Node.js EventEmitter + setTimeout
// 类型映射：
//   C# DispatcherQueueTimer       → Node.js setTimeout / setInterval
//   C# Win32Helper.GetMonitorWorkAreaInfos() → electron.screen.getAllDisplays()
//   C# event Action? DisplaysChanged → EventEmitter 'displaysChanged'
//   C# DisplayTopologyStabilityTracker（嵌套类） → StabilityTracker 类
// ============================================================

const { EventEmitter } = require('events')
const logger = require('../core/logger.js')

const POLL_INTERVAL_MS = 2000
const DEBOUNCE_DELAY_MS = 500

const OBSERVATION_INTERVAL_MS = 180
const VERIFICATION_DELAY_MS = 140
const MAX_RESTORE_RETRY_COUNT = 8
const REQUIRED_OBSERVATIONS = 2

// ============================================================
// 工具函数
// ============================================================

/**
 * 安全获取 electron.screen API
 * 在 main 进程未就绪或非 Electron 环境时返回 null
 * @returns {object|null}
 */
function getScreenApi () {
  try {
    // electron 模块在主进程内可用
    // eslint-disable-next-line no-global-assign
    return require('electron').screen || null
  } catch {
    return null
  }
}

/**
 * 捕获当前显示器拓扑签名
 * 移植自 C# DisplayAreaWatcherService.CaptureCurrentSignature
 * 算法：按 device id + left + top 排序，拼接为 "id;primary;scale;bounds;workArea" 字符串
 * @returns {string} 拓扑签名，失败时返回空串
 */
function captureCurrentSignature () {
  const screen = getScreenApi()
  if (!screen) return ''

  try {
    const displays = screen.getAllDisplays()
    // 按 id（不区分大小写）→ left → top 排序，保证签名稳定
    const sorted = displays.slice().sort((a, b) => {
      const idA = String(a.id || '')
      const idB = String(b.id || '')
      const cmp = idA.localeCompare(idB, undefined, { sensitivity: 'base' })
      if (cmp !== 0) return cmp
      if (a.bounds.x !== b.bounds.x) return a.bounds.x - b.bounds.x
      return a.bounds.y - b.bounds.y
    })

    return sorted.map(d => {
      const b = d.bounds
      const w = d.workArea
      // scaleFactor 保留 3 位小数，对齐 C# DpiScale:F3
      const scale = (d.scaleFactor || 1).toFixed(3)
      return `${d.id};${d.internal ? 1 : 0};${scale};` +
        `${b.x},${b.y},${b.width},${b.height};` +
        `${w.x},${w.y},${w.width},${w.height}`
    }).join('|')
  } catch (err) {
    logger.warn('DisplayAreaWatcher', `捕获显示器签名失败: ${err.message}`)
    return ''
  }
}

/**
 * 获取当前显示器数量
 * 移植自 C# DisplayAreaWatcherService.CountDisplays
 * @returns {number}
 */
function countDisplays () {
  const screen = getScreenApi()
  if (!screen) return 1
  try {
    return screen.getAllDisplays().length
  } catch {
    return 1
  }
}

// ============================================================
// StabilityTracker
// 移植自 C# DisplayTopologyStabilityTracker
// 职责：观察签名是否连续 N 次保持一致，用于判断拓扑是否已稳定
// ============================================================

class StabilityTracker {
  /**
   * @param {number} requiredObservations - 稳定所需连续观察次数
   */
  constructor (requiredObservations) {
    this.requiredObservations = Math.max(1, requiredObservations)
    this.lastSignature = null
    this.observationCount = 0
  }

  /**
   * 观察一次签名
   * @param {string|null} signature
   * @returns {boolean} 是否已稳定（连续观察次数达到阈值）
   */
  observe (signature) {
    const normalized = signature || ''
    if (normalized !== this.lastSignature) {
      this.lastSignature = normalized
      this.observationCount = 1
    } else {
      this.observationCount++
    }
    return this.observationCount >= this.requiredObservations
  }

  /**
   * 重置观察状态
   */
  reset () {
    this.lastSignature = null
    this.observationCount = 0
  }
}

// ============================================================
// DisplayAreaWatcher
// 移植自 C# DisplayAreaWatcherService
// 职责：周期轮询显示器拓扑，变化时 debounce 触发 'displaysChanged'
// ============================================================

class DisplayAreaWatcher extends EventEmitter {
  constructor () {
    super()
    this.isDisposed = false
    this.displayCount = 0
    this.displaySignature = ''

    this.pollTimer = null
    this.debounceTimer = null
  }

  /**
   * 当前显示器数量
   * @returns {number}
   */
  getDisplayCount () {
    return this.displayCount
  }

  /**
   * 启动监听（使用 Electron screen 事件替代轮询）
   */
  start () {
    if (this.isDisposed) return

    this.displayCount = countDisplays()
    this.displaySignature = captureCurrentSignature()
    logger.info('DisplayAreaWatcher',
      `Started, initial display count: ${this.displayCount}, signature: ${this.displaySignature}`)

    // 使用 Electron screen 事件替代 setInterval 轮询
    // display-added / display-removed / display-metrics-changed 覆盖所有拓扑变化场景
    const screen = getScreenApi()
    if (screen) {
      this._onDisplayAdded = () => this.pollForChanges()
      this._onDisplayRemoved = () => this.pollForChanges()
      this._onDisplayMetricsChanged = () => this.pollForChanges()
      screen.on('display-added', this._onDisplayAdded)
      screen.on('display-removed', this._onDisplayRemoved)
      screen.on('display-metrics-changed', this._onDisplayMetricsChanged)
    } else {
      logger.warn('DisplayAreaWatcher', 'electron.screen 不可用，回退到 setInterval 轮询')
      this.pollTimer = setInterval(() => this.pollForChanges(), POLL_INTERVAL_MS)
    }
  }

  /**
   * 强制立即检查一次拓扑
   * 移植自 C# RefreshNow，用于唤醒/解锁/Shell 重启后跳过下一个轮询周期
   */
  refreshNow () {
    if (this.isDisposed) return
    this.pollForChanges()
  }

  /**
   * 轮询检测拓扑变化
   * 移植自 C# PollForChanges
   */
  pollForChanges () {
    if (this.isDisposed) return

    const newCount = countDisplays()
    const newSignature = captureCurrentSignature()

    if (newCount !== this.displayCount || newSignature !== this.displaySignature) {
      const isCountChange = newCount !== this.displayCount
      this.displayCount = newCount
      this.displaySignature = newSignature

      logger.info('DisplayAreaWatcher',
        `Display topology changed: count=${newCount} countChanged=${isCountChange} signature=${newSignature}`)

      // 重启 debounce 计时器（每次变化都延后触发，避免快速变化连续触发）
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null
        this.emit('displaysChanged')
      }, DEBOUNCE_DELAY_MS)
    }
  }

  /**
   * 释放资源
   */
  dispose () {
    if (this.isDisposed) return
    this.isDisposed = true

    // 移除 screen 事件监听
    const screen = getScreenApi()
    if (screen && this._onDisplayAdded) {
      screen.off('display-added', this._onDisplayAdded)
      screen.off('display-removed', this._onDisplayRemoved)
      screen.off('display-metrics-changed', this._onDisplayMetricsChanged)
      this._onDisplayAdded = null
      this._onDisplayRemoved = null
      this._onDisplayMetricsChanged = null
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.removeAllListeners()
  }
}

// ============================================================
// DisplayTopologyTransitionCoordinator
// 移植自 C# DisplayTopologyTransitionCoordinator
// 职责：合并原生 per-window 显示消息与全局拓扑轮询为基于 generation 的稳定恢复操作
// 算法：
//   1. RequestRestore 累积原因，重置 generation，调度观察定时器
//   2. 定时器触发时先观察签名稳定性，未稳定则继续观察
//   3. 稳定后调用 restoreAction(generation, reasons)
//   4. 失败则重试（不超过 MaxRestoreRetryCount）
//   5. 成功后进入验证阶段，再次观察签名是否变化
//   6. 验证通过则完成；否则视为新一次恢复
// ============================================================

class DisplayTopologyTransitionCoordinator {
  /**
   * @param {function(): string} signatureProvider - 捕获当前拓扑签名的函数
   * @param {function(number, string): Promise<boolean>} restoreAction - 恢复操作，返回是否完成
   */
  constructor (signatureProvider, restoreAction) {
    this.signatureProvider = signatureProvider
    this.restoreAction = restoreAction
    this.stabilityTracker = new StabilityTracker(REQUIRED_OBSERVATIONS)

    this.generation = 0
    this.pendingReasons = ''
    this.restoreRetryCount = 0
    this.verificationPending = false
    this.isExecuting = false
    this.isDisposed = false

    this.timer = null
  }

  /**
   * 请求恢复
   * @param {string} reason - 恢复原因
   */
  requestRestore (reason) {
    if (this.isDisposed) return

    this.generation++
    this.pendingReasons = combineReasons(this.pendingReasons, reason)
    this.restoreRetryCount = 0
    this.verificationPending = false
    this.stabilityTracker.reset()
    this.schedule(OBSERVATION_INTERVAL_MS)
  }

  /**
   * 定时器触发处理
   * 移植自 C# Timer_Tick
   */
  async onTimerTick () {
    this.timer = null
    if (this.isDisposed) return

    // 上一轮 restoreAction 仍在执行，延后再试
    if (this.isExecuting) {
      this.schedule(OBSERVATION_INTERVAL_MS)
      return
    }

    const generation = this.generation
    const signature = this.captureSignature()
    const signatureChanged = signature !== this.stabilityTracker.lastSignature
    if (signatureChanged && this.verificationPending) {
      // 首次应用后拓扑又变化：把新稳定签名视为新一次应用，再走验证流程
      this.verificationPending = false
    }

    // 签名尚未稳定，继续观察
    if (!this.stabilityTracker.observe(signature)) {
      this.schedule(OBSERVATION_INTERVAL_MS)
      return
    }

    const isVerification = this.verificationPending
    let completed = true
    this.isExecuting = true
    try {
      completed = await this.restoreAction(generation, this.pendingReasons)
    } catch (err) {
      completed = false
      logger.error('DisplayTopology', `Restore generation=${generation} failed: ${err.message}`)
    } finally {
      this.isExecuting = false
    }

    // 新的 RequestRestore 已接管下一轮（generation 已变），直接退出
    if (this.isDisposed || generation !== this.generation) return

    // 恢复失败：在重试上限内重试
    if (!completed && this.restoreRetryCount < MAX_RESTORE_RETRY_COUNT) {
      this.restoreRetryCount++
      this.schedule(OBSERVATION_INTERVAL_MS)
      return
    }

    // 首次应用完成：进入验证阶段
    if (!isVerification) {
      this.verificationPending = true
      this.schedule(VERIFICATION_DELAY_MS)
      return
    }

    // 验证通过：清理状态
    logger.info('DisplayTopology',
      `Restore completed generation=${generation} reasons=${this.pendingReasons} signature=${signature}`)
    this.pendingReasons = ''
    this.verificationPending = false
    this.restoreRetryCount = 0
  }

  /**
   * 捕获当前签名
   * 移植自 C# CaptureSignature
   * @returns {string}
   */
  captureSignature () {
    try {
      return this.signatureProvider() || ''
    } catch (err) {
      logger.warn('DisplayTopology', `Signature capture failed: ${err.message}`)
      return ''
    }
  }

  /**
   * 调度下一次定时器触发
   * @param {number} delayMs - 延迟毫秒
   */
  schedule (delayMs) {
    if (this.isDisposed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.onTimerTick(), delayMs)
  }

  /**
   * 释放资源
   */
  dispose () {
    if (this.isDisposed) return
    this.isDisposed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

/**
 * 合并恢复原因（去重，逗号分隔）
 * 移植自 C# DisplayTopologyTransitionCoordinator.CombineReasons
 * @param {string} current - 当前累积原因
 * @param {string|null|undefined} next - 新原因
 * @returns {string}
 */
function combineReasons (current, next) {
  const normalized = (!next || String(next).trim() === '') ? 'unspecified' : String(next).trim()
  if (!current || current.trim() === '') return normalized

  const parts = current.split(',')
    .map(s => s.trim())
    .filter(s => s !== '')
  if (parts.includes(normalized)) return current
  return current + ',' + normalized
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
  // 主服务
  DisplayAreaWatcher,
  DisplayTopologyTransitionCoordinator,
  StabilityTracker,
  // 工具函数（导出便于单元测试）
  captureCurrentSignature,
  countDisplays,
  combineReasons,
  // 常量
  POLL_INTERVAL_MS,
  DEBOUNCE_DELAY_MS,
  OBSERVATION_INTERVAL_MS,
  VERIFICATION_DELAY_MS,
  MAX_RESTORE_RETRY_COUNT,
  REQUIRED_OBSERVATIONS
}