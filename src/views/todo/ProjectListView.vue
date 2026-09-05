<!--
  项目列表页
  功能：项目列表、新建/编辑/删除、里程碑进度

-->
<template>
  <div class="project-list-view">
    <div class="page-header">
      <h2 class="page-title">项目</h2>
      <p class="page-subtitle">用里程碑推进长期目标，专注时会同步项目进度</p>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索项目..."
        clearable
        :prefix-icon="Search"
        class="toolbar__search"
        @input="handleSearch"
        @clear="loadProjects"
      />
      <el-button type="primary" :icon="Plus" @click="handleCreate">
        新建项目
      </el-button>
    </div>

    <!-- 项目网格 -->
    <div class="project-grid" v-loading="loading">
      <div
        v-for="project in projects"
        :key="project.id"
        class="project-card"
      >
        <div class="project-card__header">
          <el-icon class="project-card__icon"><Files /></el-icon>
          <span class="project-card__name">{{ project.name }}</span>
          <el-button size="small" text @click.stop="handleDelete(project)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
        <div class="project-card__desc">{{ project.description || '暂无描述' }}</div>

        <!-- 进度条 -->
        <el-progress
          :percentage="Math.round((project.progress || 0) * 100)"
          :stroke-width="8"
          :show-text="true"
          class="project-card__progress"
        />
        <div class="project-card__milestones">
          {{ getMilestoneDone(project) }} /
          {{ (project.milestones || []).length }} 个里程碑
        </div>

        <div class="project-card__actions">
          <el-button size="small" @click="handleEdit(project)">编辑</el-button>
          <el-button type="primary" size="small" @click="handleStart(project)">启动准备</el-button>
        </div>
      </div>

      <el-empty v-if="!loading && projects.length === 0" description="还没有项目，点击新建创建" />
    </div>

    <!-- 编辑对话框 -->
    <ProjectEditDialog
      v-model="editDialogVisible"
      :project="editingProject"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Delete, Files } from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'
import ProjectEditDialog from './ProjectEditDialog.vue'

const router = useRouter()
const keyword = ref('')
const loading = ref(false)
const projects = ref([])
const editDialogVisible = ref(false)
const editingProject = ref(null)
let searchTimer = null

async function loadProjects () {
  loading.value = true
  try {
    const result = await invoke('project:list', { keyword: keyword.value, page: 1, size: 100 })
    projects.value = result?.list || []
  } catch (err) {
    ElMessage.error(`加载失败：${err?.message || '未知错误'}`)
  } finally {
    loading.value = false
  }
}

// 计算项目已完成里程碑数量（函数有缓存效果，避免模板内每次渲染重复计算）
function getMilestoneDone (project) {
  const milestones = project?.milestones
  if (!Array.isArray(milestones)) return 0
  return milestones.filter(m => m.done).length
}

function handleSearch () {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadProjects, 300)
}

function handleCreate () {
  editingProject.value = null
  editDialogVisible.value = true
}

function handleEdit (project) {
  editingProject.value = { ...project }
  editDialogVisible.value = true
}

async function handleDelete (project) {
  try {
    await ElMessageBox.confirm(`确定删除项目「${project.name}」吗？`, '删除确认', { type: 'warning' })
    await invoke('project:delete', { id: project.id })
    ElMessage.success('已删除')
    loadProjects()
  } catch (err) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      ElMessage.error(`删除失败：${err?.message || '未知错误'}`)
    }
  }
}

function handleStart (project) {
  router.push({ path: '/todo/focus', query: { project: project.id } })
}

function handleSaved () {
  loadProjects()
}

onMounted(() => {
  loadProjects()
})

// 组件卸载时清理搜索防抖定时器，避免内存泄漏
onUnmounted(() => {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
})
</script>

<style scoped lang="scss">
.project-list-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 20px;
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

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
}

.toolbar__search {
  max-width: 280px;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.project-card {
  padding: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  transition: box-shadow 0.15s, transform 0.15s;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }
}

html.dark .project-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.project-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.project-card__icon {
  font-size: 20px;
  color: #e6a23c;
  flex-shrink: 0;
}

.project-card__name {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card__desc {
  font-size: 13px;
  color: var(--el-text-secondary);
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-card__progress {
  margin-bottom: 4px;
}

.project-card__milestones {
  font-size: 12px;
  color: var(--el-text-placeholder);
  margin-bottom: 12px;
}

.project-card__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>