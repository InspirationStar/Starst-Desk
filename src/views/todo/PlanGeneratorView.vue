<!--
  AI 规划页
  功能：描述目标、生成短期/长期计划、查看历史、导入计划
  - 短期计划：调用 ai-chat:generate-plan 生成任务/任务流/项目
  - 长期计划：调用 ai-plan:create-long 生成周期性计划、路线图

-->
<template>
  <div class="plan-generator-view">
    <div class="page-header">
      <h2 class="page-title">AI 规划助手</h2>
      <p class="page-subtitle">描述你的目标，AI 会生成任务、任务流和项目结构</p>
    </div>

    <!-- 模式切换 -->
    <div class="mode-switch">
      <el-radio-group v-model="mode" size="default">
        <el-radio-button value="short">短期计划</el-radio-button>
        <el-radio-button value="long">长期计划</el-radio-button>
      </el-radio-group>
      <el-button
        v-if="mode === 'long'"
        type="primary"
        plain
        @click="goLongPlanPreview"
      >
        <el-icon><View /></el-icon>
        查看长期计划
      </el-button>
    </div>

    <!-- 输入区域 -->
    <el-card class="plan-input-card" shadow="never">
      <template #header>
        <div class="card-header">
          <el-icon><MagicStick /></el-icon>
          <span>{{ mode === 'long' ? '描述你的长期目标' : '描述你的目标' }}</span>
        </div>
      </template>
      <el-input
        v-model="prompt"
        type="textarea"
        :rows="4"
        :placeholder="mode === 'long' ? '例如：我想在两个月内从零学完 Python 数据分析，每天投入 1 小时' : '例如：我想在 30 天内完成一个 Python 项目，每天投入 1 小时'"
        maxlength="500"
        show-word-limit
      />
      <el-input
        v-if="mode === 'long'"
        v-model="durationText"
        class="duration-input"
        placeholder="持续时间描述（可选，如：两个月、8 周、60 天）"
        maxlength="50"
      />
      <div class="plan-actions">
        <el-button @click="loadHistory">
          <el-icon><Clock /></el-icon>
          查看历史
        </el-button>
        <div class="plan-actions__right">
          <el-button type="primary" :loading="generating" @click="generatePlan">
            <el-icon><Calendar /></el-icon>
            {{ mode === 'long' ? '生成长期计划' : '生成短期计划' }}
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 短期计划结果 -->
    <el-card v-if="mode === 'short' && currentPlan" class="plan-result-card" shadow="never" v-loading="generating">
      <template #header>
        <div class="card-header">
          <el-icon><Check /></el-icon>
          <span>规划结果</span>
        </div>
      </template>
      <div class="plan-content">
        <pre class="plan-json">{{ formatJson(currentPlan) }}</pre>
      </div>
      <div class="plan-actions">
        <el-button @click="clearPlan">清空</el-button>
        <div class="plan-actions__right">
          <el-button type="primary" :disabled="!currentPlan" @click="applyPlan">
            <el-icon><Upload /></el-icon>
            导入计划
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 长期计划结果 -->
    <el-card v-if="mode === 'long' && longPlanResult" class="plan-result-card" shadow="never" v-loading="generating">
      <template #header>
        <div class="card-header">
          <el-icon><Check /></el-icon>
          <span>长期计划：{{ longPlanResult.plan?.title || '未命名' }}</span>
        </div>
      </template>
      <div class="long-plan-summary">
        <el-tag type="info" size="small">目标</el-tag>
        <span class="long-plan-goal">{{ longPlanResult.plan?.longPlan?.goal || longPlanResult.plan?.title }}</span>
      </div>
      <div v-if="longPlanResult.plan?.longPlan?.durationText" class="long-plan-summary">
        <el-tag type="info" size="small">持续</el-tag>
        <span>{{ longPlanResult.plan.longPlan.durationText }}</span>
        <span class="long-plan-cycle-info">
          （共 {{ longPlanResult.plan.longPlan.totalCycles || 0 }} 周期，每周期 {{ longPlanResult.plan.longPlan.cycleLengthDays || 7 }} 天）
        </span>
      </div>
      <div v-if="longPlanResult.plan?.summary" class="long-plan-summary">
        <el-tag type="info" size="small">摘要</el-tag>
        <span>{{ longPlanResult.plan.summary }}</span>
      </div>

      <!-- 路线图 -->
      <div v-if="roadmap.length > 0" class="long-plan-section">
        <h4 class="section-title">
          <el-icon><Guide /></el-icon>
          路线图
        </h4>
        <el-timeline>
          <el-timeline-item
            v-for="(item, index) in roadmap"
            :key="index"
            :type="index === 0 ? 'primary' : 'info'"
            :timestamp="`阶段 ${index + 1}`"
            placement="top"
          >
            {{ item }}
          </el-timeline-item>
        </el-timeline>
      </div>

      <!-- 第一周期任务 -->
      <div v-if="firstCycle" class="long-plan-section">
        <h4 class="section-title">
          <el-icon><Calendar /></el-icon>
          第一周期：{{ firstCycle.title || '' }}
        </h4>
        <p v-if="firstCycle.goal" class="cycle-goal">周期目标：{{ firstCycle.goal }}</p>
        <div
          v-for="day in firstCycle.days || []"
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
        <div v-if="firstCycle.reviewPrompt" class="cycle-review">
          <el-alert
            type="warning"
            :closable="false"
            show-icon
          >
            <template #title>周期复盘提示</template>
            {{ firstCycle.reviewPrompt }}
          </el-alert>
        </div>
      </div>

      <div class="plan-actions">
        <el-button @click="clearPlan">清空</el-button>
        <div class="plan-actions__right">
          <el-button type="primary" @click="goLongPlanPreview">
            <el-icon><View /></el-icon>
            查看长期计划详情
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 历史记录 -->
    <el-card v-if="history.length > 0" class="plan-history-card" shadow="never">
      <template #header>
        <div class="card-header">
          <el-icon><List /></el-icon>
          <span>最近消息</span>
        </div>
      </template>
      <div class="history-list">
        <div
          v-for="(item, index) in history"
          :key="index"
          class="history-item"
        >
          <div class="history-item__header">
            <div class="history-item__prompt">{{ item.prompt }}</div>
            <el-tag v-if="item.applied" type="success" size="small" effect="plain">已导入</el-tag>
            <el-tag v-else type="info" size="small" effect="plain">未导入</el-tag>
          </div>
          <div class="history-item__time">{{ formatTime(item.created_at) }}</div>
          <div class="history-item__actions">
            <el-button size="small" text @click="viewPlan(item)">查看</el-button>
            <el-button size="small" text type="primary" @click="applyHistoryPlan(item)">导入</el-button>
            <el-button size="small" text type="danger" @click="deleteHistory(item.id)">删除</el-button>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MagicStick, Clock, Document, Calendar, Check, List, Upload, View, Guide } from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'

