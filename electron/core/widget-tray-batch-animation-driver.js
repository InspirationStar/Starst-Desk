// ============================================================
// 托盘批量动画驱动
// 用单一时钟驱动一批小部件滑动动画，每帧一次原子提交
// 所有窗口同步移动（无错位"波浪"），物理移动语义保持不变
// ============================================================

const logger = require('./logger.js')
const {
  createWidgetTrayAnimationFrameTracker,
  reportFrameMetrics
} = require('./widget-tray-animation-frame-tracker.js')

/**
 * 线性插值
 */
function lerp (from, to, progress) {
  return from + (to - from) * progress
}

/**
 * 缓动函数（与 widget-tray-animation-controller 共享）
 */
const { ease, EASING_INTENSITY } = require('./widget-tray-animation-controller.js')

/**
 * 创建批量动画条目
 * @param {Object} options
 * @param {Electron.BrowserWindow} options.window Electron 窗口
 * @param {number} options.baseX 基础 X 坐标
 * @param {number} options.baseY 基础 Y 坐标
 * @param {number} options.fromOffsetX 起始 X 偏移
 * @param {number} options.fromOffsetY 起始 Y 偏移
 * @param {number} options.toOffsetX 目标 X 偏移
 * @param {number} options.toOffsetY 目标 Y 偏移
 * @param {number} options.refreshRateHz 刷新率
 * @param {Function} options.isValid 有效性检查 () => boolean
 * @param {Function} options.completed 完成回调 () => void
 * @returns {Object}
 */
function createBatchAnimationEntry (options) {
  return {
    window: options.window,
    baseX: options.baseX,
    baseY: options.baseY,
    fromOffsetX: options.fromOffsetX,
    fromOffsetY: options.fromOffsetY,
    toOffsetX: options.toOffsetX,
    toOffsetY: options.toOffsetY,
    refreshRateHz: options.refreshRateHz,
    isValid: options.isValid,
    completed: options.completed
  }
}

/**
 * 创建托盘批量动画驱动
 * @param {Function} [log] 日志回调
 */
function createWidgetTrayBatchAnimationDriver (log) {
  if (typeof log !== 'function') {
    log = (msg) => logger.debug('BatchAnim', msg)
  }

  let entries = []
  let stopwatch = null
  let durationMs = 1
  let easingIntensity = ''
  let isShowing = false
  let remainingDelayFrames = 0
  let isRunning = false
  let frameTimer = null
  let frameTracker = null

  /**
   * 启动一批共享动画
   * @param {Array} batchEntries 条目列表
   * @param {number} batchDurationMs 持续时间
   * @param {string} batchEasingIntensity 缓动强度
   * @param {boolean} batchIsShowing 是否显示
   * @param {number} startDelayFrames 起始延迟帧数
   */
  function start (batchEntries, batchDurationMs, batchEasingIntensity, batchIsShowing, startDelayFrames) {
    cancel()
    if (!batchEntries || batchEntries.length === 0) return

    entries = entries.concat(batchEntries)
    durationMs = Math.max(1, batchDurationMs)
    easingIntensity = batchEasingIntensity
    isShowing = batchIsShowing
    remainingDelayFrames = Math.max(0, startDelayFrames)
    stopwatch = null
    isRunning = true
    startFrameClock()
    log(`Start count=${entries.length} durationMs=${durationMs} mode=${isShowing ? 'show' : 'hide'} delayFrames=${remainingDelayFrames}`)
  }

  /**
   * 启动帧时钟
   */
  function startFrameClock () {
    stopFrameClock()
    // Electron 中没有 CompositionTarget.Rendering，使用 setInterval 模拟
    // 间隔按最高刷新率计算，限制在 [8, 16] ms
    const maxRefreshHz = Math.max(1, ...entries.map(entry => entry.refreshRateHz))
    const intervalMs = Math.max(8, Math.min(16, 1000.0 / maxRefreshHz))
    frameTimer = setInterval(onRenderingFrame, intervalMs)
  }

  /**
   * 停止帧时钟
   */
  function stopFrameClock () {
    if (frameTimer) {
      clearInterval(frameTimer)
      frameTimer = null
    }
  }

  /**
   * 取消
   */
  function cancel () {
    if (!isRunning) return
    reportMetrics('cancelled')
    stopCore()
    log('Cancelled')
  }

  /**
   * 渲染帧回调
   */
  function onRenderingFrame () {
    try {
      if (!isRunning) return

      // 丢弃已启动更新动画的条目
      for (let i = entries.length - 1; i >= 0; i--) {
        if (!entries[i].isValid()) {
          entries.splice(i, 1)
        }
      }

      if (entries.length === 0) {
        cancel()
        return
      }

      // 给刚显示的窗口几帧时间提交首帧
      if (remainingDelayFrames > 0) {
        remainingDelayFrames--
        return
      }

      const now = Date.now()
      if (!stopwatch) {
        stopwatch = now
        frameTracker = createWidgetTrayAnimationFrameTracker(now, entries.map(entry => entry.refreshRateHz))
      }
      frameTracker && frameTracker.recordFrame(now)

      const rawProgress = Math.max(0, Math.min(1, (now - stopwatch) / durationMs))
      const easedProgress = ease(rawProgress, easingIntensity, isShowing)

      moveEntriesFrame(easedProgress)

      if (rawProgress < 1.0) return

      finishBatch()
    } catch (error) {
      logger.error('BatchAnim', `Frame exception: ${error.message}`)
      finishBatch('failed')
    }
  }

  /**
   * 移动所有条目一帧
   */
  function moveEntriesFrame (easedProgress) {
    for (const entry of entries) {
      const { x, y } = getEntryFramePosition(entry, easedProgress)
      if (entry.window && !entry.window.isDestroyed()) {
        entry.window.setPosition(x, y, false)
      }
    }
  }

  /**
   * 计算条目帧位置
   */
  function getEntryFramePosition (entry, easedProgress) {
    const offsetX = lerp(entry.fromOffsetX, entry.toOffsetX, easedProgress)
    const offsetY = lerp(entry.fromOffsetY, entry.toOffsetY, easedProgress)
    return {
      x: entry.baseX + Math.round(offsetX),
      y: entry.baseY + Math.round(offsetY)
    }
  }

  /**
   * 完成批处理
   */
  function finishBatch (outcome = 'completed') {
    const completed = entries.slice()
    reportMetrics(outcome)
    stopCore()
    for (const entry of completed) {
      try {
        entry.completed()
      } catch (error) {
        logger.error('BatchAnim', `Completed exception: ${error.message}`)
      }
    }
  }

  /**
   * 报告帧指标
   */
  function reportMetrics (outcome) {
    const tracker = frameTracker
    frameTracker = null
    reportFrameMetrics(tracker, Date.now(), isShowing, outcome, 'batch', log)
  }

  /**
   * 停止核心
   */
  function stopCore () {
    isRunning = false
    entries = []
    stopwatch = null
    frameTracker = null
    stopFrameClock()
  }

  return {
    start,
    cancel,
    createBatchAnimationEntry,
    get isRunning () { return isRunning }
  }
}

module.exports = {
  createBatchAnimationEntry,
  createWidgetTrayBatchAnimationDriver
}