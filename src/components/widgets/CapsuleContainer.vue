<!--
  胶囊容器组件
  职责：根据 isCapsule 切换折叠/展开形态，包裹小部件内容
  Props:
    - isCapsule: 是否为胶囊形态
    - collapseBehavior: 折叠行为 'expanded' | 'click' | 'smart'
      - expanded: 不响应（保持展开）
      - click: 点击切换折叠/展开
      - smart: 悬停展开/离开折叠
    - widgetType: 小部件类型（用于 IPC 通知主进程调整窗口大小）
    - contentMode: 胶囊内容模式 'minimal' | 'summary' | 'smart'
    - animationSpeed: 动画速度 'veryFast'|'fast'|'standard'|'relaxed'|'slow'
    - slideDirection: 滑动方向 'none'|'left'|'right'|'up'|'down'
    - easingIntensity: 缓动强度 'none'|'light'|'standard'|'strong'
    - segmentedStyle: 分段样式 'button' | 'pivot'
    - segmentedEqual: 是否等宽分段
    - segmentedItems: 分段项列表 [{ key, label }]
    - activeSegment: 当前激活分段 key
    - textSize: 文字大小（用于分段度量计算）
  Slots:
    - capsule: 胶囊形态内容（折叠时显示，接收 contentMode 作用域参数）
    - expanded: 展开形态内容（展开时显示，接收 contentMode 作用域参数）
  Emits:
    - toggle: 胶囊状态切换事件
    - segment-change: 分段切换事件
    - 胶囊圆角 8px（大圆角）
    - 折叠/展开过渡 167ms（fast）
    - 胶囊背景使用层填充颜色（半透明）
    - 胶囊描边使用层描边颜色
    - minimal 宽度 172 / summary 宽度 248 高度 42 / smart 宽度 272 高度 52
-->
<template>
  <div
    class="capsule-container"
    :class="{
      'is-capsule': isCapsule,
      'is-expanded': !isCapsule,
      [`content-mode-${contentMode}`]: isCapsule,
      'is-warming-up': isWarmingUp,
      'is-animating': isAnimating,
      'is-expanding': isExpanding,
      'is-collapsing': isCollapsing,
      'is-visible-idle': isVisibleIdle,
      'is-hidden-idle': isHiddenIdle,
      [`widget-animate--${resolvedEffect}--${isCapsule ? 'exit' : 'enter'}`]: shouldAnimate
    }"
    :style="animationStyle"
    @click="handleClick"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <div
      v-if="isCapsule && segmented && segmentedItems.length > 0"
      class="widget-segmented"
      :class="[`widget-segmented--${segmentedStyle}`, { 'widget-segmented--equal': segmentedEqual }]"
    >
      <button
        v-for="item in segmentedItems"
        :key="item.key"
        class="widget-segmented__item"
        :class="{ 'is-active': item.key === activeSegment }"
        :style="segmentedItemStyle"
        @click.stop="handleSegmentClick(item.key)"
      >
        {{ item.label }}
      </button>
    </div>

    <!-- 胶囊形态：折叠显示 -->
    <div v-if="isCapsule" class="capsule-container__capsule">
      <slot name="capsule" :content-mode="contentMode" />
    </div>

    <!-- 展开形态：完整内容 -->
    <div v-else class="capsule-container__expanded">
      <slot name="expanded" :content-mode="contentMode" />
    </div>

    <span v-if="perfMark" class="widget-perf-mark">{{ perfMark }}</span>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

// ============================================================
// 速度档位对应持续时间：veryFast 120 / fast 220 / standard 240 / relaxed 520 / slow 680
// 缓动使用三次贝塞尔曲线，牛顿迭代求解
// ============================================================

// 动画效果枚举
const ANIMATION_EFFECTS = [
  'none', 'fade', 'slideRight', 'slideLeft', 'slideUp', 'slideDown',
  'scaleFade', 'slideFade', 'zoom', 'slideUpFade', 'slideDownFade',
  'slideLeftFade', 'slideRightFade', 'scaleSlide'
]

// 动画速度枚举
const ANIMATION_SPEEDS = ['veryFast', 'fast', 'standard', 'relaxed', 'slow']

// 滑动方向枚举
const SLIDE_DIRECTIONS = ['none', 'left', 'right', 'up', 'down']

// 缓动强度枚举
const EASING_INTENSITIES = ['none', 'light', 'standard', 'strong']

// 速度 → 持续时间（毫秒）
const SPEED_DURATION_MS = {
  veryFast: 120,
  fast: 220,
  standard: 240,
  relaxed: 520,
  slow: 680
}

const DEFAULT_DURATION_MS = 240

// 归一化动画效果，非法值回退为 slideFade
function normalizeEffect (effect) {
  return ANIMATION_EFFECTS.includes(effect) ? effect : 'slideFade'
}

// 归一化动画速度，非法值回退为 standard
function normalizeSpeed (speed) {
  return ANIMATION_SPEEDS.includes(speed) ? speed : 'standard'
}

// 归一化滑动方向，非法值回退为 right
function normalizeSlideDirection (direction) {
  return SLIDE_DIRECTIONS.includes(direction) ? direction : 'right'
}

