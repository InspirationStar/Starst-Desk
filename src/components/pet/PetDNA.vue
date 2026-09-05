<!--
  桌宠 DNA 螺旋角色组件
  职责：内联 SVG 绘制"双螺旋"结构，根据状态切换动画，
        并响应鼠标与键盘互动（视差、旋转加速、点击反馈）
  Props:
    - state: 当前状态（idle / reminding / happy / sleeping）
  设计参考：DNA 双螺旋 + 科幻 HUD
    - 两条糖-磷酸骨架链（正弦曲线，相位差 π）
    - 碱基对（A-T 青绿 / G-C 橙红）连接两条链
    - 3D 前后分层：元素按深度排序，后面先绘制
    - 旋转动画：相位随时间变化，模拟绕 Y 轴旋转
  viewBox 0 0 200 200
-->
<template>
  <div
    class="pet-dna"
    :class="`pet-dna--${state}`"
    :style="dnaStyle"
    @mouseup="handleDnaMouseUp"
    @mousedown="handleDnaMouseDown"
    @mouseenter="handleDnaEnter"
    @mousemove="handleDnaMove"
    @mouseleave="handleDnaLeave"
  >
    <svg class="pet-dna__svg" viewBox="0 0 200 200" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <!-- ====================================================== -->
      <!-- 渐变定义 -->
      <!-- ====================================================== -->
      <defs>
        <!-- 链 A 渐变（青→蓝） -->
        <linearGradient id="dnaStrandAGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4CC2FF" stop-opacity="0.9" />
          <stop offset="50%" stop-color="#2B6BD8" stop-opacity="0.8" />
          <stop offset="100%" stop-color="#4CC2FF" stop-opacity="0.9" />
        </linearGradient>
        <!-- 链 B 渐变（紫→粉） -->
        <linearGradient id="dnaStrandBGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#B18CFF" stop-opacity="0.9" />
          <stop offset="50%" stop-color="#7C4DFF" stop-opacity="0.8" />
          <stop offset="100%" stop-color="#B18CFF" stop-opacity="0.9" />
        </linearGradient>
        <!-- 光晕 -->
        <radialGradient id="dnaGlowGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#4CC2FF" stop-opacity="0.3" />
          <stop offset="60%" stop-color="#7C4DFF" stop-opacity="0.12" />
          <stop offset="100%" stop-color="#7C4DFF" stop-opacity="0" />
        </radialGradient>
        <!-- 跃迁核心 -->
        <radialGradient id="dnaCoreExcitedGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="40%" stop-color="#FFE8A3" />
          <stop offset="100%" stop-color="#FF6B9D" />
        </radialGradient>
      </defs>

      <!-- 地面阴影 -->
      <ellipse class="pet-dna__shadow" cx="100" cy="188" rx="30" ry="5" fill="#0A0A0A" opacity="0.1" />

      <!-- 外圈光晕 -->
      <circle class="pet-dna__glow" cx="100" cy="100" r="80" fill="url(#dnaGlowGrad)" />

      <!-- ====================================================== -->
      <!-- DNA 双螺旋（按深度排序，后面先绘制） -->
      <!-- ====================================================== -->
      <g class="pet-dna__helix">
        <template v-for="el in helixElements" :key="`${el.type}-${el.idx}-${el.depth.toFixed(2)}`">
          <!-- 链 A 段 -->
          <path
            v-if="el.type === 'strandA'"
            :d="el.d"
            class="pet-dna__strand pet-dna__strand--a"
            :style="{ opacity: 0.35 + (el.depth + 1) * 0.325, strokeWidth: 2.2 + (el.depth + 1) * 0.4 }"
            fill="none"
            stroke="url(#dnaStrandAGrad)"
            stroke-linecap="round"
          />
          <!-- 链 B 段 -->
          <path
            v-else-if="el.type === 'strandB'"
            :d="el.d"
            class="pet-dna__strand pet-dna__strand--b"
            :style="{ opacity: 0.35 + (el.depth + 1) * 0.325, strokeWidth: 2.2 + (el.depth + 1) * 0.4 }"
            fill="none"
            stroke="url(#dnaStrandBGrad)"
            stroke-linecap="round"
          />
          <!-- 碱基对 -->
          <line
            v-else
            :x1="el.x1" :y1="el.y1" :x2="el.x2" :y2="el.y2"
            class="pet-dna__base"
            :class="`pet-dna__base--${el.pair}`"
            :style="{ opacity: 0.25 + (el.depth + 1) * 0.375 }"
            stroke-linecap="round"
          />
        </template>
      </g>

      <!-- 中心轴（虚线） -->
      <line class="pet-dna__axis" x1="100" y1="18" x2="100" y2="182" stroke="rgba(76, 194, 255, 0.15)" stroke-width="0.5" stroke-dasharray="2 4" />

      <!-- ====================================================== -->
      <!-- 点击反馈（跃迁脉冲） -->
      <!-- ====================================================== -->
      <g v-if="transitionFx" class="pet-dna__transition" :key="transitionNonce">
        <circle class="pet-dna__transition-ring pet-dna__transition-ring--1" cx="100" cy="100" r="40" fill="none" />
        <circle class="pet-dna__transition-ring pet-dna__transition-ring--2" cx="100" cy="100" r="40" fill="none" />
        <circle class="pet-dna__transition-core" cx="100" cy="100" r="12" fill="url(#dnaCoreExcitedGrad)" opacity="0" />
      </g>

      <!-- 键盘敲击反馈 -->
      <g
        v-for="fx in fxList"
        :key="fx.id"
        class="pet-dna__keyfx"
        :class="`pet-dna__keyfx--${fx.category} pet-dna__keyfx--tier${fx.tier}`"
      >
        <circle class="pet-dna__keyfx-ring" cx="100" cy="100" r="38" fill="none" />
      </g>

      <!-- 连击徽章 + 层级指示 + 速度显示 -->
      <g v-if="comboCount >= 2 || comboSpeed" class="pet-dna__combo" :class="`pet-dna__combo--tier${comboTier}`">
        <g v-if="comboCount >= 2" :key="`combo-${comboCount}`">
          <text class="pet-dna__combo-bg" x="140" y="36" text-anchor="middle">×{{ comboCount }}</text>
          <text class="pet-dna__combo-text" x="140" y="36" text-anchor="middle">×{{ comboCount }}</text>
        </g>
        <g v-if="comboCount >= 2" class="pet-dna__combo-tier" :class="`pet-dna__combo-tier--${comboTier}`">
          <rect class="pet-dna__tier-bar" :class="{ 'pet-dna__tier-bar--on': comboTier >= 1 }" x="118" y="42" width="7" height="3" rx="1" />
          <rect class="pet-dna__tier-bar" :class="{ 'pet-dna__tier-bar--on': comboTier >= 2 }" x="127" y="42" width="7" height="3" rx="1" />
          <rect class="pet-dna__tier-bar" :class="{ 'pet-dna__tier-bar--on': comboTier >= 3 }" x="136" y="42" width="7" height="3" rx="1" />
          <rect class="pet-dna__tier-bar" :class="{ 'pet-dna__tier-bar--on': comboTier >= 3 }" x="145" y="42" width="7" height="3" rx="1" />
        </g>
        <g v-if="comboSpeed" class="pet-dna__combo-speed" :key="`speed-${comboSpeed.id}`">
          <text class="pet-dna__speed-text" x="60" y="34" text-anchor="middle">{{ comboSpeed.value }} hits/s</text>
          <text class="pet-dna__speed-sub" x="60" y="46" text-anchor="middle">{{ comboSpeed.hits }} keys</text>
        </g>
      </g>

      <!-- 状态装饰：提醒牌子 -->
      <g class="pet-dna__alert">
        <line x1="100" y1="32" x2="100" y2="22" stroke="var(--dna-alert, #FF5C7C)" stroke-width="2.5" stroke-linecap="round" />
        <circle cx="100" cy="12" r="11" fill="var(--dna-alert, #FF5C7C)" />
        <text x="100" y="17" text-anchor="middle" font-size="14" font-weight="700" fill="#FFFFFF" font-family="Arial, sans-serif">!</text>
      </g>

      <!-- 状态装饰：Z 字 -->
      <g class="pet-dna__zzz">
        <text class="pet-dna__z pet-dna__z--1" x="138" y="42" font-size="13" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
        <text class="pet-dna__z pet-dna__z--2" x="150" y="30" font-size="17" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
        <text class="pet-dna__z pet-dna__z--3" x="163" y="16" font-size="21" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
      </g>
    </svg>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { on } from '@/utils/ipc-client'

