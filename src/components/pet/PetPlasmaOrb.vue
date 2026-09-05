<!--
  桌宠科技球角色组件（等离子体球形态）
  职责：内联 SVG 绘制玻璃球壳 + 中心电极，Canvas 2D 手写 3D 投影绘制
        立体电弧丝（核心向玻璃内壁放电），并响应鼠标与键盘互动
  Props:
    - state: 当前状态（idle / reminding / happy / sleeping）
  设计参考：等离子球（plasma globe）+ Stripe/Linear 首页"全息能量体"质感
    - 玻璃球壳：半透明，让内部电弧透出，边缘高光强化玻璃质感
    - 中心电极：发光核心，电弧由此向内壁放电
    - 电弧丝：立体紫红/品红/蓝白电流，随机蜿蜒、分叉、放电脉冲，加法混合发光
    - 球面外圈柔和光晕（canvas 内绘制，随状态呼吸）
  鼠标互动：
    - 视差：整体随鼠标位置平移 + 3D tilt（CSS 变量驱动）

    - 凝聚：鼠标靠近球体 → 电弧端点向鼠标在球面上的投影点吸引并变亮
  键盘互动（主进程 pet:key-input 推送分类，仅视觉反馈）：
    - 每次敲击：独立扩散能量环 + 迸发粒子（连击叠加）
    - 连击系统：连击数驱动脉冲强度进阶，3 连击起显示 ×N 徽章
    - viewBox 0 0 140 140
-->
<template>
  <div
    class="pet-orb"
    :class="`pet-orb--${state}`"
    @mouseenter="handleOrbEnter"
    @mousemove="handleOrbMove"
    @mouseleave="handleOrbLeave"
  >
    <div class="pet-orb__stage" :style="stageStyle">
      <!-- 等离子电弧层（canvas 3D 投影，绘于玻璃球壳之下） -->
      <canvas ref="plasmaRef" class="pet-orb__plasma"></canvas>

      <!-- ====================================================== -->
      <!-- 玻璃球壳 + 中心电极 + 高光（SVG 层，叠于电弧之上）      -->
      <!-- ====================================================== -->
      <svg class="pet-orb__svg" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <!-- 玻璃球壳：半透明，让内部电弧透出 -->
          <radialGradient id="orbSphereGrad" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.30" />
            <stop offset="45%" stop-color="#9ECBFF" stop-opacity="0.18" />
            <stop offset="78%" stop-color="#2B6BD8" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#0E2F85" stop-opacity="0.42" />
          </radialGradient>
          <!-- 中心电极：白青 → 状态色（青/紫，由 CSS 变量驱动） -->
          <radialGradient id="orbCoreGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="var(--orb-core-hot, #EAFDFF)" />
            <stop offset="48%" stop-color="var(--orb-core-1, #4CC2FF)" />
            <stop offset="100%" stop-color="var(--orb-core-2, #7C4DFF)" />
          </radialGradient>
          <!-- 球面高光：白斑径向衰减 -->
          <radialGradient id="orbSpecGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95" />
            <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
          </radialGradient>
        </defs>

        <!-- 地面阴影 -->
        <ellipse class="pet-orb__shadow" cx="70" cy="128" rx="30" ry="4.5" fill="#0A0A0A" opacity="0.12" />

        <!-- 玻璃球壳 -->
        <circle class="pet-orb__sphere" cx="70" cy="70" r="40" fill="url(#orbSphereGrad)" />
        <circle class="pet-orb__sphere-rim" cx="70" cy="70" r="39.4" fill="none" stroke="#FFFFFF" stroke-width="0.8" opacity="0.5" />
        <path class="pet-orb__sphere-shade" d="M 42 90 A 40 40 0 0 0 98 90 A 34 34 0 0 1 42 90 Z" fill="#0E2F85" opacity="0.28" />

        <!-- 中心电极 -->
        <circle class="pet-orb__core" cx="70" cy="70" r="9" fill="url(#orbCoreGrad)" />
        <circle class="pet-orb__core-ring" cx="70" cy="70" r="13" fill="none" stroke="var(--orb-core-1, #4CC2FF)" stroke-width="0.8" opacity="0.6" />

        <!-- 球面高光（随鼠标追踪） -->
        <g class="pet-orb__specular">
          <circle cx="56" cy="46" r="12" fill="url(#orbSpecGrad)" />
        </g>

        <!-- 键盘敲击：独立扩散环 + 迸发粒子（连击叠加、不断层） -->
        <g
          v-for="fx in fxList"
          :key="fx.id"
          class="pet-orb__keyfx"
          :class="`pet-orb__keyfx--${fx.category} pet-orb__keyfx--tier${fx.tier}`"
        >
          <circle class="pet-orb__keyfx-ring" cx="70" cy="70" r="28" fill="none" />
          <g class="pet-orb__keyfx-burst">
            <circle cx="48" cy="48" r="2.2" />
            <circle cx="92" cy="48" r="2.2" />
            <circle cx="48" cy="92" r="1.8" />
            <circle cx="92" cy="92" r="1.8" />
            <circle cx="70" cy="38" r="1.6" />
          </g>
        </g>

        <!-- 连击徽章 -->
        <g v-if="comboCount >= 3" class="pet-orb__combo" :key="comboCount">
          <text class="pet-orb__combo-text" x="102" y="26" text-anchor="middle">×{{ comboCount }}</text>
        </g>

        <!-- 状态装饰：提醒牌子 -->
        <g class="pet-orb__alert">
          <line x1="70" y1="22" x2="70" y2="14" stroke="var(--orb-alert, #FF5C7C)" stroke-width="2" stroke-linecap="round" />
          <circle cx="70" cy="8" r="9" fill="var(--orb-alert, #FF5C7C)" />
          <text x="70" y="12" text-anchor="middle" font-size="12" font-weight="700" fill="#FFFFFF" font-family="Arial, sans-serif">!</text>
        </g>

        <!-- 状态装饰：Z 字 -->
        <g class="pet-orb__zzz">
          <text class="pet-orb__z pet-orb__z--1" x="98" y="30" font-size="11" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
          <text class="pet-orb__z pet-orb__z--2" x="108" y="20" font-size="15" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
          <text class="pet-orb__z pet-orb__z--3" x="119" y="9" font-size="19" font-weight="700" fill="#9AA5B1" font-family="Arial, sans-serif">Z</text>
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, nextTick } from 'vue'
import { on } from '@/utils/ipc-client'

