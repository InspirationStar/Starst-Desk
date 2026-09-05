// ============================================================
// 自适应托盘动画控制器
// 结合智能帧率节流 + GPU Turbo 模式
// 在 Electron 中使用 BrowserWindow + CSS transition 重新实现
// GPU Turbo 模式：通过渲染进程 CSS transform/transition 实现（GPU 加速）
// CPU 模式：主进程逐帧 setPosition 更新
// ============================================================

const logger = require('./logger.js')
const {
  RESTING_OPACITY,
  SOFT_OPACITY,
  RESTING_SCALE,
  SOFT_SCALE,
  EASING_INTENSITY,
  ease,
  lerp
} = require('./widget-tray-animation-controller.js')

// 离屏偏移常量
const MIN_WIDGET_SLIDE_OFFSET = 1.0
const OFFSCREEN_SLIDE_PADDING = 16.0

/**
 * 默认自适应配置
 */
const DEFAULT_CONFIG = {
  enableGpuTurboMode: true,
  maxFpsHighPriority: 120,
  maxFpsNormal: 60,
  highPriorityDurationMs: 200,
  targetRefreshRate: 60
}

/**
 * 创建自适应动画配置
 * @param {Object} [overrides] 覆盖项
 * @returns {Object}
 */
function createAdaptiveConfig (overrides = {}) {
  return { ...DEFAULT_CONFIG, ...overrides }
}

/**
 * 创建自适应托盘动画控制器
 * @param {Object} options
 * @param {Object} options.config 自适应配置
 * @param {Electron.BrowserWindow} options.window Electron 窗口
 * @param {Function} options.getAnimationBounds 获取动画边界 () => {x, y, width, height}
 * @param {Function} [options.log] 日志回调
 */