const props = defineProps({
  state: {
    type: String,
    default: 'idle',
    validator: (val) => ['idle', 'reminding', 'happy', 'sleeping'].includes(val)
  }
})

// ============================================================
// 螺旋参数
// ============================================================
const HELIX_CX = 100
const HELIX_RADIUS = 32
const HELIX_Y_START = 18
const HELIX_Y_END = 182
const HELIX_TURNS = 2.5
const HELIX_SEGMENTS = 36

// ============================================================
// 螺旋元素生成（链段 + 碱基对，按深度排序）
// ============================================================
const helixElements = ref([])
let helixPhase = 0

function generateHelixElements (phase) {
  const elements = []
  const yStart = HELIX_Y_START
  const yEnd = HELIX_Y_END
  const turns = HELIX_TURNS
  const radius = HELIX_RADIUS
  const segments = HELIX_SEGMENTS

  for (let i = 0; i < segments; i++) {
    const t1 = i / segments
    const t2 = (i + 1) / segments
    const y1 = yStart + (yEnd - yStart) * t1
    const y2 = yStart + (yEnd - yStart) * t2
    const angle1 = 2 * Math.PI * turns * t1 + phase
    const angle2 = 2 * Math.PI * turns * t2 + phase
    const xA1 = HELIX_CX + radius * Math.sin(angle1)
    const xA2 = HELIX_CX + radius * Math.sin(angle2)
    const xB1 = HELIX_CX - radius * Math.sin(angle1)
    const xB2 = HELIX_CX - radius * Math.sin(angle2)
    const midAngle = (angle1 + angle2) / 2
    const depthA = Math.cos(midAngle)

    elements.push({
      type: 'strandA',
      d: `M ${xA1.toFixed(2)} ${y1.toFixed(2)} L ${xA2.toFixed(2)} ${y2.toFixed(2)}`,
      depth: depthA,
      idx: i
    })

    elements.push({
      type: 'strandB',
      d: `M ${xB1.toFixed(2)} ${y1.toFixed(2)} L ${xB2.toFixed(2)} ${y2.toFixed(2)}`,
      depth: -depthA,
      idx: i
    })

    if (i % 2 === 0) {
      const tm = (t1 + t2) / 2
      const ym = yStart + (yEnd - yStart) * tm
      const angleM = 2 * Math.PI * turns * tm + phase
      const xAm = HELIX_CX + radius * Math.sin(angleM)
      const xBm = HELIX_CX - radius * Math.sin(angleM)
      elements.push({
        type: 'base',
        x1: xAm.toFixed(2),
        y1: ym.toFixed(2),
        x2: xBm.toFixed(2),
        y2: ym.toFixed(2),
        depth: Math.cos(angleM) * 0.85,
        idx: i,
        pair: Math.floor(i / 2) % 2 === 0 ? 'at' : 'gc'
      })
    }
  }

  elements.sort((a, b) => a.depth - b.depth)
  return elements
}

