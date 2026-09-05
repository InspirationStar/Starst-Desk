<!--
  定时任务列表页
  功能：任务列表展示、新建/编辑/删除、启用/禁用切换、查看执行历史
  顶部统计面板：总任务数 / 启用中 / 今日已执行 / 失败数（MetricCard 风格）
  今日任务快捷视图：只显示今天启用的 recurring 任务
  筛选：全部/启用/禁用 + 动作类型筛选
  列表项：优先级标识（高/中/低）、下次执行时间友好显示
  监听 task:executed 事件实时刷新
-->
<template>
  <div class="task-list-page">
    <!-- 统计面板 -->
    <div class="stats-panel">
      <div class="stat-card" :style="{ '--accent': '#4099b2' }">
        <div class="stat-card__icon">
          <el-icon><List /></el-icon>
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.total }}</span>
          <span class="stat-card__label">总任务</span>
        </div>
      </div>
      <div class="stat-card" :style="{ '--accent': '#2eaa76' }">
        <div class="stat-card__icon">
          <el-icon><CircleCheck /></el-icon>
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.enabled }}</span>
          <span class="stat-card__label">启用中</span>
        </div>
      </div>
      <div class="stat-card" :style="{ '--accent': '#7054b8' }">
        <div class="stat-card__icon">
          <el-icon><Timer /></el-icon>
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.todayExecuted }}</span>
          <span class="stat-card__label">今日已执行</span>
        </div>
      </div>
      <div class="stat-card" :style="{ '--accent': '#f56c6c' }">
        <div class="stat-card__icon">
          <el-icon><CircleClose /></el-icon>
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.failed }}</span>
          <span class="stat-card__label">失败数</span>
        </div>
      </div>
    </div>

    <!-- 今日任务快捷视图 -->
    <div v-if="todayTasks.length > 0" class="today-section">
      <div class="today-section__header">
        <el-icon><Calendar /></el-icon>
        <span class="today-section__title">今日任务</span>
        <el-tag size="small" type="info" effect="plain">{{ todayTasks.length }} 个待执行</el-tag>
      </div>
      <div class="today-list">
        <div
          v-for="task in todayTasks"
          :key="task.id"
          class="today-item"
          :class="{ 'is-disabled': !isEnabled(task) }"
        >
          <span
            class="priority-dot"
            :class="`priority-dot--${getTaskPriority(task)}`"
          />
          <span class="today-item__name">{{ task.name }}</span>
          <span class="today-item__time">{{ getFriendlyNextTime(task) }}</span>
          <ActionTypeBadge :action-type="task.action_type" />
          <el-button size="small" text @click="handleViewHistory(task)">
            <el-icon><Clock /></el-icon>
            历史
          </el-button>
        </div>
      </div>
    </div>

    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-button type="primary" @click="handleCreate">
          <el-icon><Plus /></el-icon>
          新建任务
        </el-button>
      </div>
      <div class="toolbar-right">
        <el-select
          v-model="actionFilter"
          placeholder="动作类型"
          clearable
          style="width: 140px; margin-right: 8px;"
          @change="handleActionFilterChange"
        >
          <el-option label="显示消息" value="message" />
          <el-option label="打开应用" value="open_app" />
          <el-option label="执行命令" value="exec_command" />
          <el-option label="打开网址" value="open_url" />
          <el-option label="关机" value="shutdown" />
        </el-select>
        <el-radio-group v-model="filter" @change="handleFilterChange">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="enabled">启用</el-radio-button>
          <el-radio-button value="disabled">禁用</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <!-- 任务列表 -->
    <el-table
      v-loading="taskStore.loading"
      :data="filteredTasks"
      stripe
      style="width: 100%"
      empty-text="暂无定时任务，点击「新建任务」创建"
    >
      <!-- 任务名称 -->
      <el-table-column label="任务名称" prop="name" min-width="150">
        <template #default="{ row }">
          <div class="task-name-wrap">
            <span
              class="priority-dot"
              :class="`priority-dot--${getTaskPriority(row)}`"
            />
            <span class="task-name">{{ row.name }}</span>
          </div>
        </template>
      </el-table-column>

      <!-- 调度类型 -->
      <el-table-column label="调度类型" width="120" align="center">
        <template #default="{ row }">
          <el-tag :type="getScheduleTypeTag(row)" size="small" effect="plain">
            {{ getScheduleTypeLabel(row) }}
          </el-tag>
        </template>
      </el-table-column>

      <!-- 动作类型 -->
      <el-table-column label="动作类型" width="120" align="center">
        <template #default="{ row }">
          <ActionTypeBadge :action-type="row.action_type" />
        </template>
      </el-table-column>

      <!-- 下次执行时间 -->
      <el-table-column label="下次执行" width="180" align="center">
        <template #default="{ row }">
          <span class="next-execute">{{ getFriendlyNextTime(row) }}</span>
        </template>
      </el-table-column>

      <!-- 上次执行时间 -->
      <el-table-column label="上次执行" width="180" align="center">
        <template #default="{ row }">
          <span v-if="row.last_executed_at" class="last-execute">
            {{ formatDateTime(row.last_executed_at) }}
          </span>
          <span v-else class="empty-text">未执行</span>
        </template>
      </el-table-column>

      <!-- 优先级 -->
      <el-table-column label="优先级" width="90" align="center">
        <template #default="{ row }">
          <PriorityTag :priority="getTaskPriority(row)" />
        </template>
      </el-table-column>

      <!-- 启用状态 -->
      <el-table-column label="状态" width="100" align="center" fixed="right">
        <template #default="{ row }">
          <el-switch
            :model-value="isEnabled(row)"
            @change="(val) => handleToggle(row, val)"
          />
        </template>
      </el-table-column>

      <!-- 操作列 -->
      <el-table-column label="操作" width="220" align="center" fixed="right">
        <template #default="{ row }">
          <div class="action-buttons">
            <el-button size="small" text type="primary" @click="handleEdit(row)">
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button size="small" text @click="handleViewHistory(row)">
              <el-icon><Clock /></el-icon>
              历史
            </el-button>
            <el-button size="small" text type="danger" @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
              删除
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="pagination-wrapper">
      <el-pagination
        v-model:current-page="currentPage"
        :page-size="taskStore.pageSize"
        :total="taskStore.total"
        layout="total, prev, pager, next"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 编辑对话框 -->
    <TaskEditDialog
      v-model="editDialogVisible"
      :task="editingTask"
      @saved="handleSaved"
    />

    <!-- 历史对话框 -->
    <TaskHistoryDialog
      v-model="historyDialogVisible"
      :task="historyTask"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, h, defineComponent } from 'vue'
