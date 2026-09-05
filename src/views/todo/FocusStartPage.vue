<!--
  专注模式入口页
  功能：选择单任务/任务流/项目开始专注

-->
<template>
  <div class="focus-start-view">
    <div class="page-header">
      <h2 class="page-title">专注模式</h2>
      <p class="page-subtitle">选择一个未完成任务或流程，开始专注</p>
    </div>

    <!-- 快速开始：单任务 -->
    <el-card class="focus-section" shadow="never">
      <template #header>
        <div class="section-header">
          <el-icon><Clock /></el-icon>
          <span>单任务专注</span>
        </div>
      </template>
      <div class="task-list" v-loading="todoLoading">
        <div
          v-for="todo in activeTodos"
          :key="todo.id"
          class="task-item"
        >
          <span class="task-item__title">{{ todo.title || '无标题' }}</span>
          <span class="task-item__meta">{{ formatDueDate(todo.due_date) }}</span>
          <el-button type="primary" size="small" @click="startFocusTodo(todo)">
            <el-icon><VideoPlay /></el-icon>
            开始
          </el-button>
        </div>
        <el-empty v-if="!todoLoading && activeTodos.length === 0" description="没有未完成的待办" :image-size="80" />
      </div>
    </el-card>

    <!-- 快速开始：任务流 -->
    <el-card class="focus-section" shadow="never">
      <template #header>
        <div class="section-header">
          <el-icon><Connection /></el-icon>
          <span>任务流专注</span>
        </div>
      </template>
      <div class="task-list" v-loading="groupLoading">
        <div
          v-for="group in groups"
          :key="group.id"
          class="task-item"
        >
          <span class="task-item__title">{{ group.name }}</span>
          <span class="task-item__meta">{{ group.steps?.length || 0 }} 个步骤</span>
          <el-button type="primary" size="small" @click="startFocusGroup(group)">
            <el-icon><VideoPlay /></el-icon>
            开始
          </el-button>
        </div>
        <el-empty v-if="!groupLoading && groups.length === 0" description="还没有任务流" :image-size="80" />
      </div>
    </el-card>

    <!-- 快速开始：项目 -->
    <el-card class="focus-section" shadow="never">
      <template #header>
        <div class="section-header">
          <el-icon><Files /></el-icon>
          <span>项目专注</span>
        </div>
      </template>
      <div class="task-list" v-loading="projectLoading">
        <div
          v-for="project in projects"
          :key="project.id"
          class="task-item"
        >
          <span class="task-item__title">{{ project.name }}</span>
          <span class="task-item__meta">{{ Math.round((project.progress || 0) * 100) }}% 完成</span>
          <el-button type="primary" size="small" @click="startFocusProject(project)">
            <el-icon><VideoPlay /></el-icon>
            开始
          </el-button>
        </div>
        <el-empty v-if="!projectLoading && projects.length === 0" description="还没有项目" :image-size="80" />
      </div>
    </el-card>

    <!-- 专注选项 -->
    <el-card class="focus-section" shadow="never">
      <template #header>
        <div class="section-header">
          <el-icon><Setting /></el-icon>
          <span>专注选项</span>
        </div>
      </template>
      <div class="focus-options">
        <el-checkbox v-model="shieldEnabled">
          <el-icon><Lock /></el-icon>
          启用专注护盾
        </el-checkbox>
        <el-button text type="primary" size="small" @click="openGuardSettings">
          配置白名单
        </el-button>
      </div>
      <p class="focus-desc">
        启用护盾后，专注期间切换到非白名单应用将通过灵动岛弹出提醒，引导你回到任务。
      </p>

      <!-- 队列模式 -->
      <div class="focus-queue">
        <el-checkbox v-model="queueEnabled">启用队列模式（连续多个专注会话）</el-checkbox>
        <div v-if="queueEnabled" class="focus-queue__config">
          <div class="focus-queue__item">
            <span class="focus-queue__label">会话数量</span>
            <el-input-number v-model="queueCount" :min="2" :max="10" size="small" />
          </div>
          <div class="focus-queue__item">
            <span class="focus-queue__label">每轮时长（分钟）</span>
            <el-input-number v-model="queueMinutes" :min="5" :max="120" size="small" />
          </div>
          <div class="focus-queue__item">
            <span class="focus-queue__label">休息时长（分钟）</span>
            <el-input-number v-model="breakMinutes" :min="1" :max="30" size="small" />
          </div>
          <p class="focus-queue__hint">
            将连续进行 {{ queueCount }} 个专注会话，每轮 {{ queueMinutes }} 分钟，轮间休息 {{ breakMinutes }} 分钟。
          </p>
        </div>
      </div>
    </el-card>

    <!-- 专注说明 -->
    <el-card class="focus-section" shadow="never">
      <template #header>
        <div class="section-header">
          <el-icon><InfoFilled /></el-icon>
          <span>专注说明</span>
        </div>
      </template>
      <p class="focus-desc">
        专注会话由主进程管理。开始专注后，您可以最小化窗口，专注计时器会在后台运行。
        完成或取消后返回此页面。
      </p>
    </el-card>

    <!-- 护盾白名单配置弹窗 -->
    <el-dialog
      v-model="guardDialogVisible"
      title="专注护盾白名单"
      width="80%"
      top="5vh"
      destroy-on-close
    >
      <FocusGuardSettings v-if="guardDialogVisible" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Clock, Connection, Files, VideoPlay, InfoFilled, Setting, Lock } from '@element-plus/icons-vue'
