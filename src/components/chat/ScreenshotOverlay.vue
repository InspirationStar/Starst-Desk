<!--
  区域截图覆盖层组件
  职责：
    - 全屏暗化遮罩（用户可直接看到实时桌面画面）
    - 用户拖拽鼠标选择矩形区域
    - 选择时显示边框、尺寸提示与十字光标
    - 松开鼠标完成选择，提供"重新选择"与"确认截图"按钮
    - 按 Esc 或点击取消按钮取消截图
    - 确认时 emit 选区坐标 {x, y, width, height}，由父组件调用 GDI BitBlt 截取
    - 暗色模式适配
-->
<template>
  <div
    v-if="visible"
    class="screenshot-overlay"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
  >
    <!-- 选区外遮罩（暗化屏幕，但用户仍可看到实时桌面） -->
    <div
      v-if="hasSelection || isDragging"
      class="screenshot-selection"
      :style="selectionStyle"
    >
      <!-- 尺寸提示 -->
      <div class="selection-size-tip">
        {{ displayWidth }} × {{ displayHeight }}
      </div>
    </div>

    <!-- 拖拽过程中的尺寸提示（跟随鼠标） -->
    <div
      v-if="isDragging && dragWidth > 0"
      class="drag-size-tip"
      :style="dragSizeTipStyle"
    >
      {{ dragWidth }} × {{ dragHeight }}
    </div>

    <!-- 十字辅助线（拖拽中） -->
    <template v-if="isDragging">
      <div class="cross-hair cross-hair-h" :style="{ top: currentY + 'px' }" />
      <div class="cross-hair cross-hair-v" :style="{ left: currentX + 'px' }" />
    </template>

    <!-- 顶部工具栏 -->
    <div class="screenshot-toolbar">
      <div class="toolbar-tip">
        <span v-if="!hasSelection">拖拽鼠标选择截取区域，按 Esc 取消</span>
        <span v-else>已选择区域，可确认截图或重新选择</span>
      </div>
      <div class="toolbar-actions">
        <el-button
          v-if="hasSelection"
          size="small"
          @click="handleReset"
        >
          重新选择
        </el-button>
        <el-button
          v-if="hasSelection"
          type="primary"
          size="small"
          :loading="isConfirming"
          @click="handleConfirm"
        >
          确认截图
        </el-button>
        <el-button
          size="small"
          @click="handleCancel"
        >
          取消
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  // 是否显示
  visible: {
    type: Boolean,
    default: false
  },
  // 全屏截图的 data URL（仅用于背景图，新流程不需要）
  imageDataUrl: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['confirm', 'cancel'])

// 背景图元素引用（仅用于旧全屏截图流程）
const bgImgRef = ref(null)
// 背景图自然尺寸（实际像素，仅用于旧流程坐标映射）
const naturalWidth = ref(0)
const naturalHeight = ref(0)

// 拖拽状态
const isDragging = ref(false)
// 确认中状态（避免重复点击）
const isConfirming = ref(false)
// 鼠标按下起始点（屏幕坐标）
const startX = ref(0)
const startY = ref(0)
// 鼠标当前点（屏幕坐标）
const currentX = ref(0)
const currentY = ref(0)
// 是否已完成选择
const hasSelection = ref(false)
// 已完成选择的区域（屏幕坐标）
const selectionRect = ref({ x: 0, y: 0, width: 0, height: 0 })

/**
 * 拖拽过程中选择区域的宽高
 */
const dragWidth = computed(() => Math.abs(currentX.value - startX.value))
const dragHeight = computed(() => Math.abs(currentY.value - startY.value))

/**
 * 拖拽过程中尺寸提示位置（跟随选择区域右下角）
 */
const dragSizeTipStyle = computed(() => {
  const x = Math.max(startX.value, currentX.value)
  const y = Math.max(startY.value, currentY.value)
  return {
    left: `${x + 8}px`,
    top: `${y + 8}px`
  }
})

/**
 * 已完成选择区域的样式
 */