// 归一化缓动强度，非法值回退为 standard
function normalizeEasingIntensity (intensity) {
  return EASING_INTENSITIES.includes(intensity) ? intensity : 'standard'
}

// 根据速度获取持续时间（毫秒）
function getDurationMs (speed) {
  return SPEED_DURATION_MS[normalizeSpeed(speed)] ?? DEFAULT_DURATION_MS
}

// 判断效果是否使用分组偏移
// none/fade/scaleFade/zoom 不使用分组偏移
function usesGroupOffset (effect) {
  const normalized = normalizeEffect(effect)
  return !['none', 'fade', 'scaleFade', 'zoom'].includes(normalized)
}

// 三次贝塞尔缓动：牛顿迭代求解 x(t)=progress，返回 y(t)
function cubicBezierEase (t, x1, y1, x2, y2) {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  let tGuess = t
  for (let i = 0; i < 8; i++) {
    const x = ((ax * tGuess + bx) * tGuess + cx) * tGuess - t
    if (Math.abs(x) < 1e-7) break
    const dx = (3 * ax * tGuess + 2 * bx) * tGuess + cx
    if (Math.abs(dx) < 1e-10) break
    tGuess -= x / dx
  }
  return ((ay * tGuess + by) * tGuess + cy) * tGuess
}

// 缓动函数：根据进度、强度和方向（显示/隐藏）返回缓动后的进度
function ease (progress, intensity, isShowing) {
  const i = normalizeEasingIntensity(intensity)
  if (i === 'none') return progress
  if (isShowing) {
    switch (i) {
      case 'light': return cubicBezierEase(progress, 0.25, 0.9, 0.25, 1.0)
      case 'strong': return cubicBezierEase(progress, 0.05, 1.1, 0.15, 1.0)
      default: return cubicBezierEase(progress, 0.16, 1.0, 0.3, 1.0)
    }
  }
  switch (i) {
    case 'light': return cubicBezierEase(progress, 0.6, 0.1, 0.9, 0.3)
    case 'strong': return cubicBezierEase(progress, 0.7, 0.0, 0.95, -0.1)
    default: return cubicBezierEase(progress, 0.7, 0.0, 0.84, 0.0)
  }
}

// 根据方向获取偏移量 (x, y)
function getDirectionalOffset (direction, offsets) {
  let base = Math.max(Math.max(offsets.left, offsets.right), Math.max(offsets.up, offsets.down))
  if (base < 1) base = 200
  switch (normalizeSlideDirection(direction)) {
    case 'left': return { x: -base, y: 0 }
    case 'right': return { x: base, y: 0 }
    case 'up': return { x: 0, y: -base }
    case 'down': return { x: 0, y: base }
    default: return { x: base, y: 0 }
  }
}

// ============================================================
// 根据硬件性能级别（low/medium/high）和屏幕刷新率生成自适应配置
// 强制模式：所有硬件都使用显示器最大刷新率，不做帧率节流
// ============================================================

const HARDWARE_LEVELS = { low: 'low', medium: 'medium', high: 'high' }

// CPU 使用率阈值
const CPU_THRESHOLD_HIGH = 0.15
const CPU_THRESHOLD_MEDIUM = 0.40

// 默认刷新率
const DEFAULT_REFRESH_RATE_HZ = 60

// 检测屏幕刷新率（通过 matchMedia 近似）
function detectRefreshRate () {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return DEFAULT_REFRESH_RATE_HZ
  }
  // 高刷新率屏幕检测
  try {
    if (window.matchMedia('(update: fast)').matches) return 120
  } catch {
    // 忽略不支持的浏览器
  }
  return DEFAULT_REFRESH_RATE_HZ
}

// 测量 CPU 使用率（近似：基于 performance.memory API）
function measureCpuUsage () {
  try {
    if (typeof performance === 'undefined' || !performance.memory) {
      return 0.5 // 默认中等
    }
    const mem = performance.memory
    return Math.min(mem.usedJSHeapSize / mem.jsHeapSizeLimit, 1.0)
  } catch {
    return 0.5
  }
}

// 判断硬件性能级别
function detectHardwareLevel () {
  const cpuUsage = measureCpuUsage()
  if (cpuUsage < CPU_THRESHOLD_HIGH) return HARDWARE_LEVELS.high
  if (cpuUsage < CPU_THRESHOLD_MEDIUM) return HARDWARE_LEVELS.medium
  return HARDWARE_LEVELS.low
}

// 生成自适应配置
// 强制模式：直接以显示器刷新率为目标，不做任何节流
function generateAdaptiveConfig (level, refreshRate) {
  const baseFps = refreshRate || DEFAULT_REFRESH_RATE_HZ
  const base = {
    maxFpsHighPriority: baseFps,
    maxFpsNormal: baseFps,
    highPriorityDurationMs: 999999,
    useBatchGrouping: true,
    enableGpuTurbo: false,
    sourceRefreshRate: baseFps,
    targetRefreshRate: baseFps,
    isCrossScreen: false
  }
  switch (level) {
    case HARDWARE_LEVELS.high:
      return { ...base, batchGroupDelayMs: 5, reasoning: `MAX_PERFORMANCE_MODE: RefreshRate=${baseFps}Hz, no throttling applied` }
    case HARDWARE_LEVELS.medium:
      return { ...base, batchGroupDelayMs: 5, reasoning: `MAX_PERFORMANCE_MODE: RefreshRate=${baseFps}Hz, no performance degradation` }
    case HARDWARE_LEVELS.low:
      return { ...base, batchGroupDelayMs: 8, reasoning: `MAX_PERFORMANCE_MODE: RefreshRate=${baseFps}Hz, stability prioritized but no FPS drop` }
    default:
      return { ...base, batchGroupDelayMs: 5, reasoning: 'Unknown level' }
  }
}

