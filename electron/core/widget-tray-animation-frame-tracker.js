// ============================================================
// 托盘动画帧追踪器
// 按刷新率分组测量一次共享托盘动画
// 60Hz 与 144Hz 显示器各自得到独立的帧预算结果，即使 HWND 位置共享同一时钟
// ============================================================

const logger = require('./logger.js')

// 默认刷新率（Hz）
const DEFAULT_REFRESH_RATE_HZ = 60

/**
 * 规范化刷新率
 * @param {number} rate 原始刷新率
 * @returns {number}
 */
function normalizeRefreshRate (rate) {
  const value = Math.max(0, rate | 0)
  if (value <= 0) return DEFAULT_REFRESH_RATE_HZ
  // 折叠到常见档位：60 / 90 / 120 / 144 / 240
  if (value < 50) return DEFAULT_REFRESH_RATE_HZ
  return value
}

/**
 * 创建单刷新率帧追踪器
 * @param {number} startedTimestamp 起始时间戳（ms）
 * @param {number} refreshRateHz 刷新率
 */
function createSingleRateTracker (startedTimestamp, refreshRateHz) {
  const frameBudgetMs = 1000 / Math.max(1, refreshRateHz)
  let frameCount = 0
  let maxFrameIntervalMs = 0
  let lastTimestamp = startedTimestamp

  /**
   * 记录一帧
   * @param {number} timestamp 当前时间戳（ms）
   */
  function recordFrame (timestamp) {
    frameCount++
    if (frameCount > 1) {
      const interval = timestamp - lastTimestamp
      if (interval > maxFrameIntervalMs) {
        maxFrameIntervalMs = interval
      }
    }
    lastTimestamp = timestamp
  }

  /**
   * 完成追踪，返回汇总
   * @param {number} completedTimestamp 完成时间戳（ms）
   * @returns {Object}
   */
  function complete (completedTimestamp) {
    const elapsedMs = completedTimestamp - startedTimestamp
    const estimatedDroppedFrames = Math.max(
      0,
      Math.round(elapsedMs / frameBudgetMs) - frameCount
    )
    return {
      refreshRateHz,
      frameCount,
      estimatedDroppedFrames,
      maximumFrameIntervalMilliseconds: maxFrameIntervalMs,
      elapsedMilliseconds: elapsedMs,
      frameBudgetMilliseconds: frameBudgetMs
    }
  }

  return { recordFrame, complete }
}

/**
 * 创建托盘动画帧追踪器
 * @param {number} startedTimestamp 起始时间戳（ms）
 * @param {Array<number>} participantRefreshRates 参与窗口的刷新率列表
 */
function createWidgetTrayAnimationFrameTracker (startedTimestamp, participantRefreshRates) {
  if (!Array.isArray(participantRefreshRates)) {
    throw new TypeError('participantRefreshRates 必须是数组')
  }

  const normalizedRates = participantRefreshRates.map(rate => normalizeRefreshRate(rate))
  if (normalizedRates.length === 0) {
    normalizedRates.push(DEFAULT_REFRESH_RATE_HZ)
  }

  // 按刷新率分组
  const groups = []
  const rateToCount = new Map()
  for (const rate of normalizedRates) {
    rateToCount.set(rate, (rateToCount.get(rate) || 0) + 1)
  }
  for (const [rate, count] of rateToCount) {
    groups.push({
      refreshRateHz: rate,
      participantCount: count,
      tracker: createSingleRateTracker(startedTimestamp, rate)
    })
  }
  groups.sort((a, b) => a.refreshRateHz - b.refreshRateHz)

  /**
   * 记录一帧
   * @param {number} timestamp 当前时间戳（ms）
   */
  function recordFrame (timestamp) {
    for (const group of groups) {
      group.tracker.recordFrame(timestamp)
    }
  }

  /**
   * 完成追踪
   * @param {number} timestamp 完成时间戳（ms）
   * @returns {Array<Object>}
   */
  function complete (timestamp) {
    return groups.map(group => {
      const summary = group.tracker.complete(timestamp)
      return {
        refreshRateHz: summary.refreshRateHz,
        participantCount: group.participantCount,
        frameCount: summary.frameCount,
        estimatedDroppedFrames: summary.estimatedDroppedFrames,
        maximumFrameIntervalMilliseconds: summary.maximumFrameIntervalMilliseconds,
        elapsedMilliseconds: summary.elapsedMilliseconds,
        frameBudgetMilliseconds: summary.frameBudgetMilliseconds
      }
    })
  }

  return { recordFrame, complete }
}

/**
 * 报告帧指标
 * @param {Object|null} tracker 帧追踪器
 * @param {number} completedTimestamp 完成时间戳（ms）
 * @param {boolean} isShowing 是否显示动画
 * @param {string} outcome 结果（completed/cancelled/failed）
 * @param {string} scope 范围标识
 * @param {Function} [verboseLog] 详细日志回调
 */
function reportFrameMetrics (tracker, completedTimestamp, isShowing, outcome, scope, verboseLog) {
  if (!tracker) return

  const summaries = tracker.complete(completedTimestamp)
  for (const summary of summaries) {
    const details =
      `scope=${scope} mode=${isShowing ? 'show' : 'hide'} ` +
      `outcome=${outcome} refreshHz=${summary.refreshRateHz} ` +
      `participants=${summary.participantCount} frames=${summary.frameCount} ` +
      `dropped=${summary.estimatedDroppedFrames} ` +
      `maxFrameMs=${summary.maximumFrameIntervalMilliseconds.toFixed(1)} ` +
      `budgetMs=${summary.frameBudgetMilliseconds.toFixed(1)} ` +
      `elapsedMs=${summary.elapsedMilliseconds.toFixed(1)}`
    if (summary.estimatedDroppedFrames > 0) {
      logger.warn('TrayAnimation', `Frame budget missed ${details}`)
    } else if (typeof verboseLog === 'function') {
      verboseLog(`[TrayAnimation] ${details}`)
    } else {
      logger.debug('TrayAnimation', details)
    }
  }
}

module.exports = {
  DEFAULT_REFRESH_RATE_HZ,
  normalizeRefreshRate,
  createWidgetTrayAnimationFrameTracker,
  reportFrameMetrics
}