<!--
  活动统计页
  职责：展示用户今日活动概览、当前状态、最近 7 天活跃时间柱状图、活跃应用 Top 5
  数据来源：activity:* IPC 通道（已解密）
  风格参考：SettingsView.vue，使用 el-card / el-descriptions，CSS 变量适配暗色模式
-->
<template>
  <div class="activity-stats-view">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-title">活动统计</h2>
      <p class="page-subtitle">记录键鼠活动、空闲状态与电脑使用时间</p>
    </div>

    <!-- 数据管理工具栏 -->
    <div class="data-toolbar">
      <span class="data-toolbar__label">数据管理</span>
      <el-date-picker
        v-model="clearDateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        size="default"
        style="width: 280px"
      />
      <el-button type="danger" plain @click="handleClearData" :loading="clearing">清空所选范围数据</el-button>
    </div>

    <!-- 今日概览卡片 -->
    <el-card class="overview-card" shadow="never" v-loading="loading">
      <template #header>
        <span>今日概览</span>
      </template>

      <!-- 时间维度 -->
      <div class="overview-dimension">
        <div class="overview-dimension-title">时间维度</div>
        <el-row :gutter="16">
          <el-col :span="8">
            <div class="overview-item">
              <div class="overview-icon overview-icon--active">
                <el-icon><Timer /></el-icon>
              </div>
              <div class="overview-info">
                <div class="overview-value">{{ formatDuration(todayStats.totalActiveSeconds) }}</div>
                <div class="overview-label">活跃时间</div>
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="overview-item">
              <div class="overview-icon overview-icon--break">
                <el-icon><Coffee /></el-icon>
              </div>
              <div class="overview-info">
                <div class="overview-value">{{ todayStats.breakCount }}</div>
                <div class="overview-label">离开时长（分钟）</div>
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="overview-item">
              <div class="overview-icon overview-icon--longest">
                <el-icon><Stopwatch /></el-icon>
              </div>
              <div class="overview-info">
                <div class="overview-value">{{ formatDuration(todayStats.longestContinuousActive) }}</div>
                <div class="overview-label">最长连续活跃</div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>

      <!-- 操作维度 -->
      <div class="overview-dimension">
        <div class="overview-dimension-title">操作维度</div>
        <el-row :gutter="16">
          <el-col :span="8">
            <div class="overview-item">
              <div class="overview-icon overview-icon--click">
                <el-icon><Aim /></el-icon>
              </div>
              <div class="overview-info">
                <div class="overview-value">{{ formatKeystrokes(todayStats.totalClicks) }}</div>
                <div class="overview-label">鼠标点击</div>
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="overview-item">
              <div class="overview-icon overview-icon--keyboard">
                <el-icon><Monitor /></el-icon>
              </div>
              <div class="overview-info">
                <div class="overview-value">{{ formatKeystrokes(todayStats.totalKeystrokes) }}</div>
                <div class="overview-label">键盘输入</div>
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="overview-item">
              <div class="overview-icon overview-icon--segments">
                <el-icon><Operation /></el-icon>
              </div>
              <div class="overview-info">
                <div class="overview-value">{{ activeSegments }}</div>
                <div class="overview-label">连续活跃段数</div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>

      <!-- 时间段分布 -->
      <div class="overview-dimension">
        <div class="overview-dimension-title">时间段分布</div>
        <div class="time-distribution">
          <div
            v-for="item in timeDistributionList"
            :key="item.key"
            class="time-distribution-item"
          >
            <div class="time-distribution-label">{{ item.label }}</div>
            <div class="time-distribution-bar">
              <div
                class="time-distribution-bar-fill"
                :style="{ width: item.percent + '%' }"
              ></div>
            </div>
            <div class="time-distribution-value">{{ formatDuration(item.seconds, true) || '0' }}</div>
          </div>
        </div>
      </div>

      <!-- 活跃应用类别 -->
      <div class="overview-dimension">
        <div class="overview-dimension-title app-category-title">
          <span>活跃应用类别</span>
          <div class="app-category-actions">
            <el-button
              size="small"
              text
              :loading="aiCategorizing"
              :disabled="resettingCategories"
              @click="handleAiCategorize"
            >
              <el-icon v-if="!aiCategorizing"><MagicStick /></el-icon>
              LLM分类
            </el-button>
            <el-button
              size="small"
              text
              :disabled="aiCategorizing"
              :loading="resettingCategories"
              @click="handleResetCategories"
            >
              <el-icon v-if="!resettingCategories"><RefreshLeft /></el-icon>
              恢复默认
            </el-button>
            <el-button
              size="small"
              text
              :disabled="aiCategorizing || resettingCategories"
              @click="handleCategoryManage"
            >
              <el-icon><Setting /></el-icon>
              分类管理
            </el-button>
          </div>
        </div>
        <div class="app-categories" v-if="appCategories.length > 0">
          <div
            v-for="item in appCategories"
            :key="item.category"
            class="app-category-item"
          >
            <span class="app-category-tag">{{ item.category }}</span>
            <div class="app-category-bar">
              <div
                class="app-category-bar-fill"
                :style="{ width: item.percent + '%' }"
              ></div>
            </div>
            <span class="app-category-percent">{{ item.percent }}%</span>
          </div>
        </div>
        <el-empty v-else description="暂无应用使用记录" :image-size="60" />
      </div>
    </el-card>

    <!-- 当前状态 -->
    <el-card class="status-card" shadow="never" v-loading="loading">
      <template #header>
        <span>当前状态</span>
      </template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="活动状态">
          <el-tag :type="statusTagType" size="small">{{ statusTagText }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="当前应用">{{ currentStatus.activeApp || '—' }}</el-descriptions-item>
        <el-descriptions-item label="连续活跃">{{ formatDuration(currentStatus.continuousActiveSeconds) }}</el-descriptions-item>
        <el-descriptions-item label="窗口标题" :span="3">
          {{ currentStatus.activeWindow || '—' }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 专注统计卡片 -->
    <el-card class="focus-stats-card" shadow="never" v-loading="focusLoading">
      <template #header>
        <span>专注统计</span>
      </template>

      <!-- 概览数据 -->
      <div class="focus-overview">
        <div class="focus-overview-item">
          <div class="focus-overview-value">{{ formatDuration(focusStats.totalSeconds) }}</div>
          <div class="focus-overview-label">总专注时长</div>
        </div>
        <div class="focus-overview-item">
          <div class="focus-overview-value">{{ focusStats.totalSessions }}</div>
          <div class="focus-overview-label">总会话数</div>
        </div>
        <div class="focus-overview-item">
          <div class="focus-overview-value">{{ formatDuration(focusStats.todaySeconds) }}</div>
          <div class="focus-overview-label">今日专注</div>
        </div>
        <div class="focus-overview-item">
          <div class="focus-overview-value">{{ focusStats.todaySessions }}</div>
          <div class="focus-overview-label">今日会话</div>
        </div>
      </div>

      <!-- 按模式分类 -->
      <div class="focus-modes" v-if="focusStats.modeStats && focusStats.modeStats.length > 0">
        <div class="focus-modes-title">模式分类</div>
        <div class="focus-modes-list">
          <div v-for="item in focusStats.modeStats" :key="item.mode" class="focus-mode-item">
            <span class="focus-mode-label">{{ modeLabel(item.mode) }}</span>
            <span class="focus-mode-count">{{ item.count }} 次 / {{ formatDuration(item.seconds) }}</span>
          </div>
        </div>
      </div>

      <!-- 最近 7 天专注趋势 -->
      <div class="focus-trend">
        <div class="focus-trend-title">最近 7 天专注趋势</div>
        <div class="focus-trend-bars" v-if="focusStats.dailyStats && focusStats.dailyStats.length > 0">
          <div v-for="item in focusStats.dailyStats" :key="item.date" class="focus-trend-bar-item">
            <div class="focus-trend-bar-wrapper">
              <div class="focus-trend-bar" :style="{ height: getFocusBarHeight(item.seconds) + '%' }">
                <span class="focus-trend-bar-value" v-if="item.seconds > 0">
                  {{ formatDuration(item.seconds, true) }}
                </span>
              </div>
            </div>
            <div class="focus-trend-bar-label">{{ formatDateShort(item.date) }}</div>
          </div>
        </div>
        <el-empty v-else description="暂无专注数据" :image-size="60" />
      </div>
    </el-card>

    <!-- 最近 7 天活跃时间柱状图 -->
    <el-card class="chart-card" shadow="never">
      <template #header>
        <div class="card-header-row">
          <span>{{ chartExpanded ? '全部活跃时间' : '最近 7 天活跃时间' }}</span>
          <el-button
            v-if="recentSummary.length >= 7"
            link
            size="small"
            @click="toggleChartExpanded"
          >
            {{ chartExpanded ? '收起' : '展开全部' }}
          </el-button>
        </div>
      </template>
      <div class="bar-chart" v-if="recentSummary.length > 0">
        <div class="chart-container">
          <div
            class="bar-item"
            v-for="item in recentSummary"
            :key="item.date"
            @click="handleBarClick(item.date)"
          >
            <div class="bar-wrapper">
              <div
                class="bar"
                :style="{ height: getBarHeight(item.totalActiveSeconds) + '%' }"
              >
                <span class="bar-value" v-if="item.totalActiveSeconds > 0">
                  {{ formatDuration(item.totalActiveSeconds, true) }}
                </span>
              </div>
            </div>
            <div class="bar-label">{{ item.dateLabel }}</div>
          </div>
        </div>
      </div>
      <el-empty v-else description="暂无统计数据" />
    </el-card>

    <!-- 活跃应用列表 -->
    <el-card class="top-apps-card" shadow="never" v-loading="loading">
      <template #header>
        <div class="card-header-row">
          <span>今日活跃应用</span>
          <el-button
            v-if="allApps.length > 5"
            link
            size="small"
            @click="expanded = !expanded"
          >
            {{ expanded ? '收起' : '展开全部' }}
          </el-button>
        </div>
      </template>
      <div v-if="displayApps.length > 0">
        <div class="app-item" v-for="(item, idx) in displayApps" :key="item.app">
          <div class="app-rank">{{ idx + 1 }}</div>
          <div class="app-name">{{ item.app }}</div>
          <div class="app-bar">
            <div class="app-bar-fill" :style="{ width: getAppBarWidth(item.totalSeconds) + '%' }"></div>
          </div>
          <div class="app-duration">{{ formatDuration(item.totalSeconds) }}</div>
        </div>
      </div>
      <el-empty v-else description="暂无应用使用记录" />
    </el-card>

    <!-- 某天活动详情对话框（点击 7 天趋势图柱子弹出） -->
    <el-dialog
      v-model="dayDetailVisible"
      :title="`${dayDetailDate} 活动详情`"
      width="500px"
      class="day-detail-dialog"
    >
      <div v-loading="dayDetailLoading" class="day-detail-content">
        <template v-if="dayDetailData">
          <!-- 活跃时长 + 离开时长 -->
          <div class="day-detail-section">
            <div class="day-detail-stat">
              <span class="day-detail-stat-label">活跃时长</span>
              <span class="day-detail-stat-value">{{ formatDuration(dayDetailData.stats?.totalActiveSeconds || 0) }}</span>
            </div>
            <div class="day-detail-stat">
              <span class="day-detail-stat-label">离开时长</span>
              <span class="day-detail-stat-value">{{ dayDetailData.stats?.breakCount || 0 }} 分钟</span>
            </div>
          </div>

          <!-- 时间段分布 -->
          <div class="day-detail-section">
            <div class="day-detail-section-title">时间段分布</div>
            <div class="time-distribution">
              <div
                v-for="item in dayDetailTimeDistributionList"
                :key="item.key"
                class="time-distribution-item"
              >
                <div class="time-distribution-label">{{ item.label }}</div>
                <div class="time-distribution-bar">
                  <div
                    class="time-distribution-bar-fill"
                    :style="{ width: item.percent + '%' }"
                  ></div>
                </div>
                <div class="time-distribution-value">{{ formatDuration(item.seconds, true) || '0' }}</div>
              </div>
            </div>
          </div>

          <!-- 活跃应用类别 -->
          <div class="day-detail-section">
            <div class="day-detail-section-title">活跃应用类别</div>
            <div class="app-categories" v-if="dayDetailAppCategories.length > 0">
              <div
                v-for="item in dayDetailAppCategories"
                :key="item.category"
                class="app-category-item"
              >
                <span class="app-category-tag">{{ item.category }}</span>
                <div class="app-category-bar">
                  <div
                    class="app-category-bar-fill"
                    :style="{ width: item.percent + '%' }"
                  ></div>
                </div>
                <span class="app-category-percent">{{ item.percent }}%</span>
              </div>
            </div>
            <el-empty v-else description="暂无应用使用记录" :image-size="60" />
          </div>

          <!-- 活跃应用 -->
          <div class="day-detail-section">
            <div class="day-detail-section-title">
              <span>活跃应用</span>
              <el-button
                v-if="dayDetailData.topApps.length > 5"
                link
                size="small"
                @click="dayDetailExpanded = !dayDetailExpanded"
              >
                {{ dayDetailExpanded ? '收起' : '展开全部' }}
              </el-button>
            </div>
            <div v-if="dayDetailData.topApps.length > 0">
              <div class="app-item" v-for="(item, idx) in dayDetailDisplayApps" :key="item.app">
                <div class="app-rank">{{ idx + 1 }}</div>
                <div class="app-name">{{ item.app }}</div>
                <div class="app-bar">
                  <div class="app-bar-fill" :style="{ width: getDayDetailAppBarWidth(item.totalSeconds) + '%' }"></div>
                </div>
                <div class="app-duration">{{ formatDuration(item.totalSeconds) }}</div>
              </div>
            </div>
            <el-empty v-else description="暂无应用使用记录" :image-size="60" />
          </div>
        </template>
      </div>
    </el-dialog>

    <!-- 分类管理对话框（手动修改今日活跃应用分类） -->
    <el-dialog
      v-model="categoryManageVisible"
      title="分类管理"
      width="550px"
      class="category-manage-dialog"
    >
      <div v-loading="categoryManageLoading">
        <el-alert type="info" :closable="false" style="margin-bottom: 12px">
          可手动修改每个应用的分类。修改后立即生效并持久化。
        </el-alert>
        <el-table :data="categoryManageApps" size="small" max-height="400">
          <el-table-column prop="app" label="应用" min-width="140" />
          <el-table-column label="时长" width="80">
            <template #default="{ row }">{{ formatDuration(row.totalSeconds, true) }}</template>
          </el-table-column>
          <el-table-column label="分类" width="120">
            <template #default="{ row }">
              <el-select v-model="row.category" size="small" style="width: 100%">
                <el-option v-for="cat in CATEGORY_OPTIONS" :key="cat" :label="cat" :value="cat" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70">
            <template #default="{ row }">
              <el-button
                size="small"
                text
                type="primary"
                :disabled="row.category === row.originalCategory || categoryManageSaving"
                @click="handleSaveCategory(row)"
              >保存</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Timer, Coffee, Monitor, Operation, Stopwatch, Aim, MagicStick, RefreshLeft, Setting } from '@element-plus/icons-vue'
import { activityApi, invoke } from '@/utils/ipc-client'

// ============================================================
// 响应式状态
// ============================================================

const loading = ref(false)

// 今日统计
const todayStats = ref({
  totalActiveSeconds: 0,
  totalClicks: 0,
  totalKeystrokes: 0,
  longestContinuousActive: 0,
  breakCount: 0
})

// 今日连续活跃段数（反映工作碎片化程度）
const activeSegments = ref(0)
// 今日时间段分布（上午/下午/晚上/深夜活跃秒数）
const timeDistribution = ref({ morning: 0, afternoon: 0, evening: 0, night: 0 })
// 今日活跃应用按类别聚合（[{ category, totalSeconds, percent }]）
const appCategories = ref([])
// AI 分类进行中（按钮 loading 状态）
const aiCategorizing = ref(false)
const resettingCategories = ref(false)

// 当前状态
const currentStatus = ref({
  isIdle: false,
  isAway: false,
  isLocked: false,
  idleTime: 0,
  activeApp: null,
  activeWindow: null,

  continuousActiveSeconds: 0
})

// 最近 7 天汇总
const recentSummary = ref([])
// 趋势图展开全部状态（收起时仅展示最近 7 天，展开时加载全部历史记录）
const chartExpanded = ref(false)
// 今日全部活跃应用（后端已排序）
const allApps = ref([])
// 展开状态
const expanded = ref(false)

// 专注统计数据
const focusStats = ref({
  totalSeconds: 0,
  totalSessions: 0,
  todaySeconds: 0,
  todaySessions: 0,
  modeStats: [],
  dailyStats: []
})
const focusLoading = ref(false)

// 数据清空
const clearDateRange = ref(null)
const clearing = ref(false)

// 某天活动详情对话框状态（点击 7 天趋势图柱子弹出）
const dayDetailVisible = ref(false)
const dayDetailDate = ref('')
const dayDetailLoading = ref(false)
// dayDetailData 结构：{ stats, timeDistribution, appCategories, topApps }
const dayDetailData = ref(null)
// 详情弹窗应用列表展开状态（收起时仅展示前 5，展开时显示全部）
const dayDetailExpanded = ref(false)

// 分类管理对话框状态（手动修改今日活跃应用分类）
const categoryManageVisible = ref(false)
const categoryManageLoading = ref(false)
// 应用分类列表项：{ app, category, originalCategory, totalSeconds }
const categoryManageApps = ref([])
const categoryManageSaving = ref(false)
// 可选类别列表（与 AI 分类 prompt 中的类别一致）
const CATEGORY_OPTIONS = ['开发', '办公', '浏览', '社交', '娱乐', '设计', '学习', '系统', '工具', '其他']

async function handleClearData () {
  try {
    await ElMessageBox.confirm(
      '确定要清空选定日期范围的活动数据吗？此操作不可恢复。',
      '确认清空',
      { type: 'warning' }
    )
  } catch {
    return
  }
  clearing.value = true
  try {
    const params = {}
    if (clearDateRange.value && clearDateRange.value.length === 2) {
      params.startDate = clearDateRange.value[0]
      params.endDate = clearDateRange.value[1]
    }
    await invoke('activity:clear-data', params)
    ElMessage.success('活动数据已清空')
    await loadSummary()
  } catch (error) {
    ElMessage.error('清空失败：' + error.message)
  } finally {
    clearing.value = false
  }
}
// 全量应用是否已加载
const allAppsFullyLoaded = ref(false)

// 状态轮询定时器
let statusTimer = null

// ============================================================
// 计算属性
// ============================================================

// 当前状态标签类型
const statusTagType = computed(() => {
  if (currentStatus.value.isLocked) return 'info'
  if (currentStatus.value.isAway) return 'warning'
  if (currentStatus.value.isIdle) return 'info'
  return 'success'
})

// 当前状态标签文本
const statusTagText = computed(() => {
  if (currentStatus.value.isLocked) return '已锁屏'
  if (currentStatus.value.isAway) return '离开'
  if (currentStatus.value.isIdle) return '空闲'
  return '活跃'
})

// 时间段分布展示列表（含百分比，按时段顺序排列）
const timeDistributionList = computed(() => {
  const d = timeDistribution.value
  const total = d.morning + d.afternoon + d.evening + d.night
  const safeTotal = total > 0 ? total : 1
  return [
    { key: 'morning', label: '上午', seconds: d.morning, percent: Math.round((d.morning / safeTotal) * 100) },
    { key: 'afternoon', label: '下午', seconds: d.afternoon, percent: Math.round((d.afternoon / safeTotal) * 100) },
    { key: 'evening', label: '晚上', seconds: d.evening, percent: Math.round((d.evening / safeTotal) * 100) },
    { key: 'night', label: '深夜', seconds: d.night, percent: Math.round((d.night / safeTotal) * 100) }
  ]
})

// 某天详情时间段分布展示列表
const dayDetailTimeDistributionList = computed(() => {
  const d = dayDetailData.value?.timeDistribution || { morning: 0, afternoon: 0, evening: 0, night: 0 }
  const total = d.morning + d.afternoon + d.evening + d.night
  const safeTotal = total > 0 ? total : 1
  return [
    { key: 'morning', label: '上午', seconds: d.morning, percent: Math.round((d.morning / safeTotal) * 100) },
    { key: 'afternoon', label: '下午', seconds: d.afternoon, percent: Math.round((d.afternoon / safeTotal) * 100) },
    { key: 'evening', label: '晚上', seconds: d.evening, percent: Math.round((d.evening / safeTotal) * 100) },
    { key: 'night', label: '深夜', seconds: d.night, percent: Math.round((d.night / safeTotal) * 100) }
  ]
})

// 某天详情活跃应用类别展示列表（含百分比）
const dayDetailAppCategories = computed(() => {
  const categories = dayDetailData.value?.appCategories || []
  const total = categories.reduce((s, c) => s + (c.totalSeconds || 0), 0)
  const safeTotal = total > 0 ? total : 1
  return categories.map(c => ({
    category: c.category,
    totalSeconds: c.totalSeconds || 0,
    percent: Math.round(((c.totalSeconds || 0) / safeTotal) * 100)
  }))
})

// ============================================================
// 工具函数
// ============================================================

/**
 * 格式化时长（秒 -> "Xh Ym" 或 "Ym Zs"）
 * @param {number} seconds
 * @param {boolean} compact 紧凑模式（用于柱状图标签）
 * @returns {string}
 */
function formatDuration (seconds, compact = false) {
  if (!seconds || seconds <= 0) return compact ? '' : '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (compact) {
    if (h > 0) return `${h}h${m}m`
    if (m > 0) return `${m}m`
    return `${s}s`
  }
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**

 * 格式化键盘输入次数
 * @param {number} count
 * @returns {string}
 */
function formatKeystrokes (count) {
  if (!count || count <= 0) return '0'
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return `${count}`
}

/**
 * 计算柱状图高度百分比
 * @param {number} seconds
 * @returns {number}
 */
function getBarHeight (seconds) {
  const maxVal = Math.max(1, ...recentSummary.value.map(s => s.totalActiveSeconds))
  return Math.round((seconds / maxVal) * 100)
}

/**
 * 计算应用时长条宽度百分比
 * @param {number} seconds
 * @returns {number}
 */
function getAppBarWidth (seconds) {
  const apps = expanded.value ? allApps.value : displayApps.value
  const maxVal = Math.max(1, ...apps.map(a => a.totalSeconds))
  return Math.round((seconds / maxVal) * 100)
}

/**
 * 计算某天详情应用时长条宽度百分比
 * 始终以全部应用的最大时长为基准，展开/收起时进度条比例一致
 * @param {number} seconds
 * @returns {number}
 */
function getDayDetailAppBarWidth (seconds) {
  const apps = dayDetailData.value?.topApps || []
  const maxVal = Math.max(1, ...apps.map(a => a.totalSeconds))
  return Math.round((seconds / maxVal) * 100)
}

/**
 * 专注模式标签
 * @param {string} mode - single/group/project
 * @returns {string}
 */
function modeLabel (mode) {
  return { single: '单任务', group: '任务流', project: '项目' }[mode] || mode
}

/**
 * 计算专注趋势柱状图高度百分比
 * @param {number} seconds
 * @returns {number}
 */
function getFocusBarHeight (seconds) {
  const daily = focusStats.value.dailyStats || []
  const maxVal = Math.max(1, ...daily.map(d => d.seconds))
  return Math.round((seconds / maxVal) * 100)
}

/**
 * 日期短格式（MM-DD）
 * @param {string} date - YYYY-MM-DD
 * @returns {string}
 */
function formatDateShort (date) {
  return date ? date.slice(5) : ''
}

// ============================================================
// 数据加载
// ============================================================

/**
 * 加载今日统计
 * 并行加载：基础统计 + 时间段分布 + 连续活跃段数 + 活跃应用类别
 */
async function loadTodayStats () {
  try {
    const [statsRes, distRes, segRes, catRes] = await Promise.all([
      activityApi.getTodayStats(),
      activityApi.getTimeDistribution(),
      activityApi.getActiveSegments(),
      activityApi.getAppCategories()
    ])
    if (statsRes && statsRes.stats) {
      todayStats.value = { ...todayStats.value, ...statsRes.stats }
    }
    if (distRes && distRes.distribution) {
      timeDistribution.value = { ...timeDistribution.value, ...distRes.distribution }
    }
    if (segRes && typeof segRes.segments === 'number') {
      activeSegments.value = segRes.segments
    }
    if (catRes && Array.isArray(catRes.categories)) {
      const total = catRes.categories.reduce((s, c) => s + (c.totalSeconds || 0), 0)
      const safeTotal = total > 0 ? total : 1
      appCategories.value = catRes.categories.map(c => ({
        category: c.category,
        totalSeconds: c.totalSeconds || 0,
        percent: Math.round(((c.totalSeconds || 0) / safeTotal) * 100)
      }))
    }
  } catch (err) {
    ElMessage.error(`加载今日统计失败：${err.message}`)
  }
}

/**
 * 调用 AI 对未分类应用归类，完成后刷新活跃应用类别展示
 * 先获取未分类应用数量，为 0 则提示，否则弹确认对话框后调用 AI 分类
 */
async function handleAiCategorize () {
  // 先获取未分类应用列表，确认有需要分类的应用
  let uncategorizedApps = []
  try {
    const res = await activityApi.getUncategorizedApps()
    uncategorizedApps = (res && res.apps) || []
  } catch (err) {
    ElMessage.error(`获取未分类应用失败：${err.message}`)
    return
  }
  if (uncategorizedApps.length === 0) {
    ElMessage.info('没有未分类的应用，无需 AI 分类')
    return
  }
  // 确认对话框，展示未分类应用数量
  try {
    await ElMessageBox.confirm(
      `检测到 ${uncategorizedApps.length} 个未分类应用，将发送应用名给 AI 进行分类。是否继续？`,
      'AI 应用分类',
      { confirmButtonText: '开始分类', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return // 用户取消
  }
  aiCategorizing.value = true
  try {
    const res = await activityApi.aiCategorizeApps()
    if (res && res.message) {
      ElMessage.info(res.message)
    } else {
      const count = res && res.categorized ? Object.keys(res.categorized).length : 0
      ElMessage.success(`AI 分类完成，新增分类 ${count} 个，累计 ${res.total || 0} 个`)
    }
    // 刷新活跃应用类别展示
    await loadAppCategories()
  } catch (err) {
    ElMessage.error(`AI 分类失败：${err.message}`)
  } finally {
    aiCategorizing.value = false
  }
}

/**
 * 恢复默认分类：清除 AI 分类持久化，刷新展示
 */
async function handleResetCategories () {
  try {
    await ElMessageBox.confirm(
      '确定要清除 AI 分类结果并恢复默认分类吗？',
      '恢复默认分类',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }
  resettingCategories.value = true
  try {
    await activityApi.resetAppCategories()
    ElMessage.success('已恢复默认分类')
    await loadAppCategories()
  } catch (err) {
    ElMessage.error(`恢复默认失败：${err.message}`)
  } finally {
    resettingCategories.value = false
  }
}

/**
 * 仅刷新活跃应用类别数据（AI 分类/恢复默认后调用，避免重复加载全部今日统计）
 */
async function loadAppCategories () {
  try {
    const catRes = await activityApi.getAppCategories()
    if (catRes && Array.isArray(catRes.categories)) {
      const total = catRes.categories.reduce((s, c) => s + (c.totalSeconds || 0), 0)
      const safeTotal = total > 0 ? total : 1
      appCategories.value = catRes.categories.map(c => ({
        category: c.category,
        totalSeconds: c.totalSeconds || 0,
        percent: Math.round(((c.totalSeconds || 0) / safeTotal) * 100)
      }))
    }
  } catch (err) {
    ElMessage.error(`刷新分类数据失败：${err.message}`)
  }
}

/**
 * 打开分类管理对话框，加载今日活跃应用分类配置
 */
async function handleCategoryManage () {
  categoryManageVisible.value = true
  categoryManageLoading.value = true
  try {
    const res = await activityApi.getCategoryConfig()
    if (res && res.apps) {
      categoryManageApps.value = res.apps.map(a => ({
        app: a.app,
        category: a.category,
        originalCategory: a.category,
        totalSeconds: a.totalSeconds
      }))
    }
  } catch (err) {
    ElMessage.error(`加载分类配置失败：${err.message}`)
  } finally {
    categoryManageLoading.value = false
  }
}

/**
 * 保存单个应用分类修改，持久化后刷新活跃应用类别展示
 * @param {{ app:string, category:string, originalCategory:string, totalSeconds:number }} app
 */
async function handleSaveCategory (app) {
  if (app.category === app.originalCategory) return // 未修改
  categoryManageSaving.value = true
  try {
    await activityApi.updateAppCategory(app.app, app.category)
    app.originalCategory = app.category
    ElMessage.success(`已将 ${app.app} 分类为 ${app.category}`)
    // 刷新活跃应用类别展示
    await loadAppCategories()
  } catch (err) {
    ElMessage.error(`修改失败：${err.message}`)
    app.category = app.originalCategory // 回滚
  } finally {
    categoryManageSaving.value = false
  }
}

/**
 * 加载当前状态
 */
async function loadCurrentStatus () {
  try {
    const res = await activityApi.getCurrentStatus()
    if (res && res.status) {
      currentStatus.value = { ...currentStatus.value, ...res.status }
    }
  } catch (err) {
    // 静默失败，避免轮询时频繁弹窗
    console.warn('[ActivityStatsView] 加载当前状态失败:', err.message)
  }
}

/**
 * 加载最近 N 天汇总与 Top 应用
 * @param {number} days 天数，7 为最近 7 天，0 为全部历史记录
 */
async function loadSummary (days = 7) {
  try {
    const res = await activityApi.getSummary(days)
    if (res) {
      // 为每天添加 dateLabel（MM-DD）
      recentSummary.value = (res.summary || []).map(item => ({
        ...item,
        dateLabel: item.date ? item.date.slice(5) : ''
      }))
      // summary 仅返回前 5 个应用，这里不采用；改为加载全部应用
      await loadAllApps()
    }
  } catch (err) {
    ElMessage.error(`加载汇总数据失败：${err.message}`)
  }
}

/**
 * 切换趋势图展开/收起状态
 * 展开时加载全部历史记录，收起时恢复最近 7 天
 */
async function toggleChartExpanded () {
  chartExpanded.value = !chartExpanded.value
  await loadSummary(chartExpanded.value ? 0 : 7)
}

/**
 * 加载全部活跃应用
 */
async function loadAllApps () {
  try {
    const res = await activityApi.getTopApps(0)
    if (res) {
      allApps.value = res.topApps || []
      allAppsFullyLoaded.value = true
    }
  } catch (err) {
    ElMessage.error(`加载应用数据失败：${err.message}`)
  }
}

/**
 * 点击 7 天趋势图柱子，弹出该天活动详情对话框
 * 并行加载：基础统计 + 时间段分布 + 活跃应用类别 + 全部活跃应用
 * @param {string} date YYYY-MM-DD
 */
async function handleBarClick (date) {
  dayDetailDate.value = date
  dayDetailVisible.value = true
  dayDetailLoading.value = true
  dayDetailData.value = null
  dayDetailExpanded.value = false
  try {
    const [statsRes, distRes, catRes, appsRes] = await Promise.all([
      activityApi.getStatsByDate(date).catch(() => null),
      activityApi.getTimeDistribution(date).catch(() => null),
      activityApi.getAppCategories(date).catch(() => null),
      activityApi.getTopApps(0, date).catch(() => null)
    ])
    dayDetailData.value = {
      stats: statsRes?.stats || null,
      timeDistribution: distRes?.distribution || null,
      appCategories: catRes?.categories || [],
      topApps: appsRes?.topApps || []
    }
  } catch (err) {
    ElMessage.error(`加载详情失败：${err.message}`)
  } finally {
    dayDetailLoading.value = false
  }
}

/**
 * 加载专注统计数据
 */
async function loadFocusStats () {
  focusLoading.value = true
  try {
    const result = await invoke('focus:stats')
    if (result) {
      focusStats.value = {
        totalSeconds: result.totalSeconds || 0,
        totalSessions: result.totalSessions || 0,
        todaySeconds: result.todaySeconds || 0,
        todaySessions: result.todaySessions || 0,
        modeStats: result.modeStats || [],
        dailyStats: result.dailyStats || []
      }
    }
  } catch (err) {
    // 静默失败，避免影响其他统计数据的展示
    console.warn('[ActivityStatsView] 加载专注统计失败:', err.message)
  } finally {
    focusLoading.value = false
  }
}

// displayApps：收起时显示前 5，展开时显示全部
const displayApps = computed(() => {
  return expanded.value ? allApps.value : allApps.value.slice(0, 5)
})

// dayDetailDisplayApps：详情弹窗收起时显示前 5，展开时显示全部
const dayDetailDisplayApps = computed(() => {
  const apps = dayDetailData.value?.topApps || []
  return dayDetailExpanded.value ? apps : apps.slice(0, 5)
})

/**
 * 加载所有数据
 */
async function loadAll () {
  loading.value = true
  try {
    await Promise.all([loadTodayStats(), loadCurrentStatus(), loadSummary(), loadFocusStats()])
  } finally {
    loading.value = false
  }
}

// ============================================================
// 生命周期
// ============================================================

// 页面可见性变化处理：隐藏时暂停轮询，可见时恢复
function handleVisibilityChange () {
  if (document.hidden) {
    if (statusTimer) {
      clearInterval(statusTimer)
      statusTimer = null
    }
  } else if (!statusTimer) {
    // 立即刷新一次，再恢复轮询
    loadCurrentStatus()
    statusTimer = setInterval(loadCurrentStatus, 5000)
  }
}

onMounted(() => {
  loadAll()
  // 每 5 秒刷新当前状态
  statusTimer = setInterval(loadCurrentStatus, 5000)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<style scoped lang="scss">
.activity-stats-view {
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 16px;

  .page-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0 0 4px;
  }

  .page-subtitle {
    font-size: 13px;
    color: var(--app-text-secondary, #909399);
    margin: 0;
  }
}

// 数据管理工具栏
.data-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 16px;
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 8px;

  &__label {
    font-size: 13px;
    font-weight: 500;
    color: var(--app-text-secondary, #909399);
    flex-shrink: 0;
  }
}

// 概览卡片
.overview-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

// 维度分区：时间维度 / 操作维度 / 时间段分布 / 活跃应用类别
.overview-dimension {
  &:not(:last-child) {
    margin-bottom: 16px;
  }
}

.overview-dimension-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-secondary, #909399);
  margin-bottom: 8px;

  border-left: 3px solid var(--el-color-primary, #409eff);
  padding-left: 8px;
}

// 活跃应用类别标题：flex 布局，按钮靠右
.app-category-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 4px;
}

.app-category-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.overview-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.overview-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  font-size: 22px;
  flex-shrink: 0;

  &--active {
    background: rgba(64, 158, 255, 0.1);
    color: #409eff;
  }

  &--click {
    background: rgba(103, 194, 58, 0.1);
    color: #67c23a;
  }

  &--break {
    background: rgba(230, 162, 60, 0.1);
    color: #e6a23c;
  }

  &--keyboard {
    background: rgba(64, 158, 255, 0.1);
    color: #409eff;
  }

  &--longest {
    background: rgba(0, 180, 170, 0.1);
    color: #00b4aa;
  }

  &--segments {
    background: rgba(144, 89, 233, 0.1);
    color: #9059e9;
  }
}

.overview-info {
  flex: 1;
  min-width: 0;
}

.overview-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--app-text-primary, #303133);
  line-height: 1.2;
}

.overview-label {
  font-size: 12px;
  color: var(--app-text-secondary, #909399);
  margin-top: 2px;
}

// 时间段分布：横向四列进度条
.time-distribution {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.time-distribution-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.time-distribution-label {
  font-size: 12px;
  color: var(--app-text-secondary, #909399);
}

.time-distribution-bar {
  height: 8px;
  background: var(--el-fill-color, #f5f7fa);
  border-radius: 4px;
  overflow: hidden;
}

.time-distribution-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #409eff 0%, #79bbff 100%);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.time-distribution-value {
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text-primary, #303133);
}

// 活跃应用类别：标签 + 占比条
.app-categories {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-category-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.app-category-tag {
  width: 56px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text-primary, #303133);
  text-align: center;
  padding: 3px 8px;
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 10px;
}

.app-category-bar {
  flex: 1;
  height: 8px;
  background: var(--el-fill-color, #f5f7fa);
  border-radius: 4px;
  overflow: hidden;
}

.app-category-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #67c23a 0%, #85ce61 100%);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.app-category-percent {
  width: 44px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--app-text-secondary, #909399);
  text-align: right;
}

// 当前状态卡片
.status-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

// 柱状图卡片
.chart-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

.bar-chart {
  .chart-container {
    display: flex;
    align-items: flex-end;
    justify-content: space-around;
    gap: 8px;
    height: 240px;
    padding: 16px 8px 8px;
    // 展开全部时支持横向滚动，避免柱子过窄
    overflow-x: auto;
    overflow-y: hidden;
  }

  .bar-item {
    flex: 1;
    min-width: 32px; // 最小宽度，展开全部时柱子不会过窄
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    cursor: pointer;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 0.8;
    }
  }

  .bar-wrapper {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .bar {
    width: 70%;
    min-height: 4px;
    background: linear-gradient(180deg, #409eff 0%, #79bbff 100%);
    border-radius: 4px 4px 0 0;
    transition: height 0.3s ease;
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 4px;
  }

  .bar-value {
    font-size: 11px;
    color: #fff;
    white-space: nowrap;
  }

  .bar-label {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    margin-top: 8px;
  }
}

// Top 应用卡片
.top-apps-card {
  border-radius: 8px;
}

// 某天活动详情对话框
.day-detail-content {
  min-height: 120px;
}

.day-detail-section {
  &:not(:last-child) {
    margin-bottom: 16px;
  }
}

.day-detail-section-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-secondary, #909399);
  margin-bottom: 8px;
  border-left: 3px solid var(--el-color-primary, #409eff);
  padding-left: 8px;
}

.day-detail-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;

  &:not(:last-child) {
    border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
  }
}

.day-detail-stat-label {
  font-size: 13px;
  color: var(--app-text-secondary, #909399);
}

.day-detail-stat-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text-primary, #303133);
}

// 专注统计卡片
.focus-stats-card {
  margin-bottom: 16px;
  border-radius: 8px;

}

.focus-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.focus-overview-item {
  text-align: center;
  padding: 8px 4px;
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 6px;
}

.focus-overview-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--app-text-primary, #303133);
  line-height: 1.2;
}

.focus-overview-label {
  font-size: 12px;
  color: var(--app-text-secondary, #909399);
  margin-top: 4px;
}

.focus-modes {
  margin-bottom: 16px;

  .focus-modes-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--app-text-secondary, #909399);
    margin-bottom: 8px;
  }

  .focus-modes-list {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .focus-mode-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--el-fill-color-light, #f5f7fa);
    border-radius: 16px;
    font-size: 13px;
  }

  .focus-mode-label {
    color: var(--app-text-primary, #303133);
    font-weight: 500;
  }

  .focus-mode-count {
    color: var(--app-text-secondary, #909399);
  }
}

.focus-trend {
  .focus-trend-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--app-text-secondary, #909399);
    margin-bottom: 8px;
  }

  .focus-trend-bars {
    display: flex;
    align-items: flex-end;
    justify-content: space-around;
    gap: 8px;
    height: 180px;
    padding: 8px 4px 4px;
  }

  .focus-trend-bar-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
  }

  .focus-trend-bar-wrapper {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .focus-trend-bar {
    width: 70%;
    min-height: 4px;
    background: linear-gradient(180deg, #67c23a 0%, #85ce61 100%);
    border-radius: 4px 4px 0 0;
    transition: height 0.3s ease;
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 4px;
  }

  .focus-trend-bar-value {
    font-size: 11px;
    color: #fff;
    white-space: nowrap;
  }

  .focus-trend-bar-label {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    margin-top: 6px;
  }
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.app-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;

  &:not(:last-child) {
    border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
  }
}

.app-rank {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--el-fill-color, #f5f7fa);
  color: var(--app-text-secondary, #909399);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.app-name {
  width: 120px;
  font-size: 13px;
  color: var(--app-text-primary, #303133);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.app-bar {
  flex: 1;
  height: 8px;
  background: var(--el-fill-color, #f5f7fa);
  border-radius: 4px;
  overflow: hidden;
}

.app-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #409eff 0%, #79bbff 100%);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.app-duration {
  width: 80px;
  font-size: 12px;
  color: var(--app-text-secondary, #909399);
  text-align: right;
  flex-shrink: 0;
}

// ============================================================
// 暗色模式适配
// 概览图标、柱状图、Top 应用进度条在暗色下使用更柔和的色调
// ============================================================
html.dark .activity-stats-view {
  .overview-icon {
    &--active { background: rgba(64, 158, 255, 0.15); color: #79bbff; }
    &--click { background: rgba(103, 194, 58, 0.15); color: #85ce61; }
    &--break { background: rgba(230, 162, 60, 0.15); color: #ebb563; }
    &--keyboard { background: rgba(64, 158, 255, 0.15); color: #79bbff; }
    &--longest { background: rgba(0, 180, 170, 0.18); color: #4dd0c8; }
    &--segments { background: rgba(144, 89, 233, 0.18); color: #b794f6; }
  }
  .time-distribution-bar-fill {
    background: linear-gradient(90deg, #79bbff 0%, #409eff 100%);
  }
  .app-category-bar-fill {
    background: linear-gradient(90deg, #85ce61 0%, #67c23a 100%);
  }
  .bar {
    background: linear-gradient(180deg, #79bbff 0%, #409eff 100%);
  }
  .app-bar-fill {
    background: linear-gradient(90deg, #79bbff 0%, #409eff 100%);
  }
  .bar-value { color: #1d1e1f; }
  .focus-trend-bar {
    background: linear-gradient(180deg, #85ce61 0%, #67c23a 100%);
  }
  .focus-trend-bar-value { color: #1d1e1f; }

  // 数据管理工具栏：plain danger 按钮在暗色下使用更亮的色调保证对比度
  // Element Plus 默认 plain button hover 时使用 --el-color-primary-light-3，
  // 项目 applyAccentToDom 在暗色下用黑色混合 light-*，导致 hover 字体变暗，
  // 这里显式覆盖为亮色
  .data-toolbar {
    .el-button.is-plain.el-button--danger {
      color: #f78989;
      background-color: rgba(245, 108, 108, 0.1);
      border-color: rgba(245, 108, 108, 0.4);

      &:hover,
      &:focus {
        color: #f8b4b4;
        background-color: rgba(245, 108, 108, 0.2);
        border-color: rgba(245, 108, 108, 0.6);
      }

      &:active {
        color: #fab6b6;
      }
    }
  }
}
</style>