// ============================================================
// 可见空闲：有可见小部件但无任何交互时回收托管堆内存
// 隐藏空闲：无可见小部件时裁剪工作集
// ============================================================

const MEMORY_THRESHOLDS = {
  visibleIdleManagedHeap: 96 * 1024 * 1024,       // 96 MB
  visibleIdleWorkingSet: 300 * 1024 * 1024,       // 300 MB
  visibleIdlePrivateBytes: 320 * 1024 * 1024,     // 320 MB
  visibleIdleMinAllocation: 32 * 1024 * 1024,     // 32 MB
  hiddenIdleWorkingSetTrim: 220 * 1024 * 1024     // 220 MB
}

// 判断是否为可见空闲候选：有可见小部件 + 无任何交互
function isVisibleIdleCandidate (snapshot) {
  return snapshot.hasVisibleWidgets &&
    !snapshot.isWidgetInteractionActive &&
    !snapshot.isSettingsOpen &&
    !snapshot.isOnboardingOpen &&
    !snapshot.isSearchPopupVisible &&
    !snapshot.isSelfForeground &&
    !snapshot.isPointerOverSelf
}

// 判断能否裁剪工作集：无可见小部件 + 无任何交互
function canTrimWorkingSet (snapshot) {
  return !snapshot.hasVisibleWidgets &&
    !snapshot.isWidgetInteractionActive &&
    !snapshot.isSettingsOpen &&
    !snapshot.isOnboardingOpen &&
    !snapshot.isSearchPopupVisible &&
    !snapshot.isSelfForeground &&
    !snapshot.isPointerOverSelf
}

// 判断能否运行搜索索引协调
function canRunSearchIndexReconciliation (snapshot) {
  return !snapshot.isWidgetInteractionActive &&
    !snapshot.isSettingsOpen &&
    !snapshot.isOnboardingOpen &&
    !snapshot.isSearchPopupVisible &&
    !snapshot.isSelfForeground &&
    !snapshot.isPointerOverSelf
}

// 判断是否应裁剪隐藏空闲工作集
function shouldTrimHiddenIdleWorkingSet (snapshot, isSearchIndexing, workingSetBytes) {
  return canTrimWorkingSet(snapshot) &&
    !isSearchIndexing &&
    workingSetBytes >= MEMORY_THRESHOLDS.hiddenIdleWorkingSetTrim
}

// 判断是否应回收可见空闲托管内存
function shouldCollectVisibleIdleManagedMemory (
  snapshot, isSearchIndexing, managedHeapBytes, workingSetBytes,
  privateBytes, allocatedSinceLastCollection, hasCompletedVisibleIdleCollection
) {
  if (snapshot.isWidgetInteractionActive ||
      snapshot.isSettingsOpen ||
      snapshot.isOnboardingOpen ||
      snapshot.isSearchPopupVisible ||
      snapshot.isSelfForeground ||
      snapshot.isPointerOverSelf ||
      isSearchIndexing) {
    return false
  }
  const aboveThreshold =
    managedHeapBytes >= MEMORY_THRESHOLDS.visibleIdleManagedHeap ||
    workingSetBytes >= MEMORY_THRESHOLDS.visibleIdleWorkingSet ||
    privateBytes >= MEMORY_THRESHOLDS.visibleIdlePrivateBytes
  if (!aboveThreshold) return false
  // 首次始终允许一次延迟回收，后续需要足够的分配增长
  return !hasCompletedVisibleIdleCollection ||
    allocatedSinceLastCollection >= MEMORY_THRESHOLDS.visibleIdleMinAllocation
}

// ============================================================
// 将周期性 UI 活动快照转换为确定性空闲信号
// ============================================================

function createVisibleIdleTracker (requiredIdleDurationMs, maintenanceCooldownMs) {
  if (requiredIdleDurationMs <= 0) {
    throw new Error('requiredIdleDuration must be positive')
  }
  if (maintenanceCooldownMs < requiredIdleDurationMs) {
    throw new Error('maintenanceCooldown must be >= requiredIdleDuration')
  }
  let idleSince = null
  let lastMaintenanceAt = null

  return {
    // 观察当前时刻是否空闲且符合维护条件
    observe (now, isEligible) {
      if (!isEligible) {
        idleSince = null
        return false
      }
      if (idleSince === null) idleSince = now
      if (now - idleSince < requiredIdleDurationMs) return false
      if (lastMaintenanceAt !== null && now - lastMaintenanceAt < maintenanceCooldownMs) return false
      lastMaintenanceAt = now
      return true
    },
    // 重置空闲计时
    reset () {
      idleSince = null
    }
  }
}