// ============================================================
// 旋转动画（phase 随时间变化）
// ============================================================
let rotateRafId = null
let lastRotateTime = 0

function animateRotation (timestamp) {
  if (!lastRotateTime) lastRotateTime = timestamp
  const delta = Math.min(timestamp - lastRotateTime, 50)
  lastRotateTime = timestamp

  const speed = props.state === 'happy' ? 0.005
    : props.state === 'sleeping' ? 0.0008
    : props.state === 'reminding' ? 0.003
    : 0.0022
  helixPhase += speed * delta

  helixElements.value = generateHelixElements(helixPhase)
  rotateRafId = requestAnimationFrame(animateRotation)
}

// ============================================================
// 鼠标视差
// ============================================================
const mouse = reactive({ nx: 0, ny: 0 })
let latestPointer = null
let rafId = null

function clamp (v, min, max) {
  return Math.min(max, Math.max(min, v))
}

function handleMouseMove (event) {
  latestPointer = { x: event.clientX, y: event.clientY }
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    if (!latestPointer) return
    const e = latestPointer
    latestPointer = null
    const halfW = window.innerWidth / 2 || 1
    const halfH = window.innerHeight / 2 || 1
    mouse.nx = clamp((e.x - halfW) / halfW, -1.2, 1.2)
    mouse.ny = clamp((e.y - halfH) / halfH, -1.2, 1.2)
  })
}

