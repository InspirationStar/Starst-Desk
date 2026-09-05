<!--
  待办列表页
  功能：
  - 搜索、状态筛选
  - 新建待办（支持快速创建）
  - 行内编辑标题（双击标题进入编辑）
  - 截止日期选择（已过期红色、今天橙色）
  - 重复规则设置（无/每天/每周/每月）
  - 颜色标签选择（红/橙/黄/绿/蓝/紫）
  - 批量操作（多选删除）
  - 统计面板（今日待办、本周到期、已完成数）

-->
<template>
  <div class="todo-list-view">
    <!-- 统计面板 -->
    <div class="stats-panel">
      <div class="stats-panel__card" title="今日待办">
        <div class="stats-panel__icon stats-panel__icon--blue">
          <el-icon><Clock /></el-icon>
        </div>
        <div class="stats-panel__text">
          <div class="stats-panel__value">{{ stats.todayPending }}</div>
          <div class="stats-panel__label">今日待办</div>
        </div>
      </div>
      <div class="stats-panel__card" title="本周到期">
        <div class="stats-panel__icon stats-panel__icon--orange">
          <el-icon><Calendar /></el-icon>
        </div>
        <div class="stats-panel__text">
          <div class="stats-panel__value">{{ stats.weekDue }}</div>
          <div class="stats-panel__label">本周到期</div>
        </div>
      </div>
      <div class="stats-panel__card" title="已完成">
        <div class="stats-panel__icon stats-panel__icon--green">
          <el-icon><Select /></el-icon>
        </div>
        <div class="stats-panel__text">
          <div class="stats-panel__value">{{ stats.completed }}</div>
          <div class="stats-panel__label">已完成</div>
        </div>
      </div>
    </div>

    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar__left">
        <!-- 搜索框 -->
        <el-input
          v-model="keyword"
          placeholder="搜索待办标题..."

          :prefix-icon="Search"
          class="toolbar__search"
          @input="handleSearchDebounced"
          @clear="handleSearchClear"
        />

        <!-- 状态筛选 -->
        <el-select
          v-model="statusFilter"
          placeholder="全部状态"
          clearable
          class="toolbar__status"
          @change="handleStatusChange"
        >
          <el-option label="未完成" value="active" />
          <el-option label="已完成" value="completed" />
        </el-select>

        <!-- 批量操作 -->
        <template v-if="selectedIds.length > 0">
          <span class="toolbar__selected-hint">
            已选 {{ selectedIds.length }} 项
          </span>
          <el-button
            type="danger"
            size="small"
            :icon="Delete"
            @click="handleBatchDelete"
          >
            批量删除
          </el-button>
          <el-button size="small" @click="handleBatchClear">清空选择</el-button>
        </template>
      </div>

      <div class="toolbar__right">
        <!-- 新建按钮 -->
        <el-button type="primary" :icon="Plus" @click="handleCreate">
          新建待办
        </el-button>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="todo-content" v-loading="loading">
      <!-- 待办列表 -->
      <div v-if="filteredTodos.length > 0" class="todo-list">
        <div
          v-for="todo in filteredTodos"
          :key="todo.id"
          class="todo-card"
          :class="{
            'is-completed': isCompleted(todo),
            'is-selected': selectedIds.includes(todo.id)
          }"
          :data-color="todo.color"
        >
          <!-- 左侧颜色指示条 -->
          <div class="todo-card__color-bar" v-if="todo.color"></div>

          <!-- 复选框（批量选择 / 完成状态） -->
          <el-checkbox
            :model-value="selectedIds.includes(todo.id)"
            class="todo-card__checkbox"
            @change="(val) => handleToggleSelect(todo, val)"
            @click.stop
          />

          <!-- 主体内容 -->
          <div class="todo-card__body">
            <!-- 行内编辑标题 -->
            <div
              class="todo-card__title-wrapper"
              @dblclick="startEdit(todo)"
            >
              <input
                v-if="editingId === todo.id"
                v-model="editTitle"
                class="todo-card__title-input"
                @blur="finishEdit(todo)"
                @keyup.enter="finishEdit(todo)"
                @keyup.escape="cancelEdit"
                ref="titleInputRef"
              />
              <div
                v-else
                class="todo-card__title"
                :class="{ 'is-completed-title': isCompleted(todo) }"
              >
                {{ todo.title || '无标题' }}
              </div>
            </div>

            <!-- 元信息行：截止日期 + 重复规则 -->
            <div class="todo-card__meta">
              <!-- 截止日期 -->
              <div class="todo-card__due" @click.stop>
                <el-date-picker
                  v-model="todo._tempDueDate"
                  type="date"
                  placeholder="设定期限"
                  size="small"
                  format="YYYY-MM-DD"
                  value-format="YYYY-MM-DD"
                  :class="getDueDateClass(todo)"
                  @change="(val) => handleSetDueDate(todo, val)"
                  @click.stop
                />
              </div>

              <!-- 重复规则 -->
              <el-select
                v-model="todo._tempRecurrence"
                size="small"
                placeholder="重复"
                class="todo-card__recurrence"
                @change="(val) => handleSetRecurrence(todo, val)"
                @click.stop
              >
                <el-option label="无" value="" />
                <el-option label="每天" value="daily" />
                <el-option label="每周" value="weekly" />
                <el-option label="每月" value="monthly" />
              </el-select>
            </div>
          </div>

          <!-- 颜色标签选择器（悬浮显示） -->
          <div class="todo-card__color-picker" @click.stop>
            <el-popover
              placement="top-end"
              :width="160"
              trigger="click"
              @show="$event"
            >
              <template #reference>
                <div class="todo-card__color-btn">
                  <span
                    class="todo-card__color-dot"
                    :style="{ background: colorMap[todo.color || '']?.hex }"
                    v-if="todo.color"
                  ></span>
                  <el-icon v-else><Brush /></el-icon>
                </div>
              </template>
              <div class="color-picker-content">
                <div
                  v-for="c in colorOptions"
                  :key="c.value"
                  class="color-picker-item"
                  :class="{ 'is-active': todo.color === c.value }"
                  @click="handleSetColor(todo, c.value)"
                >
                  <span
                    class="color-picker-item__dot"
                    :style="{ background: c.hex }"
                  ></span>
                  <span class="color-picker-item__label">{{ c.label }}</span>
                </div>
              </div>
            </el-popover>
          </div>

          <!-- 操作按钮 -->
          <div class="todo-card__actions">
            <!-- 完成状态切换 -->
            <el-icon
              class="todo-card__action todo-card__action--check"
              title="切换完成状态"
              @click="handleToggleComplete(todo)"
            >
              <Check v-if="isCompleted(todo)" />
              <Select v-else />
            </el-icon>
            <!-- 删除按钮 -->
            <el-icon
              class="todo-card__action"
              title="删除"
              @click="handleDelete(todo)"
            >
              <Delete />
            </el-icon>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <el-empty
        v-else
        :description="loading ? '' : '暂无待办，点击右上角新建'"
        :image-size="120"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search,
  Plus,
  Delete,
  Check,
  Select,
  Clock,
  Calendar,
  Brush
} from '@element-plus/icons-vue'
import { useTodoStore } from '@/stores/todo-store'

