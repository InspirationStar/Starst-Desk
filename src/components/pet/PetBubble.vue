<!--
  桌宠提醒气泡组件
  职责：收到健康提醒时在桌宠上方显示气泡，展示提醒标题与内容
  Props:
    - reminder: 提醒对象 { id, type, title, body, timestamp }
    - visible: 是否显示
    - maxWidth: 气泡最大宽度（px），支持拖拽调整，范围 [240, 780]
    - maxLines: 内容正文最大行数，支持上拉调整，范围 [2, 20]
  Emits:
    - dismiss: 关闭气泡（用户点击 × 或自动消失）
    - click: 点击气泡体（打开健康提醒详情）
    - resize: 拖拽调整大小后触发，参数 { width?: number, lines?: number }
  支持的消息类型（type 字段）：
    - encouragement: 鼓励消息（绿色调，💪）
    - health:         健康提醒（橙红调，⚠️）
    - todo:           待办提醒（蓝色调，📋）
    - quote:          自定义名言（紫金调，✨）
    - water/sit/eye/sleep: 既有健康提醒子类型
  设计：
    - 圆角矩形气泡 + 小三角箭头指向桌宠
    - 显示提醒标题（粗体，最多 2 行省略）+ 内容（最多 maxLines 行省略）
    - 类型图标（根据 type 或 title 中的 emoji）
    - 关闭按钮（右上角 ×）
    - 出现/消失动画（opacity + scale，250ms easeOut）
    - 自动消失：8 秒后 emit dismiss（由父组件控制定时器）
    - 半透明背景 + 毛玻璃，暗色模式适配
    - 右边缘手柄左右拉调整宽度（窗口固定 800px 不变），范围 [240, 780]，默认 320
    - 上边缘手柄上拉调整内容行数（line-clamp），范围 [2, 20]，默认 5
-->
<template>
  <transition name="pet-bubble">
    <div
      v-if="visible && reminder"
      class="pet-bubble"
      :class="`pet-bubble--${typeKey}`"
      :style="{ width: maxWidth + 'px', maxWidth: maxWidth + 'px' }"
      @click="$emit('click', reminder)"
    >
      <!-- 气泡主体 -->
      <div class="pet-bubble__body">
        <!-- 类型图标 -->
        <div
          class="pet-bubble__icon"
          :class="`pet-bubble__icon--${typeKey}`"
        >
          <span v-if="typeEmoji">{{ typeEmoji }}</span>
          <el-icon v-else><Bell /></el-icon>
        </div>

        <!-- 文本区域 -->
        <!-- min-height 随 maxLines 变化：上拉时内容区域变高，即使内容只有一行也能看到气泡变高 -->
        <!-- 内容超出 maxLines 时自动向上扩展，不截断文字 -->
        <div
          class="pet-bubble__content"
          :style="{ minHeight: (maxLines * 18) + 'px' }"
        >
          <!-- 标题：无 body 时全部展开；有 body 时最多 2 行省略 -->
          <div
            class="pet-bubble__title"
            :class="{ 'pet-bubble__title--clamped': reminder.body }"
          ><PetRichText :content="displayTitle" /></div>
          <!-- 正文：全部展开，不截断，气泡自动向上扩展 -->
          <div
            v-if="reminder.body"
            class="pet-bubble__text"
          ><PetRichText :content="reminder.body" /></div>
        </div>

        <!-- 关闭按钮 -->
        <button
          class="pet-bubble__close"
          @click.stop="$emit('dismiss', reminder)"
        >
          <el-icon><Close /></el-icon>
        </button>
      </div>

      <!-- 小三角箭头（指向桌宠，位于气泡底部中央） -->
      <div class="pet-bubble__arrow"></div>

      <!-- 右边缘拖拽手柄（左右拉同步延长宽度） -->
      <!-- @click.stop.prevent 阻止 click 冒泡到气泡根元素，避免触发 dismissBubble -->
      <div
        class="pet-bubble__resize-right"
        @mousedown.stop.prevent="handleResizeRightStart"
        @click.stop.prevent
      ></div>

      <!-- 左边缘拖拽手柄（左右拉同步延长宽度，方向与右边缘相反） -->
      <div
        class="pet-bubble__resize-left"
        @mousedown.stop.prevent="handleResizeLeftStart"
        @click.stop.prevent
      ></div>

      <!-- 上边缘拖拽手柄（上拉增加内容行数） -->
      <!-- @click.stop.prevent 阻止 click 冒泡到气泡根元素，避免触发 dismissBubble -->
      <div
        class="pet-bubble__resize-top"
        @mousedown.stop.prevent="handleResizeTopStart"
        @click.stop.prevent
      ></div>
    </div>
  </transition>