import { ElTag } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Plus, Edit, Delete, Clock, List,
  CircleCheck, Timer, CircleClose, Calendar
} from '@element-plus/icons-vue'
import { useTaskStore } from '@/stores/task-store'
import { on } from '@/utils/ipc-client'
import dayjs from 'dayjs'
import TaskEditDialog from './TaskEditDialog.vue'
import TaskHistoryDialog from './TaskHistoryDialog.vue'

// ============================================================
// 内联子组件：优先级圆点
// ============================================================
const PriorityDot = defineComponent({
  name: 'PriorityDot',
  props: {
    priority: { type: String, default: 'medium' }
  },
  template: `
    <span class="priority-dot" :class="'priority-dot--' + priority"></span>
  `
})

// ============================================================
// 内联子组件：优先级标签
// ============================================================
const PriorityTag = {
  name: 'PriorityTag',
  props: {
    priority: { type: String, default: 'medium' }
  },
  render () {
    return h(ElTag, {
      type: this.priority === 'high' ? 'danger' : this.priority === 'low' ? 'info' : 'warning',
      size: 'small',
      effect: 'plain'
    }, () => this.priority === 'high' ? '高' : this.priority === 'low' ? '低' : '中')
  }
}

// ============================================================
// 内联子组件：动作类型徽标
// ============================================================
const ActionTypeBadge = {
  name: 'ActionTypeBadge',
  props: {
    actionType: { type: String, default: 'message' }
  },
  render () {
    const typeMap = { message: 'info', open_app: 'success', exec_command: 'warning', open_url: 'info', shutdown: 'danger' }
    const labelMap = { message: '显示消息', open_app: '打开应用', exec_command: '执行命令', open_url: '打开网址', shutdown: '关机' }
    return h(ElTag, {
      type: typeMap[this.actionType] || 'info',
      size: 'small',
      effect: 'plain'
    }, () => labelMap[this.actionType] || '显示消息')
  }
}

