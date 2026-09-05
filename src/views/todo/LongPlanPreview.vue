<!--
  长期计划预览页
  功能：
    - 显示当前激活的长期计划（目标、持续时间、路线图、当前周期任务）
    - 周期结束时的复盘按钮
    - 推进周期、放弃计划
  路由：/todo/long-plan
-->
<template>
  <div class="long-plan-preview">
    <!-- 顶部操作栏 -->
    <div class="page-header">
      <div class="page-header__left">
        <el-button text @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
      </div>
      <div class="page-header__right">
        <el-button @click="loadActive">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="loading-block">
      <el-skeleton :rows="6" animated />
    </div>

    <!-- 无激活计划 -->
    <el-empty
      v-else-if="!longPlan"
      description="当前没有激活的长期计划"
    >
      <el-button type="primary" @click="goGenerator">去生成长期计划</el-button>
    </el-empty>

    <!-- 计划详情 -->
    <template v-else>
      <!-- 目标信息卡片 -->
      <el-card class="goal-card" shadow="never">
        <div class="goal-title">
          <el-icon class="goal-icon"><Aim /></el-icon>
          <h2>{{ longPlan.title }}</h2>
        </div>
        <div class="goal-meta">
          <el-tag type="primary" size="small">长期目标</el-tag>
          <span class="goal-text">{{ longPlan.goal }}</span>
        </div>
        <div class="goal-meta">
          <el-tag type="info" size="small">持续时间</el-tag>
          <span>{{ longPlan.duration_text || '未指定' }}</span>
          <span class="cycle-info">
            共 {{ longPlan.total_cycles }} 周期，每周期 {{ longPlan.cycle_length_days }} 天
          </span>
        </div>
        <div v-if="longPlan.summary" class="goal-meta">
          <el-tag type="info" size="small">摘要</el-tag>
          <span>{{ longPlan.summary }}</span>
        </div>
        <div class="goal-meta">
          <el-tag :type="longPlan.pending_review ? 'warning' : 'success'" size="small">
            {{ longPlan.pending_review ? '等待复盘' : '执行中' }}
          </el-tag>
          <span class="cycle-info">
            当前周期：{{ longPlan.current_cycle + 1 }} / {{ longPlan.total_cycles }}
          </span>
          <span class="cycle-info" v-if="longPlan.started_at">
            开始于 {{ formatTime(longPlan.started_at) }}
          </span>
        </div>
      </el-card>

      <!-- 路线图 -->
      <el-card class="roadmap-card" shadow="never">
        <template #header>
          <div class="card-header">
            <el-icon><Guide /></el-icon>
            <span>路线图</span>
          </div>
        </template>
        <el-timeline v-if="roadmap.length > 0">
          <el-timeline-item
            v-for="(item, index) in roadmap"
            :key="index"
            :type="getRoadmapType(index)"
            :timestamp="`阶段 ${index + 1}`"
            placement="top"
          >
            {{ item }}
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无路线图" :image-size="60" />
      </el-card>

      <!-- 当前周期任务 -->
      <el-card class="cycle-card" shadow="never">
        <template #header>
          <div class="card-header">
            <el-icon><Calendar /></el-icon>
            <span>当前周期：{{ currentCycle?.title || `第 ${longPlan.current_cycle + 1} 周期` }}</span>
          </div>
        </template>
        <template v-if="currentCycle">
          <p v-if="currentCycle.goal" class="cycle-goal">
            <el-tag type="primary" size="small">周期目标</el-tag>
            {{ currentCycle.goal }}
          </p>
          <div
            v-for="day in currentCycle.days || []"
            :key="day.day"
            class="day-block"
          >
            <div class="day-header">
              <el-tag type="primary" size="small">第 {{ day.day }} 天</el-tag>
              <span v-if="day.focus" class="day-focus">重点：{{ day.focus }}</span>
            </div>
            <div class="day-tasks">
              <div
                v-for="(task, tIdx) in day.tasks || []"
                :key="tIdx"
                class="day-task"
              >
                <el-icon><Document /></el-icon>
                <span class="task-title">{{ task.title }}</span>
                <span v-if="task.meta" class="task-meta">{{ task.meta }}</span>
              </div>
            </div>
          </div>
          <div v-if="currentCycle.reviewPrompt" class="cycle-review-prompt">
            <el-alert
              type="warning"
              :closable="false"
              show-icon
            >
              <template #title>本周期复盘提示</template>
              {{ currentCycle.reviewPrompt }}
            </el-alert>
          </div>
        </template>
        <el-empty v-else description="当前周期暂无任务数据" :image-size="60" />
      </el-card>

      <!-- 操作按钮区 -->
      <el-card class="actions-card" shadow="never">
        <div class="actions-row">
          <el-button
            v-if="!longPlan.pending_review"
            type="warning"
            @click="startReview"
          >
            <el-icon><EditPen /></el-icon>
            开始复盘
          </el-button>
          <el-button
            v-if="longPlan.pending_review"
            type="primary"
            @click="openReviewDialog"
          >
            <el-icon><ChatDotRound /></el-icon>
            完成复盘并生成下一周期
          </el-button>
          <el-button
            v-if="!longPlan.pending_review && longPlan.current_cycle + 1 < longPlan.total_cycles"
            @click="advanceCycle"
          >
            <el-icon><Right /></el-icon>
            推进到下一周期
          </el-button>
          <el-button type="danger" plain @click="confirmAbandon">
            <el-icon><Close /></el-icon>
            放弃计划
          </el-button>
        </div>
      </el-card>
    </template>

    <!-- 复盘对话框 -->
    <el-dialog
      v-model="reviewDialogVisible"
      title="周期复盘"
      width="600px"
      :close-on-click-modal="false"
    >
      <div class="review-dialog-content">
        <el-alert
          v-if="currentCycle?.reviewPrompt"
          type="info"
          :closable="false"
          show-icon
          class="review-prompt-alert"
        >
          <template #title>复盘问题</template>
          {{ currentCycle.reviewPrompt }}
        </el-alert>
        <p class="review-tip">请根据本周期的执行情况回答以下问题，AI 会据此生成下一周期的任务：</p>
        <el-input
          v-model="reviewAnswer"
          type="textarea"
          :rows="6"
          placeholder="例如：本周期完成了 80% 的任务，对基础概念掌握良好，但在实战练习上还需要加强..."
          maxlength="1000"
          show-word-limit
        />
      </div>
      <template #footer>
        <el-button @click="reviewDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="reviewing" @click="completeReview">完成复盘</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Refresh, Aim, Guide, Calendar, Document,
  EditPen, ChatDotRound, Right, Close
} from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'

