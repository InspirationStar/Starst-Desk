<!--
  胶囊栏容器组件（多胶囊收纳）
  职责：将多个折叠为胶囊的小部件排列成一条水平/垂直的栏，支持拖拽排序
  复用 CapsuleContainer 的 CSS 变量与暗色模式约定
  Props:
    - capsules: [{ id, type, title, icon, contentMode }] 胶囊列表
    - direction: 'horizontal' | 'vertical' 排列方向
    - spacing: number 间距（默认 8）
    - positionAnchor: string 锚点（'LeftTop' | 'RightTop' | 'LeftBottom' | 'RightBottom'）
    - activeId: string 当前活跃胶囊 id（用于高亮）
  Emits:
    - reorder: 胶囊顺序变化（payload: 新的 id 顺序数组）
    - switch-member: 点击某胶囊（payload: id）
    - expand: 双击展开某胶囊（payload: id）
  拖拽实现：mousedown + mousemove + mouseup（避免 HTML5 drag 的 ghost image 问题）
  样式：
    - 复用 CSS 变量：--widget-content-bg, --widget-radius-large, --widget-text, --widget-layer-fill, --widget-layer-stroke
    - 适配暗色模式（通过 CSS 变量自动切换，widget.scss 中 html.dark 已定义）
    - 拖拽时胶囊半透明 + 阴影
-->
<template>
  <div
    class="capsule-bar"
    :class="[`is-${direction}`, { 'is-dragging': !!draggingId }]"
    :style="barStyle"
  >
    <template v-for="(capsule, index) in orderedCapsules" :key="capsule.id">
      <!-- 插入位置指示器（在 index 位置前） -->
      <div
        v-if="dragInsertIndex === index && draggingId"
        class="capsule-bar__indicator"
        :class="`is-${direction}`"
      />
      <div
        class="capsule-bar__item"
        :class="{
          'is-active': activeId === capsule.id,
          'is-dragging': draggingId === capsule.id,
          [`content-mode-${capsule.contentMode || 'summary'}`]: true
        }"
        :data-id="capsule.id"
        @mousedown="handleMouseDown($event, capsule.id)"
        @click="handleClick(capsule.id)"
        @dblclick="handleDblClick(capsule.id)"
      >
        <!-- 默认渲染：图标 + 标题；可通过 #capsule 具名插槽覆盖 -->
        <slot name="capsule" :capsule="capsule" :active="activeId === capsule.id">
          <el-icon v-if="capsule.icon" class="capsule-bar__icon">
            <component :is="capsule.icon" />
          </el-icon>
          <span v-if="capsule.title" class="capsule-bar__title">{{ capsule.title }}</span>
        </slot>
      </div>
    </template>
    <!-- 末尾插入位置指示器 -->
    <div
      v-if="dragInsertIndex === orderedCapsules.length && draggingId"
      class="capsule-bar__indicator"
      :class="`is-${direction}`"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  // 胶囊列表：[{ id, type, title, icon, contentMode }]
  //   - id: 唯一标识
  //   - type: 小部件类型（用于 IPC 通知）
  //   - title: 胶囊标题（默认渲染时显示）
  //   - icon: 图标名称字符串（Element Plus icons 全局注册，如 'EditPen'）
  //   - contentMode: 内容模式 'minimal' | 'summary' | 'smart'（影响尺寸）
  capsules: {
    type: Array,
    default: () => []
  },
  // 排列方向：'horizontal' 水平单行 | 'vertical' 垂直单列
  direction: {
    type: String,
    default: 'horizontal',
    validator: (val) => ['horizontal', 'vertical'].includes(val)
  },
  // 胶囊间距（像素）
  spacing: {
    type: Number,
    default: 8
  },
  // 位置锚点（'LeftTop' | 'RightTop' | 'LeftBottom' | 'RightBottom'）
  // 用于决定排列方向上的视觉对齐（仅样式参考，实际位置由主进程 calculator 计算）
  positionAnchor: {
    type: String,
    default: 'LeftTop'
  },
  // 当前活跃胶囊 id（高亮显示）
  activeId: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['reorder', 'switch-member', 'expand'])

// ============================================================
// 内部状态
// ============================================================

// 有序胶囊列表（按 capsules prop 顺序）
const orderedCapsules = computed(() => props.capsules || [])

