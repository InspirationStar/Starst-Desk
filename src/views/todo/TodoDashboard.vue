<!--
  待办&规划仪表盘
  整合今日任务、任务流、项目、专注模式、AI规划、成就的入口页面
-->
<template>
  <div class="todo-dashboard">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-title">待办&规划</h2>
      <p class="page-subtitle">管理任务、项目与专注时间</p>
    </div>

    <!-- 统计面板 -->
    <div class="stats-row" v-loading="loading">
      <el-card class="stat-card" shadow="never" @click="navigateTo('/todo/list')">
        <div class="stat-card__icon stat-card__icon--blue">
          <el-icon><List /></el-icon>
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.totalTodos }}</span>
          <span class="stat-card__label">待办任务</span>
        </div>
      </el-card>
      <el-card class="stat-card" shadow="never" @click="navigateTo('/todo/groups')">
        <div class="stat-card__icon stat-card__icon--green">
          <el-icon><Connection /></el-icon>
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.totalGroups }}</span>
          <span class="stat-card__label">任务流</span>
        </div>
      </el-card>
      <el-card class="stat-card" shadow="never" @click="navigateTo('/todo/projects')">
        <div class="stat-card__icon stat-card__icon--orange">
          <el-icon><Files /></el-icon>
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.totalProjects }}</span>
          <span class="stat-card__label">项目</span>
        </div>
      </el-card>
      <el-card class="stat-card" shadow="never" @click="navigateTo('/todo/achievements')">
        <div class="stat-card__icon stat-card__icon--purple">
          <el-icon><Trophy /></el-icon>
        </div>
        <div class="stat-card__content">
          <span class="stat-card__value">{{ stats.achievementsUnlocked }}/{{ stats.achievementsTotal }}</span>
          <span class="stat-card__label">成就</span>
        </div>
      </el-card>
    </div>

    <!-- 功能卡片网格 -->
    <div class="feature-grid">
      <!-- 今日任务 -->
      <el-card class="feature-card" shadow="never" @click="navigateTo('/todo/list')">
        <div class="feature-card__icon feature-card__icon--blue">
          <el-icon><Clock /></el-icon>
        </div>
        <div class="feature-card__title">今日任务</div>
        <div class="feature-card__desc">查看和管理今日待办，设置截止日期和重复规则</div>
        <el-button type="primary" size="small" class="feature-card__btn">进入</el-button>
      </el-card>

      <!-- 任务流 -->
      <el-card class="feature-card" shadow="never" @click="navigateTo('/todo/groups')">
        <div class="feature-card__icon feature-card__icon--green">
          <el-icon><Connection /></el-icon>
        </div>
        <div class="feature-card__title">任务流</div>
        <div class="feature-card__desc">创建专注步骤流程，一键启动多步骤任务</div>
        <el-button type="primary" size="small" class="feature-card__btn">进入</el-button>
      </el-card>

      <!-- 项目 -->
      <el-card class="feature-card" shadow="never" @click="navigateTo('/todo/projects')">
        <div class="feature-card__icon feature-card__icon--orange">
          <el-icon><Files /></el-icon>
        </div>
        <div class="feature-card__title">项目</div>
        <div class="feature-card__desc">用里程碑推进长期目标，追踪完成进度</div>
        <el-button type="primary" size="small" class="feature-card__btn">进入</el-button>
      </el-card>

      <!-- 专注模式 -->
      <el-card class="feature-card" shadow="never" @click="navigateTo('/todo/focus')">
        <div class="feature-card__icon feature-card__icon--purple">
          <el-icon><Timer /></el-icon>
        </div>
        <div class="feature-card__title">专注模式</div>
        <div class="feature-card__desc">进入专注状态，计时器帮助保持注意力</div>
        <el-button type="primary" size="small" class="feature-card__btn">开始专注</el-button>
      </el-card>

      <!-- AI 规划 -->
      <el-card class="feature-card" shadow="never" @click="navigateTo('/todo/plan')">
        <div class="feature-card__icon feature-card__icon--cyan">
          <el-icon><MagicStick /></el-icon>
        </div>
        <div class="feature-card__title">AI 规划</div>
        <div class="feature-card__desc">用 AI 生成分期计划和任务分解</div>
        <el-button type="primary" size="small" class="feature-card__btn">开始规划</el-button>
      </el-card>

      <!-- 成就 -->
      <el-card class="feature-card" shadow="never" @click="navigateTo('/todo/achievements')">
        <div class="feature-card__icon feature-card__icon--red">
          <el-icon><Trophy /></el-icon>
        </div>
        <div class="feature-card__title">成就</div>
        <div class="feature-card__desc">查看已完成成就和解锁进度</div>
        <el-button type="primary" size="small" class="feature-card__btn">查看</el-button>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  List, Connection, Files, Clock, Timer, MagicStick, Trophy
} from '@element-plus/icons-vue'
import { invoke, todoApi } from '@/utils/ipc-client'

