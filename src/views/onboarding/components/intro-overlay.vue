<!--
  入场动画遮罩
  职责：首次进入引导流程时展示品牌 logo 三层飞入 + 标题/正文淡入动画
  动画时序对齐：3 层 logo 依次飞入（340/320/320ms）→ 标题/正文淡入 → 1.5s 停留 → 全部淡出
-->
<template>
  <transition name="intro-fade">
    <div v-if="visible" class="intro-overlay">
      <!-- 品牌 logo 三层堆叠 -->
      <div class="intro-mark" :style="markStyle">
        <div
          v-for="(layer, index) in layers"
          :key="index"
          class="intro-mark__layer"
          :style="layer.style"
        />
      </div>

      <!-- 标题与正文 -->
      <h1 class="intro-title" :style="titleStyle">{{ title }}</h1>
      <p class="intro-body" :style="bodyStyle">{{ body }}</p>

      <!-- 品牌光泽扫光 -->
      <div class="intro-shine" :style="shineStyle" />
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  // 是否显示
  visible: { type: Boolean, default: true },
  // 标题文案
  title: { type: String, default: '欢迎使用 Starst Desk' },
  // 正文文案
  body: { type: String, default: 'Windows 11 桌面助手 · 让桌面更高效' }
})

const emit = defineEmits(['completed'])

const layerColors = [
  { bg: '#0B64BF', border: 'rgba(255,255,255,0.26)' },
  { bg: '#1691E8', border: 'rgba(255,255,255,0.26)' },
  { bg: '#58AAFE', border: 'rgba(255,255,255,0.26)' }
]

// 各层动画进度（0=初始偏移+透明，1=就位+不透明）
const layerProgress = ref([0, 0, 0])
const titleProgress = ref(0)
const bodyProgress = ref(0)
const shineOffset = ref(-44)

// logo 容器变换
const markStyle = computed(() => ({
  opacity: Math.max(...layerProgress.value) > 0 ? 1 : 0,
  transform: `scale(${0.96 + 0.04 * Math.max(...layerProgress.value)})`
}))

// 标题变换
const titleStyle = computed(() => ({
  opacity: titleProgress.value,
  transform: `translateY(${(1 - titleProgress.value) * 8}px)`
}))

// 正文变换
const bodyStyle = computed(() => ({
  opacity: bodyProgress.value,
  transform: `translateY(${(1 - bodyProgress.value) * 8}px)`
}))

// 光泽扫光位置
const shineStyle = computed(() => ({
  transform: `translateX(${shineOffset.value}px)`
}))

// 三层 logo 各自的样式（含偏移、缩放、透明度）
const layers = computed(() =>
  layerColors.map((color, index) => {
    const progress = layerProgress.value[index]
    const initialOffsets = [
      { x: -36, y: -18, scale: 0.9 },
      { x: -14, y: -8, scale: 0.93 },
      { x: 28, y: 18, scale: 0.95 }
    ]
    const init = initialOffsets[index]
    return {
      style: {
        background: color.bg,
        borderColor: color.border,
        opacity: progress,
        transform: `translate(${init.x * (1 - progress)}px, ${init.y * (1 - progress)}px) scale(${init.scale + (1 - init.scale) * progress}) skewY(-12deg)`
      }
    }
  })
)

// 动画定时器引用
let timers = []
let shineRaf = null

/**
 * 线性插值动画
 * @param {Function} setter 目标值设置函数
 * @param {number} from 起始值
 * @param {number} to 结束值
 * @param {number} duration 持续时间（ms）
 * @param {number} delay 延迟（ms）
 * @param {Function} [easing] 缓动函数
 * @returns {Promise<void>}
 */
function animate (setter, from, to, duration, delay = 0, easing = easeInOutCubic) {
  return new Promise(resolve => {
    const startTimer = setTimeout(() => {
      const startTime = performance.now()
      function tick (now) {
        const elapsed = now - startTime
        const t = Math.min(1, elapsed / duration)
        setter(from + (to - from) * easing(t))
        if (t < 1) {
          requestAnimationFrame(tick)
        } else {
          resolve()
        }
      }
      requestAnimationFrame(tick)
    }, delay)
    timers.push(startTimer)
  })
}

