<!--
  聊天记录搜索栏组件
  功能：
    - 关键词搜索（匹配消息内容）
    - 角色过滤（我/AI/全部）
    - 时间范围过滤
    - 搜索高亮
    - 键盘导航
-->
<template>
  <div v-if="visible" class="ai-chat-search-bar">
    <!-- 搜索输入框 -->
    <div class="search-input-wrapper">
      <el-input
        v-model="keyword"
        placeholder="搜索聊天记录..."
        clearable
        :prefix-icon="Search"
        @input="handleSearch"
        @keydown.down.prevent="navigateResults(1)"
        @keydown.up.prevent="navigateResults(-1)"
        @keydown.enter.prevent="selectCurrentResult"
        @keydown.esc.prevent="handleEscape"
      />
      <el-button type="primary" :icon="Search" @click="handleSearch">搜索</el-button>
      <el-button :icon="Close" circle @click="handleEscape" />
    </div>

    <!-- 过滤条件 -->
    <div class="search-filters">
      <el-radio-group v-model="filters.role" size="small" @change="handleSearch">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="user">我</el-radio-button>
        <el-radio-button value="assistant">AI</el-radio-button>
      </el-radio-group>

      <el-select v-model="filters.dateRange" size="small" style="width: 120px" @change="handleSearch">
        <el-option label="全部时间" value="all" />
        <el-option label="今天" value="today" />
        <el-option label="昨天" value="yesterday" />
        <el-option label="最近7天" value="week" />
      </el-select>
    </div>

    <!-- 搜索结果列表 -->
    <div v-if="isLoading" class="search-loading">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>搜索中...</span>
    </div>

    <div v-else-if="results.length > 0" class="search-results">
      <div class="search-result-count">找到 {{ results.length }} 条结果</div>
      <div
        v-for="(result, index) in results"
        :key="result.id"
        class="search-result-item"
        :class="{ active: currentIndex === index }"
        @click="selectResult(result)"
        @mouseenter="currentIndex = index"
      >
        <div class="result-header">
          <el-tag :type="result.role === 'user' ? 'primary' : 'success'" size="small">
            {{ result.role === 'user' ? '我' : 'AI' }}
          </el-tag>
          <span class="result-time">{{ formatTime(result.created_at) }}</span>
        </div>
        <div class="result-content">
          <span v-html="highlightKeyword(result.content)"></span>
        </div>
      </div>
    </div>

    <div v-else-if="!isLoading && keyword" class="search-empty">
      <el-icon :size="32"><Search /></el-icon>
      <p>未找到匹配的消息</p>
    </div>

    <!-- 清空按钮 -->
    <el-button
      v-if="keyword || filters.role !== 'all' || filters.dateRange !== 'all'"
      link
      size="small"
      @click="clearSearch"
    >
      清空搜索
    </el-button>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Search, Loading, Close } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { chatApi } from '@/utils/ipc-client'