import { invoke, todoApi, systemApi } from '@/utils/ipc-client'
import FocusGuardSettings from './FocusGuardSettings.vue'

const router = useRouter()

const activeTodos = ref([])
const groups = ref([])
const projects = ref([])
const todoLoading = ref(false)
const groupLoading = ref(false)
const projectLoading = ref(false)

// 专注护盾开关
const shieldEnabled = ref(true)
// 护盾白名单配置弹窗
const guardDialogVisible = ref(false)

// 队列模式
const queueEnabled = ref(false)
const queueCount = ref(3)
const queueMinutes = ref(25)
const breakMinutes = ref(5)

// 护盾开关持久化键名
const SHIELD_SETTING_KEY = 'focusShieldEnabled'

/**
 * 从设置加载护盾开关初始值
 */
async function loadShieldConfig () {
  try {
    const value = await systemApi.getSetting(SHIELD_SETTING_KEY)
    if (value !== null && value !== undefined) {
      shieldEnabled.value = value === true || value === 'true'
    }
  } catch (err) {
    // 设置加载失败时保留默认值，不阻塞页面
    console.error('[FocusStartPage] 加载护盾配置失败:', err)
  }
}

// 监听护盾开关变化并持久化
watch(shieldEnabled, (val) => {
  systemApi.setSetting(SHIELD_SETTING_KEY, val).catch(err => {
    console.error('[FocusStartPage] 保存护盾配置失败:', err)
  })
})

/**
 * 打开护盾白名单配置弹窗
 */
function openGuardSettings () {
  guardDialogVisible.value = true
}

async function loadActiveTodos () {
  todoLoading.value = true
  try {
    const result = await todoApi.list({ filter: { status: 'active' }, page: 1, size: 20 })
    activeTodos.value = result?.list || []
  } catch (err) {
    console.error('[FocusStartPage] 加载待办失败:', err)
    ElMessage.error(`加载待办失败：${err?.message || '未知错误'}`)
  } finally {
    todoLoading.value = false
  }
}

async function loadGroups () {
  groupLoading.value = true
  try {
    const result = await invoke('group:list', { page: 1, size: 20 })
    groups.value = result?.list || []
  } catch (err) {
    console.error('[FocusStartPage] 加载任务流失败:', err)
    ElMessage.error(`加载任务流失败：${err?.message || '未知错误'}`)
  } finally {
    groupLoading.value = false
  }
}