// ============================================================
// ============================================================

const PERF_LOG_ENV_KEY = 'DESKBOX_PERF_LOG'

function isPerfLogEnabled () {
  try {
    const val = import.meta.env?.[PERF_LOG_ENV_KEY]
    if (!val) return false
    const norm = String(val).trim().toLowerCase()
    return ['1', 'true', 'yes', 'on', 'enabled'].includes(norm)
  } catch {
    return false
  }
}

const performanceLogger = {
  isEnabled: isPerfLogEnabled(),
  marks: [],
  // 测量操作耗时，返回结束函数
  measure (operation, details) {
    if (!this.isEnabled) return () => {}
    const start = performance.now()
    return () => {
      const elapsed = performance.now() - start
      this.marks.push({ operation, elapsed, details, time: Date.now() })
    }
  },
  // 标记性能事件
  mark (operation, details) {
    if (!this.isEnabled) return
    this.marks.push({ operation, details, time: Date.now() })
  },
  // 采样内存快照
  sampleMemory (reason) {
    if (!this.isEnabled) return null
    try {
      const mem = performance.memory
      const sample = {
        usedJSHeapSize: mem?.usedJSHeapSize ?? 0,
        totalJSHeapSize: mem?.totalJSHeapSize ?? 0,
        jsHeapSizeLimit: mem?.jsHeapSizeLimit ?? 0,
        reason,
        time: Date.now()
      }
      this.marks.push({ operation: 'MemorySample', details: sample, time: sample.time })
      return sample
    } catch {
      return null
    }
  }
}

// ============================================================
// 基于 requestAnimationFrame 共享帧回调，最大并发边界转换 4
// ============================================================

const MAX_CONCURRENT_BOUNDS_TRANSITIONS = 4