const props = defineProps({
  state: {
    type: String,
    default: 'idle',
    validator: (val) => ['idle', 'reminding', 'happy', 'sleeping'].includes(val)
  }
})

function clamp (v, min, max) {
  return Math.min(max, Math.max(min, v))
}

// ============================================================
// 鼠标视差（相对窗口中心，用于整体平移 + 3D tilt）
// ============================================================
const mouse = reactive({ nx: 0, ny: 0 })
let latestPointer = null
let rafId = null

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

// ============================================================
// 鼠标拨动 + 电弧凝聚（球体上的 mousemove，驱动 canvas 电弧）
// ============================================================
const wobble = reactive({ skewX: 0, skewY: 0, squash: 0 })
// 电弧三维旋转角速度（拨动惯性）
const spin = { omegaX: 0, omegaY: 0, rotX: 0, rotY: 0 }
// 鼠标在球面上的投影方向 + 吸引权重
const attract = { x: 0, y: 0, z: 1, weight: 0 }
let orbRect = null
let lastOrbPointer = null
let orbMoveRafId = null
let pendingOrbMove = null
let attractDecay = 0

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

    // 果冻形变（弱化，主要 3D 感来自电弧场旋转）
    if (speed >= 1) {
      const k = Math.min(speed / 60, 1)
      const ang = Math.atan2(vy, vx)
      wobble.skewX = Math.round(Math.cos(ang) * k * 4)
      wobble.skewY = Math.round(Math.sin(ang) * k * 4)
      wobble.squash = Math.round(k * 0.03 * 1000) / 1000
      // 拨动：将移动速度转为电弧场三维角速度（沿划过切线轴旋转）
      spin.omegaY = clamp(spin.omegaY + vx * 0.004, -0.25, 0.25)
      spin.omegaX = clamp(spin.omegaX - vy * 0.004, -0.25, 0.25)
    }

    // 更新鼠标在球面上的投影 + 吸引权重
    updateAttract(e.clientX, e.clientY, true)
  })
}