// ============================================================
// Store
// ============================================================
const taskStore = useTaskStore()

// ============================================================
// 响应式状态
// ============================================================
const filter = ref('all')
const actionFilter = ref('')
const currentPage = ref(1)
const editDialogVisible = ref(false)
const editingTask = ref(null)
const historyDialogVisible = ref(false)
const historyTask = ref(null)

// task:executed 事件取消监听函数
let unsubscribeTaskExecuted = null

// ============================================================
// 统计数据
// ============================================================
const stats = ref({
  total: 0,
  enabled: 0,
  todayExecuted: 0,
  failed: 0
})

// 今日任务列表（启用状态的 recurring 任务）
const todayTasks = computed(() => {
  const list = Array.isArray(taskStore.list) ? taskStore.list : []
  const today = dayjs()
  return list.filter((task) => {
    if (task.task_type !== 'recurring') return false
    if (!isEnabled(task)) return false
    const config = task.schedule_config || {}
    if (config.type === 'daily') return true
    if (config.type === 'weekly') {
      const daysOfWeek = config.days_of_week || []
      return daysOfWeek.includes(today.day())
    }
    if (config.type === 'monthly') {
      const daysOfMonth = config.days_of_month || []
      return daysOfMonth.includes(today.date())
    }
    return false
  })
})

// 经过 actionFilter 和 filter 双重过滤后的列表
const filteredTasks = computed(() => {
  let result = Array.isArray(taskStore.list) ? taskStore.list : []

  // 动作类型筛选（前端过滤）
  if (actionFilter.value) {
    result = result.filter((t) => t.action_type === actionFilter.value)
  }

  // 启用/禁用筛选
  if (filter.value === 'enabled') {
    result = result.filter((t) => isEnabled(t))
  } else if (filter.value === 'disabled') {
    result = result.filter((t) => !isEnabled(t))
  }

  return result
})

// ============================================================
// 生命周期
// ============================================================
onMounted(async () => {
  await taskStore.fetchTasks()
  computeStats()

  // 监听任务执行结果推送，实时刷新列表并更新统计
  unsubscribeTaskExecuted = on('task:executed', (data) => {
    taskStore.fetchTasks().then(() => {
      computeStats()
    })
  })
})

onUnmounted(() => {
  if (unsubscribeTaskExecuted) {
    unsubscribeTaskExecuted()
    unsubscribeTaskExecuted = null
  }
})

// ============================================================
// 统计计算
// ============================================================
function computeStats () {
  const list = Array.isArray(taskStore.list) ? taskStore.list : []
  const today = dayjs().startOf('day').format('YYYY-MM-DD')

  stats.value.total = list.length
  stats.value.enabled = list.filter((t) => isEnabled(t)).length

  // 今日已执行：统计 history 缓存中今日执行成功的次数
  const historyList = Array.isArray(taskStore.history.list) ? taskStore.history.list : []
  stats.value.todayExecuted = historyList.filter((h) => {
    if (!h.executed_at) return false
    return dayjs(h.executed_at).format('YYYY-MM-DD') === today && h.result === 'success'
  }).length

  stats.value.failed = historyList.filter((h) => {
    if (!h.executed_at) return false
    return dayjs(h.executed_at).format('YYYY-MM-DD') === today && h.result === 'failed'
  }).length
}

// ============================================================
// 筛选与分页
// ============================================================
async function handleFilterChange () {
  currentPage.value = 1
  await taskStore.setFilter(filter.value)
  computeStats()
}

async function handleActionFilterChange () {
  // 动作类型筛选是前端过滤，无需请求后端
}

async function handlePageChange (page) {
  currentPage.value = page
  await taskStore.fetchTasks({ page })
  computeStats()
}

// ============================================================
// 新建 / 编辑
// ============================================================
function handleCreate () {
  editingTask.value = null
  editDialogVisible.value = true
}