function createAnimationCoordinator () {
  const frameCallbacks = new Map()
  const boundsTransitionIds = new Set()
  let nextId = 0
  let rafId = null

  // 判断是否有边界转换容量
  function shouldAnimateBounds () {
    return boundsTransitionIds.size < MAX_CONCURRENT_BOUNDS_TRANSITIONS
  }

  // 帧回调调度
  function tick () {
    const callbacks = Array.from(frameCallbacks.entries())
    for (const [id, callback] of callbacks) {
      if (!frameCallbacks.has(id)) continue
      try {
        callback()
      } catch (e) {
        if (performanceLogger.isEnabled) {
          performanceLogger.mark('CompactAnimationClock', `Frame callback failed: ${e.message}`)
        }
      }
    }
    if (frameCallbacks.size > 0) {
      rafId = requestAnimationFrame(tick)
    } else {
      rafId = null
    }
  }

  // 启动帧循环
  function startLoop () {
    if (rafId === null && typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(tick)
    }
  }

  // 停止帧循环
  function stopLoop () {
    if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  // 注册帧回调，返回注销函数
  function register (callback, isBoundsTransition = false) {
    const id = ++nextId
    frameCallbacks.set(id, callback)
    if (isBoundsTransition) boundsTransitionIds.add(id)
    startLoop()
    return () => {
      frameCallbacks.delete(id)
      boundsTransitionIds.delete(id)
      if (frameCallbacks.size === 0) stopLoop()
    }
  }

  return {
    register,
    // 注册边界转换帧回调（受并发限制）
    registerBoundsTransition (callback) {
      if (!shouldAnimateBounds()) {
        throw new Error('No compact bounds-transition animation slot is available.')
      }
      return register(callback, true)
    },
    hasBoundsTransitionCapacity: shouldAnimateBounds,
    get activeCount () { return frameCallbacks.size }
  }
}

// ============================================================
// 追踪帧率、帧数、估算丢帧、最大帧间隔
// ============================================================

function createFrameTracker (refreshRateHz) {
  const normalizedHz = Math.max(0, refreshRateHz) || DEFAULT_REFRESH_RATE_HZ
  let startedTimestamp = 0
  let lastFrameTimestamp = 0
  let maximumFrameIntervalMs = 0
  let frameCount = 0
  let estimatedDroppedFrames = 0

  return {
    refreshRateHz: normalizedHz,
    // 开始追踪
    start (timestamp) {
      startedTimestamp = timestamp
      lastFrameTimestamp = timestamp
    },
    // 记录一帧
    recordFrame (timestamp) {
      if (timestamp <= lastFrameTimestamp) return
      const intervalMs = timestamp - lastFrameTimestamp
      lastFrameTimestamp = timestamp
      frameCount++
      maximumFrameIntervalMs = Math.max(maximumFrameIntervalMs, intervalMs)
      const frameBudgetMs = 1000 / normalizedHz
      if (intervalMs > frameBudgetMs * 1.5) {
        estimatedDroppedFrames += Math.max(1, Math.round(intervalMs / frameBudgetMs) - 1)
      }
    },
    // 完成追踪，返回摘要
    complete (timestamp) {
      const completed = Math.max(timestamp, startedTimestamp)
      return {
        refreshRateHz: normalizedHz,
        frameCount,
        estimatedDroppedFrames,
        maximumFrameIntervalMilliseconds: maximumFrameIntervalMs,
        elapsedMilliseconds: completed - startedTimestamp,
        frameBudgetMilliseconds: 1000 / Math.max(1, normalizedHz)
      }
    }
  }
}

// ============================================================
// 判断展开是否就绪、能否运行预热
// ============================================================

// 判断展开是否就绪：已预热 + 预热 epoch 与内存清理 epoch 一致
function isExpansionReady (isWarmed, warmedEpoch, memoryCleanupEpoch) {
  return isWarmed && warmedEpoch === memoryCleanupEpoch
}

// 判断能否运行预热：已初始化折叠 + 已折叠 + 未预热 + 未关闭 + 无动画 + 无悬停 + 无交互 + 可见 + 内容就绪 + 应用空闲
function canRunWarmup (snapshot) {
  return snapshot.isCollapseInitialized &&
    snapshot.isCollapsed &&
    !snapshot.isExpansionWarmed &&
    !snapshot.isClosing &&
    !snapshot.isAnimationActive &&
    !snapshot.isPointerOverWidget &&
    !snapshot.hasActiveInteraction &&
    snapshot.isWindowVisible &&
    snapshot.isContentReady &&
    snapshot.isApplicationIdle
}

// ============================================================
// 不同部件类型的初始延迟（毫秒）
// ============================================================

const WARMUP_DELAY_MS = {
  quickCapture: 220,
  weather: 260,
  search: 300,
  music: 340,
  todo: 380,
  file: 420,
  systemMonitor: 460
}
const DEFAULT_WARMUP_DELAY_MS = 500

// 获取预热初始延迟
function getWarmupDelay (kind) {
  return WARMUP_DELAY_MS[kind] ?? DEFAULT_WARMUP_DELAY_MS
}

// ============================================================
// 最小安全宽度 96px：避免父级瞬时压缩导致子项负宽度
// ============================================================

const MIN_SAFE_WIDTH = 96
const MIN_TEXT_SIZE = 12

// 分段度量：根据文字大小计算高度和 padding
//   height = clamp(round(textSize + 17), 28, 34)
//   horizontal = clamp(round(textSize * 0.32), 3, 5)
//   vertical = clamp(round(textSize * 0.18), 2, 4)
function createSegmentedMetrics (textSize) {
  const normalized = Math.max(MIN_TEXT_SIZE, textSize)
  const height = Math.min(34, Math.max(28, Math.round(normalized + 17)))
  const horizontal = Math.min(5, Math.max(3, Math.round(normalized * 0.32)))
  const vertical = Math.min(4, Math.max(2, Math.round(normalized * 0.18)))
  return {
    textSize: normalized,
    height,
    padding: { left: horizontal, top: vertical, right: horizontal, bottom: vertical + 1 }
  }
}

// ============================================================
// 组件 Props / Emits
// ============================================================

const props = defineProps({
  // 是否为胶囊形态
  isCapsule: {
    type: Boolean,
    default: false
  },
  // 折叠行为：expanded 不折叠 / click 点击切换 / smart 鼠标离开自动折叠
  collapseBehavior: {
    type: String,
    default: 'click',
    validator: (val) => ['expanded', 'click', 'smart'].includes(val)
  },
  // 小部件类型（用于 IPC 通知主进程调整窗口大小 + 预热延迟）
  widgetType: {
    type: String,
    default: ''
  },
  // 胶囊内容模式：minimal 最紧凑 / summary 图标+数字 / smart 图标+数字+辅助信息
  contentMode: {
    type: String,
    default: 'summary',
    validator: (val) => ['minimal', 'summary', 'smart'].includes(val)
  },
  animationEffect: {
    type: String,
    default: 'slideFade'
  },
  // 动画速度
  animationSpeed: {
    type: String,
    default: 'standard'
  },
  // 滑动方向
  slideDirection: {
    type: String,
    default: 'right'
  },
  // 缓动强度
  easingIntensity: {
    type: String,
    default: 'standard'
  },
  segmented: {
    type: Boolean,
    default: false
  },
  // 分段样式：button 按钮风格 / pivot 下划线风格
  segmentedStyle: {
    type: String,
    default: 'button',
    validator: (val) => ['button', 'pivot'].includes(val)
  },
  // 是否等宽分段
  segmentedEqual: {
    type: Boolean,
    default: false
  },
  // 分段项列表 [{ key, label }]
  segmentedItems: {
    type: Array,
    default: () => []
  },
  // 当前激活分段 key
  activeSegment: {
    type: String,
    default: ''
  },
  // 文字大小（用于分段度量计算）
  textSize: {
    type: Number,
    default: 13
  },
  hardwareAware: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['toggle', 'segment-change'])

// ============================================================
// 原有交互逻辑：点击/悬停切换
// ============================================================

// 防抖：防止双击导致状态切换两次（折叠→展开），300ms 内忽略第二次切换
let lastToggleTime = 0
const TOGGLE_DEBOUNCE_MS = 300

// Smart 模式定时器
let enterTimer = null
let leaveTimer = null
const SMART_ENTER_DELAY = 200  // 鼠标进入延迟展开（防误触）
const SMART_LEAVE_DELAY = 600  // 鼠标离开延迟折叠（防止快速来回）

/**
 * 点击事件处理
 * click 行为下仅胶囊形态响应点击展开：
 *   - 胶囊形态 → 点击展开
 *   - expanded: 不响应（保持展开）
 *   - smart: 不响应点击（由 mouseenter/mouseleave 控制）
 *   Click 模式没有点击内容区域折叠的逻辑，折叠只能通过折叠按钮触发
 */
function handleClick (event) {
  // 仅 click 行为 + 胶囊形态下响应点击展开
  if (props.collapseBehavior !== 'click') return
  if (!props.isCapsule) return  // 展开形态不响应点击
  const now = Date.now()
  if (now - lastToggleTime < TOGGLE_DEBOUNCE_MS) return
  lastToggleTime = now
  emit('toggle', false)  // 胶囊 → 展开
}

/**
 * 鼠标进入事件处理
 * 仅 smart 行为响应：延迟展开（200ms 防误触）
 */
function handleMouseEnter () {
  // 清除可能存在的离开定时器
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }

  if (props.collapseBehavior === 'smart' && props.isCapsule) {
    // Smart 模式：延迟展开
    enterTimer = setTimeout(() => {
      enterTimer = null
      if (props.isCapsule) {
        emit('toggle', false)
      }
    }, SMART_ENTER_DELAY)
  }
}

/**
 * 鼠标离开事件处理
 * 仅 smart 行为响应：延迟折叠（600ms 防止快速来回）
 */
function handleMouseLeave () {
  // 清除可能存在的进入定时器
  if (enterTimer) {
    clearTimeout(enterTimer)
    enterTimer = null
  }

  if (props.collapseBehavior === 'smart' && !props.isCapsule) {
    // Smart 模式：延迟折叠
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      if (!props.isCapsule) {
        emit('toggle', true)
      }
    }, SMART_LEAVE_DELAY)
  }
}