function handleOrbLeave () {
  lastOrbPointer = null
  wobble.skewX = 0
  wobble.skewY = 0
  wobble.squash = 0
  // 让吸引权重平滑衰减，电弧自然恢复均匀分布
  attractDecay = 1
  orbRect = null
}

/**
 * 将鼠标屏幕坐标反投影到球面，更新吸引方向
 * @param {number} clientX 屏幕 X
 * @param {number} clientY 屏幕 Y
 * @param {boolean} near 鼠标是否正在球体上
 */
function updateAttract (clientX, clientY, near) {
  if (!orbRect || !plasmaCenter) return
  const cx = orbRect.left + orbRect.width / 2
  const cy = orbRect.top + orbRect.height / 2
  // 半径取球体投影半径（相对容器大小）
  const R = orbRect.width * 0.2857
  const nx = (clientX - cx) / (R || 1)
  const ny = (clientY - cy) / (R || 1)
  const len = Math.hypot(nx, ny)
  if (len <= 1) {
    attract.x = nx
    attract.y = ny
    attract.z = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
    attract.weight = near ? clamp(attract.weight + 0.15, 0, 1) : attract.weight
  } else {
    const n = len || 1
    attract.x = nx / n
    attract.y = ny / n
    attract.z = 0
    attract.weight = near ? clamp(attract.weight + 0.08, 0, 1) : attract.weight
  }
  attractDecay = 0
}

// ============================================================
// 键盘敲击反馈：连击系统
// ============================================================
const fxList = ref([])
const comboCount = ref(0)
let fxSeq = 0
let comboTimer = null
let unsubscribeKey = null
const COMBO_RESET_MS = 500
const FX_LIFETIME_MS = 700

function tierOf (combo) {
  if (combo >= 7) return 3
  if (combo >= 4) return 2
  return 1
}

function applyKeyFx (category) {
  comboCount.value += 1
  if (comboTimer !== null) clearTimeout(comboTimer)
  comboTimer = setTimeout(() => {
    comboCount.value = 0
    comboTimer = null
  }, COMBO_RESET_MS)

  const item = { id: ++fxSeq, category, tier: tierOf(comboCount.value), combo: comboCount.value }
  fxList.value.push(item)
  if (fxList.value.length > 8) fxList.value.shift()
  setTimeout(() => {
    fxList.value = fxList.value.filter(f => f.id !== item.id)
  }, FX_LIFETIME_MS)
}

// ============================================================
// Canvas 等离子电弧渲染（3D 投影，零依赖）
// ============================================================
const plasmaRef = ref(null)
let canvas = null
let ctx = null
let dpr = 1
let size = 0              // canvas CSS 边长
let center = 0            // 球心屏幕坐标
let plasmaCenter = 0      // 供 updateAttract 使用
let plasmaR = 0           // 球体投影半径
let resizeObserver = null
let rafLoopId = null
let lastTime = 0
let slowFrame = 0

const ARC_COUNT = 26
const SEGMENTS = 8
const arcs = []

// 状态 → 电弧颜色主题
function arcPalette (state) {
  switch (state) {
    case 'reminding': return ['#FFB03A', '#FF5C7C', '#FF8A5C', '#FFE0B0']
    case 'happy': return ['#B06BFF', '#FF5C9E', '#7C6BFF', '#5CE1E6']
    case 'sleeping': return ['#5C4B7A', '#4A5C7A', '#6B5B8A', '#51547A']
    default: return ['#B06BFF', '#FF5C9E', '#7C6BFF', '#4CC2FF']
  }
}

function initArcs () {
  arcs.length = 0
  // Fibonacci 球面均匀分布 → 电弧端点均匀覆盖球面
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < ARC_COUNT; i++) {
    const y = 1 - (i / (ARC_COUNT - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y)) || 0
    const theta = golden * i
    arcs.push({
      th: theta,
      ph: Math.acos(y),
      baseTh: theta + (Math.random() - 0.5) * 0.5,
      seed: Math.random() * 1000,
      wobble: 0.05 + Math.random() * 0.16,
      pulse: 0,
      pulseAt: Math.random() * 2500,
      branches: Math.random() < 0.5 ? 1 : 2
    })
  }
}

/**
 * 球坐标 → 方向向量，再应用电弧场旋转（rotX/rotY）
 */
