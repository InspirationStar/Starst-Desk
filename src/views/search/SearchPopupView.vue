<!--
  全局搜索弹窗视图
  职责：聚合搜索便签/待办/任务/会话/设置/桌面文件
  简化实现：el-dialog 全屏遮罩 + 搜索输入 + 结果列表
  通过路由 /search 访问，或全局快捷键唤起（需 leader 注册热键）
-->
<template>
  <div class="search-popup-view">
    <!-- 搜索输入区 -->
    <div class="search-header">
      <el-input
        ref="inputRef"
        v-model="query"
        placeholder="搜索便签、待办、任务、会话、设置、文件..."
        size="large"
        :prefix-icon="Search"
        clearable
        @input="handleInput"
        @keydown="handleKeydown"
      />
      <el-select
        v-model="filterType"
        size="default"
        class="search-filter"
        @change="handleFilterChange"
      >
        <el-option label="全部" value="all" />
        <el-option label="便签" value="note" />
        <el-option label="待办" value="todo" />
        <el-option label="任务" value="task" />
        <el-option label="会话" value="chat" />
        <el-option label="设置" value="settings" />
        <el-option label="文件" value="file" />
      </el-select>
    </div>

    <!-- 搜索历史区（无搜索词时显示） -->
    <div v-if="!query && history.length > 0" class="search-history">
      <div class="section-header">
        <span class="section-title">最近搜索</span>
        <el-button text size="small" @click="handleClearHistory">清空</el-button>
      </div>
      <div class="history-list">
        <div
          v-for="item in history.slice(0, 10)"
          :key="item.query"
          class="history-item"
          @click="handleHistoryClick(item.query)"
        >
          <el-icon><Clock /></el-icon>
          <span class="history-text">{{ item.query }}</span>
          <span class="history-count">{{ item.count }} 次</span>
        </div>
      </div>
    </div>

    <!-- 搜索结果区 -->
    <div v-if="query" class="search-results">
      <div v-if="isLoading" class="search-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>搜索中...</span>
      </div>

      <div v-else-if="results.length === 0" class="search-empty">
        <el-icon><Search /></el-icon>
        <p>未找到匹配结果</p>
      </div>

      <div v-else class="result-list">
        <div
          v-for="(item, index) in results"
          :key="item.id || item.path"
          class="result-item"
          :class="{ 'is-active': index === activeIndex }"
          @click="handleResultClick(item)"
          @mouseenter="activeIndex = index"
        >
          <el-icon class="result-icon">
            <component :is="iconMap[item.icon] || Document" />
          </el-icon>
          <div class="result-info">
            <div class="result-title">{{ item.title }}</div>
            <div class="result-subtitle">{{ item.subtitle }}</div>
          </div>
          <el-tag size="small" class="result-type">{{ typeLabel[item.type] || item.type }}</el-tag>
        </div>
      </div>
    </div>

    <!-- 底部快捷键提示 -->
    <div class="search-footer">
      <span class="footer-hint">
        <kbd>↑</kbd><kbd>↓</kbd> 选择
        <kbd>Enter</kbd> 打开
        <kbd>Esc</kbd> 关闭
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onActivated, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Search, Clock, Loading, Document, EditPen, List, AlarmClock,
  ChatDotRound, Setting, Folder, Grid, Pointer, DataAnalysis,
  Picture, FirstAidKit
} from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'

const router = useRouter()

// 图标映射
const iconMap = {
  EditPen, List, AlarmClock, ChatDotRound, Setting, Folder,
  Grid, Pointer, DataAnalysis, Picture, FirstAidKit, Document
}

// 类型标签映射
const typeLabel = {
  note: '便签',
  todo: '待办',
  task: '任务',
  chat: '会话',
  settings: '设置',
  file: '文件',
  folder: '文件夹'
}

// 状态
const query = ref('')
const filterType = ref('all')
const results = ref([])
const history = ref([])
const isLoading = ref(false)
const activeIndex = ref(0)
const inputRef = ref(null)

// 防抖定时器
let debounceTimer = null

/**
 * 加载搜索历史
 */
async function loadHistory () {
  try {
    const res = await invoke('search:history')
    history.value = res?.history || []
  } catch (err) {
    console.error('[SearchPopup] 加载历史失败:', err)
  }
}