const router = useRouter()

const loading = ref(false)
const stats = ref({
  totalTodos: 0,
  totalGroups: 0,
  totalProjects: 0,
  achievementsUnlocked: 0,
  achievementsTotal: 0
})

function navigateTo (path) {
  router.push(path)
}

async function loadStats () {
  loading.value = true
  try {
    // 待办统计
    const todoResult = await todoApi.list({ page: 1, size: 1 })
    stats.value.totalTodos = todoResult?.total || 0

    // 任务流统计
    const groupResult = await invoke('group:list', { page: 1, size: 1 })
    stats.value.totalGroups = groupResult?.total || 0

    // 项目统计
    const projectResult = await invoke('project:list', { page: 1, size: 1 })
    stats.value.totalProjects = projectResult?.total || 0

    // 成就统计
    const achResult = await invoke('achievement:list')
    stats.value.achievementsUnlocked = achResult?.stats?.unlocked || 0
    stats.value.achievementsTotal = achResult?.stats?.total || 0
  } catch (err) {
    console.error('[TodoDashboard] 加载统计失败:', err)
    ElMessage.error(`加载统计失败：${err?.message || '未知错误'}`)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadStats()
})
</script>

<style scoped lang="scss">
.todo-dashboard {
  padding: 24px;
  max-width: 1200px;
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

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  border-radius: 12px;

  :deep(.el-card__body) {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 20px;
  }

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}

html.dark .stat-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.stat-card__icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 20px;
  flex-shrink: 0;

  &--blue   { background: rgba(64, 158, 255, 0.12); color: #409eff; }
  &--green  { background: rgba(103, 194, 58, 0.12); color: #67c23a; }
  &--orange { background: rgba(230, 162, 60, 0.12); color: #e6a23c; }
  &--purple { background: rgba(112, 84, 184, 0.12); color: #7054b8; }
  &--red    { background: rgba(245, 108, 108, 0.12); color: #f56c6c; }
  &--cyan   { background: rgba(0, 183, 195, 0.12); color: #00b7c3; }
}

.stat-card__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-card__value {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-text-primary);
  line-height: 1.2;
}

.stat-card__label {
  font-size: 13px;
  color: var(--el-text-secondary);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.feature-card {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  border-radius: 12px;

  :deep(.el-card__body) {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 20px;
    min-height: 160px;
  }

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}

html.dark .feature-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.feature-card__icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-size: 24px;
  margin-bottom: 12px;

  &--blue   { background: rgba(64, 158, 255, 0.12); color: #409eff; }
  &--green  { background: rgba(103, 194, 58, 0.12); color: #67c23a; }
  &--orange { background: rgba(230, 162, 60, 0.12); color: #e6a23c; }
  &--purple { background: rgba(112, 84, 184, 0.12); color: #7054b8; }
  &--cyan   { background: rgba(0, 183, 195, 0.12); color: #00b7c3; }
  &--red    { background: rgba(245, 108, 108, 0.12); color: #f56c6c; }
}

.feature-card__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-primary);
  margin-bottom: 6px;
}

.feature-card__desc {
  font-size: 13px;
  color: var(--el-text-secondary);
  line-height: 1.5;
  flex: 1;
  margin-bottom: 12px;
}

.feature-card__btn {
  align-self: flex-start;
}

// 响应式
@media (max-width: 900px) {
  .stats-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .feature-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .stats-row {
    grid-template-columns: 1fr;
  }
  .feature-grid {
    grid-template-columns: 1fr;
  }
}
</style>