// 拖拽中的胶囊 id
const draggingId = ref('')
// 拖拽插入位置索引（0 到 length）
const dragInsertIndex = ref(-1)
// 拖拽起始鼠标坐标（用于区分点击与拖拽）
let dragStartX = 0
let dragStartY = 0
// 拖拽是否已实际移动（超过阈值才算拖拽，否则视为点击）
let dragMoved = false
// 拖拽阈值（像素）：超过此距离才进入拖拽模式
const DRAG_THRESHOLD = 4

// ============================================================
// 样式计算
// ============================================================

// 栏容器样式：根据方向设置 flex 与 gap
const barStyle = computed(() => ({
  flexDirection: props.direction === 'vertical' ? 'column' : 'row',
  gap: `${props.spacing}px`
}))

// ============================================================
// 拖拽排序：mousedown + mousemove + mouseup
// ============================================================

/**
 * 鼠标按下：记录拖拽起始状态，绑定全局 mousemove/mouseup
 * 不立即进入拖拽模式，等 mousemove 超过阈值才进入（区分点击与拖拽）
 * @param {MouseEvent} event
 * @param {string} id - 胶囊 id
 */
function handleMouseDown (event, id) {
  // 仅左键触发
  if (event.button !== 0) return
  // 单个胶囊不触发拖拽
  if (orderedCapsules.value.length < 2) return
  // 阻止文本选中
  event.preventDefault()

  dragStartX = event.clientX
  dragStartY = event.clientY
  dragMoved = false
  draggingId.value = id

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

/**
 * 鼠标移动：超过阈值进入拖拽模式，计算插入位置
 * @param {MouseEvent} event
 */
function handleMouseMove (event) {
  if (!draggingId.value) return

  const dx = event.clientX - dragStartX
  const dy = event.clientY - dragStartY
  // 未超过阈值：不进入拖拽模式
  if (!dragMoved && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) {
    return
  }
  dragMoved = true

  // 计算插入位置：根据鼠标坐标找到最近的胶囊槽位边界
  dragInsertIndex.value = computeInsertIndex(event.clientX, event.clientY)
}

/**
 * 计算插入位置索引
 * 遍历每个胶囊项的 DOM 位置，根据方向比较鼠标坐标与胶囊中点
 * @param {number} clientX - 鼠标视口 x
 * @param {number} clientY - 鼠标视口 y
 * @returns {number} 插入位置索引（0 到 length）
 */
function computeInsertIndex (clientX, clientY) {
  const items = document.querySelectorAll('.capsule-bar__item')
  const isVertical = props.direction === 'vertical'
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect()
    if (isVertical) {
      // 垂直方向：鼠标在胶囊上半部分则插入到该胶囊前
      const midY = rect.top + rect.height / 2
      if (clientY < midY) return i
    } else {
      // 水平方向：鼠标在胶囊左半部分则插入到该胶囊前
      const midX = rect.left + rect.width / 2
      if (clientX < midX) return i
    }
  }
  // 鼠标在所有胶囊之后：插入到末尾
  return items.length
}

/**
 * 鼠标松开：若已拖拽则重排并 emit reorder，清理状态
 * 若未拖拽（仅点击）则不在此处理（由 click 事件处理）
 */
function handleMouseUp () {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)

  const wasMoved = dragMoved
  const insertIndex = dragInsertIndex.value
  const dragId = draggingId.value

  // 清理拖拽状态
  draggingId.value = ''
  dragInsertIndex.value = -1
  dragMoved = false

  if (!wasMoved || !dragId) return

  // 执行重排：从原位置移除，插入到新位置
  const currentOrder = orderedCapsules.value.map(c => c.id)
  const fromIndex = currentOrder.indexOf(dragId)
  if (fromIndex < 0 || fromIndex === insertIndex || fromIndex === insertIndex - 1) {
    // 未移动或移动到自身前后：不重排
    return
  }
  const newOrder = currentOrder.slice()
  newOrder.splice(fromIndex, 1)
  // 插入位置需要修正：如果原位置在插入位置之前，移除后插入位置后移 1
  const adjustedInsert = fromIndex < insertIndex ? insertIndex - 1 : insertIndex
  newOrder.splice(adjustedInsert, 0, dragId)
  emit('reorder', newOrder)
}

// ============================================================
// 点击 / 双击
// ============================================================

/**
 * 点击胶囊：切换活跃成员
 * 拖拽中不触发（dragMoved 标记区分）
 * @param {string} id - 胶囊 id
 */
function handleClick (id) {
  // 拖拽中不触发点击
  if (dragMoved) return
  emit('switch-member', id)
}