const router = useRouter()

const mode = ref('short') // short / long
const prompt = ref('')
const durationText = ref('')
const currentPlan = ref(null) // 短期计划结果
const longPlanResult = ref(null) // 长期计划结果
const generating = ref(false)
const history = ref([])

// 模式切换时清空旧结果，避免切回旧模式看到上次结果
watch(mode, () => {
  currentPlan.value = null
  longPlanResult.value = null
})

// 长期计划路线图
const roadmap = computed(() => {
  if (!longPlanResult.value?.plan?.longPlan?.roadmap) return []
  return longPlanResult.value.plan.longPlan.roadmap
})

// 长期计划第一周期
const firstCycle = computed(() => {
  const cycles = longPlanResult.value?.plan?.longPlan?.cycles
  if (!Array.isArray(cycles) || cycles.length === 0) return null
  return cycles[0]
})

async function generatePlan () {
  if (!prompt.value.trim()) {
    ElMessage.warning('请输入目标描述')
    return
  }

  generating.value = true
  try {
    if (mode.value === 'long') {
      // 长期计划：调用 ai-plan:create-long
      const result = await invoke('ai-plan:create-long', {
        goal: prompt.value.trim(),
        durationText: durationText.value.trim() || undefined
      })
      if (result?.plan) {
        longPlanResult.value = result
        currentPlan.value = null
        ElMessage.success('长期计划生成成功')
      } else {
        ElMessage.error('长期计划生成失败，请重试')
      }
    } else {
      // 短期计划：调用 ai-chat:generate-plan
      const result = await invoke('ai-chat:generate-plan', {
        prompt: prompt.value.trim(),
        longTerm: false
      })
      if (result?.plan) {
        currentPlan.value = result.plan
        longPlanResult.value = null
        // 保存历史记录
        await saveHistory(prompt.value.trim(), result.plan)
        ElMessage.success('规划生成成功')
      } else {
        ElMessage.error('规划生成失败，请重试')
      }
    }
  } catch (err) {
    ElMessage.error(`生成失败：${err?.message || '未知错误'}`)
  } finally {
    generating.value = false
  }
}