// ============================================================
// 颜色常量配置
// ============================================================
const colorOptions = [
  { value: '',     label: '无',  hex: '#dcdfe6' },
  { value: 'red',    label: '红色', hex: '#f56c6c' },
  { value: 'orange', label: '橙色', hex: '#e6a23c' },
  { value: 'yellow', label: '黄色', hex: '#fadb14' },
  { value: 'green',  label: '绿色', hex: '#67c23a' },
  { value: 'blue',   label: '蓝色', hex: '#409eff' },
  { value: 'purple', label: '紫色', hex: '#7054b8' }
]

const colorMap = {}
colorOptions.forEach(c => { colorMap[c.value] = c })

// ============================================================
// Store & 响应式数据
// ============================================================
const todoStore = useTodoStore()

// 搜索关键词
const keyword = ref('')
// 状态筛选：active=未完成 / completed=已完成
const statusFilter = ref('')
// 选中 ID 集合（批量操作）
const selectedIds = ref([])
// 当前编辑中的标题
const editingId = ref(null)
const editTitle = ref('')
// 输入框引用
const titleInputRef = ref(null)
// 搜索防抖定时器
let searchTimer = null

// 加载状态
const loading = computed(() => todoStore.loading)
// 原始待办列表
const todos = computed(() => todoStore.list)