function handleMouseLeave () {
  mouse.nx = 0
  mouse.ny = 0
}

function handleDnaEnter () {}
function handleDnaMove () {}
function handleDnaLeave () {
  mouse.nx = 0
  mouse.ny = 0
}

// ============================================================
// 点击反馈（跃迁脉冲）
// ============================================================
const transitionFx = ref(null)
const transitionNonce = ref(0)
let transitionTimer = null
let dnaMouseDownPos = null

function handleDnaMouseDown (event) {
  dnaMouseDownPos = { x: event.clientX, y: event.clientY, time: Date.now() }
}

function handleDnaMouseUp (event) {
  if (!dnaMouseDownPos) return
  const dx = event.clientX - dnaMouseDownPos.x
  const dy = event.clientY - dnaMouseDownPos.y
  const dt = Date.now() - dnaMouseDownPos.time
  const dist = Math.hypot(dx, dy)
  dnaMouseDownPos = null

  if (dist > 5 || dt > 1000) return

  transitionNonce.value += 1
  transitionFx.value = { time: Date.now() }

  if (transitionTimer !== null) clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => {
    transitionFx.value = null
    transitionTimer = null
  }, 800)
}

// ============================================================
// 键盘敲击反馈（连击系统）
// ============================================================
const fxList = ref([])
const comboCount = ref(0)
const comboTier = ref(1)
const comboSpeed = ref(null)
let fxSeq = 0
let speedSeq = 0
let comboTimer = null
let speedTimer = null
let unsubscribeKey = null
let comboStartTime = null
let comboTotalHits = 0

const COMBO_RESET_MS = 500
const FX_LIFETIME_MS = 700
const SPEED_DISPLAY_MS = 1500

function tierOf (combo) {
  if (combo >= 7) return 3
  if (combo >= 4) return 2
  return 1
}

