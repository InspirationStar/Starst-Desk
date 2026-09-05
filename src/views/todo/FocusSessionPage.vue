<!--
  专注会话进行中页
  功能：倒计时显示、取消/返回

-->
<template>
  <div class="focus-session-page">
    <div class="focus-container">
      <el-icon class="focus-icon"><Timer /></el-icon>
      <h1 class="focus-title">{{ session?.title || '专注会话' }}</h1>
      <div class="focus-mode-label">
        {{ modeLabel }}
        <el-tag v-if="shieldActive" type="warning" size="small" class="shield-tag" effect="light">
          <el-icon><Lock /></el-icon>
          护盾已启用
        </el-tag>
      </div>
      <div class="focus-timer">{{ remaining !== null ? formatTime(remaining) : '--:--' }}</div>
      <div class="focus-hint">
        <template v-if="queueInfo.active">
          队列进度：第 {{ queueInfo.idx }} / {{ queueInfo.total }} 轮
        </template>
        <template v-else>专注计时器运行中...</template>
      </div>

      <div class="focus-actions">
        <el-button size="large" @click="handleCancel">
          <el-icon><Close /></el-icon>
          取消专注
        </el-button>
        <el-button type="primary" size="large" @click="handleComplete">
          <el-icon><Check /></el-icon>
          完成专注
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Timer, Close, Check, Lock } from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'

const router = useRouter()
const route = useRoute()

// 专注模式标签映射
const MODE_LABELS = {
  single: '单任务专注',
  group: '任务流专注',
  project: '项目专注'
}

// 队列信息
const queueInfo = computed(() => {
  const qIdx = parseInt(route.query.qIdx) || 0
  const qTotal = parseInt(route.query.qTotal) || 0
  return { active: qIdx > 0 && qTotal > 0, idx: qIdx, total: qTotal }
})

const session = ref(null)
const remaining = ref(null)
let timerInterval = null
let restTimer = null
// 专注总时长（秒），用于灵动岛进度条
let totalDuration = 0

const modeLabel = computed(() => MODE_LABELS[session.value?.mode] || '专注会话')
// 护盾是否启用（从会话 options 读取）
const shieldActive = ref(false)

async function loadSession () {
  const sessionId = route.query.sessionId
  if (!sessionId) {
    ElMessage.error('未指定会话 ID')
    router.push('/todo/focus')
    return
  }

  try {
    const result = await invoke('focus:get-active')
    if (result?.session?.id === sessionId) {
      session.value = result.session
      remaining.value = result.session.remaining_seconds
      totalDuration = result.session.duration_seconds || result.session.remaining_seconds || 0

      // 从路由 query 读取护盾启用标记（focus_sessions 表未持久化 options）
      shieldActive.value = route.query.shield === '1'
      startTimer()
    } else {
      ElMessage.error('会话不存在或已结束')
      router.push('/todo/focus')
    }
  } catch (err) {
    ElMessage.error(`加载会话失败：${err?.message || '未知错误'}`)
    router.push('/todo/focus')
  }
}


function startTimer () {
  timerInterval = setInterval(async () => {
    if (remaining.value <= 0) {
      clearInterval(timerInterval)
      await handleComplete()
      return
    }
    remaining.value--
    // 每秒推送灵动岛倒计时更新
    try {
      await invoke('focus:tick', {
        taskName: session.value?.title || '专注中',
        remainingMs: (remaining.value || 0) * 1000,
        totalMs: (totalDuration || 0) * 1000
      })
    } catch (e) {
      // 灵动岛更新失败不影响计时
    }
    // 每 5 秒同步一次服务器时间
    if (remaining.value % 5 === 0) {
      await syncRemaining()
    }
  }, 1000)
}

async function syncRemaining () {
  try {
    const result = await invoke('focus:get-active')
    // 会话已结束（被外部取消或完成），停止定时器并跳转回入口
    if (!result?.session) {
      if (timerInterval) {
        clearInterval(timerInterval)
        timerInterval = null
      }
      ElMessage.info('专注会话已结束')
      router.push('/todo/focus')
      return
    }
    if (result.session?.id === session.value?.id) {
      remaining.value = result.session.remaining_seconds
    }
  } catch (err) {
    console.error('[FocusSessionPage] 同步剩余时间失败:', err)
  }
}

async function handleCancel () {
  if (!session.value) return
  try {
    await invoke('focus:cancel', { id: session.value.id })
    ElMessage.success('已取消专注')
    router.push('/todo/focus')
  } catch (err) {
    ElMessage.error(`取消失败：${err?.message || '未知错误'}`)
  }
}

async function handleComplete () {
  if (!session.value) return
  clearInterval(timerInterval)
  try {
    await invoke('focus:complete', { id: session.value.id })
    // 队列模式：检查是否有下一个会话
    const qIdx = parseInt(route.query.qIdx) || 0
    const qTotal = parseInt(route.query.qTotal) || 0
    if (qIdx > 0 && qIdx < qTotal) {
      const qMinutes = parseInt(route.query.qMinutes) || 25
      const bMinutes = parseInt(route.query.bMinutes) || 5
      ElMessage.success(`第 ${qIdx} 轮专注完成！休息 ${bMinutes} 分钟后开始下一轮...`)
      // 休息倒计时后自动开始下一个会话
      restTimer = setTimeout(async () => {
        try {
          const result = await invoke('focus:create', {
            mode: session.value.mode,
            title: session.value.title,
            total_seconds: qMinutes * 60,
            options: { shieldEnabled: route.query.shield === '1' }
          })
          if (result?.session) {
            router.replace({
              path: '/todo/focus/session',
              query: {
                sessionId: result.session.id,
                shield: route.query.shield,
                queue: '1',
                qIdx: String(qIdx + 1),
                qTotal: String(qTotal),
                qMinutes: String(qMinutes),
                bMinutes: String(bMinutes)
              }
            })
          }
        } catch (err) {
          ElMessage.error(`开始下一轮失败：${err?.message || '未知错误'}`)
          router.push('/todo/focus')
        }
      }, bMinutes * 60 * 1000)
      return
    }
    ElMessage.success(qIdx > 0 ? `全部 ${qTotal} 轮专注完成！` : '专注完成！')
    router.push('/todo/focus')
  } catch (err) {
    ElMessage.error(`完成失败：${err?.message || '未知错误'}`)
    router.push('/todo/focus')
  }
}

function formatTime (seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

onMounted(() => {
  loadSession()
})

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval)
  if (restTimer) clearTimeout(restTimer)
})
</script>

<style scoped lang="scss">
.focus-session-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-bg-color);
}

.focus-container {
  text-align: center;
  padding: 40px;
  max-width: 500px;
}

.focus-icon {
  font-size: 48px;
  color: #409eff;
  margin-bottom: 20px;
}

.focus-title {
  font-size: 28px;
  font-weight: 600;
  color: var(--el-text-primary);
  margin: 0 0 8px 0;
}

.focus-mode-label {
  font-size: 14px;
  color: var(--el-text-secondary);
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.shield-tag {
  :deep(.el-tag__content) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
}

.focus-timer {
  font-size: 72px;
  font-weight: 300;
  color: var(--el-text-primary);
  font-variant-numeric: tabular-nums;
  margin-bottom: 16px;
  letter-spacing: 2px;
}

.focus-hint {
  font-size: 13px;
  color: var(--el-text-placeholder);
  margin-bottom: 32px;
}

.focus-actions {
  display: flex;
  gap: 16px;
  justify-content: center;
}
</style>