// ============================================================
// 计算属性
// ============================================================

/**
 * 判断待办是否已完成
 * is_enabled: 1=未完成（激活），0=已完成
 */
function isCompleted (todo) {
  return Number(todo.is_enabled) === 0
}

/**
 * 按关键词过滤的待办列表
 */
const filteredTodos = computed(() => {
  const list = Array.isArray(todos.value) ? todos.value : []
  if (!keyword.value) return list
  const kw = keyword.value.toLowerCase()
  return list.filter(t => {
    const title = (t.title || '').toLowerCase()
    return title.includes(kw)
  })
})

/**
 * 统计面板数据
 */
const stats = computed(() => {
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay() + 1) // 本周一
  startOfWeek.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)
  endOfWeek.setHours(23, 59, 59, 999)

  let todayPending = 0
  let weekDue = 0
  let completed = 0

  const list = Array.isArray(todos.value) ? todos.value : []
  list.forEach(todo => {
    const enabled = Number(todo.is_enabled)
    // 今日待办：未完成且今天到期
    if (enabled === 1 && todo.due_date) {
      const due = new Date(todo.due_date)
      if (isSameDay(due, today)) {
        todayPending++
      }
    }
    // 本周到期：未完成且在本周内到期
    if (enabled === 1 && todo.due_date) {
      const due = new Date(todo.due_date)
      if (due >= startOfWeek && due <= endOfWeek) {
        weekDue++
      }
    }
    // 已完成
    if (enabled === 0) {
      completed++
    }
  })

  return { todayPending, weekDue, completed }
})

// ============================================================
// 日期辅助函数
// ============================================================

/**
 * 判断两个日期是否同一天
 */
function isSameDay (dateA, dateB) {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  )
}

/**
 * 获取截止日期的 CSS 类名（用于过期/今天高亮）
 */
