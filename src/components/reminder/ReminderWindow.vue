<!--
  独立提醒窗口组件
  职责：监听主进程 'reminder:popup' 推送事件，在独立窗口中显示提醒
  支持的提醒类型：note/task/health_*
-->
<template>
  <div class="reminder-window" :class="{ 'reminder-window--visible': visible }">
    <div class="reminder-window__card" :class="`reminder-window__card--${typeKey}`">
      <!-- 头部 -->
      <div class="reminder-window__header">
        <div class="reminder-window__title">
          <span class="reminder-window__icon">{{ typeEmoji }}</span>
          <span>{{ reminder.title || '提醒' }}</span>
        </div>
        <el-icon class="reminder-window__close" @click="handleDismiss"><Close /></el-icon>
      </div>

      <!-- 内容 -->
      <div class="reminder-window__body">
        <div class="reminder-window__content">{{ formattedBody }}</div>
        <div class="reminder-window__meta">
          <el-tag size="small" :type="typeTagType">{{ typeLabel }}</el-tag>
          <span class="reminder-window__time">{{ formattedTime }}</span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="reminder-window__footer">
        <el-button size="small" @click="handleSnooze" v-if="reminder.source?.module === 'note'">稍后提醒</el-button>
        <el-button size="small" type="primary" @click="handleDismiss">知道了</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import { Close } from '@element-plus/icons-vue'
import { on, removeAllListeners } from '@/utils/ipc-client'
import { useNoteStore } from '@/stores/note-store'

// 提醒窗口可见状态
const visible = ref(false)

// 提醒数据
const reminder = reactive({
  type: '',
  title: '',
  body: '',
  source: null,
  extra: null,
  receivedAt: null
})

// Store（用于稍后提醒时更新便签）
const noteStore = useNoteStore()

// 取消监听函数
let unsubscribe = null

// 自动消失定时器
let autoDismissTimer = null

// 提醒类型映射
const TYPE_KEY_MAP = {
  note: 'note',
  task: 'task',
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
  diet: 'diet',
  encouragement: 'encouragement',
  health: 'health',
  todo: 'todo',
  quote: 'quote',
  activity: 'activity',
  analytics: 'analytics'
}

// 类型 emoji 映射
const TYPE_EMOJI_MAP = {
  note: '📝',
  task: '✅',
  water: '💧',
  sit: '🪑',
  eye: '👁️',
  sleep: '😴',
  diet: '🍽️',
  encouragement: '💪',
  health: '⚠️',
  todo: '📋',
  quote: '✨',
  activity: '🎯',
  analytics: '📊'
}

// 归一化 typeKey
const typeKey = computed(() => {
  const raw = reminder.type
  if (!raw || typeof raw !== 'string') return 'default'
  const lower = raw.toLowerCase()
  return TYPE_KEY_MAP[lower] || 'default'
})

// 类型 emoji
const typeEmoji = computed(() => {
  return TYPE_EMOJI_MAP[typeKey.value] || '🔔'
})

// 格式化正文
const formattedBody = computed(() => {
  const body = reminder.body || ''
  if (!body) return '<span class="reminder-empty">无内容</span>'
  // 截断到 200 字符
  return body.length > 200 ? body.slice(0, 200) + '…' : body
})

// 提醒类型标签
const typeLabel = computed(() => {
  const typeMap = {
    note: '便签提醒',
    task: '定时任务',
    water: '喝水提醒',
    sit: '久坐提醒',
    eye: '护眼提醒',
    sleep: '睡眠提醒',
    diet: '饮食提醒',
    encouragement: '鼓励消息',
    health: '健康提醒',
    todo: '待办提醒',
    quote: '名言',
    activity: '用户活动',
    analytics: '数据分析'
  }
  return typeMap[reminder.type] || '提醒'
})

// 提醒类型对应的标签颜色
const typeTagType = computed(() => {
  if (reminder.type === 'note') return 'warning'
  if (reminder.type === 'task') return 'primary'
  if (reminder.type?.startsWith('health_') || reminder.type === 'health') return 'success'
  if (reminder.type === 'water') return 'info'
  if (reminder.type === 'encouragement') return 'success'
  if (reminder.type === 'activity') return ''
  if (reminder.type === 'analytics') return 'purple'
  return 'info'
})