async function loadProjects () {
  projectLoading.value = true
  try {
    const result = await invoke('project:list', { page: 1, size: 20 })
    projects.value = result?.list || []
  } catch (err) {
    console.error('[FocusStartPage] 加载项目失败:', err)
    ElMessage.error(`加载项目失败：${err?.message || '未知错误'}`)
  } finally {
    projectLoading.value = false
  }
}

async function startFocusTodo (todo) {
  try {
    const result = await invoke('focus:create', {
      mode: 'single',
      task_id: todo.id,
      title: todo.title,
      total_seconds: queueEnabled.value ? queueMinutes.value * 60 : 1500,
      options: { shieldEnabled: shieldEnabled.value }
    })
    if (result?.session) {
      router.push({
        path: '/todo/focus/session',
        query: buildSessionQuery(result.session.id)
      })
    }
  } catch (err) {
    ElMessage.error(`开始专注失败：${err.message}`)
  }
}

async function startFocusGroup (group) {
  try {
    const result = await invoke('focus:create', {
      mode: 'group',
      group_id: group.id,
      title: group.name,
      total_seconds: queueEnabled.value ? queueMinutes.value * 60 : calcTotalMinutes(group.steps) * 60,
      options: { shieldEnabled: shieldEnabled.value }
    })
    if (result?.session) {
      router.push({
        path: '/todo/focus/session',
        query: buildSessionQuery(result.session.id)
      })
    }
  } catch (err) {
    ElMessage.error(`开始专注失败：${err.message}`)
  }
}

async function startFocusProject (project) {
  try {
    const result = await invoke('focus:create', {
      mode: 'project',
      project_id: project.id,
      title: project.name,
      total_seconds: queueEnabled.value ? queueMinutes.value * 60 : 1500,
      options: { shieldEnabled: shieldEnabled.value }
    })
    if (result?.session) {
      router.push({
        path: '/todo/focus/session',
        query: buildSessionQuery(result.session.id)
      })
    }
  } catch (err) {
    ElMessage.error(`开始专注失败：${err.message}`)
  }
}

function buildSessionQuery (sessionId) {
  const query = { sessionId, shield: shieldEnabled.value ? '1' : '0' }
  if (queueEnabled.value) {
    query.queue = '1'
    query.qIdx = '1'
    query.qTotal = String(queueCount.value)
    query.qMinutes = String(queueMinutes.value)
    query.bMinutes = String(breakMinutes.value)
  }
  return query
}

function calcTotalMinutes (steps) {
  if (!Array.isArray(steps)) return 25
  return steps.reduce((sum, s) => sum + (Number(s.duration) || 25), 0)
}

function formatDueDate (dueDate) {
  if (!dueDate) return ''
  const d = new Date(dueDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.getTime() === today.getTime()) return '今天'
  if (d.getTime() === tomorrow.getTime()) return '明天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}

onMounted(() => {
  loadShieldConfig()
  loadActiveTodos()
  loadGroups()
  loadProjects()
})
</script>

<style scoped lang="scss">
.focus-start-view {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-primary);
  margin: 0 0 4px 0;
}

.page-subtitle {
  font-size: 14px;
  color: var(--el-text-secondary);
  margin: 0;
}

.focus-section {
  margin-bottom: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-primary);
}

.section-header .el-icon {
  font-size: 18px;
  color: #409eff;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  transition: background 0.15s;

  &:hover {
    background: var(--el-fill-color);
  }
}

.task-item__title {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-item__meta {
  font-size: 12px;
  color: var(--el-text-secondary);
  white-space: nowrap;
}

.focus-desc {
  font-size: 13px;
  color: var(--el-text-secondary);
  line-height: 1.6;
  margin: 0;
}

.focus-options {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;

  .el-checkbox {
    :deep(.el-checkbox__label) {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
  }
}

.focus-queue {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);

  &__config {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__label {
    font-size: 13px;
    color: var(--el-text-secondary);
    white-space: nowrap;
  }

  &__hint {
    width: 100%;
    font-size: 12px;
    color: var(--el-text-secondary);
    margin: 4px 0 0 0;
  }
}
</style>