</template>

<script setup>
import { computed } from 'vue'
import { Bell, Close } from '@element-plus/icons-vue'
import PetRichText from './PetRichText.vue'

const props = defineProps({
  // 提醒对象 { id, type, title, body, timestamp }
  reminder: {
    type: Object,
    default: null
  },
  // 是否显示
  visible: {
    type: Boolean,
    default: false
  },
  // 气泡最大宽度（px），支持拖拽调整，范围 [240, 780]
  // 窗口固定 800px，气泡最大 780px 留 20px 余量
  maxWidth: {
    type: Number,
    default: 320
  },
  // 内容正文最大行数，支持上拉调整，范围 [2, 20]
  maxLines: {
    type: Number,
    default: 5
  }
})

// resize 事件参数: { width?: number, lines?: number }
// resize-start: 拖拽开始，父组件应清除自动消失定时器避免拖拽中断
// resize-end:   拖拽结束，父组件应重新设置自动消失定时器
const emit = defineEmits(['dismiss', 'click', 'resize', 'resize-start', 'resize-end'])

// ============================================================
// 拖拽调整大小逻辑
// ============================================================

// 右边缘拖拽（左右同步调整宽度）
// 气泡居中（translateX(-50%)），左右拉同步延长意味着位移 dx 放大 2 倍
let resizeRightStartX = 0
let resizeRightStartWidth = 0

/**
 * 右边缘拖拽开始：记录起始坐标和宽度，绑定全局 mousemove/mouseup
 * @param {MouseEvent} event
 */
function handleResizeRightStart (event) {
  resizeRightStartX = event.clientX
  resizeRightStartWidth = props.maxWidth
  // 通知父组件清除自动消失定时器，避免拖拽过程中气泡消失
  emit('resize-start')
  window.addEventListener('mousemove', handleResizeRightMove)
  window.addEventListener('mouseup', handleResizeRightEnd)
}

/**
 * 右边缘拖拽移动：左右同步延长（dx * 2），限制宽度在 [240, 780] 范围
 * 窗口固定 800px 不变，仅调整气泡 max-width
 * @param {MouseEvent} event
 */
function handleResizeRightMove (event) {
  const dx = event.clientX - resizeRightStartX
  const newWidth = Math.max(240, Math.min(780, resizeRightStartWidth + dx * 2))
  emit('resize', { width: newWidth })
}

/**
 * 右边缘拖拽结束：解绑全局事件
 */
function handleResizeRightEnd () {
  window.removeEventListener('mousemove', handleResizeRightMove)
  window.removeEventListener('mouseup', handleResizeRightEnd)
  // 通知父组件重新设置自动消失定时器
  emit('resize-end')
}

// 左边缘拖拽（左右同步调整宽度，方向与右边缘相反）
// 气泡居中（translateX(-50%)），左拉同步延长意味着位移 dx 放大 2 倍（dx 为负）
let resizeLeftStartX = 0
let resizeLeftStartWidth = 0

/**
 * 左边缘拖拽开始：记录起始坐标和宽度，绑定全局 mousemove/mouseup
 * @param {MouseEvent} event
 */
function handleResizeLeftStart (event) {
  resizeLeftStartX = event.clientX
  resizeLeftStartWidth = props.maxWidth
  // 通知父组件清除自动消失定时器，避免拖拽过程中气泡消失
  emit('resize-start')
  window.addEventListener('mousemove', handleResizeLeftMove)
  window.addEventListener('mouseup', handleResizeLeftEnd)
}

/**
 * 左边缘拖拽移动：左拉（dx < 0）同步延长（|dx| * 2），限制宽度在 [240, 780] 范围
 * @param {MouseEvent} event
 */
function handleResizeLeftMove (event) {
  const dx = event.clientX - resizeLeftStartX
  // 左拉 dx < 0，宽度增加 -dx * 2
  const newWidth = Math.max(240, Math.min(780, resizeLeftStartWidth - dx * 2))
  emit('resize', { width: newWidth })
}