function handleEdit (task) {
  editingTask.value = { ...task }
  editDialogVisible.value = true
}

function handleSaved () {
  taskStore.fetchTasks().then(computeStats)
}

// ============================================================
// 删除
// ============================================================
async function handleDelete (task) {
  try {
    await ElMessageBox.confirm(
      `确定要删除任务「${task.name}」吗？执行历史将保留。`,
      '删除确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await taskStore.deleteTask(task.id)
    computeStats()
    ElMessage.success('任务已删除')
  } catch (error) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(`删除失败: ${error.message || error}`)
    }
  }
}

// ============================================================
// 启用/禁用切换
// ============================================================
async function handleToggle (task, enabled) {
  try {
    await taskStore.toggleEnabled(task.id, enabled)
    computeStats()
    ElMessage.success(enabled ? '任务已启用' : '任务已禁用')
  } catch (error) {
    ElMessage.error(`操作失败: ${error.message}`)
    // 失败时刷新列表以恢复正确状态
    await taskStore.fetchTasks()
    computeStats()
  }
}

// ============================================================
// 查看历史
// ============================================================
function handleViewHistory (task) {
  historyTask.value = { ...task }
  historyDialogVisible.value = true
}

// ============================================================
// 辅助方法
// ============================================================

/**
 * 判断任务是否启用
 */
function isEnabled (task) {
  return task.is_enabled === 1 || task.is_enabled === true
}

/**
 * 获取任务优先级（从 action_payload.priority 读取）
 */
function getTaskPriority (task) {
  const priority = task?.action_payload?.priority
  if (!priority) return 'medium'
  const p = String(priority).toLowerCase()
  if (p === 'high') return 'high'
  if (p === 'low') return 'low'
  return 'medium'
}

/**
 * 获取调度类型标签
 */
function getScheduleTypeLabel (task) {
  if (task.task_type === 'one_shot') return '一次性'
  const config = task.schedule_config || {}
  if (config.type === 'daily') return '每日'
  if (config.type === 'weekly') return '每周'
  if (config.type === 'monthly') return '每月'
  return '循环'
}

/**
 * 获取调度类型标签颜色
 */
function getScheduleTypeTag (task) {
  if (task.task_type === 'one_shot') return 'warning'
  const config = task.schedule_config || {}
  if (config.type === 'daily') return 'primary'
  if (config.type === 'weekly') return 'success'
  if (config.type === 'monthly') return 'info'
  return ''
}

/**
 * 获取动作类型标签
 */
function getActionTypeLabel (actionType) {
  const labels = {
    message: '显示消息',
    open_app: '打开应用',
    exec_command: '执行命令',
    open_url: '打开网址',
    shutdown: '关机'
  }
  return labels[actionType] || actionType
}

/**
 * 获取下次执行时间（友好格式）
 */
