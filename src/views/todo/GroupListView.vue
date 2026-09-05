<!--
  任务流列表页
  功能：任务流列表、新建/编辑/删除、启动准备

-->
<template>
  <div class="group-list-view">
    <div class="page-header">
      <h2 class="page-title">任务流</h2>
      <p class="page-subtitle">把重复的专注步骤整理成一键启动流程</p>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索任务流..."
        clearable
        :prefix-icon="Search"
        class="toolbar__search"
        @input="handleSearch"
        @clear="loadGroups"
      />
      <el-button type="primary" :icon="Plus" @click="handleCreate">
        新建任务流
      </el-button>
    </div>

    <!-- 任务流网格 -->
    <div class="group-grid" v-loading="loading">
      <div
        v-for="group in groups"
        :key="group.id"
        class="group-card"
      >
        <div class="group-card__header">
          <el-icon class="group-card__icon"><Connection /></el-icon>
          <span class="group-card__name">{{ group.name }}</span>
          <el-button size="small" text @click.stop="handleDelete(group)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
        <div class="group-card__desc">{{ group.description || '暂无描述' }}</div>
        <div class="group-card__meta">
          {{ group.steps?.length || 0 }} 个步骤 ·
          约 {{ calcTotalMinutes(group.steps) }} 分钟
        </div>
        <div class="group-card__actions">
          <el-button size="small" @click="handleEdit(group)">编辑</el-button>
          <el-button type="primary" size="small" @click="handleStart(group)">启动准备</el-button>
        </div>
      </div>

      <el-empty v-if="!loading && groups.length === 0" description="还没有任务流，点击新建创建" />
    </div>

    <!-- 编辑对话框 -->
    <GroupEditDialog
      v-model="editDialogVisible"
      :group="editingGroup"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Delete, Connection } from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'
import GroupEditDialog from './GroupEditDialog.vue'

const router = useRouter()
const keyword = ref('')
const loading = ref(false)
const groups = ref([])
const editDialogVisible = ref(false)
const editingGroup = ref(null)
let searchTimer = null

async function loadGroups () {
  loading.value = true
  try {
    const result = await invoke('group:list', { keyword: keyword.value, page: 1, size: 100 })
    groups.value = result?.list || []
  } catch (err) {
    ElMessage.error(`加载失败：${err?.message || '未知错误'}`)
  } finally {
    loading.value = false
  }
}

function handleSearch () {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadGroups, 300)
}

function handleCreate () {
  editingGroup.value = null
  editDialogVisible.value = true
}

function handleEdit (group) {
  editingGroup.value = { ...group }
  editDialogVisible.value = true
}

async function handleDelete (group) {
  try {
    await ElMessageBox.confirm(`确定删除任务流「${group.name}」吗？`, '删除确认', { type: 'warning' })
    await invoke('group:delete', { id: group.id })
    ElMessage.success('已删除')
    loadGroups()
  } catch (err) {
    if (err !== 'cancel' && err?.message !== 'cancel') {
      ElMessage.error(`删除失败：${err?.message || '未知错误'}`)
    }
  }
}

function handleStart (group) {
  router.push({ path: '/todo/focus', query: { group: group.id } })
}

function handleSaved () {
  loadGroups()
}

function calcTotalMinutes (steps) {
  if (!Array.isArray(steps)) return 0
  return steps.reduce((sum, s) => sum + (Number(s.duration) || 25), 0)
}

onMounted(() => {
  loadGroups()
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
.group-list-view {
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

.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.group-card {
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

html.dark .group-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.group-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.group-card__icon {
  font-size: 20px;
  color: #409eff;
  flex-shrink: 0;
}

.group-card__name {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-card__desc {
  font-size: 13px;
  color: var(--el-text-secondary);
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.group-card__meta {
  font-size: 12px;
  color: var(--el-text-placeholder);
  margin-bottom: 12px;
}

.group-card__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>