async function saveHistory (promptText, planJson) {
  try {
    await invoke('ai-plan:create', {
      prompt: promptText,
      planJson: JSON.stringify(planJson)
    })
  } catch (err) {
    console.error('[PlanGeneratorView] 保存历史失败:', err)
  }
}

async function loadHistory () {
  try {
    const result = await invoke('ai-plan:list')
    history.value = result?.list || []
  } catch (err) {
    console.error('[PlanGeneratorView] 加载历史失败:', err)
    ElMessage.error(`加载历史失败：${err?.message || '未知错误'}`)
  }
}

function viewPlan (item) {
  try {
    currentPlan.value = JSON.parse(item.plan_json)
    mode.value = 'short'
    longPlanResult.value = null
  } catch (err) {
    ElMessage.error('解析规划内容失败')
  }
}

async function applyPlan () {
  if (!currentPlan.value) return
  try {
    const result = await invoke('ai-plan:apply', {
      planJson: JSON.stringify(currentPlan.value)
    })
    if (result?.created) {
      ElMessage.success(`导入成功：${result.created.groups} 个任务流，${result.created.projects} 个项目，${result.created.todos} 个任务`)
      currentPlan.value = null
      prompt.value = ''
    }
  } catch (err) {
    ElMessage.error(`导入失败：${err?.message || '未知错误'}`)
  }
}

async function applyHistoryPlan (item) {
  try {
    const result = await invoke('ai-plan:apply', {
      planId: item.id,
      planJson: item.plan_json
    })
    if (result?.created) {
      ElMessage.success(`导入成功：${result.created.groups} 个任务流，${result.created.projects} 个项目，${result.created.todos} 个任务`)
    }
  } catch (err) {
    ElMessage.error(`导入失败：${err?.message || '未知错误'}`)
  }
}

async function deleteHistory (id) {
  try {
    await ElMessageBox.confirm('确定删除这条历史记录？', '提示', { type: 'warning' })
  } catch (err) {
    // 用户取消确认
    if (err === 'cancel' || err?.message === 'cancel') return
    return
  }
  try {
    await invoke('ai-plan:delete', { id })
    history.value = history.value.filter(item => item.id !== id)
    ElMessage.success('已删除')
  } catch (err) {
    ElMessage.error(`删除失败：${err?.message || '未知错误'}`)
  }
}

function clearPlan () {
  currentPlan.value = null
  longPlanResult.value = null
}

function goLongPlanPreview () {
  router.push('/todo/long-plan')
}

function formatJson (obj) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

function formatTime (timeStr) {
  if (!timeStr) return ''
  const d = new Date(timeStr)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  loadHistory()
})
</script>

<style scoped lang="scss">
.plan-generator-view {
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

.mode-switch {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-primary);
}

.card-header .el-icon {
  font-size: 18px;
  color: #409eff;
}

.duration-input {
  margin-top: 12px;
}

.plan-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  gap: 12px;
}

.plan-actions__right {
  display: flex;
  gap: 8px;
}

.plan-content {
  max-height: 400px;
  overflow-y: auto;
}

.plan-json {
  font-size: 13px;
  color: var(--el-text-regular);
  background: var(--el-fill-color-light);
  padding: 16px;
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'Consolas', 'Monaco', monospace;
}

// 长期计划结果样式
.long-plan-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--el-text-regular);
}

.long-plan-goal {
  font-weight: 600;
  color: var(--el-text-primary);
}

.long-plan-cycle-info {
  color: var(--el-text-secondary);
  font-size: 13px;
}

.long-plan-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-primary);
  margin: 0 0 12px 0;
}

.section-title .el-icon {
  color: #409eff;
}

.cycle-goal {
  font-size: 13px;
  color: var(--el-text-secondary);
  margin: 0 0 12px 0;
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

.cycle-review {
  margin-top: 12px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-item {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.history-item__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.history-item__prompt {
  font-size: 14px;
  color: var(--el-text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item__time {
  font-size: 12px;
  color: var(--el-text-placeholder);
  margin-bottom: 8px;
}

.history-item__actions {
  display: flex;
  gap: 8px;
}
</style>