function applyKeyFx (category) {
  if (comboCount.value === 0) {
    comboStartTime = Date.now()
    comboTotalHits = 0
  }
  comboCount.value += 1
  comboTotalHits += 1
  comboTier.value = tierOf(comboCount.value)

  if (comboTimer !== null) clearTimeout(comboTimer)
  comboTimer = setTimeout(() => {
    if (comboStartTime && comboTotalHits > 1) {
      const elapsed = (Date.now() - comboStartTime) / 1000
      const hitsPerSec = elapsed > 0 ? Math.round((comboTotalHits / elapsed) * 10) / 10 : 0
      comboSpeed.value = { value: hitsPerSec, hits: comboTotalHits, id: ++speedSeq }
      if (speedTimer !== null) clearTimeout(speedTimer)
      speedTimer = setTimeout(() => {
        comboSpeed.value = null
        speedTimer = null
      }, SPEED_DISPLAY_MS)
    }
    comboCount.value = 0
    comboTier.value = 1
    comboStartTime = null
    comboTotalHits = 0
    comboTimer = null
  }, COMBO_RESET_MS)

  const item = {
    id: ++fxSeq,
    category,
    tier: tierOf(comboCount.value),
    combo: comboCount.value
  }
  fxList.value.push(item)
  if (fxList.value.length > 8) {
    fxList.value.shift()
  }
  setTimeout(() => {
    fxList.value = fxList.value.filter(f => f.id !== item.id)
  }, FX_LIFETIME_MS)
}

// ============================================================
// 生命周期
// ============================================================
onMounted(() => {
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseleave', handleMouseLeave)

  helixElements.value = generateHelixElements(0)
  rotateRafId = requestAnimationFrame(animateRotation)

  unsubscribeKey = on('pet:key-input', (payload) => {
    if (payload && payload.category) {
      applyKeyFx(payload.category)
    }
  })
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseleave', handleMouseLeave)
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (rotateRafId !== null) {
    cancelAnimationFrame(rotateRafId)
    rotateRafId = null
  }
  if (comboTimer !== null) {
    clearTimeout(comboTimer)
    comboTimer = null
  }
  if (speedTimer !== null) {
    clearTimeout(speedTimer)
    speedTimer = null
  }
  if (transitionTimer !== null) {
    clearTimeout(transitionTimer)
    transitionTimer = null
  }
  if (unsubscribeKey) {
    unsubscribeKey()
    unsubscribeKey = null
  }
})

const dnaStyle = computed(() => ({
  '--dna-rx': `${(-mouse.ny * 8).toFixed(2)}deg`,
  '--dna-ry': `${(mouse.nx * 12).toFixed(2)}deg`,
  '--dna-tx': `${(mouse.nx * 6).toFixed(2)}px`,
  '--dna-ty': `${(mouse.ny * 4).toFixed(2)}px`
}))
</script>

