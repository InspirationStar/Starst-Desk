<!--
  启动前检测视图
  职责：当启动飞行检查（网络连通性 + 关键文件完整性）失败时，
        展示错误列表供用户查看，并提供"重新检测"与"退出"操作。
  入口：主进程 createStartupCheckWindow 加载 SPA 并通过 hash 路由 /startup-check 进入。
  通信：
    - 主进程 -> 渲染进程：startup-check:errors 事件，payload: { errors: string[] }
    - 渲染进程 -> 主进程：startup-check:retry / startup-check:exit

-->
<template>
  <div class="startup-check-view">
    <!-- 顶部说明面板 -->
    <div class="header-panel">
      <h1 class="title">启动前检测</h1>
      <p class="subtitle">
        应用发现当前环境还不能安全进入主界面，修复下面的问题后可以重新检测。
      </p>
      <p class="summary" :class="{ 'summary-ok': errors.length === 0 }">
        {{ summaryText }}
      </p>
    </div>

    <!-- 错误卡片列表 -->
    <div class="cards-scroll">
      <div v-if="errors.length === 0" class="card ok-card">
        <div class="card-title ok">
          <el-icon><CircleCheckFilled /></el-icon>
          <span>检测通过</span>
        </div>
        <div class="card-body">网络和关键文件都正常，正在进入软件...</div>
      </div>

      <div v-for="(error, index) in errors" :key="index" class="card">
        <div class="card-title">
          <el-icon class="card-icon"><WarningFilled /></el-icon>
          <span>未通过 - {{ describeError(error).title }}</span>
        </div>
        <div class="card-body">{{ describeError(error).body }}</div>
      </div>
    </div>

    <!-- 底部操作区 -->
    <div class="actions">
      <el-button :disabled="retrying" @click="handleExit">退出</el-button>
      <el-button type="primary" :loading="retrying" @click="handleRetry">重新检测</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { WarningFilled, CircleCheckFilled } from '@element-plus/icons-vue'

const errors = ref([])
const retrying = ref(false)

// 摘要文案
const summaryText = computed(() => {
  if (retrying.value) return '正在重新检测...'
  if (errors.value.length === 0) return '检测通过，正在进入软件。'
  return `发现 ${errors.value.length} 个问题，已暂缓进入主界面。`
})

/**
 * 根据错误文本归类标题与建议
 * @param {string} error 原始错误文本
 * @returns {{title: string, body: string}}
 */
function describeError (error) {
  const text = (error || '').trim()
  if (text.includes('网络') || text.includes('baidu.com') || text.includes('unpkg.com') || text.includes('qq.com')) {
    return {
      title: '网络连接未通过',
      body: text + '\n\n建议：确认电脑已联网；如果使用代理或防火墙，请允许本软件访问网络。'
    }
  }
  if (text.includes('文件') || text.includes('dist') || text.includes('index.html') || text.includes('assets')) {
    return {
      title: '关键资源文件异常',
      body: text + '\n\n建议：检查软件目录是否完整，尤其是 dist 资源文件夹。'
    }
  }
  return {
    title: '软件初始化异常',
    body: text + '\n\n建议：保留这段错误信息，方便定位具体模块。'
  }
}

/**
 * 点击"重新检测"：调用主进程重新执行飞行检查
 */
async function handleRetry () {
  if (retrying.value) return
  retrying.value = true
  try {
    const result = await window.electronAPI.invoke('startup-check:retry')
    if (result && result.ok) {
      // 检测通过，主进程会销毁本窗口并继续启动，无需在此处理
      errors.value = []
    } else if (result && Array.isArray(result.errors)) {
      errors.value = result.errors
    }
  } catch (error) {
    // 重新检测异常时保留原列表，避免用户丢失上下文
    console.error('[StartupCheck] 重新检测失败:', error)
  } finally {
    retrying.value = false
  }
}

/**
 * 点击"退出"：通知主进程退出应用
 */
function handleExit () {
  window.electronAPI.send('startup-check:exit')
}

// 接收主进程推送的错误列表
let offErrorsListener = null
onMounted(() => {
  offErrorsListener = window.electronAPI.on('startup-check:errors', (payload) => {
    if (payload && Array.isArray(payload.errors)) {
      errors.value = payload.errors
    }
  })
})

onBeforeUnmount(() => {
  if (typeof offErrorsListener === 'function') {
    offErrorsListener()
  }
})
</script>

<style scoped lang="scss">
// 深色主题配色
$startup-bg: #1c1b1f;
$startup-panel: #2b2930;
$startup-panel-border: #49454f;
$startup-card-bg: #211f26;
$startup-card-border: #625b71;
$startup-text-primary: #e6e1e5;
$startup-text-secondary: #cac4d0;
$startup-accent: #d0bcff;
$startup-danger: #ffb4ab;
$startup-success: #b9f6ca;
$startup-title: #ffd8e4;

.startup-check-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 30px 34px;
  background: $startup-bg;
  color: $startup-text-primary;
  font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
  box-sizing: border-box;
}

.header-panel {
  background: $startup-panel;
  border: 1px solid $startup-panel-border;
  border-radius: 18px;
  padding: 24px 28px;
  margin-bottom: 18px;

  .title {
    font-size: 30px;
    font-weight: 800;
    color: $startup-title;
    margin: 0 0 8px;
  }

  .subtitle {
    font-size: 15px;
    color: $startup-text-secondary;
    margin: 0 0 8px;
    line-height: 1.5;
  }

  .summary {
    font-size: 14px;
    font-weight: 600;
    color: $startup-accent;
    margin: 0;

    &.summary-ok {
      color: $startup-success;
    }
  }
}

.cards-scroll {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: $startup-card-border;
    border-radius: 4px;
  }
}

.card {
  background: $startup-card-bg;
  border: 1px solid $startup-card-border;
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 12px;

  .card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
    font-weight: 800;
    color: $startup-danger;
    margin-bottom: 10px;

    .card-icon {
      font-size: 22px;
    }

    &.ok {
      color: $startup-success;
    }
  }

  .card-body {
    font-size: 13px;
    line-height: 1.55;
    color: $startup-text-secondary;
    white-space: pre-wrap;
    user-select: text;
  }
}

.ok-card {
  border-color: $startup-success;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 18px;

  :deep(.el-button) {
    min-height: 42px;
    padding: 0 22px;
    border-radius: 21px;
    font-size: 14px;
    font-weight: 600;
  }

  // 次要按钮：退出
  :deep(.el-button:not(.el-button--primary)) {
    background: #332d41;
    color: $startup-text-primary;
    border: 1px solid $startup-card-border;
  }

  // 主按钮：重新检测
  :deep(.el-button--primary) {
    background: $startup-accent;
    color: #381e72;
    border: none;
  }

  :deep(.el-button.is-disabled) {
    background: #49454f !important;
    color: $startup-text-secondary !important;
  }
}
</style>