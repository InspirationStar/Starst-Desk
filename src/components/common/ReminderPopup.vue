<!--
  应用内提醒弹窗组件
  职责：监听主进程 'reminder:popup' 推送事件，在应用内显示提醒弹窗
  支持的提醒类型：note/task/health_*，统一展示标题与正文
  提供"稍后提醒（10 分钟后）"与"知道了"两个操作
-->
<template>
  <transition name="reminder-slide">
    <div v-if="visible" class="reminder-popup" @click.stop>
      <div class="reminder-popup__card">
        <!-- 头部 -->
        <div class="reminder-popup__header">
          <div class="reminder-popup__title">
            <el-icon class="reminder-popup__icon"><Bell /></el-icon>
            <span>{{ reminder.title || '提醒' }}</span>
          </div>
          <el-icon class="reminder-popup__close" @click="handleDismiss"><Close /></el-icon>
        </div>

        <!-- 内容 -->
        <div class="reminder-popup__body">
          <div class="reminder-popup__content" v-html="formattedBody"></div>
          <div class="reminder-popup__meta">
            <el-tag size="small" :type="typeTagType">{{ typeLabel }}</el-tag>
            <span class="reminder-popup__time">{{ formattedTime }}</span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="reminder-popup__footer">
          <el-button size="small" @click="handleSnooze">稍后提醒（10 分钟）</el-button>
          <el-button size="small" type="primary" @click="handleDismiss">知道了</el-button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import { Bell, Close } from '@element-plus/icons-vue'
import { on, removeAllListeners } from '@/utils/ipc-client'
import { useNoteStore } from '@/stores/note-store'

// 提醒弹窗可见状态
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

// 格式化正文（去除 HTML 标签，截断长度）
const formattedBody = computed(() => {
  const body = reminder.body || ''
  // 提取纯文本
  const div = document.createElement('div')
  div.innerHTML = body
  const text = (div.textContent || div.innerText || '').trim()
  if (!text) return '<span class="reminder-empty">无内容</span>'
  // 截断到 200 字符
  return text.length > 200 ? text.slice(0, 200) + '…' : text
})

// 提醒类型标签
const typeLabel = computed(() => {
  const typeMap = {
    note: '便签提醒',
    task: '定时任务',
    health_water: '喝水提醒',
    health_sedentary: '久坐提醒',
    health_eye: '护眼提醒',
    health_stretch: '运动伸展',
    health_sleep: '睡眠提醒',
    health_diet: '饮食提醒'
  }
  return typeMap[reminder.type] || '提醒'
})

// 提醒类型对应的标签颜色
const typeTagType = computed(() => {
  if (reminder.type === 'note') return 'warning'
  if (reminder.type === 'task') return 'primary'
  if (reminder.type?.startsWith('health_')) return 'success'
  return 'info'
})

// 格式化接收时间
const formattedTime = computed(() => {
  if (!reminder.receivedAt) return ''
  return dayjs(reminder.receivedAt).format('HH:mm')
})

// 处理接收到的提醒事件
function handleReminder (payload) {
  // 如果已有弹窗，先关闭旧的（或排队，这里采用覆盖策略）
  Object.assign(reminder, {
    type: payload.type || '',
    title: payload.title || '提醒',
    body: payload.body || '',
    source: payload.source || null,
    extra: payload.extra || null,
    receivedAt: new Date().toISOString()
  })
  visible.value = true

  // 如果是便签提醒，标记为已提醒
  if (payload.source?.module === 'note' && payload.source?.id) {
    noteStore.markReminded(payload.source.id).catch(err => {
      console.error('[ReminderPopup] 标记已提醒失败:', err)
    })
  }
}

// "知道了"：关闭弹窗
function handleDismiss () {
  visible.value = false
}

// "稍后提醒（10 分钟后）"：
// 1. 关闭当前弹窗
// 2. 如果是便签提醒，更新 reminder_time 为 10 分钟后，并重置 is_reminded
function handleSnooze () {
  visible.value = false
  // 仅便签类型支持稍后提醒（更新 reminder_time）
  if (reminder.source?.module === 'note' && reminder.source?.id) {
    const newReminderTime = dayjs().add(10, 'minute').format('YYYY-MM-DD HH:mm:00')
    noteStore.updateNote(reminder.source.id, {
      reminder_time: newReminderTime,
      is_reminded: 0
    }).then(success => {
      if (success) {
        console.log('[ReminderPopup] 已设置 10 分钟后再次提醒')
      }
    }).catch(err => {
      console.error('[ReminderPopup] 设置稍后提醒失败:', err)
    })
  }
}

// 组件挂载：监听主进程推送
onMounted(() => {
  // 监听 'reminder:popup' 事件（preload.js 白名单中的事件通道）
  unsubscribe = on('reminder:popup', handleReminder)
})

// 组件卸载前：取消监听
onBeforeUnmount(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  // 兜底：移除所有监听器
  removeAllListeners('reminder:popup')
})
</script>

<style scoped lang="scss">
// 遮罩层（半透明背景，点击空白不关闭，需点击按钮）
.reminder-popup {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 9999;
  width: 360px;
  user-select: none;

  &__card {
    background: #ffffff;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);
    overflow: hidden;
    border: 1px solid #ebeef5;
  }

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
    font-size: 15px;
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__icon {
    font-size: 18px;
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
    font-size: 14px;
    color: #303133;
    line-height: 1.6;
    word-break: break-all;
    margin-bottom: 12px;
    max-height: 200px;
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
    padding: 12px 16px;
    border-top: 1px solid #ebeef5;
    background: #fafafa;
  }
}

// 滑入/滑出动画
.reminder-slide-enter-active,
.reminder-slide-leave-active {
  transition: all 0.3s ease;
}

.reminder-slide-enter-from {
  transform: translateX(400px);
  opacity: 0;
}

.reminder-slide-leave-to {
  transform: translateX(400px);
  opacity: 0;
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark .reminder-popup {
  &__card {
    background: #252627;
    border-color: #414243;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

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
</style>