/**
 * 输入处理（防抖 200ms）
 */
function handleInput () {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => doSearch(), 200)
}

/**
 * 执行搜索
 */
async function doSearch () {
  const q = query.value.trim()
  if (!q) {
    results.value = []
    return
  }
  isLoading.value = true
  activeIndex.value = 0
  try {
    const res = await invoke('search:query', {
      query: q,
      type: filterType.value,
      limit: 30
    })
    results.value = res?.results || []
    history.value = res?.history || history.value
  } catch (err) {
    console.error('[SearchPopup] 搜索失败:', err)
    results.value = []
  } finally {
    isLoading.value = false
  }
}

/**
 * 筛选类型变化
 */
function handleFilterChange () {
  if (query.value) doSearch()
}

/**
 * 键盘导航
 */
function handleKeydown (e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (results.value[activeIndex.value]) {
      handleResultClick(results.value[activeIndex.value])
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    router.back()
  }
}

/**
 * 点击结果项
 */
function handleResultClick (item) {
  if (item.type === 'file' || item.type === 'folder') {
    // 文件/文件夹：调用主进程打开
    invoke('file:open-file', { path: item.payload.fullPath }).catch(err => {
      ElMessage.error(`打开失败：${err.message}`)
    })
  } else if (item.type === 'settings') {
    // 设置项：路由跳转
    router.push(item.path)
  } else {
    // 其他类型：路由跳转到对应页面
    router.push(item.path)
  }
  ElMessage.success(`已打开：${item.title}`)
}

/**
 * 点击历史项
 */
function handleHistoryClick (q) {
  query.value = q
  doSearch()
}

/**
 * 清空历史
 */
async function handleClearHistory () {
  try {
    await invoke('search:clear-history')
    history.value = []
    ElMessage.success('历史已清空')
  } catch (err) {
    ElMessage.error(`清空失败：${err.message}`)
  }
}

onMounted(() => {
  loadHistory()
  nextTick(() => {
    inputRef.value?.focus()
  })
})

onActivated(() => {
  loadHistory()
  nextTick(() => {
    inputRef.value?.focus()
  })
})
</script>

<style scoped lang="scss">
.search-popup-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.search-header {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;

  .search-filter {
    width: 120px;
    flex-shrink: 0;
  }
}

.search-history {
  margin-bottom: 16px;

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;

    .section-title {
      font-size: 13px;
      color: var(--app-text-secondary, #909399);
      font-weight: 500;
    }
  }

  .history-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .history-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 16px;
    background: var(--app-bg-secondary, #f5f7fa);
    color: var(--app-text-primary, #303133);
    font-size: 13px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background: var(--el-color-primary-light-9, #ecf5ff);
      color: var(--el-color-primary, #409eff);
    }

    .history-count {
      font-size: 11px;
      color: var(--app-text-secondary, #909399);
    }
  }
}

.search-results {
  flex: 1;
  overflow-y: auto;
}

.search-loading,
.search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  color: var(--app-text-secondary, #909399);

  .el-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }

  p {
    margin: 0;
    font-size: 14px;
  }
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover,
  &.is-active {
    background: var(--el-color-primary-light-9, #ecf5ff);
  }

  .result-icon {
    font-size: 20px;
    color: var(--el-color-primary, #409eff);
    flex-shrink: 0;
  }

  .result-info {
    flex: 1;
    min-width: 0;
  }

  .result-title {
    font-size: 14px;
    color: var(--app-text-primary, #303133);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-subtitle {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 2px;
  }

  .result-type {
    flex-shrink: 0;
  }
}

.search-footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--app-border, #ebeef5);
  text-align: center;

  .footer-hint {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);

    kbd {
      display: inline-block;
      padding: 2px 6px;
      margin: 0 2px;
      border: 1px solid var(--app-border, #dcdfe6);
      border-radius: 4px;
      background: var(--app-bg-secondary, #f5f7fa);
      font-family: monospace;
      font-size: 11px;
    }
  }
}

// 暗色主题
html.dark {
  .search-popup-view {
    --app-bg-secondary: #262727;
    --app-border: #414243;
  }
}
</style>