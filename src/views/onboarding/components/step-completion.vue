<!--
  引导步骤：完成页面
  职责：汇总已启用的部件、外观、日常使用、存储配置，搜索演示动画
  - SetupStep5: 汇总 widgets/appearance/daily/storage 信息
  - StartSearchDemoAnimation: 搜索打字机动画
-->
<template>
  <div class="step-completion">
    <!-- 完成图标 -->
    <div class="completion-header">
      <el-icon class="completion-icon"><CircleCheckFilled /></el-icon>
      <h3 class="completion-title">一切就绪！</h3>
      <p class="completion-subtitle">点击「开始使用」进入主界面</p>
    </div>

    <!-- 配置汇总 -->
    <div class="summary-grid">
      <!-- 已启用部件 -->
      <div class="summary-card">
        <div class="summary-card__title">
          <el-icon><Grid /></el-icon>
          已启用部件
        </div>
        <div class="summary-card__content">
          {{ widgetsSummary || '未启用任何部件' }}
        </div>
      </div>

      <!-- 外观配置 -->
      <div class="summary-card">
        <div class="summary-card__title">
          <el-icon><Brush /></el-icon>
          外观配置
        </div>
        <div class="summary-card__content">{{ appearanceSummary }}</div>
      </div>

      <!-- 日常使用 -->
      <div class="summary-card">
        <div class="summary-card__title">
          <el-icon><Key /></el-icon>
          日常使用
        </div>
        <div class="summary-card__content">{{ dailySummary }}</div>
      </div>

      <!-- 存储配置 -->
      <div class="summary-card">
        <div class="summary-card__title">
          <el-icon><FolderOpened /></el-icon>
          存储配置
        </div>
        <div class="summary-card__content">{{ storageSummary }}</div>
      </div>
    </div>

    <!-- 搜索演示动画 -->
    <div class="search-demo">
      <div class="search-demo__title">快速搜索</div>
      <div class="search-demo__input">
        <el-icon><Search /></el-icon>
        <span class="search-demo__text">{{ searchDemoText }}</span>
        <span v-if="showCursor" class="search-demo__cursor">|</span>
      </div>
      <transition name="search-results">
        <div v-if="showResults" class="search-demo__results">
          <div class="search-result-item">
            <el-icon><Document /></el-icon>
            <span>周报.docx</span>
          </div>
          <div class="search-result-item">
            <el-icon><Document /></el-icon>
            <span>周报-备份.docx</span>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  CircleCheckFilled, Grid, Brush, Key, FolderOpened,
  Search, Document
} from '@element-plus/icons-vue'

const props = defineProps({
  // 已启用的部件列表
  enabledWidgets: { type: Array, default: () => [] },
  // 外观配置
  appearance: {
    type: Object,
    default: () => ({ theme: 'auto', material: 'mica' })
  },
  // 日常使用配置
  dailyUse: {
    type: Object,
    default: () => ({ hotkeyEnabled: true, autoStart: false })
  },
  // 存储配置
  storage: {
    type: Object,
    default: () => ({ storagePath: '', pinnedToQuickAccess: false })
  }
})

// 部件汇总文案
const widgetsSummary = computed(() => {
  if (!props.enabledWidgets || props.enabledWidgets.length === 0) {
    return ''
  }
  return props.enabledWidgets.join(' · ')
})

// 外观汇总文案
const appearanceSummary = computed(() => {
  const themeLabel = {
    light: '浅色',
    dark: '深色',
    auto: '跟随系统'
  }[props.appearance?.theme] || '跟随系统'
  const materialLabel = {
    mica: '云母',
    acrylic: '亚克力',
    solid: '纯色'
  }[props.appearance?.material] || '云母'
  return `${themeLabel} · ${materialLabel}`
})

// 日常使用汇总文案
const dailySummary = computed(() => {
  const hotkeyStatus = props.dailyUse?.hotkeyEnabled ? '热键已开启' : '热键已关闭'
  const startupStatus = props.dailyUse?.autoStart ? '开机自启已开启' : '开机自启已关闭'
  return `${hotkeyStatus} · ${startupStatus}`
})

