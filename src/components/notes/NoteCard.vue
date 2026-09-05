<!--
  便签卡片组件
  - 顶部：标题 + 状态标签（已置顶/已完成/已提醒/已逾期/待提醒）
  - 内容预览
  - 底部：颜色标签 + 提醒时间 + 操作按钮区
  - 操作按钮：编辑、置顶/取消置顶、标记完成/取消完成、删除
    每个按钮均提供 icon + tooltip + 文字标签，语义明确
  - 暗色主题通过 html.dark 选择器 + CSS 变量适配
-->
<template>
  <div
    class="note-card"
    :class="[
      `note-card--${note.color_tag || 'yellow'}`,
      { 'is-pinned': isPinned },
      { 'is-completed': isCompleted },
      { 'is-due': isDue },
      { 'is-overdue': isOverdue }
    ]"
    @click="handleClick"
    @contextmenu.prevent="handleContextMenu"
  >
    <!-- 顶部：标题 + 状态标签 -->
    <div class="note-card__header">
      <div class="note-card__title" :title="displayTitle">
        {{ displayTitle }}
      </div>
      <div class="note-card__status-tags">
        <!-- 已置顶标签 -->
        <el-tag
          v-if="isPinned"
          size="small"
          type="warning"
          effect="plain"
          round
          class="note-card__tag"
        >
          <el-icon class="note-card__tag-icon"><Top /></el-icon>
          已置顶
        </el-tag>
        <!-- 已完成标签 -->
        <el-tag
          v-if="isCompleted"
          size="small"
          type="success"
          effect="plain"
          round
          class="note-card__tag"
        >
          <el-icon class="note-card__tag-icon"><CircleCheckFilled /></el-icon>
          已完成
        </el-tag>
        <!-- 已逾期标签 -->
        <el-tag
          v-if="isOverdue"
          size="small"
          type="danger"
          effect="dark"
          round
          class="note-card__tag"
        >
          <el-icon class="note-card__tag-icon"><AlarmClock /></el-icon>
          已逾期
        </el-tag>
        <!-- 已提醒标签 -->
        <el-tag
          v-else-if="isReminded"
          size="small"
          type="info"
          effect="plain"
          round
          class="note-card__tag"
        >
          <el-icon class="note-card__tag-icon"><BellFilled /></el-icon>
          已提醒
        </el-tag>
        <!-- 待提醒标签 -->
        <el-tag
          v-else-if="hasReminder"
          size="small"
          type="info"
          effect="plain"
          round
          class="note-card__tag"
        >
          <el-icon class="note-card__tag-icon"><Clock /></el-icon>
          待提醒
        </el-tag>
      </div>
    </div>

    <!-- 内容预览 -->
    <div class="note-card__body" v-html="previewBody"></div>

    <!-- 底部：颜色标签 + 提醒时间 -->
    <div class="note-card__footer">
      <div class="note-card__meta">
        <span
          class="note-card__color-tag"
          :style="{ background: colorInfo.color }"
          :title="`颜色：${colorInfo.label}`"
        >
          {{ colorInfo.label }}
        </span>
        <span v-if="note.reminder_time" class="note-card__reminder" :class="{ 'is-overdue': isOverdue }">
          <el-icon><Clock /></el-icon>
          {{ reminderText }}
        </span>
      </div>
      <div class="note-card__actions" @click.stop>
        <el-tooltip :content="isPinned ? '取消置顶' : '置顶'" placement="top">
          <button
            class="note-card__action-btn"
            :class="{ 'is-active': isPinned }"
            :aria-label="isPinned ? '取消置顶' : '置顶'"
            @click="handleTogglePin"
          >
            <el-icon><Top /></el-icon>
            <span class="note-card__action-label">{{ isPinned ? '取消置顶' : '置顶' }}</span>
          </button>
        </el-tooltip>
        <el-tooltip :content="isCompleted ? '标记为进行中' : '标记为已完成'" placement="top">
          <button
            class="note-card__action-btn"
            :class="{ 'is-active': isCompleted }"
            :aria-label="isCompleted ? '标记为进行中' : '标记为已完成'"
            @click="handleToggleComplete"
          >
            <el-icon><CircleCheck /></el-icon>
            <span class="note-card__action-label">{{ isCompleted ? '取消完成' : '标记完成' }}</span>
          </button>
        </el-tooltip>
        <el-tooltip content="编辑" placement="top">
          <button
            class="note-card__action-btn"
            aria-label="编辑"
            @click="handleEdit"
          >
            <el-icon><Edit /></el-icon>
            <span class="note-card__action-label">编辑</span>
          </button>
        </el-tooltip>
        <el-tooltip content="删除" placement="top">
          <button
            class="note-card__action-btn note-card__action-btn--danger"
            aria-label="删除"
            @click="handleDelete"
          >
            <el-icon><Delete /></el-icon>
            <span class="note-card__action-label">删除</span>
          </button>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import dayjs from 'dayjs'
