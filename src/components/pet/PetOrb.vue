<!--
  桌宠科技球角色组件（高级量子态）
  职责：内联 SVG 绘制一颗"全息能量球"，根据状态切换 CSS 动画，
        并响应鼠标与键盘互动（视差、高光追踪、量子场涟漪、量子跃迁反馈）
  Props:
    - state: 当前状态（idle / reminding / happy / sleeping）
  设计参考：量子物理 + 科幻 HUD + 分子轨道
    - 深蓝紫玻璃球体，径向渐变模拟 3D 受光面
    - 青→紫霓虹能量核心，支持量子跃迁变色
    - sp³ 杂化轨道（四面体纺锤形）+ 电子沿轨道公转
    - 土星环（倾斜大星环，带环缝，3D 透视）
    - 量子场涟漪（同心等势线 + 3D 透视）
    - 点击量子跃迁：核心能级跃迁 + 轨道重排
  鼠标互动：
    - 视差：球体随鼠标位置轻微平移 + 3D tilt
    - 高光：球面高光点实时追踪鼠标方向
    - 量子场拨动：鼠标在球体上滑动时，同心波纹从划过点扩散，
                   带 3D 倾斜，内部电路纹路闪现
  键盘互动（连击系统 + 分类反馈）
  viewBox 0 0 200 200
