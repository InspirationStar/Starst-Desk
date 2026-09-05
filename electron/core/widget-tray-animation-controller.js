// ============================================================
// 小部件托盘动画控制器
// 在 Electron 中使用 BrowserWindow + CSS transition 重新实现
// 透明度/缩放由渲染进程 CSS 驱动，窗口位置由主进程逐帧更新
// ============================================================

const logger = require('./logger.js')
const {
  createWidgetTrayAnimationFrameTracker,
  reportFrameMetrics
} = require('./widget-tray-animation-frame-tracker.js')

// 静止状态常量
const RESTING_OPACITY = 1.0
const SOFT_OPACITY = 0.0
const RESTING_SCALE = 1.0
const SOFT_SCALE = 0.985

// 滑动偏移下限与离屏填充
const MIN_WIDGET_SLIDE_OFFSET = 1.0
const OFFSCREEN_SLIDE_PADDING = 16.0

// 动画效果枚举
const ANIMATION_EFFECT = {
  NONE: 'none',
  FADE: 'fade',
  SLIDE_LEFT: 'slide-left',
  SLIDE_UP: 'slide-up',
  SLIDE_DOWN: 'slide-down',
  SLIDE_RIGHT: 'slide-right',
  SLIDE_FADE: 'slide-fade',
  SCALE_FADE: 'scale-fade',
  SCALE_SLIDE: 'scale-slide',
  ZOOM: 'zoom',
  SLIDE_UP_FADE: 'slide-up-fade',
  SLIDE_DOWN_FADE: 'slide-down-fade',
  SLIDE_LEFT_FADE: 'slide-left-fade',
  SLIDE_RIGHT_FADE: 'slide-right-fade'
}

// 缓动强度
const EASING_INTENSITY = {
  NONE: 'none',
  LIGHT: 'light',
  NORMAL: 'normal',
  STRONG: 'strong'
}

/**
 * 线性插值
 */
function lerp (from, to, progress) {
  return from + (to - from) * progress
}

/**
 * 缓动函数
 * @param {number} progress 原始进度 [0,1]
 * @param {string} intensity 缓动强度
 * @param {boolean} isShowing 是否显示
 * @returns {number}
 */
function ease (progress, intensity, isShowing) {
  const p = Math.max(0, Math.min(1, progress))
  if (intensity === EASING_INTENSITY.NONE) return p

  if (isShowing) {
    // 显示：缓出曲线
    switch (intensity) {
      case EASING_INTENSITY.LIGHT: return 1 - Math.pow(1 - p, 2)
      case EASING_INTENSITY.STRONG: return 1 - Math.pow(1 - p, 4)
      default: return 1 - Math.pow(1 - p, 3)
    }
  }
  // 隐藏：缓入曲线
  switch (intensity) {
    case EASING_INTENSITY.LIGHT: return p * p
    case EASING_INTENSITY.STRONG: return p * p * p * p
    default: return p * p * p
  }
}

/**
 * 创建动画配置
 * @param {Object} options 选项
 * @param {string} options.effect 动画效果
 * @param {number} options.durationMs 持续时间
 * @param {string} options.slideDirection 滑动方向
 * @param {boolean} options.isEnabled 是否启用
 * @param {Object} slideOffsets 离屏滑动偏移
 * @returns {Object}
 */