<style scoped lang="scss">
.pet-dna {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  perspective: 800px;
  cursor: grab;
  pointer-events: auto;
  overflow: visible;

  --dna-alert: #FF5C7C;

  &__svg {
    width: 100%;
    height: 100%;
    display: block;
    background: transparent;
    overflow: visible;
    transform: translate(var(--dna-tx, 0px), var(--dna-ty, 0px))
               rotateX(var(--dna-rx, 0deg))
               rotateY(var(--dna-ry, 0deg));
    transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
    animation: dna-float 4.5s ease-in-out infinite;
  }

  &__shadow {
    transform-origin: 100px 188px;
    transform-box: view-box;
    animation: dna-shadow-pulse 4.5s ease-in-out infinite;
  }

  &__glow {
    transform-origin: 100px 100px;
    transform-box: view-box;
    animation: dna-breathe 3.5s ease-in-out infinite;
  }

  &__helix {
    transform-origin: 100px 100px;
    transform-box: view-box;
  }

  &__strand {
    filter: drop-shadow(0 0 3px rgba(76, 194, 255, 0.4));
    transition: opacity 0.1s linear;
  }

  &__base {
    stroke-width: 1.8;
    transition: opacity 0.1s linear;

    &--at {
      stroke: #4CF2C0;
      filter: drop-shadow(0 0 2px rgba(76, 242, 192, 0.5));
    }
    &--gc {
      stroke: #FFB03A;
      filter: drop-shadow(0 0 2px rgba(255, 176, 58, 0.5));
    }
  }

  &__axis {
    opacity: 0.3;
  }

  // 点击反馈
  &__transition {
    pointer-events: none;
  }

  &__transition-ring {
    transform-origin: 100px 100px;
    transform-box: view-box;
    fill: none;

    &--1 {
      stroke: #4CC2FF;
      stroke-width: 2.5;
      animation: dna-transition-ring 0.6s ease-out forwards;
    }
    &--2 {
      stroke: #7C4DFF;
      stroke-width: 1.5;
      animation: dna-transition-ring 0.7s ease-out forwards;
    }
  }

  &__transition-core {
    transform-origin: 100px 100px;
    transform-box: view-box;
    animation: dna-transition-core 0.6s ease-out forwards;
  }

  // 键盘敲击反馈
  &__keyfx {
    pointer-events: none;
    --dna-key-color: #4CC2FF;
    --dna-key-scale: 1.8;
    --dna-key-width: 2;

    &--tier2 { --dna-key-scale: 2.2; --dna-key-width: 2.5; }
    &--tier3 { --dna-key-scale: 2.8; --dna-key-width: 3; }

    &--space { --dna-key-color: #EAFDFF; }
    &--enter { --dna-key-color: #B18CFF; }
    &--backspace { --dna-key-color: #FF8A5C; }
    &--tab { --dna-key-color: #4CF2C0; }
    &--arrow { --dna-key-color: #6FC4FF; }
    &--modifier { --dna-key-color: #B78CFF; --dna-key-scale: 1.4; }
    &--escape { --dna-key-color: #FF5C7C; }
  }

  &__keyfx-ring {
    stroke: var(--dna-key-color);
    stroke-width: var(--dna-key-width, 2);
    transform-origin: 100px 100px;
    transform-box: view-box;
    animation: dna-key-ring 0.5s ease-out forwards;
  }

  // 连击徽章
  &__combo {
    pointer-events: none;
  }
  &__combo-bg {
    fill: none;
    stroke: #4CC2FF;
    stroke-width: 3;
    font-size: 18px;
    font-weight: 900;
    font-family: Arial, sans-serif;
    transform-origin: 140px 36px;
    transform-box: view-box;
    animation: dna-combo-pop 0.3s ease-out;
  }
  &__combo-text {
    fill: #4CC2FF;
    font-size: 18px;
    font-weight: 900;
    font-family: Arial, sans-serif;
    filter: drop-shadow(0 0 6px rgba(76, 194, 255, 0.9));
    transform-origin: 140px 36px;
    transform-box: view-box;
    animation: dna-combo-pop 0.3s ease-out;
  }
  &__combo--tier2 .pet-dna__combo-bg { stroke: #7C4DFF; }
  &__combo--tier2 .pet-dna__combo-text {
    fill: #7C4DFF;
    filter: drop-shadow(0 0 6px rgba(124, 77, 255, 0.9));
  }
  &__combo--tier3 .pet-dna__combo-bg { stroke: #FFD24D; }
  &__combo--tier3 .pet-dna__combo-text {
    fill: #FFE8A3;
    filter: drop-shadow(0 0 6px rgba(255, 170, 60, 0.9));
  }

  // 层级指示条
  &__combo-tier {
    transform-origin: 140px 44px;
    transform-box: view-box;
    animation: dna-combo-pop 0.3s ease-out;
  }
  &__tier-bar {
    fill: rgba(255, 255, 255, 0.15);
    transition: fill 0.2s ease;

    &--on {
      fill: #4CC2FF;
      filter: drop-shadow(0 0 2px rgba(76, 194, 255, 0.8));
    }
  }
  &__combo-tier--2 &__tier-bar--on {
    fill: #7C4DFF;
    filter: drop-shadow(0 0 2px rgba(124, 77, 255, 0.8));
  }
  &__combo-tier--3 &__tier-bar--on {
    fill: #FFD24D;
    filter: drop-shadow(0 0 3px rgba(255, 210, 77, 0.9));
  }

  // 敲击速度显示
  &__combo-speed {
    pointer-events: none;
    transform-origin: 60px 40px;
    transform-box: view-box;
    animation: dna-speed-show 1.5s ease-out forwards;
  }
  &__speed-text {
    fill: #4CF2C0;
    font-size: 17px;
    font-weight: 700;
    font-family: Arial, sans-serif;
    filter: drop-shadow(0 0 5px rgba(76, 242, 192, 0.9));
  }
  &__speed-sub {
    fill: rgba(207, 233, 255, 0.7);
    font-size: 12px;
    font-weight: 600;
    font-family: Arial, sans-serif;
  }

  // 悬停
  &:hover {
    .pet-dna__svg {
      scale: 1.05;
    }
    .pet-dna__glow {
      animation-duration: 1.8s;
    }
  }
}

// 状态装饰
.pet-dna__alert { opacity: 0; transition: opacity 250ms ease; }
.pet-dna__zzz { opacity: 0; }

// ============================================================
// 各状态动画
// ============================================================
.pet-dna--idle {
  .pet-dna__glow { animation: dna-breathe 3.5s ease-in-out infinite; }
}

.pet-dna--happy {
  .pet-dna__glow { animation: dna-glow-happy 1.6s ease-in-out infinite; }
  .pet-dna__svg { animation: dna-bounce 1.2s ease-in-out infinite; }
}

.pet-dna--reminding {
  --dna-alert: #FF5C7C;

  .pet-dna__glow { animation: dna-breathe 0.9s ease-in-out infinite; }
  .pet-dna__alert {
    opacity: 1;
    animation: dna-alert-bob 0.6s ease-in-out infinite;
  }
}

.pet-dna--sleeping {
  .pet-dna__glow { animation: dna-breathe 5s ease-in-out infinite; opacity: 0.6; }
  .pet-dna__helix { opacity: 0.7; }
  .pet-dna__zzz { opacity: 1; }
  .pet-dna__z {
    animation: dna-z-float 2.4s ease-in-out infinite;
    opacity: 0;
    &--1 { animation-delay: 0s; }
    &--2 { animation-delay: 0.8s; }
    &--3 { animation-delay: 1.6s; }
  }
  .pet-dna__svg { animation: dna-float 6s ease-in-out infinite; }
}

// ============================================================
// 关键帧
// ============================================================
@keyframes dna-float {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -2px; }
}
@keyframes dna-bounce {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -6px; }
}
@keyframes dna-breathe {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.06); }
}
@keyframes dna-glow-happy {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.15); opacity: 1; }
}
@keyframes dna-shadow-pulse {
  0%, 100% { transform: scale(1); opacity: 0.1; }
  50% { transform: scale(0.9); opacity: 0.06; }
}
@keyframes dna-alert-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes dna-z-float {
  0% { opacity: 0; transform: translateY(0); }
  30% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-12px); }
}

// 点击反馈
@keyframes dna-transition-ring {
  0% { transform: scale(0.5); opacity: 0.95; stroke-width: 4; }
  100% { transform: scale(2.5); opacity: 0; stroke-width: 0.5; }
}
@keyframes dna-transition-core {
  0% { transform: scale(0.3); opacity: 1; }
  100% { transform: scale(2); opacity: 0; }
}

// 键盘敲击
@keyframes dna-key-ring {
  0% { transform: scale(0.55); opacity: 0.95; }
  100% { transform: scale(var(--dna-key-scale, 1.8)); opacity: 0; }
}

// 连击徽章
@keyframes dna-combo-pop {
  0% { transform: scale(1.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes dna-speed-show {
  0% { transform: scale(0.6); opacity: 0; }
  15% { transform: scale(1.1); opacity: 1; }
  25% { transform: scale(1); opacity: 1; }
  75% { transform: scale(1); opacity: 1; }
  100% { transform: scale(1); opacity: 0; }
}
</style>