function direction (th, ph) {
  let x = Math.sin(ph) * Math.cos(th)
  let y = Math.sin(ph) * Math.sin(th)
  let z = Math.cos(ph)
  // 绕 Y 轴
  const cy = Math.cos(spin.rotY), sy = Math.sin(spin.rotY)
  const x1 = x * cy + z * sy
  const z1 = -x * sy + z * cy
  // 绕 X 轴
  const cx = Math.cos(spin.rotX), sx = Math.sin(spin.rotX)
  const y1 = y * cx - z1 * sx
  const z2 = y * sx + z1 * cx
  return { x: x1, y: y1, z: z2 }
}

/**
 * 更新电弧场：旋转积分、吸引权重、每条电弧的蜿蜒相位与放电脉冲
 * @param {number} dt 秒
 */
function update (dt) {
  // 缓慢自转（无鼠标时电弧场仍缓慢转动，彰显 3D）
  spin.rotY += (0.12 + spin.omegaY) * dt
  spin.rotX += spin.omegaX * dt
  // 拨动惯性阻尼
  spin.omegaX *= Math.pow(0.02, dt)
  spin.omegaY *= Math.pow(0.02, dt)

  // 鼠标吸引权重衰减（离开球体后逐渐恢复自然分布）
  if (attractDecay > 0) {
    attract.weight = Math.max(0, attract.weight - dt * 2.5)
    if (attract.weight <= 0) attractDecay = 0
  }

  const now = performance.now()
  for (const a of arcs) {
    a.th += (Math.random() - 0.5) * 0.02
    // 放电脉冲：到点触发，随后指数衰减
    if (now >= a.pulseAt) {
      a.pulse = 1
      a.pulseAt = now + 400 + Math.random() * 2200
    } else {
      a.pulse = Math.max(0, a.pulse - dt * 4.5)
    }
  }
}

/**
 * 绘制一帧 plasma：光晕 + 电弧（按深度排序，加法混合发光）
 */
function render () {
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  // 光晕（球外泛光，随状态呼吸）
  const breathe = 0.5 + 0.5 * Math.sin(performance.now() / 1600)
  const glowAlpha = props.state === 'sleeping' ? 0.10 : 0.16 + breathe * 0.10
  const glowColor = props.state === 'reminding' ? '255,138,92' : '76,194,255'
  const glow = ctx.createRadialGradient(center, center, plasmaR * 0.4, center, center, plasmaR * 1.9)
  glow.addColorStop(0, `rgba(${glowColor},${glowAlpha})`)
  glow.addColorStop(1, `rgba(${glowColor},0)`)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // 计算每条电弧的投影路径 + 深度
  const palette = arcPalette(props.state)
  const drawn = []
  for (const a of arcs) {
    const dir = direction(a.th, a.ph)
    // 鼠标吸引：端点方向向鼠标方向偏移
    let dx = dir.x, dy = dir.y, dz = dir.z
    if (attract.weight > 0) {
      const dot = dx * attract.x + dy * attract.y + dz * attract.z
      const align = clamp((dot + 1) / 2, 0, 1) // 越靠近鼠标方向越被吸引
      const s = attract.weight * (0.25 + align * 0.75)
      dx += (attract.x - dx) * s
      dy += (attract.y - dy) * s
      dz += (attract.z - dz) * s
      const n = Math.hypot(dx, dy, dz) || 1
      dx /= n; dy /= n; dz /= n
    }
    drawn.push(buildArcPoints(a, dx, dy, dz, palette))
  }

  // 深度排序：背面先画、正面后画
  drawn.sort((p, q) => p.depth - q.depth)

  // 电弧（加法混合，重叠发光）
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const arcList of drawn) {
    for (const path of arcList.paths) {
      drawArcPath(path)
    }
  }
  ctx.globalCompositeOperation = 'source-over'
}

/**
 * 构建一条电弧的屏幕路径点（蜿蜒 + 分支），返回 { paths, depth }
 * @returns {{ paths: Array<{pts:Array, color:string, amp:number}>, depth:number }}
 */