-->
<template>
  <div
    class="pet-orb"
    :class="`pet-orb--${state}`"
    :style="orbStyle"

    @mousedown="handleOrbMouseDown"
    @mouseenter="handleOrbEnter"
    @mousemove="handleOrbMove"
    @mouseleave="handleOrbLeave"
  >
    <svg class="pet-orb__svg" viewBox="0 0 200 200" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <!-- ====================================================== -->
      <!-- 渐变定义 -->
      <!-- ====================================================== -->
      <defs>
        <!-- 球体：径向渐变模拟 3D 受光 -->
        <radialGradient id="orbSphereGrad" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="var(--orb-sphere-light, #F2FBFF)" />
          <stop offset="32%" stop-color="var(--orb-sphere-mid, #8ECBFF)" />
          <stop offset="68%" stop-color="var(--orb-sphere-deep, #2B6BD8)" />
          <stop offset="100%" stop-color="var(--orb-sphere-dark, #0E2F85)" />
        </radialGradient>
        <!-- 核心：青→紫霓虹能量（支持跃迁变色） -->
        <radialGradient id="orbCoreGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="var(--orb-core-hot, #EAFDFF)" />
          <stop offset="48%" stop-color="var(--orb-core-1, #4CC2FF)" />
          <stop offset="100%" stop-color="var(--orb-core-2, #7C4DFF)" />
        </radialGradient>
        <!-- 跃迁核心：激发态 -->
        <radialGradient id="orbCoreExcitedGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="40%" stop-color="#FFE8A3" />
          <stop offset="100%" stop-color="#FF6B9D" />
        </radialGradient>
        <!-- 轨道环：青→紫渐变 -->
        <linearGradient id="orbRingGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--orb-ring-1, #4CC2FF)" stop-opacity="0.9" />
          <stop offset="100%" stop-color="var(--orb-ring-2, #7C4DFF)" stop-opacity="0.9" />
        </linearGradient>
        <!-- 星环渐变 -->
        <linearGradient id="orbSaturnRingGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#4CC2FF" stop-opacity="0.6" />
          <stop offset="35%" stop-color="#7C4DFF" stop-opacity="0.4" />
          <stop offset="50%" stop-color="transparent" stop-opacity="0.1" />
          <stop offset="65%" stop-color="#7C4DFF" stop-opacity="0.4" />
          <stop offset="100%" stop-color="#4CC2FF" stop-opacity="0.6" />
        </linearGradient>
        <!-- 光晕 -->
        <radialGradient id="orbGlowGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="var(--orb-glow-color, #4CC2FF)" stop-opacity="var(--orb-glow-alpha, 0.42)" />
          <stop offset="60%" stop-color="var(--orb-glow-color, #4CC2FF)" stop-opacity="0.16" />
          <stop offset="100%" stop-color="var(--orb-glow-color, #4CC2FF)" stop-opacity="0" />
        </radialGradient>
        <!-- 高光 -->
        <radialGradient id="orbSpecGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95" />
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
        </radialGradient>
        <!-- sp³ 轨道渐变 -->
        <linearGradient id="orbSp3Grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="var(--orb-sp3-1, #4CC2FF)" stop-opacity="0.6" />
          <stop offset="50%" stop-color="var(--orb-sp3-2, #7C4DFF)" stop-opacity="0.3" />
          <stop offset="100%" stop-color="transparent" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- 地面阴影 -->
      <ellipse class="pet-orb__shadow" cx="100" cy="168" rx="35" ry="6" fill="#0A0A0A" opacity="0.12" />

      <!-- 外圈光晕 -->
      <circle class="pet-orb__glow" cx="100" cy="100" r="72" fill="url(#orbGlowGrad)" />

      <!-- ====================================================== -->
      <!-- 土星环后半（在球体后方绘制，固定倾斜，不旋转） -->
      <!-- 顶部弧（y < 100），路径方向逆时针（右→左） -->
      <!-- ====================================================== -->
      <g class="pet-orb__saturn-ring pet-orb__saturn-ring--back" transform="rotate(-18 100 100)">
        <path d="M 225 100 A 125 32 0 0 0 -25 100" fill="none" stroke="url(#orbSaturnRingGrad)" stroke-width="14" stroke-linecap="round" opacity="0.5" />
        <path d="M 202 100 A 102 26 0 0 0 -2 100" fill="none" stroke="var(--orb-sphere-dark, #0E2F85)" stroke-width="6" stroke-linecap="round" opacity="0.8" />
        <path d="M 188 100 A 88 22 0 0 0 12 100" fill="none" stroke="url(#orbRingGrad)" stroke-width="6" stroke-linecap="round" opacity="0.35" />
        <path class="pet-orb__saturn-flow" d="M 225 100 A 125 32 0 0 0 -25 100" fill="none" stroke="var(--orb-ring-1, #4CC2FF)" stroke-width="2" stroke-linecap="round" stroke-dasharray="6 18" opacity="0.7" />
      </g>

      <!-- ====================================================== -->
      <!-- sp³ 杂化轨道（四面体纺锤形） -->
      <!-- ====================================================== -->
      <g class="pet-orb__sp3">
        <!-- 4 个纺锤形轨道沿四面体方向 -->
        <g class="pet-orb__sp3-axis pet-orb__sp3-axis--1">
          <path class="pet-orb__sp3-lobe pet-orb__sp3-lobe--a" d="M 100 100 Q 70 60 50 40" fill="url(#orbSp3Grad)" opacity="0.5" />
          <path class="pet-orb__sp3-lobe pet-orb__sp3-lobe--b" d="M 100 100 Q 130 140 150 160" fill="url(#orbSp3Grad)" opacity="0.5" />
          <circle class="pet-orb__sp3-electron" cx="65" cy="55" r="2.5" fill="var(--orb-core-1, #4CC2FF)" />
        </g>
        <g class="pet-orb__sp3-axis pet-orb__sp3-axis--2">
          <path class="pet-orb__sp3-lobe pet-orb__sp3-lobe--a" d="M 100 100 Q 140 70 160 50" fill="url(#orbSp3Grad)" opacity="0.5" />
          <path class="pet-orb__sp3-lobe pet-orb__sp3-lobe--b" d="M 100 100 Q 60 130 40 150" fill="url(#orbSp3Grad)" opacity="0.5" />
          <circle class="pet-orb__sp3-electron" cx="145" cy="65" r="2.5" fill="var(--orb-core-2, #7C4DFF)" />
        </g>
        <g class="pet-orb__sp3-axis pet-orb__sp3-axis--3">
          <path class="pet-orb__sp3-lobe pet-orb__sp3-lobe--a" d="M 100 100 Q 130 130 150 150" fill="url(#orbSp3Grad)" opacity="0.5" />
          <path class="pet-orb__sp3-lobe pet-orb__sp3-lobe--b" d="M 100 100 Q 70 70 50 50" fill="url(#orbSp3Grad)" opacity="0.5" />
          <circle class="pet-orb__sp3-electron" cx="135" cy="135" r="2.2" fill="var(--orb-core-1, #4CC2FF)" />
        </g>
        <g class="pet-orb__sp3-axis pet-orb__sp3-axis--4">
          <path class="pet-orb__sp3-lobe pet-orb__sp3-lobe--a" d="M 100 100 Q 60 130 40 150" fill="url(#orbSp3Grad)" opacity="0.5" />
          <path class="pet-orb__sp3-lobe pet-orb__sp3-lobe--b" d="M 100 100 Q 140 70 160 50" fill="url(#orbSp3Grad)" opacity="0.5" />
          <circle class="pet-orb__sp3-electron" cx="55" cy="135" r="2.2" fill="var(--orb-core-2, #7C4DFF)" />
        </g>
      </g>

      <!-- 倾斜轨道环（原子模型） -->
      <g class="pet-orb__rings">
        <ellipse class="pet-orb__ring pet-orb__ring--static" cx="100" cy="100" rx="58" ry="22" fill="none" stroke="url(#orbRingGrad)" stroke-width="1" opacity="0.4" />
        <ellipse class="pet-orb__ring pet-orb__ring--flow" cx="100" cy="100" rx="58" ry="22" fill="none" stroke="url(#orbRingGrad)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="54 260" transform="rotate(-58 100 100)" />
        <ellipse class="pet-orb__ring pet-orb__ring--flow-rev" cx="100" cy="100" rx="52" ry="16" fill="none" stroke="var(--orb-ring-2, #7C4DFF)" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="40 240" transform="rotate(32 100 100)" opacity="0.7" />
      </g>

      <!-- 环绕粒子 -->
      <g class="pet-orb__particle pet-orb__particle--1">
        <circle cx="100" cy="100" r="58" fill="none" />
        <circle class="pet-orb__particle-dot" cx="158" cy="100" r="3" fill="var(--orb-particle, #CFE9FF)" />
      </g>
      <g class="pet-orb__particle pet-orb__particle--2">
        <circle cx="100" cy="100" r="46" fill="none" />
        <circle class="pet-orb__particle-dot" cx="146" cy="100" r="2" fill="var(--orb-particle, #CFE9FF)" opacity="0.85" />
      </g>

      <!-- ====================================================== -->
      <!-- 球体主体（支持量子跃迁变色） -->
      <!-- ====================================================== -->
      <g class="pet-orb__body">
        <circle class="pet-orb__sphere" cx="100" cy="100" r="48" fill="url(#orbSphereGrad)" />
        <circle class="pet-orb__sphere-rim" cx="100" cy="100" r="47.4" fill="none" stroke="#FFFFFF" stroke-width="0.6" opacity="0.35" />
        <path class="pet-orb__sphere-shade" d="M 60 128 A 48 48 0 0 0 140 128 A 40 40 0 0 1 60 128 Z" fill="#0E2F85" opacity="0.35" />

        <!-- 内部电路纹路（默认隐藏，拨动时闪现 / 长按时闪现） -->
        <g class="pet-orb__circuit" :class="{ 'pet-orb--circuit-active': wobble.circuitFlash > 0 || longPressActive }">
          <circle cx="100" cy="100" r="35" fill="none" stroke="var(--orb-core-1, #4CC2FF)" stroke-width="0.4" opacity="0.2" />
          <circle cx="100" cy="100" r="28" fill="none" stroke="var(--orb-core-2, #7C4DFF)" stroke-width="0.4" opacity="0.15" />
          <path d="M 100 72 L 100 128 M 72 100 L 128 100" stroke="var(--orb-core-1, #4CC2FF)" stroke-width="0.3" opacity="0.15" />
          <path d="M 80 80 L 120 120 M 120 80 L 80 120" stroke="var(--orb-core-2, #7C4DFF)" stroke-width="0.3" opacity="0.1" />
        </g>

        <!-- 能量核心 -->
        <g class="pet-orb__core-group">
          <circle class="pet-orb__core" cx="100" cy="100" r="17" fill="url(#orbCoreGrad)" />
          <circle class="pet-orb__core-excited" cx="100" cy="100" r="17" fill="url(#orbCoreExcitedGrad)" opacity="0" />
          <circle class="pet-orb__core-ring" cx="100" cy="100" r="23" fill="none" stroke="var(--orb-core-1, #4CC2FF)" stroke-width="1" opacity="0.6" />
        </g>

        <!-- 高光 -->
        <g class="pet-orb__specular">
          <circle cx="85" cy="80" r="16" fill="url(#orbSpecGrad)" />
        </g>
      </g>

      <!-- ====================================================== -->
      <!-- 土星环前半（在球体前方绘制，固定倾斜，不旋转） -->
      <!-- 底部弧（y > 100），路径方向逆时针（左→右） -->
      <!-- ====================================================== -->
      <g class="pet-orb__saturn-ring pet-orb__saturn-ring--front" transform="rotate(-18 100 100)">
        <path d="M -25 100 A 125 32 0 0 0 225 100" fill="none" stroke="url(#orbSaturnRingGrad)" stroke-width="14" stroke-linecap="round" opacity="0.5" />
        <path d="M -2 100 A 102 26 0 0 0 202 100" fill="none" stroke="var(--orb-sphere-dark, #0E2F85)" stroke-width="6" stroke-linecap="round" opacity="0.8" />
        <path d="M 12 100 A 88 22 0 0 0 188 100" fill="none" stroke="url(#orbRingGrad)" stroke-width="6" stroke-linecap="round" opacity="0.35" />
        <path class="pet-orb__saturn-flow" d="M -25 100 A 125 32 0 0 0 225 100" fill="none" stroke="var(--orb-ring-1, #4CC2FF)" stroke-width="2" stroke-linecap="round" stroke-dasharray="6 18" opacity="0.7" />
      </g>

      <!-- ====================================================== -->
      <!-- 量子场涟漪（同心等势线 + 3D 透视） -->
      <!-- ====================================================== -->
      <g v-for="qp in quantumRipples" :key="qp.id" class="pet-orb__quantum-ripple" :class="`pet-orb__quantum-ripple--${qp.type}`">
        <ellipse class="pet-orb__quantum-ring" :cx="100 + qp.x" :cy="100 + qp.y" :rx="qp.r" :ry="qp.r * 0.4" fill="none" />
      </g>

      <!-- ====================================================== -->
      <!-- 量子跃迁点击反馈（能级跃迁 + 轨道重排） -->
      <!-- ====================================================== -->
      <g v-if="transitionFx" class="pet-orb__transition" :key="transitionNonce">
        <!-- 跃迁能量环（3 层向外扩散） -->
        <circle class="pet-orb__transition-ring pet-orb__transition-ring--1" cx="100" cy="100" r="48" fill="none" />
        <circle class="pet-orb__transition-ring pet-orb__transition-ring--2" cx="100" cy="100" r="48" fill="none" />
        <circle class="pet-orb__transition-ring pet-orb__transition-ring--3" cx="100" cy="100" r="48" fill="none" />
        <!-- 跃迁粒子爆发 -->
        <g class="pet-orb__transition-burst">
          <circle cx="60" cy="60" r="2.5" />
          <circle cx="140" cy="60" r="2.5" />
          <circle cx="60" cy="140" r="2.2" />
          <circle cx="140" cy="140" r="2.2" />
          <circle cx="100" cy="52" r="2" />
          <circle cx="100" cy="148" r="2" />
          <circle cx="52" cy="100" r="2" />
          <circle cx="148" cy="100" r="2" />
        </g>
      </g>

      <!-- 键盘敲击反馈 -->
      <g
        v-for="fx in fxList"
        :key="fx.id"
        class="pet-orb__keyfx"
        :class="`pet-orb__keyfx--${fx.category} pet-orb__keyfx--tier${fx.tier}`"
      >
        <circle class="pet-orb__keyfx-ring" cx="100" cy="100" r="34" fill="none" />
        <g class="pet-orb__keyfx-burst">
          <circle cx="68" cy="68" r="2.8" />
          <circle cx="132" cy="68" r="2.8" />
          <circle cx="68" cy="132" r="2.4" />
          <circle cx="132" cy="132" r="2.4" />
          <circle cx="100" cy="55" r="2" />
        </g>
      </g>

      <!-- 连击徽章 + 层级指示 + 速度显示 -->
      <g v-if="comboCount >= 2 || comboSpeed" class="pet-orb__combo" :class="`pet-orb__combo--tier${comboTier}`">
        <!-- 连击次数 -->
        <g v-if="comboCount >= 2" :key="`combo-${comboCount}`">
          <text class="pet-orb__combo-bg" x="140" y="36" text-anchor="middle">×{{ comboCount }}</text>
          <text class="pet-orb__combo-text" x="140" y="36" text-anchor="middle">×{{ comboCount }}</text>
        </g>
        <!-- 层级指示条（tier 1/2/3，随连击数点亮） -->
        <g v-if="comboCount >= 2" class="pet-orb__combo-tier" :class="`pet-orb__combo-tier--${comboTier}`">
          <rect class="pet-orb__tier-bar" :class="{ 'pet-orb__tier-bar--on': comboTier >= 1 }" x="118" y="42" width="7" height="3" rx="1" />
          <rect class="pet-orb__tier-bar" :class="{ 'pet-orb__tier-bar--on': comboTier >= 2 }" x="127" y="42" width="7" height="3" rx="1" />
          <rect class="pet-orb__tier-bar" :class="{ 'pet-orb__tier-bar--on': comboTier >= 3 }" x="136" y="42" width="7" height="3" rx="1" />
          <rect class="pet-orb__tier-bar" :class="{ 'pet-orb__tier-bar--on': comboTier >= 3 }" x="145" y="42" width="7" height="3" rx="1" />
        </g>
        <!-- 敲击速度显示（连击结束后短暂显示，左侧避免与连击次数重叠） -->
        <g v-if="comboSpeed" class="pet-orb__combo-speed" :key="`speed-${comboSpeed.id}`">
          <text class="pet-orb__speed-text" x="60" y="34" text-anchor="middle">{{ comboSpeed.value }} hits/s</text>
          <text class="pet-orb__speed-sub" x="60" y="46" text-anchor="middle">{{ comboSpeed.hits }} keys</text>
        </g>
      </g>

      <!-- 状态装饰：提醒牌子 -->
      <g class="pet-orb__alert">
        <line x1="100" y1="32" x2="100" y2="22" stroke="var(--orb-alert, #FF5C7C)" stroke-width="2.5" stroke-linecap="round" />
        <circle cx="100" cy="12" r="11" fill="var(--orb-alert, #FF5C7C)" />
        <text x="100" y="17" text-anchor="middle" font-size="14" font-weight="700" fill="#FFFFFF" font-family="Arial, sans-serif">!</text>
      </g>

      <!-- 状态装饰：Z 字 -->
      <g class="pet-orb__zzz">
        <text class="pet-orb__z pet-orb__z--1" x="138" y="42" font-size="13" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
        <text class="pet-orb__z pet-orb__z--2" x="150" y="30" font-size="17" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
        <text class="pet-orb__z pet-orb__z--3" x="163" y="16" font-size="21" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
      </g>
    </svg>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { on } from '@/utils/ipc-client'

defineProps({
  state: {
    type: String,
    default: 'idle',
    validator: (val) => ['idle', 'reminding', 'happy', 'sleeping'].includes(val)
  }
})

// ============================================================
// 鼠标视差 / 高光追踪
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

// ============================================================
// 鼠标拨动：量子场涟漪（同心等势线 + 3D 透视 + 内部电路闪现）
// ============================================================
const wobble = reactive({ circuitFlash: 0 })
const quantumRipples = ref([])
let rippleSeq = 0
let orbRect = null
let lastOrbPointer = null
let orbMoveRafId = null
let pendingOrbMove = null
// 电路纹路闪现计时器
let circuitTimer = null

function handleOrbEnter (event) {
  orbRect = event.currentTarget.getBoundingClientRect()
  lastOrbPointer = { x: event.clientX, y: event.clientY }
}

function handleOrbMove (event) {
  pendingOrbMove = event
  if (orbMoveRafId !== null) return
  orbMoveRafId = requestAnimationFrame(() => {
    orbMoveRafId = null
    const e = pendingOrbMove
    if (!e) return
    if (!lastOrbPointer) {
      lastOrbPointer = { x: e.clientX, y: e.clientY }
      return
    }
    const vx = e.clientX - lastOrbPointer.x
    const vy = e.clientY - lastOrbPointer.y
    const speed = Math.hypot(vx, vy)
    lastOrbPointer = { x: e.clientX, y: e.clientY }
    if (speed < 1) return

    const k = Math.min(speed / 60, 1)

    // 电路纹路闪现强度（直接控制 opacity）
    wobble.circuitFlash = Math.round(k * 100) / 100
    if (circuitTimer !== null) clearTimeout(circuitTimer)
    circuitTimer = setTimeout(() => {
      wobble.circuitFlash = 0
      circuitTimer = null
    }, 400)

    // 生成量子场涟漪（同心等势线）—— 降低阈值，更容易触发
    if (k > 0.15 && quantumRipples.value.length < 5) {
      addQuantumRipple(e.clientX, e.clientY, k)
    }
  })
}

function handleOrbLeave () {
  lastOrbPointer = null
  orbRect = null
  wobble.circuitFlash = 0
  if (circuitTimer !== null) {
    clearTimeout(circuitTimer)
    circuitTimer = null
  }
}

/**
 * 量子场涟漪：从划过点生成同心等势线（带 3D 透视倾斜）
 */
function addQuantumRipple (clientX, clientY, strength) {
  if (!orbRect || quantumRipples.value.length >= 4) return
  const ox = (clientX - orbRect.left) / orbRect.width * 200
  const oy = (clientY - orbRect.top) / orbRect.height * 200
  const dx = ox - 100
  const dy = oy - 100
  const dist = Math.hypot(dx, dy)
  const limit = 40
  const scale = dist > limit ? limit / dist : 1

  // 生成 1-2 圈同心波纹
  const count = strength > 0.6 ? 2 : 1
  for (let i = 0; i < count; i++) {
    const item = {
      id: ++rippleSeq,
      x: dx * scale,
      y: dy * scale,
      r: 15 + i * 18,
      type: i === 0 ? 'inner' : 'outer'
    }
    quantumRipples.value.push(item)

    setTimeout(() => {
      quantumRipples.value = quantumRipples.value.filter(r => r.id !== item.id)
    }, 900)
  }
}

// ============================================================
// 量子跃迁点击反馈（能级跃迁 + 轨道重排）
// ============================================================
const transitionFx = ref(null)
const transitionNonce = ref(0)
let transitionTimer = null

// 长按电路纹路闪现（独立于 wobble.circuitFlash，避免被 handleOrbMove 覆盖）
const longPressActive = ref(false)
let longPressTimer = null

// 记录鼠标按下位置，用于区分点击和拖拽
let orbMouseDownPos = null

function handleOrbMouseDown (event) {
  // 用 screenX/screenY（相对屏幕）代替 clientX/clientY（相对窗口），
  // 避免父级 dragStart 移动窗口后坐标漂移导致 dist 误判
  orbMouseDownPos = { x: event.screenX, y: event.screenY, time: Date.now() }
  // 用全局 mouseup 监听代替元素上的 @mouseup：
  // Electron 拖拽模式会改变窗口穿透状态，吞掉元素上的 mouseup，
  // 全局监听不受影响，连点后长按也能可靠触发
  window.removeEventListener('mouseup', handleOrbGlobalMouseUp)
  window.addEventListener('mouseup', handleOrbGlobalMouseUp)
  // 长按闪动：mousedown 后 200ms 即开始电路纹路闪现（实时反馈，不再等 mouseup）
  // 若 200ms 内松开（快速单击），handleOrbGlobalMouseUp 会取消此定时器，不触发闪动
  if (longPressTimer !== null) clearTimeout(longPressTimer)
  longPressTimer = setTimeout(() => {
    longPressActive.value = true
    longPressTimer = null // 标记长按已触发（timer 已消费）
  }, 200)
}

function handleOrbGlobalMouseUp (event) {
  window.removeEventListener('mouseup', handleOrbGlobalMouseUp)
  if (!orbMouseDownPos) return
  const dx = event.screenX - orbMouseDownPos.x
  const dy = event.screenY - orbMouseDownPos.y
  const dist = Math.hypot(dx, dy)
  orbMouseDownPos = null

  // 拖拽（移动 > 10px）不触发，阈值放宽容忍窗口微移
  // 同时取消可能挂起的长按定时器，并关闭已触发的闪动
  if (dist > 10) {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    if (longPressActive.value) {
      longPressActive.value = false
    }
    return
  }

  // 点按和长按都触发 transition ring（环扩散 + 粒子爆发）
  transitionNonce.value += 1
  transitionFx.value = { time: Date.now() }

  if (transitionTimer !== null) clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => {
    transitionFx.value = null
    transitionTimer = null
  }, 800)

  // 触发轨道重排动画（通过 CSS class）
  const svg = document.querySelector('.pet-orb__svg')
  if (svg) {
    svg.classList.add('pet-orb__svg--transition')
    setTimeout(() => {
      svg.classList.remove('pet-orb__svg--transition')
    }, 600)
  }

  // 长按闪动收尾：
  // - longPressActive 已 true（mousedown 后 200ms 已触发闪动）：保持 600ms 后关闭
  // - longPressTimer 仍挂起（dt < 200ms，快速单击）：取消定时器，不触发闪动
  if (longPressActive.value) {
    if (longPressTimer !== null) clearTimeout(longPressTimer)
    longPressTimer = setTimeout(() => {
      longPressActive.value = false
      longPressTimer = null
    }, 600)
  } else if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

// ============================================================
// 键盘敲击反馈（连击系统）
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
  if (combo >= 18) return 3
  if (combo >= 7) return 2
  return 1
}

function applyKeyFx (category) {
  // 首次敲击记录起始时间
  if (comboCount.value === 0) {
    comboStartTime = Date.now()
    comboTotalHits = 0
  }
  comboCount.value += 1
  comboTotalHits += 1
  comboTier.value = tierOf(comboCount.value)

  if (comboTimer !== null) clearTimeout(comboTimer)
  comboTimer = setTimeout(() => {
    // 连击结束：计算并显示敲击速度（至少 2 次才有意义）
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

// 窗口隐藏时暂停所有 CSS 动画，避免 GPU 空转（11 个无限循环动画）
// 恢复可见时自动继续播放，视觉效果无损失
function handleOrbVisibilityChange () {
  const orbEl = document.querySelector('.pet-orb')
  if (!orbEl) return
  if (document.hidden) {
    orbEl.classList.add('pet-orb--anim-paused')
  } else {
    orbEl.classList.remove('pet-orb--anim-paused')
  }
}

onMounted(() => {
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseleave', handleMouseLeave)
  document.addEventListener('visibilitychange', handleOrbVisibilityChange)

  unsubscribeKey = on('pet:key-input', (payload) => {
    if (payload && payload.category) {
      applyKeyFx(payload.category)
    }
  })
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseleave', handleMouseLeave)
  document.removeEventListener('visibilitychange', handleOrbVisibilityChange)
  window.removeEventListener('mouseup', handleOrbGlobalMouseUp)
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (orbMoveRafId !== null) {
    cancelAnimationFrame(orbMoveRafId)
    orbMoveRafId = null
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
  if (circuitTimer !== null) {
    clearTimeout(circuitTimer)
    circuitTimer = null
  }
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  if (unsubscribeKey) {
    unsubscribeKey()
    unsubscribeKey = null
  }
})

/**
 * 根据状态生成 CSS 自定义变量
 */
const orbStyle = computed(() => ({
  '--orb-rx': `${(-mouse.ny * 10).toFixed(2)}deg`,
  '--orb-ry': `${(mouse.nx * 14).toFixed(2)}deg`,
  '--orb-tx': `${(mouse.nx * 8).toFixed(2)}px`,
  '--orb-ty': `${(mouse.ny * 6).toFixed(2)}px`,
  '--orb-hx': `${(mouse.nx * 12).toFixed(2)}px`,
  '--orb-hy': `${(mouse.ny * 10).toFixed(2)}px`,
  // 电路纹路闪现强度（直接映射到 opacity）
  '--orb-circuit-flash': wobble.circuitFlash.toFixed(2)
}))
</script>

<style scoped lang="scss">
.pet-orb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  perspective: 800px;
  cursor: grab;
  pointer-events: auto;
  overflow: visible;

  // ============ 配色令牌 ============
  --orb-sphere-light: #F2FBFF;
  --orb-sphere-mid: #8ECBFF;
  --orb-sphere-deep: #2B6BD8;
  --orb-sphere-dark: #0E2F85;
  --orb-core-hot: #EAFDFF;
  --orb-core-1: #4CC2FF;
  --orb-core-2: #7C4DFF;
  --orb-ring-1: #4CC2FF;
  --orb-ring-2: #7C4DFF;
  --orb-glow-color: #4CC2FF;
  --orb-glow-alpha: 0.42;
  --orb-particle: #CFE9FF;
  --orb-alert: #FF5C7C;
  --orb-sp3-1: #4CC2FF;
  --orb-sp3-2: #7C4DFF;

  &__svg {
    width: 100%;
    height: 100%;
    display: block;
    background: transparent;
    overflow: visible;
    scale: 1;
    transform: translate(var(--orb-tx, 0px), var(--orb-ty, 0px))
               rotateX(var(--orb-rx, 0deg))
               rotateY(var(--orb-ry, 0deg));
    transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
                scale var(--pet-motion-normal, 250ms) ease;
    animation: orb-float 4.5s ease-in-out infinite;

    // 量子跃迁轨道重排
    &--transition {
      animation: orb-transition 0.6s ease-out;
    }
  }

  &__sphere,
  &__core,
  &__core-ring {
    transform-origin: 100px 100px;
    transform-box: view-box;
  }

  &__specular {
    transform: translate(var(--orb-hx, 0px), var(--orb-hy, 0px));
    transition: transform var(--pet-motion-normal, 250ms) ease;
  }

  &__glow {
    transform-origin: 100px 100px;
    transform-box: view-box;
    animation: orb-breathe 3.5s ease-in-out infinite;
  }

  // 内部电路纹路（JavaScript 控制 opacity）
  &__circuit {
    opacity: 0;
    transition: opacity 0.3s ease;
    filter: drop-shadow(0 0 3px var(--orb-core-1, #4CC2FF));
  }

  // 拨动时电路纹路闪现（通过 CSS 变量控制）
  &--circuit-active .pet-orb__circuit {
    opacity: calc(var(--orb-circuit-flash, 0) * 0.9);
  }

  // 土星环（固定倾斜角度，不旋转；前后分层绘制）
  // 倾斜角度通过 SVG transform 属性设置（rotate(-18 100 100)）
  &__saturn-ring {
    filter: drop-shadow(0 0 8px rgba(76, 194, 255, 0.3));
  }

  &__saturn-flow {
    stroke-dashoffset: 0;
    animation: saturn-flow 8s linear infinite;
  }

  // sp³ 杂化轨道（围绕球心 100,100 旋转）
  &__sp3 {
    transform-origin: 100px 100px;
    transform-box: view-box;
    animation: sp3-rotate 25s linear infinite;
  }

  &__sp3-axis {
    transform-box: view-box;
    transform-origin: 100px 100px;
  }

  &__sp3-lobe {
    opacity: 0.4;
    filter: blur(1px);
  }

  &__sp3-electron {
    transform-box: view-box;
    transform-origin: 100px 100px;
    filter: drop-shadow(0 0 2px var(--orb-core-1, #4CC2FF));
  }

  // 轨道环
  &__ring {
    &--static { opacity: 0.4; }
    &--flow {
      stroke-dasharray: 54 260;
      animation: orb-dash-flow 5s linear infinite;
    }
    &--flow-rev {
      stroke-dasharray: 40 240;
      animation: orb-dash-flow-rev 7s linear infinite;
    }
  }

  // 环绕粒子（围绕球心 100,100 旋转）
  &__particle {
    transform-box: view-box;
    transform-origin: 100px 100px;
    &--1 { animation: orb-spin 14s linear infinite; }
    &--2 { animation: orb-spin-rev 20s linear infinite; }
  }

  // 量子场涟漪（围绕球心 100,100 扩散）
  &__quantum-ripple {
    pointer-events: none;
    transform-origin: 100px 100px;
    transform-box: view-box;

    &--inner {
      animation: quantum-ripple-inner 0.8s ease-out forwards;
    }
    &--outer {
      animation: quantum-ripple-outer 1s ease-out forwards;
    }
  }

  &__quantum-ring {
    fill: none;
    stroke: var(--orb-core-1, #4CC2FF);
    stroke-width: 1;
    stroke-dasharray: 4 6;
    opacity: 0.7;
  }

  // 量子跃迁
  &__transition {
    pointer-events: none;
  }

  &__transition-ring {
    transform-origin: 100px 100px;
    transform-box: view-box;
    fill: none;

    &--1 {
      stroke: var(--orb-core-1, #4CC2FF);
      stroke-width: 2.5;
      animation: transition-ring-1 0.6s ease-out forwards;
    }
    &--2 {
      stroke: var(--orb-core-2, #7C4DFF);
      stroke-width: 1.5;
      animation: transition-ring-2 0.6s ease-out forwards;
    }
    &--3 {
      stroke: #FFE8A3;
      stroke-width: 1;
      animation: transition-ring-3 0.6s ease-out forwards;
    }
  }

  &__transition-burst {
    transform-origin: 100px 100px;
    transform-box: view-box;
    animation: transition-burst 0.6s ease-out forwards;

    circle {
      fill: #FFE8A3;
      filter: drop-shadow(0 0 4px #FFD24D);
    }
  }

  // 键盘敲击反馈
  &__keyfx {
    pointer-events: none;
    --orb-key-color: #4CC2FF;
    --orb-key-scale: 1.8;
    --orb-key-width: 2;

    &--tier2 { --orb-key-scale: 2.2; --orb-key-width: 2.5; }
    &--tier3 { --orb-key-scale: 2.8; --orb-key-width: 3; }

    &--space { --orb-key-color: #EAFDFF; }
    &--enter { --orb-key-color: #B18CFF; }
    &--backspace { --orb-key-color: #FF8A5C; }
    &--tab { --orb-key-color: #4CF2C0; }
    &--arrow { --orb-key-color: #6FC4FF; }
    &--modifier { --orb-key-color: #B78CFF; --orb-key-scale: 1.4; }
    &--escape { --orb-key-color: #FF5C7C; }
  }

  &__keyfx-ring {
    stroke: var(--orb-key-color);
    stroke-width: var(--orb-key-width, 2);
    transform-origin: 100px 100px;
    transform-box: view-box;
    animation: orb-key-ring 0.5s ease-out forwards;
  }

  &__keyfx-burst {
    transform-origin: 100px 100px;
    transform-box: view-box;
    animation: orb-key-burst 0.55s ease-out forwards;

    circle { fill: var(--orb-key-color); }
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
    animation: combo-pop 0.3s ease-out;
  }
  &__combo-text {
    fill: #4CC2FF;
    font-size: 18px;
    font-weight: 900;
    font-family: Arial, sans-serif;
    filter: drop-shadow(0 0 6px rgba(76, 194, 255, 0.9));
    transform-origin: 140px 36px;
    transform-box: view-box;
    animation: combo-pop 0.3s ease-out;
  }
  // tier 2 紫
  &__combo--tier2 .pet-orb__combo-bg { stroke: #7C4DFF; }
  &__combo--tier2 .pet-orb__combo-text {
    fill: #7C4DFF;
    filter: drop-shadow(0 0 6px rgba(124, 77, 255, 0.9));
  }
  // tier 3 金
  &__combo--tier3 .pet-orb__combo-bg { stroke: #FFD24D; }
  &__combo--tier3 .pet-orb__combo-text {
    fill: #FFE8A3;
    filter: drop-shadow(0 0 6px rgba(255, 170, 60, 0.9));
  }

  // 层级指示条（tier 1=蓝, 2=紫, 3=金）
  &__combo-tier {
    transform-origin: 140px 44px;
    transform-box: view-box;
    animation: combo-pop 0.3s ease-out;
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

  // 敲击速度显示（连击结束后）
  &__combo-speed {
    pointer-events: none;
    transform-origin: 60px 40px;
    transform-box: view-box;
    animation: speed-show 1.5s ease-out forwards;
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
    .pet-orb__svg {
      scale: 1.05;
    }
    .pet-orb__glow {
      animation-duration: 1.8s;
    }
  }

}

// 状态装饰
.pet-orb__alert { opacity: 0; transition: opacity var(--pet-motion-normal, 250ms) ease; }
.pet-orb__zzz { opacity: 0; }

// 窗口隐藏时暂停所有动画，释放 GPU 合成层
.pet-orb--anim-paused,
.pet-orb--anim-paused * {
  animation-play-state: paused !important;
}

// ============================================================
// 各状态动画
// ============================================================
.pet-orb--idle {
  .pet-orb__core { animation: orb-core-breathe 3.5s ease-in-out infinite; }
  .pet-orb__core-ring { animation: orb-core-ring-breathe 3.5s ease-in-out infinite; }
  .pet-orb__sp3-electron { opacity: 0.6; }
}

.pet-orb--happy {
  .pet-orb__core { animation: orb-core-happy 1.2s ease-in-out infinite; }
  .pet-orb__core-ring { animation: orb-core-ring-happy 1.2s ease-in-out infinite; }
  .pet-orb__glow { animation: orb-glow-happy 1.6s ease-in-out infinite; }
  .pet-orb__ring--flow { animation-duration: 2.5s; }
  .pet-orb__ring--flow-rev { animation-duration: 3.5s; }
  .pet-orb__sp3 { animation-duration: 12s; }
  .pet-orb__svg { animation: orb-bounce 1.2s ease-in-out infinite; }
}

.pet-orb--reminding {
  --orb-core-1: #FFB03A;
  --orb-core-2: #FF5C7C;
  --orb-glow-color: #FF8A5C;
  --orb-ring-1: #FFB03A;
  --orb-ring-2: #FF5C7C;
  --orb-sp3-1: #FFB03A;
  --orb-sp3-2: #FF5C7C;

  .pet-orb__core { animation: orb-core-alert 0.5s ease-in-out infinite; }
  .pet-orb__core-ring { animation: orb-core-ring-alert 0.5s ease-in-out infinite; }
  .pet-orb__glow { animation: orb-breathe 0.9s ease-in-out infinite; }
  .pet-orb__sphere { animation: orb-pulse 0.8s ease-in-out infinite; }
  .pet-orb__alert {
    opacity: 1;
    animation: orb-alert-bob 0.6s ease-in-out infinite;
  }
  .pet-orb__ring--flow { animation-duration: 1.8s; }
  .pet-orb__sp3 { animation-duration: 18s; }
}

.pet-orb--sleeping {
  --orb-glow-alpha: 0.22;

  .pet-orb__sphere { opacity: 0.82; }
  .pet-orb__core { opacity: 0.4; animation: orb-core-breathe 5s ease-in-out infinite; }
  .pet-orb__core-ring { opacity: 0.35; animation: orb-core-ring-breathe 5s ease-in-out infinite; }
  .pet-orb__glow { animation: orb-breathe 5s ease-in-out infinite; }
  .pet-orb__ring--flow { animation-duration: 10s; }
  .pet-orb__ring--flow-rev { animation-duration: 14s; }
  .pet-orb__sp3 { animation-duration: 40s; }
  .pet-orb__sp3-electron { opacity: 0.2; }
  .pet-orb__zzz { opacity: 1; }
  .pet-orb__z {
    animation: orb-z-float 2.4s ease-in-out infinite;
    opacity: 0;
    &--1 { animation-delay: 0s; }
    &--2 { animation-delay: 0.8s; }
    &--3 { animation-delay: 1.6s; }
  }
  .pet-orb__svg { animation: orb-float 6s ease-in-out infinite; }
}

// ============================================================
// 关键帧
// ============================================================
@keyframes orb-float {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -2px; }
}
@keyframes orb-bounce {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -6px; }
}
@keyframes orb-breathe {
  0%, 100% { opacity: 0.75; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.06); }
}
@keyframes orb-core-breathe {
  0%, 100% { transform: scale(0.92); opacity: 0.85; }
  50% { transform: scale(1.06); opacity: 1; }
}
@keyframes orb-core-ring-breathe {
  0%, 100% { transform: scale(0.9); opacity: 0.45; }
  50% { transform: scale(1.1); opacity: 0.75; }
}
@keyframes orb-core-happy {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: 1; }
}
@keyframes orb-core-ring-happy {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.28); opacity: 0.9; }
}
@keyframes orb-core-alert {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.14); opacity: 0.8; }
}
@keyframes orb-core-ring-alert {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.32); opacity: 0.5; }
}
@keyframes orb-glow-happy {
  0%, 100% { transform: scale(1); opacity: 0.75; }
  50% { transform: scale(1.12); opacity: 1; }
}
@keyframes orb-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}
@keyframes orb-dash-flow {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: -314; }
}
@keyframes orb-dash-flow-rev {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: 280; }
}
@keyframes orb-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes orb-spin-rev {
  from { transform: rotate(0deg); }
  to { transform: rotate(-360deg); }
}
@keyframes orb-alert-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes orb-z-float {
  0% { opacity: 0; transform: translateY(0); }
  30% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-12px); }
}

// 土星环流光（沿环缝流动，不旋转环体）
@keyframes saturn-flow {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: -200; }
}

// sp³ 杂化轨道旋转
@keyframes sp3-rotate {
  from { transform: rotateZ(0deg); }
  to { transform: rotateZ(360deg); }
}

// 量子场涟漪：同心等势线扩散
@keyframes quantum-ripple-inner {
  0% { transform: scale(0.3); opacity: 0.9; }
  100% { transform: scale(2.2); opacity: 0; }
}
@keyframes quantum-ripple-outer {
  0% { transform: scale(0.2); opacity: 0.7; }
  100% { transform: scale(2.8); opacity: 0; }
}

// 量子跃迁：能级跃迁 + 轨道重排
@keyframes orb-transition {
  0% { filter: brightness(1.2) saturate(1.5); }
  50% { filter: brightness(1.8) saturate(2); }
  100% { filter: brightness(1) saturate(1); }
}
@keyframes transition-ring-1 {
  0% { transform: scale(0.6); opacity: 0.95; stroke-width: 4; }
  100% { transform: scale(2.5); opacity: 0; stroke-width: 0.5; }
}
@keyframes transition-ring-2 {
  0% { transform: scale(0.6); opacity: 0.8; stroke-width: 3; }
  100% { transform: scale(3); opacity: 0; stroke-width: 0.3; }
}
@keyframes transition-ring-3 {
  0% { transform: scale(0.5); opacity: 1; }
  100% { transform: scale(3.5); opacity: 0; }
}
@keyframes transition-burst {
  0% { transform: scale(0.2); opacity: 1; }
  100% { transform: scale(2.5); opacity: 0; }
}

// 敲击扩散环
@keyframes orb-key-ring {
  0% { transform: scale(0.55); opacity: 0.95; }
  100% { transform: scale(var(--orb-key-scale, 1.8)); opacity: 0; }
}
@keyframes orb-key-burst {
  0% { transform: scale(0.3); opacity: 1; }
  100% { transform: scale(2.2); opacity: 0; }
}

// 连击徽章弹出
@keyframes combo-pop {
  0% { transform: scale(1.8); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

// 敲击速度显示（淡入停留后淡出）
@keyframes speed-show {
  0% { transform: scale(0.6); opacity: 0; }
  15% { transform: scale(1.1); opacity: 1; }
  25% { transform: scale(1); opacity: 1; }
  75% { transform: scale(1); opacity: 1; }
  100% { transform: scale(1); opacity: 0; }
}
</style>