/**
 * 左边缘拖拽结束：解绑全局事件
 */
function handleResizeLeftEnd () {
  window.removeEventListener('mousemove', handleResizeLeftMove)
  window.removeEventListener('mouseup', handleResizeLeftEnd)
  // 通知父组件重新设置自动消失定时器
  emit('resize-end')
}

// 上边缘拖拽（上拉增加内容行数）
let resizeTopStartY = 0
let resizeTopStartLines = 0

/**
 * 上边缘拖拽开始：记录起始坐标和行数，绑定全局 mousemove/mouseup
 * @param {MouseEvent} event
 */
function handleResizeTopStart (event) {
  resizeTopStartY = event.clientY
  resizeTopStartLines = props.maxLines
  // 通知父组件清除自动消失定时器，避免拖拽过程中气泡消失
  emit('resize-start')
  window.addEventListener('mousemove', handleResizeTopMove)
  window.addEventListener('mouseup', handleResizeTopEnd)
}

/**
 * 上边缘拖拽移动：向上拉 dy > 0，每移动 20px 增加一行，限制行数在 [2, 20] 范围
 * @param {MouseEvent} event
 */
function handleResizeTopMove (event) {
  const dy = resizeTopStartY - event.clientY
  const newLines = Math.max(2, Math.min(20, resizeTopStartLines + Math.round(dy / 20)))
  emit('resize', { lines: newLines })
}

/**
 * 上边缘拖拽结束：解绑全局事件
 */
function handleResizeTopEnd () {
  window.removeEventListener('mousemove', handleResizeTopMove)
  window.removeEventListener('mouseup', handleResizeTopEnd)
  // 通知父组件重新设置自动消失定时器
  emit('resize-end')
}

// ============================================================
// 类型相关计算
// ============================================================

// 提醒类型 → 内部 typeKey（用于匹配图标颜色 class）
// 支持 health 模块常见类型：water（喝水）/ sit（久坐）/ eye（护眼）/ sleep（睡眠）
// 支持智能气泡消息类型：encouragement（鼓励）/ health（健康）/ todo（待办）/ quote（名言）
// 新增：activity（用户活动）/ analytics（数据分析）
const TYPE_KEY_MAP = {
  water: 'water',
  hydration: 'water',
  drink: 'water',
  sit: 'sit',
  sedentary: 'sit',
  posture: 'sit',
  eye: 'eye',
  vision: 'eye',
  sleep: 'sleep',
  rest: 'sleep',
  encouragement: 'encouragement',
  health: 'health',
  todo: 'todo',
  quote: 'quote',
  activity: 'activity',
  analytics: 'analytics',
  ai: 'ai',
  chat: 'ai'
}

// 归一化 typeKey：取 reminder.type 小写，未匹配则回退 default
const typeKey = computed(() => {
  const raw = props.reminder?.type
  if (!raw || typeof raw !== 'string') return 'default'
  const lower = raw.toLowerCase()
  return TYPE_KEY_MAP[lower] || 'default'
})

// 类型 emoji：根据 type 选取，未匹配则返回空字符串（用 el-icon 回退）
const TYPE_EMOJI_MAP = {
  water: '💧',
  sit: '🪑',
  eye: '👁️',
  sleep: '😴',
  encouragement: '💪',
  health: '⚠️',
  todo: '📋',
  quote: '✨',
  activity: '🎯',
  analytics: '📊',
  ai: '🤖'
}

// 标题中可能已包含 emoji，若已包含则不再重复显示类型 emoji
const typeEmoji = computed(() => {
  const title = props.reminder?.title || ''
  // 标题已含 emoji（非 ASCII 字符范围粗判）则不再叠加
  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(title)) return ''
  return TYPE_EMOJI_MAP[typeKey.value] || ''
})

// 显示标题：去除可能的 emoji 前缀，保留纯文本（避免与图标重复）
const displayTitle = computed(() => {
  const title = props.reminder?.title || ''
  return title.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim()
})
</script>