function buildArcPoints (arc, dx, dy, dz, palette) {
  // 方向向量的正交基（用于切向蜿蜒扰动）
  const norm = Math.hypot(dx, dy, dz) || 1
  const dnx = dx / norm, dny = dy / norm, dnz = dz / norm
  // T1 = normalize(cross(dir, up))，up = (0, 0, 1)
  let t1x, t1y, t1z
  if (Math.abs(dnz) < 0.9) {
    t1x = dny; t1y = -dnx; t1z = 0
    const tl = Math.hypot(t1x, t1y) || 1
    t1x /= tl; t1y /= tl
  } else {
    t1x = 1; t1y = 0; t1z = 0
  }
  // T2 = cross(dir, T1)，与 T1 构成球面切平面正交基
  const t2x = dny * t1z - dnz * t1y
  const t2y = dnz * t1x - dnx * t1z
  const t2z = dnx * t1y - dny * t1x

  const colorIdx = (arc.seed | 0) % palette.length
  const color = palette[colorIdx]
  const t = performance.now() / 1000
  const wobR = arc.wobble * plasmaR

  const paths = []
  const baseAmp = props.state === 'sleeping' ? 0.35 : 1
  const amp = baseAmp * (0.65 + arc.pulse * 0.75)
  const depth = dnz

  // 主电弧：从电极末端（0.14R）蜿蜒到内壁（1.0R）
  const mainPts = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const r = 0.14 + (i / SEGMENTS) * 0.86
    const n1 = Math.sin(arc.seed * 7.3 + t * 2.1 + i * 1.7)
    const n2 = Math.cos(arc.seed * 5.1 + t * 1.6 + i * 1.3)
    const ox = (t1x * n1 + t2x * n2) * wobR
    const oy = (t1y * n1 + t2y * n2) * wobR
    const oz = (t1z * n1 + t2z * n2) * wobR
    mainPts.push({
      x: center + dnx * r * plasmaR + ox,
      y: center + dny * r * plasmaR + oy,
      z: dnz * r * plasmaR + oz
    })
  }
  paths.push({ pts: mainPts, color, amp })

  // 分支电弧：接近内壁处分叉，增强放电感
  const branchCount = arc.pulse > 0.35 ? arc.branches : arc.branches - 1
  if (branchCount > 0) {
    for (let b = 0; b < branchCount; b++) {
      const side = b === 0 ? 1 : -1
      const bPts = []
      for (let i = 0; i <= 3; i++) {
        const r = 0.6 + (i / 3) * 0.4
        const n1 = Math.sin(arc.seed * 9.1 + b * 3.3 + t * 2.8 + i * 2.1)
        const n2 = Math.cos(arc.seed * 6.7 + b * 2.9 + t * 2.3 + i * 1.9)
        const off = wobR * (0.7 + i * 0.4) * side
        bPts.push({
          x: center + dnx * r * plasmaR + (t1x * n1 + t2x * n2) * off,
          y: center + dny * r * plasmaR + (t1y * n1 + t2y * n2) * off,
          z: dnz * r * plasmaR + (t1z * n1 + t2z * n2) * off
        })
      }
      paths.push({ pts: bPts, color, amp: amp * 0.7 })
    }
  }

  return { paths, depth }
}

/**
 * 绘制一条电弧路径（两次描边：光晕层 + 亮芯层）
 */
function drawArcPath (path) {
  const { pts, color, amp } = path
  if (pts.length < 2) return
  // 深度亮暗（背面暗、正面亮）
  const zNorm = pts.reduce((s, p) => s + p.z, 0) / pts.length / plasmaR
  const depthFactor = 0.35 + clamp(zNorm * 0.65 + 0.5, 0, 0.8)
  const alpha = clamp(amp, 0, 1) * depthFactor

  const step = Math.max(1, Math.round(1.4 * plasmaR))
  const build = (width, a) => {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    ctx.lineWidth = width
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y)
    }
    ctx.strokeStyle = hexToRgba(path.color, a)
    ctx.stroke()
  }

  const lw = step * 0.22
  build(lw * 2.6, alpha * 0.22) // 外层光晕
  build(lw, alpha * 0.95)        // 亮芯
}