import { NOTE_COLORS } from '@/utils/constants'

// Props
const props = defineProps({
  // 便签数据对象
  note: {
    type: Object,
    required: true
  },
  // 是否始终显示操作按钮（不依赖悬浮）
  showActions: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['edit', 'delete', 'toggle-pin', 'toggle-complete', 'contextmenu'])

// 是否置顶
const isPinned = computed(() => Number(props.note.is_pinned) === 1)
// 是否完成
const isCompleted = computed(() => Number(props.note.is_completed) === 1)
// 是否已提醒
const isReminded = computed(() => Number(props.note.is_reminded) === 1)
// 是否有提醒时间
const hasReminder = computed(() => !!props.note.reminder_time && !isCompleted.value)
// 提醒是否已逾期（有提醒时间且未完成且时间 < 当前）
const isOverdue = computed(() => {
  if (!props.note.reminder_time || isCompleted.value) return false
  const reminderTime = dayjs(props.note.reminder_time)
  const now = dayjs()
  return reminderTime.isBefore(now)
})
// 提醒是否已到期未提醒（用于高亮动画）
const isDue = computed(() => isOverdue.value && !isReminded.value)

// 显示标题（空标题时显示"无标题"）
const displayTitle = computed(() => {
  return props.note.title || '无标题'
})

// 内容预览（去除 HTML 标签，截断到 100 字符）
const previewBody = computed(() => {
  const body = props.note.body || ''
  // 提取纯文本
  const div = document.createElement('div')
  div.innerHTML = body
  const text = (div.textContent || div.innerText || '').trim()
  if (!text) return '<span class="note-card__empty">无内容</span>'
  // 截断
  const truncated = text.length > 100 ? text.slice(0, 100) + '…' : text
  // 转义 HTML 特殊字符
  return truncated
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
})

// 颜色标签信息
const colorInfo = computed(() => {
  const tag = props.note.color_tag || 'yellow'
  return NOTE_COLORS.find(item => item.value === tag) || NOTE_COLORS[0]
})

// 提醒时间文案
const reminderText = computed(() => {
  if (!props.note.reminder_time) return ''
  const time = dayjs(props.note.reminder_time)
  const now = dayjs()
  // 距离当前时间不足 1 天，显示 HH:mm
  if (time.isSame(now, 'day')) {
    return time.format('今天 HH:mm')
  }
  // 明天
  if (time.isSame(now.add(1, 'day'), 'day')) {
    return time.format('明天 HH:mm')
  }
  // 其他显示完整日期
  return time.format('MM-DD HH:mm')
})

// 点击卡片
function handleClick () {
  emit('edit', props.note)
}

// 右键菜单
function handleContextMenu (event) {
  emit('contextmenu', event, props.note)
}

// 编辑
function handleEdit () {
  emit('edit', props.note)
}

// 删除
function handleDelete () {
  emit('delete', props.note)
}

// 切换置顶
function handleTogglePin () {
  emit('toggle-pin', props.note)
}

// 切换完成
function handleToggleComplete () {
  emit('toggle-complete', props.note)
}
</script>

<style scoped lang="scss">
// ============================================================
// - 圆角 8px，悬浮上抬
// - 颜色变体作为背景
// - 状态标签（el-tag）+ 操作按钮（icon + 文字标签）
// ============================================================
.note-card {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 180px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
  user-select: none;

  // 悬浮效果
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);

    // 悬浮时显示操作按钮
    .note-card__actions {
      opacity: 1;
      transform: translateY(0);
    }
  }

  // 到期高亮
  &.is-due {
    box-shadow: 0 0 0 2px #f56c6c inset;
    animation: note-card-pulse 2s ease-in-out infinite;
  }

  // 完成状态：整体降低不透明度
  &.is-completed {
    opacity: 0.65;

    .note-card__title,
    .note-card__body {
      text-decoration: line-through;
    }
  }

  // 颜色变体
  &--yellow { background: #fef0c7; }
  &--red    { background: #fde2e2; }
  &--orange { background: #fde8d4; }
  &--green  { background: #d4f0d4; }
  &--blue   { background: #d4e4f7; }
  &--purple { background: #e4d4f7; }

  // 顶部
  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 8px;
    gap: 8px;
  }

  &__title {
    flex: 1;
    font-size: 15px;
    font-weight: 600;
    color: #303133;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 4px;
  }

  // 状态标签区
  &__status-tags {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: 60%;
  }

  &__tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 6px;
    height: 20px;
    font-size: 11px;
    line-height: 1;
  }

  &__tag-icon {
    font-size: 11px;
    margin-right: 2px;
  }

  // 内容
  &__body {
    flex: 1;
    font-size: 13px;
    color: #606266;
    line-height: 1.6;
    overflow: hidden;
    word-break: break-all;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
  }

  &__empty {
    color: #c0c4cc;
    font-style: italic;
  }

  // 底部
  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    gap: 8px;
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  &__color-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    color: #606266;
    font-size: 11px;
    background: rgba(255, 255, 255, 0.6);
    flex-shrink: 0;
  }

  &__reminder {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #909399;
    font-size: 11px;

    // 逾期红色高亮
    &.is-overdue {
      color: #f56c6c;
      font-weight: 500;
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.2s ease, transform 0.2s ease;
    flex-shrink: 0;
  }

  &__action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-width: 28px;
    height: 24px;
    padding: 0 6px;
    border: none;
    background: rgba(255, 255, 255, 0.7);
    border-radius: 4px;
    cursor: pointer;
    color: #606266;
    font-size: 11px;
    transition: background 0.15s ease, color 0.15s ease;

    .el-icon {
      font-size: 13px;
    }

    &:hover {
      background: rgba(255, 255, 255, 0.95);
      color: #303133;
    }

    // 激活态（已置顶/已完成）
    &.is-active {
      color: #e6a23c;
      background: rgba(230, 162, 60, 0.12);

      &:hover {
        background: rgba(230, 162, 60, 0.2);
      }
    }

    // 危险按钮（删除）
    &--danger {
      &:hover {
        background: rgba(245, 108, 108, 0.15);
        color: #f56c6c;
      }
    }
  }

  &__action-label {
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
  }
}

// 到期脉冲动画
@keyframes note-card-pulse {
  0%, 100% { box-shadow: 0 0 0 2px #f56c6c inset; }
  50%      { box-shadow: 0 0 0 3px #f56c6c inset; }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark .note-card {
  border-color: rgba(255, 255, 255, 0.08);

  &:hover {
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  }

  // 颜色变体在暗色模式下降低饱和度、加深底色
  &--yellow { background: #4a3f1e; }
  &--red    { background: #4a2424; }
  &--orange { background: #4a3220; }
  &--green  { background: #244a24; }
  &--blue   { background: #1e3a5a; }
  &--purple { background: #3a1e4a; }

  &__title {
    color: #e5eaf3;
  }

  &__body {
    color: #cfd3dc;
  }

  &__empty {
    color: #6a6d75;
  }

  &__color-tag {
    color: #cfd3dc;
    background: rgba(0, 0, 0, 0.3);
  }

  &__reminder {
    color: #a3a6ad;

    &.is-overdue {
      color: #ff7875;
    }
  }

  &__action-btn {
    background: rgba(0, 0, 0, 0.4);
    color: #cfd3dc;

    &:hover {
      background: rgba(0, 0, 0, 0.6);
      color: #e5eaf3;
    }

    &.is-active {
      color: #ffb74d;
      background: rgba(255, 183, 77, 0.15);

      &:hover {
        background: rgba(255, 183, 77, 0.25);
      }
    }

    &--danger {
      &:hover {
        background: rgba(245, 108, 108, 0.2);
        color: #ff7875;
      }
    }
  }
}
</style>