const selectionStyle = computed(() => {
  if (hasSelection.value) {
    const { x, y, width, height } = selectionRect.value
    return {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`
    }
  }
  // 拖拽过程中实时展示
  const x = Math.min(startX.value, currentX.value)
  const y = Math.min(startY.value, currentY.value)
  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${dragWidth.value}px`,
    height: `${dragHeight.value}px`
  }
})

/**
 * 已完成选择区域的宽高（用于尺寸提示展示）
 */
const selectionWidth = computed(() => Math.round(selectionRect.value.width))
const selectionHeight = computed(() => Math.round(selectionRect.value.height))

/**
 * 当前展示的宽高（拖拽中用 dragWidth/Height，完成后用 selectionWidth/Height）
 */
const displayWidth = computed(() => hasSelection.value ? selectionWidth.value : dragWidth.value)
const displayHeight = computed(() => hasSelection.value ? selectionHeight.value : dragHeight.value)

/**
 * 背景图加载完成（仅用于旧流程，新流程不需要）
 */
function handleBgLoad () {
  if (bgImgRef.value) {
    naturalWidth.value = bgImgRef.value.naturalWidth
    naturalHeight.value = bgImgRef.value.naturalHeight
  }
}

/**
 * 获取屏幕坐标偏移（App 窗口的屏幕左上角位置，考虑 DPI 缩放）
 */
function getScreenOffset () {
  // 使用 window.electronAPI 获取主窗口位置（若不可用则返回 0,0）
  const api = window.electronAPI
  if (!api) return { x: 0, y: 0 }
  try {
    // screen.getDisplayNearestPoint 只能反向查，这里直接用 window.screenX/screenY
    // Electron 渲染进程的 screenX/Y 已是物理像素（不含缩放），直接使用
    return { x: window.screenX || 0, y: window.screenY || 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

const SCREEN_OFFSET = getScreenOffset()

/**
 * 鼠标按下：开始拖拽
 */
function handleMouseDown (e) {
  console.log('[SHOT-OVERLAY] mousedown', e.clientX, e.clientY, 'SCREEN_OFFSET', SCREEN_OFFSET)
  if (e.target.closest('.screenshot-toolbar')) return
  hasSelection.value = false
  isDragging.value = true
  startX.value = e.clientX + SCREEN_OFFSET.x
  startY.value = e.clientY + SCREEN_OFFSET.y
  currentX.value = startX.value
  currentY.value = startY.value
}

function handleMouseMove (e) {
  if (!isDragging.value) return
  console.log('[SHOT-OVERLAY] mousemove', e.clientX, e.clientY, '-> screen:', e.clientX + SCREEN_OFFSET.x, e.clientY + SCREEN_OFFSET.y)
  currentX.value = e.clientX + SCREEN_OFFSET.x
  currentY.value = e.clientY + SCREEN_OFFSET.y
}

/**
 * 鼠标移动：更新当前点
 */
function handleMouseMove (e) {
  if (!isDragging.value) return
  currentX.value = e.clientX + SCREEN_OFFSET.x
  currentY.value = e.clientY + SCREEN_OFFSET.y
}

/**
 * 鼠标松开：完成选择
 */
function handleMouseUp (e) {
  if (!isDragging.value) return
  isDragging.value = false
  const x = Math.min(startX.value, currentX.value)
  const y = Math.min(startY.value, currentY.value)
  const width = Math.abs(currentX.value - startX.value)
  const height = Math.abs(currentY.value - startY.value)
  // 过滤过小的选择（避免5px 阈值）
  if (width < 5 || height < 5) {
    hasSelection.value = false
    selectionRect.value = { x: 0, y: 0, width: 0, height: 0 }
    return
  }
  selectionRect.value = { x, y, width, height }
  hasSelection.value = true
}

/**
 * 重新选择
 */
function handleReset () {
  hasSelection.value = false
  isDragging.value = false
  selectionRect.value = { x: 0, y: 0, width: 0, height: 0 }
}

/**
 * 确认截图：emit 选区坐标（x, y, width, height），由父进程调用 GDI BitBlt 截取
 */
function handleConfirm () {
  if (!hasSelection.value) return
  if (isConfirming.value) return
  isConfirming.value = true

  try {
    emit('confirm', {
      x: Math.round(selectionRect.value.x),
      y: Math.round(selectionRect.value.y),
      width: Math.round(selectionRect.value.width),
      height: Math.round(selectionRect.value.height)
    })
  } catch (err) {
    console.error('[ScreenshotOverlay] 确认截图失败:', err)
  } finally {
    isConfirming.value = false
  }
}

/**
 * 取消截图
 */
function handleCancel () {
  handleReset()
  emit('cancel')
}

/**
 * Esc 键取消截图
 */
function handleKeydown (e) {
  if (!props.visible) return
  if (e.key === 'Escape') {
    handleCancel()
  }
}

// 监听 visible 变化，显示时重置状态
watch(() => props.visible, (val) => {
  if (val) {
    handleReset()
  }
})

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped lang="scss">
.screenshot-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  cursor: crosshair;
  user-select: none;
  background: transparent;
}

// 全屏截图背景（仅旧流程使用，新流程无此元素）
.screenshot-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

// 选择区域高亮（挖空效果，box-shadow 充当遮罩）
.screenshot-selection {
  position: absolute;
  border: 2px solid #409eff;
  background: rgba(0, 0, 0, 0);
  // box-shadow 向外扩张 9999px 形成遮罩，挖空当前选区
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  // 让选区上方的尺寸提示可被点击（虽然 pointer-events: none，但子元素可单独设置）
  z-index: 1;

  // 尺寸提示
  .selection-size-tip {
    position: absolute;
    top: -28px;
    left: 0;
    padding: 2px 8px;
    font-size: 12px;
    color: #fff;
    background: rgba(64, 158, 255, 0.9);
    border-radius: 4px;
    white-space: nowrap;
    line-height: 1.5;
  }
}

// 拖拽过程中的尺寸提示
.drag-size-tip {
  position: fixed;
  padding: 2px 8px;
  font-size: 12px;
  color: #fff;
  background: rgba(64, 158, 255, 0.9);
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10000;
}

// 十字辅助线
.cross-hair {
  position: absolute;
  background: rgba(64, 158, 255, 0.6);
  pointer-events: none;

  // 水平线
  &.cross-hair-h {
    left: 0;
    right: 0;
    height: 1px;
  }

  // 垂直线
  &.cross-hair-v {
    top: 0;
    bottom: 0;
    width: 1px;
  }
}

// 顶部工具栏
.screenshot-toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  z-index: 10001;
  cursor: default;

  .toolbar-tip {
    font-size: 13px;
    line-height: 1.5;
  }

  .toolbar-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
}

// 暗色模式适配
[data-theme='dark'] {
  .screenshot-selection {
    border-color: #79bbff;

    .selection-size-tip {
      background: rgba(64, 158, 255, 0.9);
    }
  }

  .drag-size-tip {
    background: rgba(64, 158, 255, 0.9);
  }

  .screenshot-toolbar {
    background: rgba(0, 0, 0, 0.8);
  }
}
</style>