// ============================================================
// 动画设置计算属性
// ============================================================

// 归一化后的动画效果
const resolvedEffect = computed(() => {
  const effect = normalizeEffect(props.animationEffect)
  // slideFade 效果 + none 方向时默认为 right
  if (effect === 'slideFade' && normalizeSlideDirection(props.slideDirection) === 'none') {
    return 'slideRightFade'
  }
  return effect
})

// 动画持续时间（毫秒）
const animationDurationMs = computed(() => getDurationMs(props.animationSpeed))

// 是否应播放动画
const shouldAnimate = computed(() => resolvedEffect.value !== 'none')

// 动画内联样式：设置 CSS 变量
const animationStyle = computed(() => {
  if (!shouldAnimate.value) return {}
  return {
    '--widget-animation-duration': `${animationDurationMs.value}ms`
  }
})

// ============================================================
// 硬件自适应
// ============================================================

const hardwareLevel = ref(HARDWARE_LEVELS.medium)
const adaptiveConfig = ref(null)

onMounted(() => {
  if (props.hardwareAware) {
    // 检测硬件级别和屏幕刷新率
    hardwareLevel.value = detectHardwareLevel()
    const refreshRate = detectRefreshRate()
    adaptiveConfig.value = generateAdaptiveConfig(hardwareLevel.value, refreshRate)

    // 应用硬件级别到 html 元素，触发 CSS 变量切换
    if (typeof document !== 'undefined') {
      document.documentElement.classList.add(`widget-hardware-${hardwareLevel.value}`)
    }

    if (performanceLogger.isEnabled) {
      performanceLogger.mark('HardwareAdaptive', adaptiveConfig.value.reasoning)
    }
  }
})

// ============================================================
// 分段布局计算属性
// ============================================================

// 分段度量：根据文字大小计算高度和 padding
const segmentedMetrics = computed(() => createSegmentedMetrics(props.textSize))

// 分段项样式：自然宽度模式下应用度量计算的 padding 和 minHeight
const segmentedItemStyle = computed(() => {
  if (!props.segmented || props.segmentedEqual) return {}
  const m = segmentedMetrics.value
  return {
    minHeight: `${m.height}px`,
    padding: `${m.padding.top}px ${m.padding.right}px ${m.padding.bottom}px ${m.padding.left}px`
  }
})

// 分段点击处理
function handleSegmentClick (key) {
  emit('segment-change', key)
}

// ============================================================
// ============================================================

const isWarmingUp = ref(false)
let warmupTimer = null

// 监听胶囊状态变化：展开时启动预热
watch(() => props.isCapsule, (newVal) => {
  // 展开时（非胶囊形态）启动预热
  if (!newVal && props.widgetType) {
    const delay = getWarmupDelay(props.widgetType)
    isWarmingUp.value = true
    if (warmupTimer) clearTimeout(warmupTimer)
    warmupTimer = setTimeout(() => {
      isWarmingUp.value = false
      warmupTimer = null
    }, delay)
  } else {
    isWarmingUp.value = false
  }
}, { immediate: true })

// ============================================================
// 胶囊动画进行中状态
// ============================================================

const isAnimating = ref(false)
let animatingTimer = null