function createAdaptiveTrayAnimationController (options) {
  const config = { ...DEFAULT_CONFIG, ...(options.config || {}) }
  const { window: browserWindow, getAnimationBounds } = options
  const log = typeof options.log === 'function' ? options.log : (msg) => logger.debug('AdaptiveTray', msg)

  let generation = 0
  let targetPosition = null
  let offsetOverrideX = null
  let offsetOverrideY = null
  let preparedOffsetX = 0
  let preparedOffsetY = 0
  let preparedOpacity = RESTING_OPACITY
  let preparedScale = RESTING_SCALE

  // 智能帧率节流状态
  let lastRenderTime = 0
  let targetFps = config.maxFpsHighPriority
  let minFrameIntervalMs = 1000.0 / targetFps
  let animationStartTime = 0

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
  let renderTimer = null
  let gpuCompletionTimer = null

  // GPU Turbo 是否启用
  const isGpuTurboEnabled = config.enableGpuTurboMode && isGpuAvailable()

  /**
   * 初始化帧率控制
   */
  function initializeFrameRateControl () {
    targetFps = config.maxFpsHighPriority
    minFrameIntervalMs = 1000.0 / targetFps
    log(`Frame rate control initialized: HighPriority=${config.maxFpsHighPriority}fps, Normal=${config.maxFpsNormal}fps, HighPriorityDuration=${config.highPriorityDurationMs}ms`)
  }

  initializeFrameRateControl()

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
   * 启动动画
   */
  function animate (fromOffsetX, fromOffsetY, toOffsetX, toOffsetY, fromOpacity, toOpacity, fromScale, toScale, durationMs, isShowing, gen, easingIntensity, completed) {
    log(`Animate mode=${isShowing ? 'show' : 'hide'} gen=${gen} durationMs=${durationMs} windowOffset=(${fromOffsetX},${fromOffsetY})->(${toOffsetX},${toOffsetY}) windowOpacity=${fromOpacity}->${toOpacity}, GPU_Turbo=${isGpuTurboEnabled} fps_high=${config.maxFpsHighPriority} fps_normal=${config.maxFpsNormal}`)

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

    // 透明度与缩放：渲染进程 CSS transition 驱动
    sendVisualStateToRenderer(toOpacity, toScale, 0, 0, durationMs, easingIntensity, isShowing)

    // 窗口位置：自适应策略
    if (isGpuTurboEnabled) {
      logAndExecuteGpuMode(fromOffsetX, fromOffsetY, toOffsetX, toOffsetY, durationMs, easingIntensity, completed, gen, isShowing)
    } else {
      logAndExecuteCpuMode(fromOffsetX, fromOffsetY, toOffsetX, toOffsetY, durationMs, easingIntensity, completed, gen, isShowing)
    }
  }

  /**
   * CPU 模式：传统每帧更新
   */
  function logAndExecuteCpuMode (fromOffsetX, fromOffsetY, toOffsetX, toOffsetY, durationMs, easingIntensity, completed, gen, isShowing) {
    log('Executing in CPU Mode (traditional per-frame updates)')

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
    animationStartTime = Date.now()
    renderEasingIntensity = EASING_INTENSITY.LIGHT // 使用轻缓动保证平滑

    if (renderTimer) clearInterval(renderTimer)
    renderTimer = setInterval(onRenderingFrame, 16)
  }

  /**
   * GPU Turbo 模式：通过渲染进程 CSS transform/transition 实现
   * 窗口保持在最终物理位置，CSS transform 从 offscreen 滑到最终位置
   */
  function logAndExecuteGpuMode (fromOffsetX, fromOffsetY, toOffsetX, toOffsetY, durationMs, easingIntensity, completed, gen, isShowing) {
    log('Executing in GPU Turbo Mode (CSS transform-based animation)')

    try {
      // Step 1: 确保窗口已经移动到最终物理位置
      applyWindowOffset(toOffsetX, toOffsetY)

      // Step 2: 通过 CSS transform 实现滑动
      // Translation 起始值是 -offset（offscreen 偏移量），结束在 0
      const translationStartX = -(toOffsetX - fromOffsetX)
      const translationStartY = -(toOffsetY - fromOffsetY)

      if (browserWindow && !browserWindow.isDestroyed()) {
        browserWindow.webContents.send('widget-tray-animation-gpu-turbo', {
          startOffsetX: translationStartX,
          startOffsetY: translationStartY,
          endOffsetX: 0,
          endOffsetY: 0,
          durationMs,
          easingIntensity,
          isShowing
        })
      }

      log(`GPU CSS transform animation started (startOffset=(${translationStartX},${translationStartY})->final=${toOffsetX},${toOffsetY})`)

      // 使用更精确的完成回调时机（考虑动画帧对齐）
      const completionFrameBudgetMs = 1000 / Math.max(1, config.targetRefreshRate)
      const completionDelay = durationMs + Math.ceil(completionFrameBudgetMs)
      if (gpuCompletionTimer) clearTimeout(gpuCompletionTimer)
      gpuCompletionTimer = setTimeout(() => {
        gpuCompletionTimer = null
        cleanupGpuAnimation()
        if (typeof completed === 'function') completed()
      }, completionDelay)
    } catch (error) {
      log(`GPU Turbo mode failed (${error.message}), falling back to CPU mode`)
      logAndExecuteCpuMode(fromOffsetX, fromOffsetY, toOffsetX, toOffsetY, durationMs, easingIntensity, completed, gen, isShowing)
    }
  }

  /**
   * 清理 GPU 动画
   */
  function cleanupGpuAnimation () {
    try {
      if (browserWindow && !browserWindow.isDestroyed()) {
        browserWindow.webContents.send('widget-tray-animation-gpu-cleanup')
      }
    } catch (error) {
      log(`Cleanup GPU animation error: ${error.message}`)
    }
  }

  /**
   * 渲染帧回调
   */
  function onRenderingFrame () {
    if (!isRendering || renderGeneration !== generation) {
      stopRendering()
      return
    }

    // 强制满帧模式：直接渲染，不跳过任何帧
    lastRenderTime = Date.now()

    const now = Date.now()
    const rawProgress = Math.max(0, Math.min(1, (now - renderStartTime) / renderDurationMs))
    const easedProgress = ease(rawProgress, renderEasingIntensity, renderIsShowing)
    const currentOffsetX = lerp(renderFromOffsetX, renderToOffsetX, easedProgress)
    const currentOffsetY = lerp(renderFromOffsetY, renderToOffsetY, easedProgress)

    applyWindowOffset(currentOffsetX, currentOffsetY)

    if (rawProgress >= 1.0) {
      stopRendering()
      completeAnimation(renderToOffsetX, renderToOffsetY, renderIsShowing, renderGeneration, renderCompleted)
    }
  }

  /**
   * 停止渲染
   */
  function stopRendering () {
    if (!isRendering) return

    isRendering = false
    if (renderTimer) {
      clearInterval(renderTimer)
      renderTimer = null
    }
    lastRenderTime = 0
    targetFps = config.maxFpsHighPriority
    minFrameIntervalMs = 1000.0 / targetFps
  }

  /**
   * 完成动画
   */
  function completeAnimation (offsetX, offsetY, isShowing, gen, completed) {
    // 简化版：不做复杂的动画状态重置
    if (typeof completed === 'function') completed()
  }

  /**
   * 停止动画
   */
  function stop () {
    stopRendering()
    if (gpuCompletionTimer) {
      clearTimeout(gpuCompletionTimer)
      gpuCompletionTimer = null
    }
    if (browserWindow && !browserWindow.isDestroyed()) {
      try {
        browserWindow.webContents.send('widget-tray-animation-stop')
      } catch {
        // 窗口可能已销毁
      }
    }
  }

  /**
   * 应用窗口偏移
   */
  function applyWindowOffset (offsetX, offsetY) {
    const bounds = getAnimationBounds()
    const target = targetPosition || { x: Math.round(bounds.x), y: Math.round(bounds.y) }
    const nextPosition = {
      x: target.x + Math.round(offsetX),
      y: target.y + Math.round(offsetY)
    }
    moveNativeWindow(nextPosition)
  }

  /**
   * 移动原生窗口
   */
  function moveNativeWindow (position) {
    if (!browserWindow || browserWindow.isDestroyed()) return
    browserWindow.setPosition(position.x, position.y, false)
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
   * GPU 是否可用
   */
  function isGpuAvailable () {
    // Electron 渲染进程默认启用 GPU 加速
    return true
  }

  return {
    nextGeneration,
    setOffsetOverride,
    prepareVisualState,
    animate,
    stop,
    get generation () { return generation }
  }
}

module.exports = {
  DEFAULT_CONFIG,
  createAdaptiveConfig,
  createAdaptiveTrayAnimationController
}