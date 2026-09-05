<!--
  灵动岛通用通知卡片
  职责：
  - 显示 type/title/body/icon
  - 支持点击操作（action 按钮）
  - Fluent Design 风格：圆角 12px、半透明背景、微妙阴影
  - type 映射为不同图标和强调色：info/success/warning/error/note/task/ai
-->
<template>
  <div class="island-notification" :class="`island-notification--${type}`">
    <!-- 左侧图标 -->
    <div class="island-notification__icon">
      <el-icon v-if="iconEl">
        <component :is="iconEl" />
      </el-icon>
    </div>

    <!-- 中间内容 -->
    <div class="island-notification__content">
      <div class="island-notification__title" v-if="title">{{ title }}</div>
      <div class="island-notification__body" v-if="body">{{ body }}</div>
    </div>

    <!-- 右侧操作按钮 -->
    <div
      v-if="action && action.label"
      class="island-notification__action"
      @click="handleAction"
    >
      {{ action.label }}
    </div>

    <!-- 关闭按钮（无操作时显示） -->
    <div
      v-else
      class="island-notification__close"
      @click="handleDismiss"
    >
      <el-icon><Close /></el-icon>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  Close,
  InfoFilled,
  SuccessFilled,
  WarningFilled,
  CircleCloseFilled,
  Document,
  Clock,
  ChatDotRound
} from '@element-plus/icons-vue'

// ============================================================
// 组件属性
// ============================================================
const props = defineProps({
  // 通知类型：info/success/warning/error/note/task/ai
  type: {
    type: String,
    default: 'info'
  },
  // 通知标题
  title: {
    type: String,
    default: ''
  },
  // 通知内容
  body: {
    type: String,
    default: ''
  },
  // 自定义图标（可选）
  icon: {
    type: [String, Object],
    default: null
  },
  // 操作按钮 { label, value }
  action: {
    type: Object,
    default: null
  }
})

// ============================================================
// 组件事件
// ============================================================
const emit = defineEmits(['dismiss', 'action'])

// 类型 → 图标映射
const typeIconMap = {
  info: InfoFilled,
  success: SuccessFilled,
  warning: WarningFilled,
  error: CircleCloseFilled,
  note: Document,
  task: Clock,
  ai: ChatDotRound
}

// 当前图标
const iconEl = computed(() => {
  if (props.icon) return props.icon
  return typeIconMap[props.type] || InfoFilled
})

/**
 * 处理关闭
 */
function handleDismiss () {
  emit('dismiss')
}

/**
 * 处理操作按钮点击
 */
function handleAction () {
  emit('action', { action: props.action })
}
</script>

<style lang="scss" scoped>
.island-notification {
  // Fluent Design 风格
  width: 100%;
  min-height: 56px;
  padding: 12px 16px;
  border-radius: 12px;
  // 半透明背景
  background: var(--island-card-bg);
  // 细边框勾勒轮廓（亮色模式）
  border: var(--island-card-border);
  // 微妙阴影
  box-shadow: var(--island-card-shadow);
  // 布局
  display: flex;
  align-items: center;
  gap: 12px;
  // 文字颜色（跟随主题）
  color: var(--island-text-primary);
  // 鼠标交互
  cursor: default;
  user-select: none;
  // 透明背景的窗口下，让阴影正确显示
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
    color: var(--island-accent, var(--island-text-title));
  }

  &__content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--island-text-title);
    // 单行省略
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__body {
    font-size: 12px;
    line-height: 1.4;
    color: var(--island-text-secondary);
    // 最多两行
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__action {
    flex-shrink: 0;
    padding: 4px 12px;
    border-radius: 6px;
    background: var(--island-action-bg);
    color: var(--island-text-title);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s ease;

    &:hover {
      background: var(--island-action-bg-hover);
    }
  }

  &__close {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: var(--island-close-color);
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;

    &:hover {
      background: var(--island-close-bg-hover);
      color: var(--island-close-color-hover);
    }
  }

  // 类型强调色
  &--info    { --island-accent: #4cc4ff; }
  &--success { --island-accent: #67c23a; }
  &--warning { --island-accent: #e6a23c; }
  &--error   { --island-accent: #f56c6c; }
  &--note    { --island-accent: #f0c674; }
  &--task    { --island-accent: #a78bfa; }
  &--ai      { --island-accent: #4cc4ff; }
}
</style>