const props = defineProps({
  sessionId: {
    type: String,
    default: ''
  },
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:visible', 'select'])

// 搜索关键词
const keyword = ref('')
// 当前选中结果索引
const currentIndex = ref(0)
// 搜索结果
const results = ref([])
// 加载状态
const isLoading = ref(false)
// 过滤条件
const filters = ref({
  role: 'all',
  dateRange: 'all'
})

// 格式化时间
function formatTime (time) {
  if (!time) return ''
  return dayjs(time).format('MM-DD HH:mm')
}

// 高亮关键词
function highlightKeyword (content) {
  if (!keyword.value || !content) return content
  const escaped = keyword.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, 'gi')
  return content.replace(regex, match => `<mark>${match}</mark>`)
}

// 按日期范围过滤消息
function filterByDateRange (list, range) {
  if (range === 'all') return list
  const now = dayjs()
  let start, end
  if (range === 'today') {
    start = now.startOf('day')
    end = now.endOf('day')
  } else if (range === 'yesterday') {
    start = now.subtract(1, 'day').startOf('day')
    end = now.subtract(1, 'day').endOf('day')
  } else if (range === 'week') {
    start = now.subtract(6, 'day').startOf('day')
    end = now.endOf('day')
  } else {
    return list
  }
  return list.filter(m => {
    if (!m.created_at) return false
    const t = dayjs(m.created_at)
    return t.isAfter(start) && t.isBefore(end)
  })
}

// 执行搜索
async function handleSearch () {
  if (!keyword.value.trim() && filters.value.role === 'all' && filters.value.dateRange === 'all') {
    results.value = []
    return
  }
  if (!props.sessionId) {
    results.value = []
    return
  }

  isLoading.value = true
  currentIndex.value = 0

  try {
    const res = await chatApi.listMessages(props.sessionId)
    let list = (res && res.list) || []

    // 关键词过滤（匹配消息内容）
    const kw = keyword.value.trim().toLowerCase()
    if (kw) {
      list = list.filter(m => m.content && String(m.content).toLowerCase().includes(kw))
    }

    // 角色过滤
    if (filters.value.role !== 'all') {
      list = list.filter(m => m.role === filters.value.role)
    }

    // 日期范围过滤
    list = filterByDateRange(list, filters.value.dateRange)

    results.value = list
  } catch (error) {
    console.error('[AIChatSearchBar] 搜索失败:', error)
    results.value = []
  } finally {
    isLoading.value = false
  }
}

// 导航结果
function navigateResults (direction) {
  if (results.value.length === 0) return
  currentIndex.value = Math.max(0, Math.min(results.value.length - 1, currentIndex.value + direction))
}

// 选择当前结果
function selectCurrentResult () {
  if (results.value.length > 0 && currentIndex.value >= 0) {
    selectResult(results.value[currentIndex.value])
  }
}

// 选择结果
function selectResult (result) {
  emit('select', result)
  emit('update:visible', false)
}

// 清空搜索
function clearSearch () {
  keyword.value = ''
  filters.value = {
    role: 'all',
    dateRange: 'all'
  }
  results.value = []
  currentIndex.value = 0
}

// 处理 ESC 键
function handleEscape () {
  emit('update:visible', false)
}

// 监听 visible 变化，清空状态
watch(() => props.visible, (newVal) => {
  if (!newVal) {
    clearSearch()
  }
})
</script>

<style scoped lang="scss">
.ai-chat-search-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  padding: 12px 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

// 搜索输入框
.search-input-wrapper {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;

  .el-input {
    flex: 1;
  }
}

// 过滤条件
.search-filters {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}

// 搜索加载
.search-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: #909399;
  font-size: 14px;
}

// 搜索结果
.search-results {
  max-height: 300px;
  overflow-y: auto;
}

.search-result-count {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
}

.search-result-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
  margin-bottom: 4px;

  &:hover,
  &.active {
    background: #ecf5ff;
  }

  .result-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;

    .result-time {
      font-size: 12px;
      color: #909399;
    }
  }

  .result-content {
    font-size: 13px;
    color: #303133;
    line-height: 1.5;

    mark {
      background: #fffbe6;
      padding: 1px 2px;
      border-radius: 2px;
    }
  }
}

// 空状态
.search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: #909399;

  p {
    margin: 8px 0 0;
    font-size: 14px;
  }
}

// 暗色模式适配
[data-theme='dark'] {
  .ai-chat-search-bar {
    background: #1d1e1f;
    border-color: #414243;
  }

  .search-loading {
    color: #a3a6ad;
  }

  .search-result-count {
    color: #a3a6ad;
  }

  .search-result-item {
    &:hover,
    &.active {
      background: #2b2d30;
    }

    .result-header {
      .result-time {
        color: #a3a6ad;
      }
    }

    .result-content {
      color: #e5eaf3;

      // 搜索高亮 mark 暗色适配（避免浅色黄色背景刺眼）
      mark {
        background: rgba(230, 162, 60, 0.25);
        color: #ebb563;
      }
    }
  }

  .search-empty {
    color: #a3a6ad;
  }
}
</style>