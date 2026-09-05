<!--
  灵动岛专注计时器卡片
  职责：
  - 显示当前任务名
  - 显示剩余时间（mm:ss 格式）
  - 显示进度条
  - 专注模式下持续显示，不自动隐藏
-->
<template>
  <div class="island-focus-timer">
    <!-- 左侧图标 -->
    <div class="island-focus-timer__icon">
      <el-icon><Aim /></el-icon>
    </div>

    <!-- 中间内容 -->
    <div class="island-focus-timer__content">
      <div class="island-focus-timer__title">
        {{ taskName || '专注中' }}
      </div>
      <!-- 进度条 -->
      <div class="island-focus-timer__progress">
        <div
          class="island-focus-timer__progress-bar"
          :style="{ width: progressPercent + '%' }"
        />
      </div>
    </div>

    <!-- 右侧剩余时间 -->
    <div class="island-focus-timer__time">
      {{ formattedTime }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Aim } from '@element-plus/icons-vue'

// ============================================================
// 组件属性
// ============================================================
const props = defineProps({
  // 当前任务名
  taskName: {
    type: String,
    default: ''
  },
  // 剩余时间（毫秒）
  remainingMs: {
    type: Number,
    default: 0
  },
  // 总时间（毫秒）
  totalMs: {
    type: Number,
    default: 0
  }
})

// 格式化时间 mm:ss
const formattedTime = computed(() => {
  const totalSec = Math.max(0, Math.ceil(props.remainingMs / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
})

// 进度百分比
const progressPercent = computed(() => {
  if (props.totalMs <= 0) return 0
  const used = props.totalMs - props.remainingMs
  const percent = Math.round((used / props.totalMs) * 100)
  return Math.max(0, Math.min(100, percent))
})
</script>

<style lang="scss" scoped>
.island-focus-timer {
  // 复用 Fluent Design 风格
  width: 100%;
  min-height: 56px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--island-card-bg);
  border: var(--island-card-border);
  box-shadow: var(--island-card-shadow);
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--island-text-primary);
  user-select: none;
  position: relative;
  z-index: 1;

  &__icon {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: #a78bfa;
  }

  &__content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--island-text-title);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__progress {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: var(--island-progress-bg);
    overflow: hidden;
  }

  &__progress-bar {
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(90deg, #a78bfa, #4cc4ff);
    transition: width 0.3s ease;
  }

  &__time {
    flex-shrink: 0;
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--island-text-title);
    min-width: 56px;
    text-align: right;
  }
}
</style>