// 缓动函数：cubic ease in-out
function easeInOutCubic (t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * 运行完整入场动画序列
 */
async function runSequence () {
  // 清理上一次动画
  cleanup()

  // 重置初始状态
  layerProgress.value = [0, 0, 0]
  titleProgress.value = 0
  bodyProgress.value = 0

  // 三层 logo 依次飞入（340/320/320ms，间隔 60ms）
  await animate(v => { layerProgress.value[0] = v }, 0, 1, 340)
  await animate(v => { layerProgress.value[1] = v }, 0, 1, 320, 60)
  await animate(v => { layerProgress.value[2] = v }, 0, 1, 320, 60)

  // 标题与正文淡入（220/200ms）
  await animate(v => { titleProgress.value = v }, 0, 1, 220)
  await animate(v => { bodyProgress.value = v }, 0, 1, 200)

  // 停留 1.5s
  await new Promise(resolve => {
    const t = setTimeout(resolve, 1500)
    timers.push(t)
  })

  // 全部淡出
  await Promise.all([
    animate(v => { titleProgress.value = v }, 1, 0, 260),
    animate(v => { bodyProgress.value = v }, 1, 0, 240),
    animate(v => { layerProgress.value = [v, v, v] }, 1, 0, 480)
  ])

  emit('completed')
}

/**
 * 启动品牌光泽扫光循环
 */
function startShineLoop () {
  let startTime = null
  function tick (now) {
    if (startTime === null) startTime = now
    const cycle = 2150 // 700ms 延迟 + 1450ms 动画
    const elapsed = (now - startTime) % cycle
    if (elapsed >= 700) {
      const t = (elapsed - 700) / 1450
      shineOffset.value = -44 + 110 * easeInOutCubic(t)
    } else {
      shineOffset.value = -44
    }
    shineRaf = requestAnimationFrame(tick)
  }
  shineRaf = requestAnimationFrame(tick)
}

/**
 * 清理所有动画定时器
 */
function cleanup () {
  timers.forEach(clearTimeout)
  timers = []
  if (shineRaf !== null) {
    cancelAnimationFrame(shineRaf)
    shineRaf = null
  }
}

// 监听 visible 变化：显示时启动动画
watch(
  () => props.visible,
  async (val) => {
    if (val) {
      startShineLoop()
      await runSequence()
    } else {
      cleanup()
    }
  },
  { immediate: true }
)

onBeforeUnmount(cleanup)
</script>

<style scoped lang="scss">
.intro-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 100;
  background: var(--app-bg-primary, #ffffff);
  overflow: hidden;
}

// 品牌 logo 三层堆叠容器
.intro-mark {
  position: relative;
  width: 170px;
  height: 170px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.3s ease;
}

.intro-mark__layer {
  position: absolute;
  width: 108px;
  height: 102px;
  border-radius: 18px;
  border: 1px solid;
  &:nth-child(1) { left: 14px; top: 14px; }
  &:nth-child(2) { left: 39px; top: 34px; }
  &:nth-child(3) { left: 64px; top: 54px; }
  transform-origin: center;
  will-change: transform, opacity;
}

.intro-title {
  font-size: 32px;
  font-weight: 700;
  color: var(--app-text-primary, #303133);
  margin: 0;
  will-change: transform, opacity;
}

.intro-body {
  font-size: 16px;
  color: var(--app-text-secondary, #909399);
  margin: 0;
  will-change: transform, opacity;
}

// 品牌光泽扫光
.intro-shine {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 40px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.15),
    transparent
  );
  pointer-events: none;
  will-change: transform;
}

// 淡入淡出过渡
.intro-fade-enter-active,
.intro-fade-leave-active {
  transition: opacity 0.22s ease;
}

.intro-fade-enter-from,
.intro-fade-leave-to {
  opacity: 0;
}

// 暗色主题
html.dark {
  .intro-overlay {
    background: var(--app-bg-primary, #1d1e1f);
  }

  .intro-shine {
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.08),
      transparent
    );
  }
}
</style>