<style scoped lang="scss">
.pet-bubble {
  // 最大宽度 320px
  max-width: var(--pet-bubble-max-width, 320px);
  // 半透明背景 + 毛玻璃
  background: var(--pet-bg, rgba(255, 255, 255, 0.72));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  // 圆角
  border-radius: var(--pet-radius-medium, 10px);
  border: 1px solid var(--pet-stroke, rgba(0, 0, 0, 0.08));
  // 阴影
  box-shadow: var(--pet-shadow-bubble, 0 4px 16px rgba(0, 0, 0, 0.10));
  // 文字颜色
  color: var(--pet-text, #1A1A1A);
  // 鼠标指针：点击打开详情
  cursor: pointer;
  // 内边距
  padding: var(--pet-spacing-sm, 8px) var(--pet-spacing-md, 12px);
  // 相对定位，便于箭头绝对定位
  position: relative;

  &__body {
    // 水平排列：图标 + 文本 + 关闭
    display: flex;
    align-items: flex-start;
    gap: var(--pet-spacing-sm, 8px);
  }

  // 智能气泡消息类型：通过左侧色条强化视觉辨识
  // 健康提醒（橙红）/ 待办（蓝色）/ 名言（紫金）使用左侧色条
  &__body::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 2px;
    background: transparent;
  }

  // 根据类型设置左侧色条颜色（通过父级 typeKey class）
  &.pet-bubble--health &__body::before {
    background: var(--pet-type-health, #E94B3C);
  }
  &.pet-bubble--todo &__body::before {
    background: var(--pet-type-todo, #4CC2FF);
  }
  &.pet-bubble--quote &__body::before {
    background: var(--pet-type-quote, #B8860B);
  }
  &.pet-bubble--encouragement &__body::before {
    background: var(--pet-type-encouragement, #67C23A);
  }
  // 新增类型：用户活动（蓝色）/ 数据分析（紫色）
  &.pet-bubble--activity &__body::before {
    background: var(--pet-type-activity, #409EFF);
  }
  &.pet-bubble--analytics &__body::before {
    background: var(--pet-type-analytics, #9B59B6);
  }
  &.pet-bubble--ai &__body::before {
    background: var(--pet-type-ai, #6E56CF);
  }

  // 类型图标
  &__icon {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    border-radius: 50%;
    // 默认色
    color: var(--pet-type-default, #67C23A);
    background: transparent;

    // 各类型颜色
    &--water { color: var(--pet-type-water, #4CC2FF); }
    &--sit { color: var(--pet-type-sit, #F5A623); }
    &--eye { color: var(--pet-type-eye, #9B59B6); }
    &--sleep { color: var(--pet-type-sleep, #5C6BC0); }
    // 智能气泡消息类型颜色
    &--encouragement { color: var(--pet-type-encouragement, #67C23A); }
    &--health { color: var(--pet-type-health, #E94B3C); }
    &--todo { color: var(--pet-type-todo, #4CC2FF); }
    &--quote { color: var(--pet-type-quote, #B8860B); }
    // 新增类型颜色
    &--activity { color: var(--pet-type-activity, #409EFF); }
    &--analytics { color: var(--pet-type-analytics, #9B59B6); }
    &--ai { color: var(--pet-type-ai, #6E56CF); }

    .el-icon {
      font-size: 16px;
    }
  }

  // 文本区域
  &__content {
    flex: 1;
    min-width: 0;
    // 文本区域不触发关闭按钮的点击
    pointer-events: auto;
  }

  // 标题
  // 通过 --pet-bubble-font-size CSS 变量支持用户自定义大小（与正文一致，滑杆统一调整）
  &__title {
    font-size: var(--pet-bubble-font-size, 14px);
    font-weight: 600;
    color: var(--pet-text, #1A1A1A);
    line-height: 1.4;
    word-break: break-word; // 长单词换行

    // 有 body 时标题最多 2 行省略，无 body 时全部展开
    &--clamped {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  }

  // 内容正文：全部展开，不截断，气泡自动向上扩展
  // 通过 --pet-bubble-font-size CSS 变量支持用户自定义大小（默认 14px 对齐主聊天界面）
  &__text {
    margin-top: 2px;
    font-size: var(--pet-bubble-font-size, 14px);
    color: var(--pet-text-secondary, #5A5A5A);
    line-height: 1.7;
    word-break: break-word; // 长单词换行
  }

  // AI 输出：加粗 + 颜色加深（用主文本色，避免灰色不够明显）
  &.pet-bubble--ai &__text {
    font-weight: 600;
    color: var(--pet-text, #1A1A1A);
  }

  // 关闭按钮
  &__close {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: 50%;
    cursor: pointer;
    color: var(--pet-text-tertiary, #8A8A8A);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background var(--pet-motion-faster, 83ms) ease,
                color var(--pet-motion-faster, 83ms) ease;

    .el-icon {
      font-size: 12px;
    }

    &:hover {
      background: var(--pet-toolbar-btn-hover, rgba(0, 0, 0, 0.06));
      color: var(--pet-text, #1A1A1A);
    }
  }

  // 小三角箭头：指向桌宠（气泡底部中央）
  &__arrow {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    // 朝下三角
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid var(--pet-bg, rgba(255, 255, 255, 0.72));
    // 让三角边缘与气泡描边协调（用 filter drop-shadow 模拟）
    filter: drop-shadow(0 1px 0 var(--pet-stroke, rgba(0, 0, 0, 0.08)));
  }

  // 右边缘拖拽手柄（左右拉同步延长宽度）
  &__resize-right {
    position: absolute;
    right: -5px;       // 略微超出气泡右边缘，便于抓取
    top: 50%;
    transform: translateY(-50%);
    width: 10px;
    height: 60px;       // 60px 高的点击区域
    cursor: ew-resize;
    z-index: 10;
    border-radius: 3px;

    // 视觉指示线
    &::after {
      content: '';
      position: absolute;
      right: 3px;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 20px;
      background: var(--pet-text-tertiary, #8A8A8A);
      border-radius: 1.5px;
      opacity: 0.5;
      transition: opacity 150ms ease;
    }

    &:hover::after {
      opacity: 1;
    }
  }

  // 左边缘拖拽手柄（左右拉同步延长宽度，方向与右边缘相反）
  &__resize-left {
    position: absolute;
    left: -5px;        // 略微超出气泡左边缘，便于抓取
    top: 50%;
    transform: translateY(-50%);
    width: 10px;
    height: 60px;
    cursor: ew-resize;
    z-index: 10;
    border-radius: 3px;

    &::after {
      content: '';
      position: absolute;
      left: 3px;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 20px;
      background: var(--pet-text-tertiary, #8A8A8A);
      border-radius: 1.5px;
      opacity: 0.5;
      transition: opacity 150ms ease;
    }

    &:hover::after {
      opacity: 1;
    }
  }

  // 上边缘拖拽手柄（上拉增加内容行数）
  &__resize-top {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: -5px;          // 略微超出气泡上边缘，便于抓取
    width: 80px;        // 80px 宽的点击区域
    height: 10px;
    cursor: ns-resize;
    z-index: 10;
    border-radius: 3px;

    &::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 3px;
      transform: translateX(-50%);
      width: 20px;
      height: 3px;
      background: var(--pet-text-tertiary, #8A8A8A);
      border-radius: 1.5px;
      opacity: 0.5;
      transition: opacity 150ms ease;
    }

    &:hover::after {
      opacity: 1;
    }
  }
}

// ============================================================
// 出现/消失动画：opacity + scale，250ms easeOut
// ============================================================
.pet-bubble-enter-active,
.pet-bubble-leave-active {
  transition: opacity var(--pet-motion-normal, 250ms) ease-out,
              transform var(--pet-motion-normal, 250ms) ease-out;
}

.pet-bubble-enter-from,
.pet-bubble-leave-to {
  opacity: 0;
  // 保留父级 .pet-root__bubble 的 translateX(-50%) 水平居中
  // 否则 scale 会覆盖 translateX 导致气泡向右偏移
  transform: translateX(-50%) scale(0.92);
}

// 暗色模式适配：CSS 变量已在 pet.scss 中通过 html.dark 覆盖
// 此处保留兼容性回退
html.dark .pet-bubble {
  color: var(--pet-text, #F5F5F5);

  &__title {
    color: var(--pet-text, #F5F5F5);
  }

  &__text {
    color: var(--pet-text-secondary, #A5A5A5);
  }

  &__close {
    color: var(--pet-text-tertiary, #8A8A8A);

    &:hover {
      color: var(--pet-text, #F5F5F5);
    }
  }

}
</style>