function getDueDateClass (todo) {
  if (!todo.due_date) return ''
  const due = new Date(todo.due_date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (isSameDay(due, today)) return 'is-due-today'
  if (due < today) return 'is-overdue'
  return ''
}

/**
 * 格式化日期显示
 */
function formatDate (dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// ============================================================
// 事件处理函数
// ============================================================

/**
 * 加载待办列表
 */
async function loadTodos () {
  await todoStore.fetchTodos({ status: statusFilter.value })
  // 同步截止日期本地临时变量，避免选择器初始值不匹配
  const list = Array.isArray(todos.value) ? todos.value : []
  list.forEach(todo => {
    todo._tempDueDate = todo.due_date || ''
    todo._tempRecurrence = todo.recurrence || ''
  })
}

/**
 * 新建待办
 */
async function handleCreate () {
  const todo = await todoStore.create({ title: '新待办', is_enabled: 1 })
  if (todo) {
    ElMessage.success('已新建待办')
    // 自动同步本地临时变量
    todo._tempDueDate = ''
    todo._tempRecurrence = ''
  } else {
    ElMessage.error(`新建失败：${todoStore.error || '未知错误'}`)
  }
}

/**
 * 切换待办完成状态
 */
async function handleToggleComplete (todo) {
  const ok = await todoStore.toggleComplete(todo)
  if (!ok) {
    ElMessage.error(`操作失败：${todoStore.error || '未知错误'}`)
  }
}

/**
 * 删除单个待办
 */
async function handleDelete (todo) {
  try {
    await ElMessageBox.confirm(
      `确定删除待办"${todo.title || '无标题'}"吗？`,
      '删除确认',
      { type: 'warning' }
    )
    const ok = await todoStore.delete(todo.id)
    if (ok) {
      ElMessage.success('已删除')
      // 从选中集合中移除
      selectedIds.value = selectedIds.value.filter(id => id !== todo.id)
    } else {
      ElMessage.error(`删除失败：${todoStore.error || '未知错误'}`)
    }
  } catch (err) {
    if (err === 'cancel' || err?.message === 'cancel') return
    console.error('[TodoListView] 删除待办失败:', err.message)
    ElMessage.error(`删除失败：${err.message}`)
  }
}

/**
 * 批量删除选中的待办
 */
async function handleBatchDelete () {
  if (selectedIds.value.length === 0) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selectedIds.value.length} 条待办吗？`,
      '批量删除确认',
      { type: 'warning' }
    )
    let successCount = 0
    for (const id of selectedIds.value) {
      const ok = await todoStore.delete(id)
      if (ok) successCount++
    }
    selectedIds.value = []
    ElMessage.success(`已删除 ${successCount} 条待办`)
  } catch (err) {
    if (err === 'cancel' || err?.message === 'cancel') return
    console.error('[TodoListView] 批量删除失败:', err.message)
    ElMessage.error(`批量删除失败：${err.message}`)
  }
}

/**
 * 清空批量选择
 */
function handleBatchClear () {
  selectedIds.value = []
}

/**
 * 切换选中状态（批量选择）
 */
function handleToggleSelect (todo, checked) {
  if (checked) {
    if (!selectedIds.value.includes(todo.id)) {
      selectedIds.value = [...selectedIds.value, todo.id]
    }
  } else {
    selectedIds.value = selectedIds.value.filter(id => id !== todo.id)
  }
}

/**
 * 设置截止日期
 */
async function handleSetDueDate (todo, dateStr) {
  const ok = await todoStore.setDueDate(todo.id, dateStr || null)
  if (!ok) {
    ElMessage.error(`设置截止日期失败：${todoStore.error || '未知错误'}`)
  }
}

/**
 * 设置重复规则
 */
async function handleSetRecurrence (todo, recurrence) {
  const ok = await todoStore.setRecurrence(todo.id, recurrence || null)
  if (!ok) {
    ElMessage.error(`设置重复规则失败：${todoStore.error || '未知错误'}`)
  }
}

/**
 * 设置颜色标签
 */
async function handleSetColor (todo, color) {
  const ok = await todoStore.setColor(todo.id, color || null)
  if (!ok) {
    ElMessage.error(`设置颜色失败：${todoStore.error || '未知错误'}`)
  }
}

/**
 * 开始编辑标题（双击触发）
 */
function startEdit (todo) {
  editingId.value = todo.id
  editTitle.value = todo.title || ''
  // 下一帧聚焦输入框
  nextTick(() => {
    if (titleInputRef.value) {
      titleInputRef.value.focus()
      titleInputRef.value.select()
    }
  })
}

/**
 * 完成编辑（失焦或回车）
 */
async function finishEdit (todo) {
  const newTitle = editTitle.value.trim()
  editingId.value = null
  if (newTitle && newTitle !== todo.title) {
    const ok = await todoStore.update(todo.id, { title: newTitle })
    if (!ok) {
      ElMessage.error(`保存失败：${todoStore.error || '未知错误'}`)
    }
  }
}

/**
 * 取消编辑（Esc）
 */
function cancelEdit () {
  editingId.value = null
  editTitle.value = ''
}

/**
 * 搜索输入防抖处理
 */
function handleSearchDebounced () {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    // 关键词过滤为前端 computed，无需重新请求
  }, 300)
}

/**
 * 搜索清空时处理
 */
function handleSearchClear () {
  keyword.value = ''
}

/**
 * 状态筛选变化
 */
async function handleStatusChange () {
  selectedIds.value = []
  await loadTodos()
}

// 监听列表变化，同步本地临时变量
watch(
  () => todos.value,
  (newList) => {
    const list = Array.isArray(newList) ? newList : []
    list.forEach(todo => {
      if (todo._tempDueDate === undefined) {
        todo._tempDueDate = todo.due_date || ''
      }
      if (todo._tempRecurrence === undefined) {
        todo._tempRecurrence = todo.recurrence || ''
      }
    })
  },
  { deep: true, immediate: true }
)

onMounted(() => {
  loadTodos()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<style scoped lang="scss">
// ============================================================
// ============================================================
.stats-panel {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;

  &__card {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: var(--el-bg-color, #ffffff);
    border: 1px solid var(--el-border-color-lighter, #ebeef5);
    border-radius: 10px;
    cursor: default;
    transition: background 0.2s ease, border-color 0.2s ease,
                box-shadow 0.2s ease;

    &:hover {
      border-color: var(--el-border-color, #dcdfe6);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }
  }

  &__icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    font-size: 18px;
    flex-shrink: 0;

    &--blue   { background: rgba(64, 158, 255, 0.12);  color: #409eff; }
    &--orange { background: rgba(230, 162, 60, 0.12);  color: #e6a23c; }
    &--green  { background: rgba(103, 194, 58, 0.12); color: #67c23a; }
  }

  &__text {
    flex: 1;
    min-width: 0;
  }

  &__value {
    font-size: 20px;
    font-weight: 600;
    color: var(--el-text-primary, #303133);
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }

  &__label {
    font-size: 12px;
    color: var(--el-text-secondary, #909399);
    margin-top: 2px;
  }
}

// ============================================================
// 顶部工具栏
// ============================================================
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  gap: 12px;

  &__left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  &__right {
    flex-shrink: 0;
  }

  &__search {
    max-width: 280px;
    flex-shrink: 0;
  }

  &__status {
    width: 120px;
    flex-shrink: 0;
  }

  &__selected-hint {
    font-size: 13px;
    color: var(--el-text-secondary, #909399);
    white-space: nowrap;
    flex-shrink: 0;
  }
}

// ============================================================
// 内容区
// ============================================================
.todo-content {
  flex: 1;
  overflow-y: auto;
}

// ============================================================
// 待办列表
// ============================================================
.todo-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

// ============================================================
// 待办卡片
// ============================================================
.todo-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--el-bg-color, #ffffff);
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
  transition: background 0.18s ease, border-color 0.18s ease,
              box-shadow 0.18s ease;
  position: relative;
  overflow: hidden;

  // 左侧颜色指示条
  &__color-bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 8px 0 0 8px;
    pointer-events: none;
  }

  &:hover {
    background: var(--el-fill-color-light, #f5f7fa);
    border-color: var(--el-border-color, #dcdfe6);
  }

  &.is-selected {
    background: rgba(64, 158, 255, 0.08);
    border-color: rgba(64, 158, 255, 0.35);
  }

  // 根据 data-color 设置左侧色条颜色
  &[data-color="red"]    .todo-card__color-bar    { background: #f56c6c; }
  &[data-color="orange"] .todo-card__color-bar    { background: #e6a23c; }
  &[data-color="yellow"] .todo-card__color-bar    { background: #fadb14; }
  &[data-color="green"]  .todo-card__color-bar    { background: #67c23a; }
  &[data-color="blue"]   .todo-card__color-bar    { background: #409eff; }
  &[data-color="purple"] .todo-card__color-bar    { background: #7054b8; }

  &__checkbox {
    flex-shrink: 0;
    margin-left: 4px;
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__title-wrapper {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: text;
  }

  &__title {
    font-size: 14px;
    font-weight: 500;
    color: var(--el-text-primary, #303133);
    line-height: 1.5;
    word-break: break-word;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s ease;

    &.is-completed-title {
      color: var(--el-text-secondary, #909399);
      text-decoration: line-through;
    }
  }

  // 行内编辑输入框
  &__title-input {
    flex: 1;
    font-size: 14px;
    font-weight: 500;
    color: var(--el-text-primary, #303133);
    line-height: 1.5;
    padding: 2px 6px;
    border: 1px solid var(--el-color-primary, #409eff);
    border-radius: 4px;
    outline: none;
    background: var(--el-bg-color, #ffffff);
    transition: border-color 0.15s ease;

    &:focus {
      border-color: var(--el-color-primary-light-3, #79bbff);
      box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.15);
    }
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }

  &__due {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: var(--el-text-secondary, #909399);

    // 已过期样式
    &.is-overdue :deep(.el-input__wrapper),
    &.is-overdue :deep(.el-input__inner) {
      color: #f56c6c !important;
      font-weight: 600;
    }

    // 今天到期样式
    &.is-due-today :deep(.el-input__wrapper),
    &.is-due-today :deep(.el-input__inner) {
      color: #e6a23c !important;
      font-weight: 600;
    }
  }

  &__recurrence {
    flex-shrink: 0;
    width: 76px;

    :deep(.el-input__wrapper) {
      font-size: 12px;
      padding: 0 6px;
    }
  }

  &__color-picker {
    flex-shrink: 0;
  }

  &__color-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease;
    font-size: 14px;
    color: var(--el-text-secondary, #909399);

    &:hover {
      background: var(--el-fill-color, #f0f2f5);
      color: var(--el-text-primary, #303133);
    }
  }

  &__color-dot {
    display: block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid rgba(0, 0, 0, 0.1);
  }

  &__actions {
    flex-shrink: 0;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  &__action {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    font-size: 14px;
    color: var(--el-text-secondary, #909399);
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease;

    &:hover {
      background: var(--el-fill-color, #f0f2f5);
    }

    &--check:hover {
      color: var(--el-color-success, #67c23a);
    }
  }

  // 悬停时显示操作按钮
  &:hover {
    .todo-card__actions {
      opacity: 1;
    }
  }

  // 已完成状态
  &.is-completed {
    .todo-card__title {
      color: var(--el-text-secondary, #909399);
      text-decoration: line-through;
    }
  }
}

// ============================================================
// 颜色选择器弹窗内容
// ============================================================
.color-picker-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.color-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s ease;

  &:hover {
    background: var(--el-fill-color, #f0f2f5);
  }

  &.is-active {
    background: var(--el-color-primary-light-9, #ecf5ff);
  }

  &__dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1px solid rgba(0, 0, 0, 0.08);
  }

  &__label {
    font-size: 13px;
    color: var(--el-text-regular, #606266);
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark {
  .stats-panel__card {
    background: var(--el-bg-color, #1d1e1f);
    border-color: var(--el-border-color, #414243);

    &:hover {
      border-color: var(--el-border-color-dark, #5c5d5e);
    }
  }

  .stats-panel__value {
    color: var(--el-text-primary, #f0f0f0);
  }

  .todo-card {
    background: var(--el-bg-color, #1d1e1f);
    border-color: var(--el-border-color, #414243);

    &:hover {
      background: var(--el-fill-color-light, #262728);
      border-color: var(--el-border-color-dark, #5c5d5e);
    }

    &.is-selected {
      background: rgba(64, 158, 255, 0.12);
      border-color: rgba(64, 158, 255, 0.3);
    }
  }

  .todo-card__title,
  .todo-card__title-input {
    color: var(--el-text-primary, #f0f0f0);
  }

  .todo-card__title-input {
    background: var(--el-bg-color, #1d1e1f);
  }

  .todo-card__color-btn {
    &:hover {
      background: var(--el-fill-color, #2e2e30);
    }
  }

  .color-picker-item:hover {
    background: var(--el-fill-color, #2e2e30);
  }

  .color-picker-item__label {
    color: var(--el-text-regular, #c0c4cc);
  }
}
</style>