function getFriendlyNextTime (task) {
  if (!isEnabled(task)) return '已禁用'

  const config = task.schedule_config || {}

  if (task.task_type === 'one_shot') {
    if (!config.due_time) return '—'
    const due = dayjs(config.due_time)
    const now = dayjs()
    const diffMin = due.diff(now, 'minute')
    if (diffMin < 0) return '已过期'
    if (diffMin < 60) return `${diffMin} 分钟后`
    if (diffMin < 1440) {
      const hours = due.hour()
      const mins = due.minute()
      return `今天 ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
    }
    const tomorrow = due.isSame(now.add(1, 'day'), 'day')
    if (tomorrow) {
      return `明天 ${String(due.hour()).padStart(2, '0')}:${String(due.minute()).padStart(2, '0')}`
    }
    return due.format('MM-DD HH:mm')
  }

  if (task.task_type === 'recurring') {
    const time = config.time || {}
    const hour = String(time.hour || 0).padStart(2, '0')
    const minute = String(time.minute || 0).padStart(2, '0')
    const timeStr = `${hour}:${minute}`

    if (config.type === 'daily') {
      return `每日 ${timeStr}`
    }
    if (config.type === 'weekly') {
      const days = config.days_of_week || []
      const dayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      const daysStr = days.length > 0
        ? days.sort().map((d) => dayLabels[d]).join('、')
        : '未设置'
      return `${daysStr} ${timeStr}`
    }
    if (config.type === 'monthly') {
      const days = config.days_of_month || []
      const daysStr = days.length > 0
        ? days.sort((a, b) => a - b).map((d) => `${d}日`).join('、')
        : '未设置'
      return `每月 ${daysStr} ${timeStr}`
    }
  }

  return '—'
}

/**
 * 格式化日期时间（兼容原有方法，使用 dayjs）
 */
function formatDateTime (dateTime) {
  if (!dateTime) return '—'
  return dayjs(dateTime).format('YYYY-MM-DD HH:mm')
}
</script>

<style scoped lang="scss">
// ============================================================
// 统计面板（MetricCard 风格）
// ============================================================
.stats-panel {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;

  .stat-card {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 20px;
    background: #fff;
    border-radius: 12px;
    border: 1px solid #e4e7ed;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    transition: box-shadow 0.2s, transform 0.15s;

    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      transform: translateY(-1px);
    }

    &__icon {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      background: var(--accent, #409eff);
      color: #fff;
      font-size: 20px;
      flex-shrink: 0;
    }

    &__content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    &__value {
      font-size: 24px;
      font-weight: 700;
      color: #303133;
      line-height: 1.2;
    }

    &__label {
      font-size: 13px;
      color: #909399;
    }
  }
}

// ============================================================
// 今日任务快捷视图
// ============================================================
.today-section {
  margin-bottom: 20px;
  padding: 16px 20px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e4e7ed;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);

  &__header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;

    .el-icon {
      font-size: 16px;
      color: #409eff;
    }
  }

  &__title {
    font-size: 15px;
    font-weight: 600;
    color: #303133;
  }

  .today-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .today-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 8px;
    background: #f5f7fa;
    transition: background 0.15s;

    &:hover {
      background: #ecf5ff;
    }

    &.is-disabled {
      opacity: 0.5;
    }

    &__name {
      flex: 1;
      font-size: 14px;
      color: #303133;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &__time {
      font-size: 13px;
      color: #409eff;
      white-space: nowrap;
    }
  }
}

// ============================================================
// 工具栏
// ============================================================
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;

  .toolbar-left {
    display: flex;
    gap: 12px;
  }
}

// ============================================================
// 任务名称行
// ============================================================
.task-name-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-name {
  font-weight: 500;
  color: #303133;
}

// ============================================================
// 优先级圆点
// ============================================================
.priority-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &--high {
    background: #f56c6c;
  }

  &--medium {
    background: #e6a23c;
  }

  &--low {
    background: #909399;
  }
}

.next-execute {
  color: #409eff;
  font-size: 13px;
}

.last-execute {
  color: #606266;
  font-size: 13px;
}

.empty-text {
  color: #c0c4cc;
}

// ============================================================
// 分页
// ============================================================
.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

// 操作按钮组
.action-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;

  .el-button + .el-button {
    margin-left: 0;
  }
}
</style>

<!-- 深色模式适配 -->
<style lang="scss">
html.dark {
  .stats-panel {
    .stat-card {
      background: #252627;
      border-color: #414243;
      box-shadow: none;

      &:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      &__value {
        color: #e5eaf3;
      }

      &__label {
        color: #a3a6ad;
      }
    }
  }

  .today-section {
    background: #252627;
    border-color: #414243;
    box-shadow: none;

    &__title {
      color: #e5eaf3;
    }

    &__header .el-icon {
      color: #66b1ff;
    }
  }

  .today-item {
    background: #1d1e1f;

    &:hover {
      background: #2a2b2c;
    }

    &__name {
      color: #e5eaf3;
    }

    &__time {
      color: #66b1ff;
    }
  }

  .task-name {
    color: #e5eaf3;
  }

  .next-execute {
    color: #66b1ff;
  }

  .last-execute {
    color: #a3a6ad;
  }

  .empty-text {
    color: #6a6d75;
  }

  .priority-dot {
    &--high {
      background: #f78989;
    }

    &--medium {
      background: #ebb563;
    }

    &--low {
      background: #6a6d75;
    }
  }
}
</style>