// 监听胶囊状态变化：播放动画时标记进行中
watch(() => props.isCapsule, () => {
  if (shouldAnimate.value) {
    isAnimating.value = true
    if (animatingTimer) clearTimeout(animatingTimer)
    animatingTimer = setTimeout(() => {
      isAnimating.value = false
      animatingTimer = null
    }, animationDurationMs.value)
  }
})

// ============================================================
// 胶囊展开/折叠过渡状态
// is-expanding：胶囊 → 展开形态过渡中（width/height/opacity 增长）
// is-collapsing：展开 → 胶囊形态过渡中（width/height/opacity 收缩）
// 复用 animationDurationMs 控制过渡时长，与 isAnimating 解耦以独立控制 CSS transition
// ============================================================

const isExpanding = ref(false)
const isCollapsing = ref(false)
let expandingTimer = null
let collapsingTimer = null

// 监听胶囊状态变化：触发展开/折叠过渡 class
// isCapsule: true → false 表示展开（胶囊 → 完整）
// isCapsule: false → true 表示折叠（完整 → 胶囊）
watch(() => props.isCapsule, (newVal, oldVal) => {
  // 仅在状态实际变化时触发过渡
  if (newVal === oldVal) return
  if (!newVal) {
    // 展开：标记 is-expanding，过渡结束后清除
    isCollapsing.value = false
    if (collapsingTimer) {
      clearTimeout(collapsingTimer)
      collapsingTimer = null
    }
    isExpanding.value = true
    if (expandingTimer) clearTimeout(expandingTimer)
    expandingTimer = setTimeout(() => {
      isExpanding.value = false
      expandingTimer = null
    }, animationDurationMs.value)
  } else {
    // 折叠：标记 is-collapsing，过渡结束后清除
    isExpanding.value = false
    if (expandingTimer) {
      clearTimeout(expandingTimer)
      expandingTimer = null
    }
    isCollapsing.value = true
    if (collapsingTimer) clearTimeout(collapsingTimer)
    collapsingTimer = setTimeout(() => {
      isCollapsing.value = false
      collapsingTimer = null
    }, animationDurationMs.value)
  }
})

// ============================================================
// ============================================================

const isVisibleIdle = ref(false)
const isHiddenIdle = ref(false)

// 创建可见空闲追踪器：空闲 30 秒后触发，冷却 5 分钟
const idleTracker = createVisibleIdleTracker(30000, 300000)

// 更新内存清理状态
function updateMemoryCleanupState () {
  const now = Date.now()
  // 胶囊形态（可见）+ 无交互 → 可见空闲候选
  const visibleIdleEligible = props.isCapsule && !isAnimating.value
  isVisibleIdle.value = idleTracker.observe(now, visibleIdleEligible)
  // 非胶囊形态（展开，可能离屏）→ 隐藏空闲
  isHiddenIdle.value = !props.isCapsule && !isAnimating.value
}

// 定期更新内存清理状态（每 10 秒）
let memoryCheckTimer = null
function handleMemoryCheckVisibility () {
  if (document.visibilityState === 'visible') {
    if (!memoryCheckTimer) {
      memoryCheckTimer = setInterval(updateMemoryCleanupState, 10000)
    }
  } else {
    if (memoryCheckTimer) {
      clearInterval(memoryCheckTimer)
      memoryCheckTimer = null
    }
  }
}
onMounted(() => {
  memoryCheckTimer = setInterval(updateMemoryCleanupState, 10000)
  document.addEventListener('visibilitychange', handleMemoryCheckVisibility)
})

// ============================================================
// 性能标记
// ============================================================

const perfMark = computed(() => {
  if (!performanceLogger.isEnabled) return ''
  return hardwareLevel.value
})

// ============================================================
// 组件卸载清理
// ============================================================

onUnmounted(() => {
  // 清理所有定时器
  if (warmupTimer) clearTimeout(warmupTimer)
  if (animatingTimer) clearTimeout(animatingTimer)
  if (expandingTimer) clearTimeout(expandingTimer)
  if (collapsingTimer) clearTimeout(collapsingTimer)
  if (enterTimer) clearTimeout(enterTimer)
  if (leaveTimer) clearTimeout(leaveTimer)
  if (memoryCheckTimer) clearInterval(memoryCheckTimer)
  document.removeEventListener('visibilitychange', handleMemoryCheckVisibility)

  // 移除硬件级别 class
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('widget-hardware-low')
    document.documentElement.classList.remove('widget-hardware-medium')
    document.documentElement.classList.remove('widget-hardware-high')
  }
})

// ============================================================
// 导出工具函数和常量（供外部使用）
// ============================================================