const router = useRouter()

const loading = ref(false)
const reviewing = ref(false)
const longPlan = ref(null)
const reviewDialogVisible = ref(false)
const reviewAnswer = ref('')

// 路线图
const roadmap = computed(() => {
  if (!longPlan.value?.roadmap) return []
  return longPlan.value.roadmap
})

// 当前周期
const currentCycle = computed(() => {
  if (!longPlan.value) return null
  const cycles = longPlan.value.cycles || []
  const idx = Number(longPlan.value.current_cycle) || 0
  return cycles[idx] || null
})

/**
 * 加载当前激活的长期计划
 */
async function loadActive () {
  loading.value = true
  try {
    const result = await invoke('ai-plan:get-long-active')
    longPlan.value = result?.longPlan || null
  } catch (err) {
    ElMessage.error(`加载失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

/**
 * 开始复盘（标记 pending_review）
 */
async function startReview () {
  try {
    await invoke('ai-plan:start-review', { id: longPlan.value.id })
    ElMessage.success('已标记为等待复盘')
    await loadActive()
  } catch (err) {
    ElMessage.error(`操作失败：${err.message}`)
  }
}

/**
 * 打开复盘对话框
 */
function openReviewDialog () {
  reviewAnswer.value = ''
  reviewDialogVisible.value = true
}

/**
 * 完成复盘，调用 AI 生成下一周期任务
 */
async function completeReview () {
  if (!reviewAnswer.value.trim()) {
    ElMessage.warning('请输入复盘回答')
    return
  }
  reviewing.value = true
  try {
    const result = await invoke('ai-plan:complete-review', {
      id: longPlan.value.id,
      reviewAnswer: reviewAnswer.value.trim()
    })
    if (result?.longPlan) {
      longPlan.value = result.longPlan
      ElMessage.success('复盘完成，已生成下一周期任务')
      reviewDialogVisible.value = false
    } else {
      ElMessage.error('复盘失败，请重试')
    }
  } catch (err) {
    ElMessage.error(`复盘失败：${err.message}`)
  } finally {
    reviewing.value = false
  }
}

/**
 * 推进到下一周期
 */
async function advanceCycle () {
  try {
    await ElMessageBox.confirm('确定要推进到下一周期吗？', '提示', {
      type: 'warning'
    })
  } catch {
    return
  }
  try {
    const result = await invoke('ai-plan:advance-cycle', { id: longPlan.value.id })
    if (result?.longPlan) {
      longPlan.value = result.longPlan
      ElMessage.success('已推进到下一周期')
    } else {
      ElMessage.error('操作失败')
    }
  } catch (err) {
    ElMessage.error(`操作失败：${err.message}`)
  }
}

/**
 * 确认放弃计划
 */
async function confirmAbandon () {
  try {
    await ElMessageBox.confirm('确定要放弃当前长期计划吗？此操作不可恢复。', '放弃计划', {
      type: 'warning',
      confirmButtonText: '确定放弃',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await invoke('ai-plan:abandon-long', { id: longPlan.value.id })
    ElMessage.success('已放弃长期计划')
    longPlan.value = null
  } catch (err) {
    ElMessage.error(`操作失败：${err.message}`)
  }
}

/**
 * 路线图时间线节点类型
 */
function getRoadmapType (index) {
  if (!longPlan.value) return 'info'
  const current = Number(longPlan.value.current_cycle) || 0
  if (index < current) return 'success'
  if (index === current) return 'primary'
  return 'info'
}

function goBack () {
  router.back()
}

function goGenerator () {
  router.push('/todo/plan')
}

function formatTime (timeStr) {
  if (!timeStr) return ''
  const d = new Date(timeStr)
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

onMounted(() => {
  loadActive()
})
</script>

<style scoped lang="scss">
.long-plan-preview {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.loading-block {
  margin-top: 24px;
}

// 目标卡片
.goal-card {
  margin-bottom: 16px;
}

.goal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--el-text-primary);
  }
}

.goal-icon {
  font-size: 22px;
  color: #409eff;
}

.goal-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--el-text-regular);
}

.goal-text {
  font-weight: 500;
  color: var(--el-text-primary);
}

.cycle-info {
  color: var(--el-text-secondary);
  font-size: 13px;
}

// 卡片通用
.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-primary);
}

.card-header .el-icon {
  color: #409eff;
}

.roadmap-card,
.cycle-card,
.actions-card {
  margin-bottom: 16px;
}

// 周期任务
.cycle-goal {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--el-text-regular);
  margin: 0 0 16px 0;
}

.day-block {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.day-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.day-focus {
  font-size: 13px;
  color: var(--el-text-secondary);
}

.day-tasks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.day-task {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--el-text-regular);
}

.day-task .el-icon {
  color: #67c23a;
  font-size: 14px;
}

.task-title {
  flex-shrink: 0;
}

.task-meta {
  font-size: 12px;
  color: var(--el-text-placeholder);
  margin-left: 4px;
}

.cycle-review-prompt {
  margin-top: 12px;
}

// 操作区
.actions-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

// 复盘对话框
.review-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.review-prompt-alert {
  margin-bottom: 4px;
}

.review-tip {
  font-size: 13px;
  color: var(--el-text-secondary);
  margin: 0;
}

// 暗色模式适配：修复 el-button type="danger" plain 按钮字体颜色
// applyAccentToDom 在暗色下用黑色混合 light-*，导致 hover 字体变暗，需覆盖所有状态
html.dark .long-plan-preview {
  :deep(.el-button--danger.is-plain) {
    color: var(--el-color-danger);

    &:hover,
    &:focus,
    &:active {
      color: var(--el-color-danger);
    }
  }
}
</style>