function hexToRgba (hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * 同步 canvas 尺寸与 DPR（角色尺寸 60~300 可变，ResizeObserver 监听）
 */
function syncCanvasSize () {
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  dpr = window.devicePixelRatio || 1
  size = Math.min(rect.width, rect.height)
  canvas.width = Math.round(size * dpr)
  canvas.height = Math.round(size * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  center = size / 2
  plasmaCenter = center
  plasmaR = size * 0.2857
}

function frame (ts) {
  rafLoopId = requestAnimationFrame(frame)
  const dt = Math.min((ts - lastTime) / 1000, 0.05)
  lastTime = ts
  // sleeping 状态降频（约 10fps），省电
  if (props.state === 'sleeping') {
    slowFrame++
    if (slowFrame % 6 !== 0) return
  }
  update(dt)
  render()
}

// ============================================================
// 生命周期
// ============================================================
onMounted(() => {
  document.addEventListener('mousemove', handleMouseMove)

  unsubscribeKey = on('pet:key-input', (payload) => {
    if (payload && payload.category) applyKeyFx(payload.category)
  })

  nextTick(() => {
    canvas = plasmaRef.value
    if (canvas) {
      ctx = canvas.getContext('2d')
      syncCanvasSize()
      initArcs()
      // 监听容器尺寸变化（角色尺寸可调）
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => syncCanvasSize())
        resizeObserver.observe(canvas)
      }
      lastTime = performance.now()
      rafLoopId = requestAnimationFrame(frame)
    }
  })
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (orbMoveRafId !== null) {
    cancelAnimationFrame(orbMoveRafId)
    orbMoveRafId = null
  }
  if (rafLoopId !== null) {
    cancelAnimationFrame(rafLoopId)
    rafLoopId = null
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (comboTimer !== null) {
    clearTimeout(comboTimer)
    comboTimer = null
  }
  if (unsubscribeKey) {
    unsubscribeKey()
    unsubscribeKey = null
  }
})

/**
 * 舞台 transform：视差平移 + 3D tilt + 果冻形变（CSS 变量驱动）
 */
const stageStyle = computed(() => ({
  '--orb-rx': `${(-mouse.ny * 10).toFixed(2)}deg`,
  '--orb-ry': `${(mouse.nx * 14).toFixed(2)}deg`,
  '--orb-tx': `${(mouse.nx * 8).toFixed(2)}px`,
  '--orb-ty': `${(mouse.ny * 6).toFixed(2)}px`,
  '--orb-hx': `${(mouse.nx * 12).toFixed(2)}px`,
  '--orb-hy': `${(mouse.ny * 10).toFixed(2)}px`,
  '--orb-skew-x': `${wobble.skewX.toFixed(2)}deg`,
  '--orb-skew-y': `${wobble.skewY.toFixed(2)}deg`,
  '--orb-squash-x': (1 + wobble.squash).toFixed(3),
  '--orb-squash-y': (1 - wobble.squash).toFixed(3)
}))
</script>

<style scoped lang="scss">
.pet-orb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  cursor: grab;
  pointer-events: auto;

  // ============ 配色令牌（状态色由 CSS 变量驱动） ============
  --orb-core-hot: #EAFDFF;
  --orb-core-1: #4CC2FF;
  --orb-core-2: #7C4DFF;
  --orb-alert: #FF5C7C;

  // 舞台：视差 + 3D tilt + 果冻形变
  &__stage {
    position: relative;
    width: 100%;
    height: 100%;
    // 3D tilt 透视参考
    perspective: 700px;
    transform: translate(var(--orb-tx, 0px), var(--orb-ty, 0px))
               rotateX(var(--orb-rx, 0deg))
               rotateY(var(--orb-ry, 0deg))
               skewX(var(--orb-skew-x, 0deg))
               skewY(var(--orb-skew-y, 0deg))
               scale(var(--orb-squash-x, 1), var(--orb-squash-y, 1));
    transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
    animation: orb-float 4.5s ease-in-out infinite;
  }

  // 等离子电弧层（canvas，绘于玻璃球壳下方）
  &__plasma {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    pointer-events: none;
  }

  // 玻璃球壳 + 电极 + 装饰层
  &__svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    pointer-events: none;
  }

  &__sphere,
  &__core,
  &__core-ring {
    transform-origin: center;
    transform-box: fill-box;
  }

  &__specular {
    transform: translate(var(--orb-hx, 0px), var(--orb-hy, 0px));
    transition: transform var(--pet-motion-normal, 250ms) ease;
  }

  // 键盘敲击反馈
  &__keyfx {
    pointer-events: none;
    --orb-key-color: #4CC2FF;
    --orb-key-scale: 1.7;
    --orb-key-width: 2;

    &--tier2 { --orb-key-scale: 2.1; --orb-key-width: 2.5; }
    &--tier3 { --orb-key-scale: 2.6; --orb-key-width: 3; }

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
    transform-origin: center;
    transform-box: fill-box;
    animation: orb-key-ring 0.5s ease-out forwards;
  }

  &__keyfx-burst {
    transform-origin: 70px 70px;
    transform-box: view-box;
    animation: orb-key-burst 0.55s ease-out forwards;
    circle { fill: var(--orb-key-color); }
  }

  &__combo {
    pointer-events: none;
  }
  &__combo-text {
    fill: #FFD24D;
    font-size: 15px;
    font-weight: 800;
    font-family: Arial, sans-serif;
    filter: drop-shadow(0 0 4px rgba(255, 170, 60, 0.95));
    transform-origin: center;
    transform-box: fill-box;
    animation: orb-combo-pop 0.3s ease-out;
  }

  // 悬停：球体微放大
  &:hover {
    .pet-orb__stage {
      animation-duration: 1.8s;
    }
  }
}

