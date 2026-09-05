<!--
  任务执行历史对话框
  展示指定任务的执行历史列表，按时间倒序排列
  支持分页
-->
<template>
  <el-dialog
    v-model="visible"
    title="执行历史"
    width="700px"
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <!-- 任务名称 -->
    <div v-if="task" class="task-info">
      <el-tag type="info" effect="plain">
        任务：{{ task.name }}
      </el-tag>
    </div>

    <!-- 历史列表 -->
    <el-table
      v-loading="taskStore.history.loading"
      :data="taskStore.history.list"
      stripe
      style="width: 100%"
      empty-text="暂无执行历史"
    >
      <el-table-column label="执行时间" prop="executed_at" width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.executed_at) }}
        </template>
      </el-table-column>

      <el-table-column label="结果" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.result === 'success' ? 'success' : 'danger'" size="small">
            {{ row.result === 'success' ? '成功' : '失败' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="错误信息" prop="error_message" min-width="200">
        <template #default="{ row }">
          <span v-if="row.error_message" class="error-message">{{ row.error_message }}</span>
          <span v-else class="empty-text">—</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        :page-size="taskStore.history.pageSize"
        :total="taskStore.history.total"
        layout="total, prev, pager, next"
        @current-change="handlePageChange"
      />
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useTaskStore } from '@/stores/task-store'

// ============================================================
// 组件属性
// ============================================================
const props = defineProps({
  // 是否显示
  modelValue: {
    type: Boolean,
    default: false
  },
  // 任务对象
  task: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:modelValue'])

// ============================================================
// Store
// ============================================================
const taskStore = useTaskStore()

// ============================================================
// 对话框可见性
// ============================================================
const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 当前页码
const currentPage = ref(1)

// ============================================================
// 监听对话框打开，加载历史
// ============================================================
watch(visible, async (val) => {
  if (val && props.task?.id) {
    currentPage.value = 1
    await loadHistory()
  }
})

/**
 * 加载执行历史
 */
async function loadHistory () {
  if (!props.task?.id) return
  try {
    await taskStore.getExecutionHistory(props.task.id, {
      page: currentPage.value,
      size: taskStore.history.pageSize
    })
  } catch (error) {
    console.error('[TaskHistoryDialog] 加载历史失败:', error.message)
  }
}

/**
 * 分页变化
 */
async function handlePageChange (page) {
  currentPage.value = page
  await loadHistory()
}

/**
 * 格式化日期时间
 */
function formatDateTime (dateTime) {
  if (!dateTime) return '—'
  return dateTime.replace('T', ' ')
}

/**
 * 对话框关闭后重置
 */
function handleClosed () {
  currentPage.value = 1
  taskStore.resetHistory()
}
</script>

<style scoped lang="scss">
.task-info {
  margin-bottom: 16px;
}

.error-message {
  color: #f56c6c;
  font-size: 13px;
  word-break: break-all;
}

.empty-text {
  color: #c0c4cc;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark {
  .error-message {
    color: #f78989;
  }

  .empty-text {
    color: #8d9095;
  }
}
</style>