defineExpose({
  // 动画设置工具
  normalizeEffect,
  normalizeSpeed,
  normalizeSlideDirection,
  normalizeEasingIntensity,
  getDurationMs,
  usesGroupOffset,
  cubicBezierEase,
  ease,
  getDirectionalOffset,
  // 硬件自适应工具
  detectHardwareLevel,
  detectRefreshRate,
  generateAdaptiveConfig,
  // 内存清理策略
  isVisibleIdleCandidate,
  canTrimWorkingSet,
  canRunSearchIndexReconciliation,
  shouldTrimHiddenIdleWorkingSet,
  shouldCollectVisibleIdleManagedMemory,
  createVisibleIdleTracker,
  // 性能日志
  performanceLogger,
  // 动画协调器工厂
  createAnimationCoordinator,
  createFrameTracker,
  // 预热策略
  isExpansionReady,
  canRunWarmup,
  getWarmupDelay,
  // 分段布局
  createSegmentedMetrics,
  // 常量
  MEMORY_THRESHOLDS,
  MIN_SAFE_WIDTH,
  MAX_CONCURRENT_BOUNDS_TRANSITIONS,
  // 响应式状态
  hardwareLevel,
  adaptiveConfig,
  isWarmingUp,
  isAnimating,
  isExpanding,
  isCollapsing,
  isVisibleIdle,
  isHiddenIdle
})
</script>

<style scoped lang="scss">
.capsule-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: all var(--widget-motion-fast, 167ms) ease;

  // 胶囊形态：紧凑布局
  // 移除 border 避免折叠时"框暴露"视觉问题（背景差异已足够区分胶囊与桌面）
  &.is-capsule {
    cursor: pointer;
    background: var(--widget-content-bg, rgba(243, 243, 243, 1));
    border-radius: var(--widget-radius-large, 8px);
    overflow: hidden;

    &:hover {
      // 悬停时略微提亮背景
      background: var(--widget-layer-fill, rgba(255, 255, 255, 0.9));
    }
  }

  // 展开形态：完整布局
  &.is-expanded {
    cursor: default;
    background: transparent;
    border: none;
    border-radius: var(--widget-radius-large, 8px);
  }

  &__capsule,
  &__expanded {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
}

// minimal：最紧凑，仅图标，宽度 172
// summary：图标+数字/简短文字，宽度 248，高度 42
// smart：图标+数字+辅助信息，宽度 272，高度 52
// 修复（问题 a）：min-width 与 max-width 一致，确保胶囊宽度固定不被内容撑大或压缩
//   原仅 max-width 导致内容少时胶囊宽度不确定，内容多时可能溢出
.capsule-container.is-capsule {
  // summary 模式：标准胶囊高度 42px
  &.content-mode-summary {
    min-width: 248px;
    max-width: 248px;
    min-height: 42px;
    max-height: 42px;
  }

  // smart 模式：高密度胶囊高度 52px
  &.content-mode-smart {
    min-width: 272px;
    max-width: 272px;
    min-height: 52px;
    max-height: 52px;
  }

  // minimal 模式：最紧凑，高度 42px（与 summary 一致，仅宽度不同）
  &.content-mode-minimal {
    min-width: 172px;
    max-width: 172px;
    min-height: 42px;
    max-height: 42px;
  }
}

// ============================================================
// 暗色模式适配
// CSS 变量已在 widget.scss 中通过 html.dark 定义，此处补充回退值
// ============================================================
html.dark .capsule-container.is-capsule {
  background: var(--widget-content-bg, rgba(43, 43, 43, 1));

  &:hover {
    background: var(--widget-layer-fill, rgba(255, 255, 255, 0.08));
  }
}

// ============================================================
// 冷启动时延迟首次绘制，避免首帧卡顿
// ============================================================
.capsule-container.is-warming-up {
  opacity: 0;
  pointer-events: none;
}

// 胶囊动画进行中：禁用交互避免视觉干扰
.capsule-container.is-animating {
  pointer-events: none;
}

// 胶囊展开/折叠过渡状态
// 复用 --widget-animation-duration CSS 变量（由 animationStyle 计算属性注入）
// will-change 提示浏览器提前合成层，避免过渡期间抖动
.capsule-container.is-expanding,
.capsule-container.is-collapsing {
  // 过渡期间提升合成层优先级
  will-change: width, height, opacity, transform;
  // 过渡期间禁用交互，避免状态竞争
  pointer-events: none;
}

// 展开过渡：width/height/opacity 同时增长
.capsule-container.is-expanding {
  transition: width var(--widget-animation-duration, 200ms) ease,
              height var(--widget-animation-duration, 200ms) ease,
              opacity var(--widget-animation-duration, 200ms) ease,
              transform var(--widget-animation-duration, 200ms) ease;
}

// 折叠过渡：width/height/opacity 同时收缩
.capsule-container.is-collapsing {
  transition: width var(--widget-animation-duration, 200ms) ease,
              height var(--widget-animation-duration, 200ms) ease,
              opacity var(--widget-animation-duration, 200ms) ease,
              transform var(--widget-animation-duration, 200ms) ease;
}

// ============================================================
// ============================================================

// 可见空闲：胶囊可见但应用空闲，配合内存回收
.capsule-container.is-visible-idle {
  will-change: auto;
}

// 隐藏空闲：胶囊不可见时可裁剪工作集
.capsule-container.is-hidden-idle {
  content-visibility: auto;
  contain-intrinsic-size: 248px 42px;
}

// ============================================================
// 硬件自适应：低性能硬件延长过渡时长
// ============================================================
html.widget-hardware-low .capsule-container {
  transition-duration: var(--widget-motion-normal, 250ms);
}
</style>