// 状态装饰默认隐藏
.pet-orb__alert {
  opacity: 0;
  transition: opacity var(--pet-motion-normal, 250ms) ease;
}

.pet-orb__zzz {
  opacity: 0;
}

// ============================================================
// 各状态动画（作用于 SVG 电极/装饰层）
// ============================================================
.pet-orb--idle {
  .pet-orb__core {
    animation: orb-core-breathe 3.5s ease-in-out infinite;
  }
  .pet-orb__core-ring {
    animation: orb-core-ring-breathe 3.5s ease-in-out infinite;
  }
}

.pet-orb--happy {
  .pet-orb__core {
    animation: orb-core-happy 1.2s ease-in-out infinite;
  }
  .pet-orb__core-ring {
    animation: orb-core-ring-happy 1.2s ease-in-out infinite;
  }
  .pet-orb__stage {
    animation: orb-bounce 1.2s ease-in-out infinite;
  }
}

.pet-orb--reminding {
  --orb-core-1: #FFB03A;
  --orb-core-2: #FF5C7C;

  .pet-orb__core {
    animation: orb-core-alert 0.5s ease-in-out infinite;
  }
  .pet-orb__core-ring {
    animation: orb-core-ring-alert 0.5s ease-in-out infinite;
  }
  .pet-orb__alert {
    opacity: 1;
    animation: orb-alert-bob 0.6s ease-in-out infinite;
  }
}

.pet-orb--sleeping {
  .pet-orb__sphere {
    opacity: 0.7;
  }
  .pet-orb__core {
    opacity: 0.4;
    animation: orb-core-breathe 5s ease-in-out infinite;
  }
  .pet-orb__core-ring {
    opacity: 0.35;
    animation: orb-core-ring-breathe 5s ease-in-out infinite;
  }
  .pet-orb__zzz {
    opacity: 1;
  }
  .pet-orb__z {
    animation: orb-z-float 2.4s ease-in-out infinite;
    opacity: 0;
    &--1 { animation-delay: 0s; }
    &--2 { animation-delay: 0.8s; }
    &--3 { animation-delay: 1.6s; }
  }
  .pet-orb__stage {
    animation: orb-float 6s ease-in-out infinite;
  }
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
@keyframes orb-core-breathe {
  0%, 100% { transform: scale(0.9); opacity: 0.85; }
  50% { transform: scale(1.08); opacity: 1; }
}
@keyframes orb-core-ring-breathe {
  0%, 100% { transform: scale(0.85); opacity: 0.4; }
  50% { transform: scale(1.15); opacity: 0.7; }
}
@keyframes orb-core-happy {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 1; }
}
@keyframes orb-core-ring-happy {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.3); opacity: 0.9; }
}
@keyframes orb-core-alert {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: 0.8; }
}
@keyframes orb-core-ring-alert {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.36); opacity: 0.5; }
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
@keyframes orb-key-ring {
  0% { transform: scale(0.55); opacity: 0.95; }
  100% { transform: scale(var(--orb-key-scale, 1.7)); opacity: 0; }
}
@keyframes orb-key-burst {
  0% { transform: scale(0.3); opacity: 1; }
  100% { transform: scale(1.9); opacity: 0; }
}
@keyframes orb-combo-pop {
  0% { transform: scale(1.7); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
</style>