function createProfile (options, slideOffsets) {
  const effect = options.effect
  const durationMs = options.durationMs
  const dir = getDirectionalOffset(options.slideDirection, slideOffsets)
  const dirX = dir.x
  const dirY = dir.y

  switch (effect) {
    case ANIMATION_EFFECT.NONE:
      return { showOffsetX: 0, showOffsetY: 0, hideOffsetX: 0, hideOffsetY: 0, showStartOpacity: RESTING_OPACITY, hideEndOpacity: RESTING_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs: 1, isEnabled: false }
    case ANIMATION_EFFECT.FADE:
      return { showOffsetX: 0, showOffsetY: 0, hideOffsetX: 0, hideOffsetY: 0, showStartOpacity: SOFT_OPACITY, hideEndOpacity: SOFT_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SLIDE_LEFT:
      return { showOffsetX: -slideOffsets.left, showOffsetY: 0, hideOffsetX: -slideOffsets.left, hideOffsetY: 0, showStartOpacity: RESTING_OPACITY, hideEndOpacity: RESTING_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SLIDE_UP:
      return { showOffsetX: 0, showOffsetY: -slideOffsets.up, hideOffsetX: 0, hideOffsetY: -slideOffsets.up, showStartOpacity: RESTING_OPACITY, hideEndOpacity: RESTING_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SLIDE_DOWN:
      return { showOffsetX: 0, showOffsetY: slideOffsets.down, hideOffsetX: 0, hideOffsetY: slideOffsets.down, showStartOpacity: RESTING_OPACITY, hideEndOpacity: RESTING_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SCALE_FADE:
      return { showOffsetX: 0, showOffsetY: 0, hideOffsetX: 0, hideOffsetY: 0, showStartOpacity: SOFT_OPACITY, hideEndOpacity: SOFT_OPACITY, showStartScale: SOFT_SCALE, hideEndScale: SOFT_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SLIDE_RIGHT:
      return { showOffsetX: slideOffsets.right, showOffsetY: 0, hideOffsetX: slideOffsets.right, hideOffsetY: 0, showStartOpacity: RESTING_OPACITY, hideEndOpacity: RESTING_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.ZOOM:
      return { showOffsetX: 0, showOffsetY: 0, hideOffsetX: 0, hideOffsetY: 0, showStartOpacity: SOFT_OPACITY, hideEndOpacity: SOFT_OPACITY, showStartScale: 0.5, hideEndScale: 0.5, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SLIDE_UP_FADE:
      return { showOffsetX: 0, showOffsetY: -slideOffsets.up, hideOffsetX: 0, hideOffsetY: -slideOffsets.up, showStartOpacity: SOFT_OPACITY, hideEndOpacity: SOFT_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SLIDE_DOWN_FADE:
      return { showOffsetX: 0, showOffsetY: slideOffsets.down, hideOffsetX: 0, hideOffsetY: slideOffsets.down, showStartOpacity: SOFT_OPACITY, hideEndOpacity: SOFT_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SLIDE_LEFT_FADE:
      return { showOffsetX: -slideOffsets.left, showOffsetY: 0, hideOffsetX: -slideOffsets.left, hideOffsetY: 0, showStartOpacity: SOFT_OPACITY, hideEndOpacity: SOFT_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SLIDE_RIGHT_FADE:
      return { showOffsetX: slideOffsets.right, showOffsetY: 0, hideOffsetX: slideOffsets.right, hideOffsetY: 0, showStartOpacity: SOFT_OPACITY, hideEndOpacity: SOFT_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SLIDE_FADE:
      return { showOffsetX: dirX, showOffsetY: dirY, hideOffsetX: dirX, hideOffsetY: dirY, showStartOpacity: RESTING_OPACITY, hideEndOpacity: RESTING_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    case ANIMATION_EFFECT.SCALE_SLIDE:
      return { showOffsetX: dirX, showOffsetY: dirY, hideOffsetX: dirX, hideOffsetY: dirY, showStartOpacity: SOFT_OPACITY, hideEndOpacity: SOFT_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
    default:
      return { showOffsetX: dirX, showOffsetY: dirY, hideOffsetX: dirX, hideOffsetY: dirY, showStartOpacity: RESTING_OPACITY, hideEndOpacity: RESTING_OPACITY, showStartScale: RESTING_SCALE, hideEndScale: RESTING_SCALE, durationMs, isEnabled: true }
  }
}

/**
 * 根据滑动方向获取偏移
 */
function getDirectionalOffset (direction, slideOffsets) {
  switch (direction) {
    case 'left': return { x: -slideOffsets.left, y: 0 }
    case 'right': return { x: slideOffsets.right, y: 0 }
    case 'up': return { x: 0, y: -slideOffsets.up }
    case 'down': return { x: 0, y: slideOffsets.down }
    default: return { x: 0, y: 0 }
  }
}

/**
 * 创建小部件托盘动画控制器
 * @param {Object} options
 * @param {Electron.BrowserWindow} options.window Electron 窗口
 * @param {Function} options.getAnimationBounds 获取动画边界 () => {x, y, width, height}
 * @param {Function} [options.log] 日志回调
 */
function createWidgetTrayAnimationController (options) {
  const { window: browserWindow, getAnimationBounds } = options
  const log = typeof options.log === 'function' ? options.log : (msg) => logger.debug('WidgetTrayAnim', msg)

  let generation = 0
  let isApplyingBounds = false
  let targetPosition = null
  let offsetOverrideX = null
  let offsetOverrideY = null
  let preparedOffsetX = 0
  let preparedOffsetY = 0
  let preparedOpacity = RESTING_OPACITY
  let preparedScale = RESTING_SCALE
  let preparedRefreshRateHz = 60

  // 渲染状态
  let isRendering = false
  let renderStartTime = 0
  let renderDurationMs = 0
  let renderFromOffsetX = 0
  let renderFromOffsetY = 0
  let renderToOffsetX = 0
  let renderToOffsetY = 0
  let renderIsShowing = false
  let renderGeneration = 0
  let renderEasingIntensity = ''
  let renderCompleted = null
  let renderFrameTracker = null
  let renderTimer = null

  /**
   * 获取下一代数
   */
  function nextGeneration () {
    return ++generation
  }

  /**
   * 设置偏移覆盖
   */
  function setOffsetOverride (offsetX, offsetY) {
    offsetOverrideX = offsetX
    offsetOverrideY = offsetY
  }

  /**
   * 准备视觉状态
   */
  function prepareVisualState (offsetX, offsetY, opacity, scale) {
    preparedOffsetX = offsetX
    preparedOffsetY = offsetY
    preparedOpacity = opacity
    preparedScale = scale
    const bounds = getAnimationBounds()
    targetPosition = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y)
    }
    applyWindowOffset(offsetX, offsetY)
    sendVisualStateToRenderer(opacity, scale, 0, 0)
  }

  /**
   * 准备隐藏状态
   */
  function prepareHiddenState () {
    if (targetPosition) {
      applyWindowOffset(preparedOffsetX, preparedOffsetY)
      sendVisualStateToRenderer(preparedOpacity, preparedScale, 0, 0)
      return
    }
    sendVisualStateToRenderer(SOFT_OPACITY, RESTING_SCALE, 0, 0)
  }

  /**
   * 启动动画
   * @param {number} fromOffsetX 起始 X 偏移
   * @param {number} fromOffsetY 起始 Y 偏移
   * @param {number} toOffsetX 目标 X 偏移
   * @param {number} toOffsetY 目标 Y 偏移
   * @param {number} fromOpacity 起始透明度
   * @param {number} toOpacity 目标透明度
   * @param {number} fromScale 起始缩放
   * @param {number} toScale 目标缩放
   * @param {number} durationMs 持续时间
   * @param {boolean} isShowing 是否显示
   * @param {number} gen 代数
   * @param {string} easingIntensity 缓动强度
   * @param {Function} completed 完成回调
   */
  function animate (fromOffsetX, fromOffsetY, toOffsetX, toOffsetY, fromOpacity, toOpacity, fromScale, toScale, durationMs, isShowing, gen, easingIntensity, completed) {
    log(`AnimateStart mode=${isShowing ? 'show' : 'hide'} gen=${gen} durationMs=${durationMs} windowOffset=(${fromOffsetX},${fromOffsetY})->(${toOffsetX},${toOffsetY}) windowOpacity=${fromOpacity}->${toOpacity}`)
    stop()
    if (!targetPosition) {
      prepareVisualState(fromOffsetX, fromOffsetY, fromOpacity, fromScale)
    } else {
      applyWindowOffset(fromOffsetX, fromOffsetY)
    }

    if (durationMs <= 1) {
      sendVisualStateToRenderer(toOpacity, toScale, 0, 0)
      completeAnimation(toOffsetX, toOffsetY, isShowing, gen, completed)
      return
    }

    // 透明度与缩放：通过渲染进程 CSS transition 驱动
    sendVisualStateToRenderer(toOpacity, toScale, 0, 0, durationMs, easingIntensity, isShowing)

    // 窗口偏移：主进程逐帧更新
    renderFromOffsetX = fromOffsetX
    renderFromOffsetY = fromOffsetY
    renderToOffsetX = toOffsetX
    renderToOffsetY = toOffsetY
    renderDurationMs = durationMs
    renderIsShowing = isShowing
    renderGeneration = gen
    renderCompleted = completed
    renderStartTime = Date.now()
    isRendering = true
    renderEasingIntensity = easingIntensity
    renderFrameTracker = createWidgetTrayAnimationFrameTracker(renderStartTime, [preparedRefreshRateHz])

    if (renderTimer) clearInterval(renderTimer)
    renderTimer = setInterval(onRenderingFrame, 16)
  }

  /**
   * 渲染帧回调
   */
  function onRenderingFrame () {
    try {
      if (!isRendering || renderGeneration !== generation) {
        stopRendering('superseded')
        return
      }

      const now = Date.now()
      renderFrameTracker && renderFrameTracker.recordFrame(now)

      const rawProgress = Math.max(0, Math.min(1, (now - renderStartTime) / renderDurationMs))
      const easedProgress = ease(rawProgress, renderEasingIntensity, renderIsShowing)
      const currentOffsetX = lerp(renderFromOffsetX, renderToOffsetX, easedProgress)
      const currentOffsetY = lerp(renderFromOffsetY, renderToOffsetY, easedProgress)

      applyWindowOffset(currentOffsetX, currentOffsetY)

      if (rawProgress < 1.0) return

      stopRendering('completed')
      completeAnimation(renderToOffsetX, renderToOffsetY, renderIsShowing, renderGeneration, renderCompleted)
    } catch (error) {
      logger.error('WidgetTrayAnim', `Frame exception: ${error.message}`)
      stopRendering('failed')
    }
  }

  /**
   * 停止渲染
   */
  function stopRendering (outcome = 'cancelled') {
    if (!isRendering) return

    isRendering = false
    if (renderTimer) {
      clearInterval(renderTimer)
      renderTimer = null
    }
    const tracker = renderFrameTracker
    renderFrameTracker = null
    reportFrameMetrics(tracker, Date.now(), renderIsShowing, outcome, `window:${browserWindow ? browserWindow.id : '?'}`, log)
  }

  /**
   * 停止动画
   */
  function stop () {
    stopRendering()
    if (browserWindow && !browserWindow.isDestroyed()) {
      try {
        browserWindow.webContents.send('widget-tray-animation-stop')
      } catch {
        // 窗口可能已销毁
      }
    }
  }

  /**
   * 停止并恢复窗口位置
   */
  function stopAndRestoreWindowPosition () {
    stop()
    restoreWindowPosition()
  }

  /**
   * 恢复视觉状态
   */
  function restoreVisualState () {
    sendVisualStateToRenderer(RESTING_OPACITY, RESTING_SCALE, 0, 0)
  }

  /**
   * 恢复窗口位置
   */
  function restoreWindowPosition () {
    if (targetPosition) {
      isApplyingBounds = true
      try {
        moveNativeWindow(targetPosition)
      } finally {
        isApplyingBounds = false
      }
    }
    targetPosition = null
  }

  /**
   * 完成动画
   */
  function completeAnimation (finalOffsetX, finalOffsetY, isShowing, gen, completed) {
    if (gen !== generation) return

    applyWindowOffset(finalOffsetX, finalOffsetY)
    setOffsetOverride(null, null)
    log(`AnimateCompleted mode=${isShowing ? 'show' : 'hide'} gen=${gen}`)
    if (typeof completed === 'function') completed()
  }

  /**
   * 应用窗口偏移
   */
  function applyWindowOffset (offsetX, offsetY) {
    const target = targetPosition || getCurrentBasePosition()
    const nextPosition = {
      x: target.x + Math.round(offsetX),
      y: target.y + Math.round(offsetY)
    }
    isApplyingBounds = true
    try {
      moveNativeWindow(nextPosition)
    } finally {
      isApplyingBounds = false
    }
  }

  /**
   * 移动原生窗口
   */
  function moveNativeWindow (position) {
    if (!browserWindow || browserWindow.isDestroyed()) return
    browserWindow.setPosition(position.x, position.y, false)
  }

  /**
   * 获取当前基础位置
   */
  function getCurrentBasePosition () {
    const bounds = getAnimationBounds()
    return { x: Math.round(bounds.x), y: Math.round(bounds.y) }
  }

  /**
   * 获取离屏滑动偏移
   */
  function getOffscreenSlideOffsets () {
    if (offsetOverrideX != null || offsetOverrideY != null) {
      const horizontal = Math.abs(offsetOverrideX || 0)
      const vertical = Math.abs(offsetOverrideY || 0)
      return {
        left: horizontal > 0 ? horizontal : MIN_WIDGET_SLIDE_OFFSET,
        right: horizontal > 0 ? horizontal : MIN_WIDGET_SLIDE_OFFSET,
        up: vertical > 0 ? vertical : MIN_WIDGET_SLIDE_OFFSET,
        down: vertical > 0 ? vertical : MIN_WIDGET_SLIDE_OFFSET
      }
    }

    const bounds = getAnimationBounds()
    const x = bounds.x
    const y = bounds.y
    const width = Math.max(MIN_WIDGET_SLIDE_OFFSET, bounds.width)
    const height = Math.max(MIN_WIDGET_SLIDE_OFFSET, bounds.height)

    // 简化：使用屏幕尺寸作为工作区
    let screenWidth = 1920
    let screenHeight = 1080
    try {
      if (browserWindow && !browserWindow.isDestroyed()) {
        const display = require('electron').screen.getDisplayMatching(browserWindow.getBounds())
        const workArea = display.workArea
        const left = Math.max(MIN_WIDGET_SLIDE_OFFSET, (x + width) - workArea.x + OFFSCREEN_SLIDE_PADDING)
        const right = Math.max(MIN_WIDGET_SLIDE_OFFSET, (workArea.x + workArea.width) - x + OFFSCREEN_SLIDE_PADDING)
        const up = Math.max(MIN_WIDGET_SLIDE_OFFSET, (y + height) - workArea.y + OFFSCREEN_SLIDE_PADDING)
        const down = Math.max(MIN_WIDGET_SLIDE_OFFSET, (workArea.y + workArea.height) - y + OFFSCREEN_SLIDE_PADDING)
        return { left, right, up, down }
      }
    } catch {
      // 回退到默认屏幕尺寸
    }

    return {
      left: Math.max(MIN_WIDGET_SLIDE_OFFSET, x + width + OFFSCREEN_SLIDE_PADDING),
      right: Math.max(MIN_WIDGET_SLIDE_OFFSET, screenWidth - x + OFFSCREEN_SLIDE_PADDING),
      up: Math.max(MIN_WIDGET_SLIDE_OFFSET, y + height + OFFSCREEN_SLIDE_PADDING),
      down: Math.max(MIN_WIDGET_SLIDE_OFFSET, screenHeight - y + OFFSCREEN_SLIDE_PADDING)
    }
  }

  /**
   * 向渲染进程发送视觉状态
   */
  function sendVisualStateToRenderer (opacity, scale, offsetX, offsetY, durationMs, easingIntensity, isShowing) {
    if (!browserWindow || browserWindow.isDestroyed()) return
    try {
      browserWindow.webContents.send('widget-tray-animation-state', {
        opacity: Math.max(0, Math.min(1, opacity)),
        scale,
        offsetX,
        offsetY,
        durationMs: durationMs || 0,
        easingIntensity: easingIntensity || EASING_INTENSITY.NORMAL,
        isShowing: !!isShowing
      })
    } catch {
      // 窗口可能已销毁
    }
  }

  /**
   * 获取静止动画边界
   */
  function getRestingAnimationBounds () {
    const current = getAnimationBounds()
    if (targetPosition) {
      return { x: targetPosition.x, y: targetPosition.y, width: current.width, height: current.height }
    }
    return current
  }

  return {
    nextGeneration,
    setOffsetOverride,
    prepareVisualState,
    prepareHiddenState,
    animate,
    stop,
    stopAndRestoreWindowPosition,
    restoreVisualState,
    restoreWindowPosition,
    createProfile: (options) => createProfile(options, getOffscreenSlideOffsets()),
    getRestingAnimationBounds,
    get isApplyingBounds () { return isApplyingBounds },
    get isPositionTransitionActive () { return targetPosition != null },
    get generation () { return generation }
  }
}

module.exports = {
  RESTING_OPACITY,
  SOFT_OPACITY,
  RESTING_SCALE,
  SOFT_SCALE,
  ANIMATION_EFFECT,
  EASING_INTENSITY,
  createProfile,
  ease,
  lerp,
  createWidgetTrayAnimationController
}