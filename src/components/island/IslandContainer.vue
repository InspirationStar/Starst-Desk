<!--
  灵动岛容器组件
  职责：
  - 同时展示多个通知卡片（垂直堆叠，各自独立进出场动画）
  - 每个通知独立计时、独立消失，互不阻塞
  - Fluent Design 风格：圆角 12px、半透明背景 rgba(32,32,32,0.92)、微妙阴影
  - 专注模式激活时优先显示专注计时器卡片，隐藏通知堆叠
  - 使用 transition-group 动画从顶部向下滑入（translateY -100% → 0）
  - 淡出时反向动画
-->
<template>
  <div class="island-container">
    <!-- 专注模式激活时优先显示专注计时器 -->
    <transition name="island-slide" appear>
      <IslandFocusTimer
        v-if="focusState.active"
        key="focus"
        :task-name="focusState.taskName"
        :remaining-ms="focusState.remainingMs"
        :total-ms="focusState.totalMs"
      />
    </transition>
    <!-- 通知堆叠：同时展示所有队列中的通知，各自独立动画 -->
    <transition-group
      v-if="!focusState.active"
      name="island-slide"
      tag="div"
      class="island-stack"
      appear
    >
      <component
        v-for="item in props.queue"
        :is="getComponent(item)"
        :key="item.id"
        v-bind="getItemProps(item)"
        @dismiss="handleDismiss(item.id)"
        @action="handleAction(item.id, $event)"
      />
    </transition-group>
  </div>
</template>

<script setup>
import { onBeforeUnmount, watch } from 'vue'
import IslandNotification from './IslandNotification.vue'
import IslandFocusTimer from './IslandFocusTimer.vue'
import IslandHealthReminder from './IslandHealthReminder.vue'
import IslandWaterRecord from './IslandWaterRecord.vue'
import IslandDietRecord from './IslandDietRecord.vue'

// ============================================================
// 组件属性
// ============================================================
const props = defineProps({
  // 通知队列：同时展示所有项
  queue: {
    type: Array,
    default: () => []
  },
  // 专注模式状态
  focusState: {
    type: Object,
    default: () => ({ active: false, taskName: '', remainingMs: 0, totalMs: 0 })
  }
})

// ============================================================
// 组件事件
// ============================================================
const emit = defineEmits(['dismiss', 'action'])

// ============================================================
// 组件选择与属性映射
// ============================================================

/**
 * 根据通知类型选择对应组件
 * health 类型使用健康提醒卡片，其他使用通用通知卡片
 */
function getComponent (item) {
  if (item.type === 'health') return IslandHealthReminder
  if (item.type === 'water') return IslandWaterRecord
  if (item.type === 'diet') return IslandDietRecord
  return IslandNotification
}

/**
 * 映射通知数据为组件属性
 */
function getItemProps (item) {
  return {
    type: item.type,
    title: item.title,
    body: item.body,
    icon: item.icon,
    action: item.action,
    duration: item.duration,
    extraData: item.extraData
  }
}

// ============================================================
// 独立计时器管理（每个通知独立计时、独立消失）
// ============================================================

// 每个通知的自动消失定时器 Map<id, timeoutId>
const dismissTimers = new Map()

/**
 * 为通知启动自动消失定时器
 * health 类型不自动消失，等用户交互（已完成/稍后提醒/关闭）或倒计时归零
 */
function startDismissTimer (item) {
  if (item.type === 'health') return
  // diet 带输入框需要更长交互时间；其他类型默认 5 秒
  const defaultDuration = item.type === 'diet' ? 15000 : 5000
  const duration = item.duration || defaultDuration
  const timer = setTimeout(() => {
    dismissTimers.delete(item.id)
    emit('dismiss', item.id)
  }, duration)
  dismissTimers.set(item.id, timer)
}

/**
 * 清除指定通知的定时器
 */
function clearDismissTimer (id) {
  const timer = dismissTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    dismissTimers.delete(id)
  }
}

/**
 * 清除所有定时器
 */
function clearAllDismissTimers () {
  dismissTimers.forEach(timer => clearTimeout(timer))
  dismissTimers.clear()
}

// ============================================================
// 事件处理
// ============================================================

/**
 * 处理通知消失（手动关闭或倒计时归零）
 */
function handleDismiss (id) {
  clearDismissTimer(id)
  emit('dismiss', id)
}

/**
 * 处理通知操作按钮点击
 */
function handleAction (id, actionPayload) {
  emit('action', { id, ...actionPayload })
}

// ============================================================
// 队列监听：为新出现的通知启动计时器，为消失的通知清除计时器
// ============================================================
watch(
  () => props.queue,
  (newQueue) => {
    if (!newQueue || newQueue.length === 0) {
      clearAllDismissTimers()
      return
    }
    const currentIds = new Set(newQueue.map(item => item.id))
    // 清除已不在队列中的通知的计时器
    for (const id of dismissTimers.keys()) {
      if (!currentIds.has(id)) {
        clearDismissTimer(id)
      }
    }
    // 为新出现的通知启动计时器
    for (const item of newQueue) {
      if (!dismissTimers.has(item.id)) {
        startDismissTimer(item)
      }
    }
  },
  { deep: true, immediate: true }
)

onBeforeUnmount(() => {
  clearAllDismissTimers()
})
</script>

<style lang="scss" scoped>
.island-container {
  width: 100%;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
}

// 通知堆叠容器
.island-stack {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
}

// 从顶部向下滑入动画
.island-slide-enter-active,
.island-slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

// 入场起始：从顶部上方滑入
.island-slide-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}

// 离场结束：向上滑出
.island-slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}

// transition-group 项离开时脱离文档流，让剩余项平滑上移
.island-slide-leave-active {
  position: absolute;
  width: 100%;
}

// transition-group 项移动时的平滑过渡
.island-slide-move {
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