// 格式化接收时间
const formattedTime = computed(() => {
  if (!reminder.receivedAt) return ''
  return dayjs(reminder.receivedAt).format('HH:mm')
})

/**
 * 处理接收到的提醒事件
 */
function handleReminder (payload) {
  // 如果已有弹窗，先关闭旧的
  Object.assign(reminder, {
    type: payload.type || '',
    title: payload.title || '提醒',
    body: payload.body || '',
    source: payload.source || null,
    extra: payload.extra || null,
    receivedAt: new Date().toISOString()
  })
  visible.value = true

  // 清除之前的定时器
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer)
  }

  // 10 秒后自动消失
  autoDismissTimer = setTimeout(() => {
    visible.value = false
  }, 10000)

  // 如果是便签提醒，标记为已提醒
  if (payload.source?.module === 'note' && payload.source?.id) {
    noteStore.markReminded(payload.source.id).catch(err => {
      console.error('[ReminderWindow] 标记已提醒失败:', err)
    })
  }
}

/**
 * "知道了"：关闭弹窗
 */
function handleDismiss () {
  visible.value = false
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer)
    autoDismissTimer = null
  }
}

/**
 * "稍后提醒"：10 分钟后再次提醒
 */
function handleSnooze () {
  visible.value = false
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer)
    autoDismissTimer = null
  }

  // 仅便签类型支持稍后提醒
  if (reminder.source?.module === 'note' && reminder.source?.id) {
    const newReminderTime = dayjs().add(10, 'minute').format('YYYY-MM-DD HH:mm:00')
    noteStore.updateNote(reminder.source.id, {
      reminder_time: newReminderTime,
      is_reminded: 0
    }).then(success => {
      if (success) {
        console.log('[ReminderWindow] 已设置 10 分钟后再次提醒')
      }
    }).catch(err => {
      console.error('[ReminderWindow] 设置稍后提醒失败:', err)
    })
  }
}

// 组件挂载：监听主进程推送
onMounted(() => {
  unsubscribe = on('reminder:popup', handleReminder)
})

// 组件卸载前：取消监听
onBeforeUnmount(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  removeAllListeners('reminder:popup')
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer)
  }
})
</script>

<style scoped lang="scss">
.reminder-window {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  width: 360px;
  user-select: none;
  opacity: 0;
  transform: translateY(-20px);
  transition: opacity 0.3s ease, transform 0.3s ease;
  pointer-events: none;

  &--visible {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  &__card {
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, 0.08);

    // 类型左侧色条
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      border-radius: 4px 0 0 4px;
    }

    &--note::before { background: #f5a623; }
    &--task::before { background: #409eff; }
    &--water::before { background: #4cc2ff; }
    &--sit::before { background: #f5a623; }
    &--eye::before { background: #9b59b6; }
    &--sleep::before { background: #5c6bc0; }
    &--diet::before { background: #67c23a; }
    &--encouragement::before { background: #67c23a; }
    &--health::before { background: #e94b3c; }
    &--todo::before { background: #4cc2ff; }
    &--quote::before { background: #b8860b; }
    &--activity::before { background: #409eff; }
    &--analytics::before { background: #9b59b6; }

    // 头部
    &__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
      color: #ffffff;
    }

    &__title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    &__close {
      font-size: 16px;
      cursor: pointer;
      opacity: 0.85;
      transition: opacity 0.2s;

      &:hover {
        opacity: 1;
      }
    }

    // 内容
    &__body {
      padding: 16px;
    }

    &__content {
      font-size: 13px;
      color: #303133;
      line-height: 1.6;
      word-break: break-all;
      margin-bottom: 12px;
      max-height: 120px;
      overflow-y: auto;

      .reminder-empty {
        color: #c0c4cc;
        font-style: italic;
      }
    }

    &__meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #909399;
    }

    &__time {
      font-size: 12px;
    }

    // 底部按钮
    &__footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 16px;
      border-top: 1px solid #f5f5f5;
      background: #fafafa;
    }
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark .reminder-window {
  &__card {
    background: #252627;
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);

    &__content {
      color: #e5eaf3;

      .reminder-empty {
        color: #6a6d75;
      }
    }

    &__meta {
      color: #a3a6ad;
    }

    &__footer {
      border-top-color: #414243;
      background: #1d1e1f;
    }
  }
}
</style>