// 存储汇总文案
const storageSummary = computed(() => {
  const path = props.storage?.storagePath || '默认目录'
  const pinStatus = props.storage?.pinnedToQuickAccess ? '已固定' : '未固定'
  const dirName = path.split(/[\\/]/).pop() || path
  return `${dirName} · ${pinStatus}`
})

// 搜索演示动画状态
const searchDemoText = ref('')
const showCursor = ref(true)
const showResults = ref(false)
let animationTimers = []
let animationStopped = false

/**
 * 运行搜索打字机演示动画
 */
async function runSearchDemo () {
  // 清理上一次动画
  animationTimers.forEach(clearTimeout)
  animationTimers = []

  const demoText = '周报.docx'
  searchDemoText.value = ''
  showResults.value = false

  // 等待 600ms
  await delay(600)
  if (animationStopped) return

  // 打字机效果（每个字符 110ms）
  for (let i = 0; i < demoText.length; i++) {
    if (animationStopped) return
    searchDemoText.value = demoText.substring(0, i + 1)
    await delay(110)
  }

  // 等待 400ms 后显示结果
  await delay(400)
  if (animationStopped) return
  showResults.value = true

  // 光标闪烁 5 次后隐藏
  for (let i = 0; i < 5; i++) {
    if (animationStopped) return
    showCursor.value = !showCursor.value
    await delay(500)
  }
  showCursor.value = false
}

/**
 * 延迟工具函数
 */
function delay (ms) {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms)
    animationTimers.push(t)
  })
}

// 监听 props 变化时重启演示动画
watch(
  () => [props.enabledWidgets, props.appearance, props.dailyUse, props.storage],
  () => {
    if (!animationStopped) {
      runSearchDemo()
    }
  },
  { deep: true }
)

onMounted(() => {
  runSearchDemo()
})

onBeforeUnmount(() => {
  animationStopped = true
  animationTimers.forEach(clearTimeout)
})
</script>

<style scoped lang="scss">
.step-completion {
  // 完成头部
  .completion-header {
    text-align: center;
    padding: 24px 0 32px;
  }

  .completion-icon {
    font-size: 56px;
    color: var(--el-color-success, #67c23a);
    margin-bottom: 12px;
  }

  .completion-title {
    font-size: 22px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0 0 6px;
  }

  .completion-subtitle {
    font-size: 14px;
    color: var(--app-text-secondary, #909399);
    margin: 0;
  }
}

// 汇总卡片网格
.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.summary-card {
  padding: 14px;
  border: 1px solid var(--app-border, #ebeef5);
  border-radius: 8px;
  background: var(--app-bg-primary, #ffffff);

  &__title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin-bottom: 8px;

    .el-icon {
      color: var(--el-color-primary, #409eff);
    }
  }

  &__content {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    line-height: 1.5;
  }
}

// 搜索演示
.search-demo {
  padding: 16px;
  border: 1px solid var(--app-border, #ebeef5);
  border-radius: 8px;
  background: var(--app-bg-primary, #ffffff);

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin-bottom: 10px;
  }

  &__input {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--el-color-primary, #409eff);
    border-radius: 6px;
    background: var(--app-bg-secondary, #f5f7fa);

    .el-icon {
      color: var(--el-color-primary, #409eff);
    }
  }

  &__text {
    font-size: 13px;
    color: var(--app-text-primary, #303133);
    font-family: 'Segoe UI', monospace;
  }

  &__cursor {
    font-size: 13px;
    color: var(--el-color-primary, #409eff);
    animation: cursor-blink 1s step-end infinite;
  }

  &__results {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
}

@keyframes cursor-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--app-text-regular, #606266);
  background: var(--app-bg-secondary, #f5f7fa);

  .el-icon {
    color: var(--el-color-primary, #409eff);
  }
}

// 搜索结果淡入
.search-results-enter-active {
  transition: all 0.38s ease;
}

.search-results-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

// 暗色主题
html.dark {
  .summary-card,
  .search-demo {
    background: var(--app-bg-secondary, #262727);
  }
}
</style>