/**
 * 双击胶囊：展开为完整小部件
 * @param {string} id - 胶囊 id
 */
function handleDblClick (id) {
  // 拖拽中不触发双击
  if (dragMoved) return
  emit('expand', id)
}

// ============================================================
// 卸载清理：防止全局监听器泄漏
// ============================================================
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
})
</script>

<style scoped lang="scss">
.capsule-bar {
  // 容器：flex 布局，方向由 inline style 控制
  display: flex;
  flex-wrap: nowrap;
  // 复用胶囊容器圆角与背景
  border-radius: var(--widget-radius-large, 8px);
  // 内边距让胶囊与栏边缘有间距
  padding: var(--widget-spacing-xs, 4px);
  // 过渡：方向切换时平滑
  transition: all var(--widget-motion-fast, 167ms) ease;

  // 拖拽中：禁止文本选中
  &.is-dragging {
    user-select: none;
    cursor: grabbing;
  }

  // ============================================================
  // 胶囊项
  // ============================================================
  &__item {
    // 胶囊基础样式：圆角 + 背景填充
    display: flex;
    align-items: center;
    gap: var(--widget-spacing-xs, 4px);
    padding: 0 var(--widget-spacing-sm, 8px);
    background: var(--widget-content-bg, rgba(243, 243, 243, 1));
    border: 1px solid var(--widget-layer-stroke, rgba(0, 0, 0, 0.09));
    border-radius: var(--widget-radius-large, 8px);
    cursor: pointer;
    // 过渡：高亮、拖拽状态切换
    transition: background var(--widget-motion-faster, 83ms) ease,
                border-color var(--widget-motion-faster, 83ms) ease,
                opacity var(--widget-motion-faster, 83ms) ease,
                box-shadow var(--widget-motion-faster, 83ms) ease;

    // 悬停：略微提亮
    &:hover {
      background: var(--widget-layer-fill, rgba(255, 255, 255, 0.9));
    }

    // 活跃胶囊：高亮边框
    &.is-active {
      border-color: var(--widget-accent, #0078D4);
      background: var(--widget-layer-fill, rgba(255, 255, 255, 0.9));
    }

    // 拖拽中：半透明 + 阴影
    &.is-dragging {
      opacity: 0.5;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      cursor: grabbing;
    }

    // minimal：最紧凑，高度 42px
    &.content-mode-minimal {
      min-height: 42px;
    }
    // summary：标准胶囊高度 42px
    &.content-mode-summary {
      min-height: 42px;
    }
    // smart：高密度胶囊高度 52px
    &.content-mode-smart {
      min-height: 52px;
    }
  }

  // ============================================================
  // 图标 / 标题
  // ============================================================
  &__icon {
    font-size: 16px;
    color: var(--widget-text-secondary, #5A5A5A);
    flex-shrink: 0;
  }

  &__title {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text, #1A1A1A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  // 活跃胶囊的图标/标题颜色加深
  &__item.is-active {
    .capsule-bar__icon {
      color: var(--widget-text, #1A1A1A);
    }
  }

  // ============================================================
  // 插入位置指示器
  // ============================================================
  &__indicator {
    // 水平方向：竖线
    &.is-horizontal {
      width: 2px;
      align-self: stretch;
      background: var(--widget-accent, #0078D4);
      border-radius: 1px;
    }
    // 垂直方向：横线
    &.is-vertical {
      height: 2px;
      width: 100%;
      background: var(--widget-accent, #0078D4);
      border-radius: 1px;
    }
  }
}

// ============================================================
// 暗色模式适配
// CSS 变量已在 widget.scss 中通过 html.dark 定义，此处仅补充阴影
// ============================================================
html.dark .capsule-bar {
  &__item {
    // 深色模式下拖拽阴影加深
    &.is-dragging {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
  }

  // 暗色模式补充：胶囊项背景、边框、文字
  &__item {
    background: var(--widget-content-bg, rgba(43, 43, 43, 1));
    border-color: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));

    &:hover {
      background: var(--widget-layer-fill, rgba(255, 255, 255, 0.08));
    }

    &.is-active {
      background: var(--widget-layer-fill, rgba(255, 255, 255, 0.12));
    }
  }

  &__icon {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  &__title {
    color: var(--widget-text, #F5F5F5);
  }

  &__item.is-active {
    .capsule-bar__icon {
      color: var(--widget-text, #F5F5F5);
    }
  }
}
</style>