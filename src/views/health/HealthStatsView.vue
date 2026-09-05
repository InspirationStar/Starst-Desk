<!--
  健康统计页
  综合统计仪表盘：喝水趋势柱状图、睡眠时长折线图、各模块完成率
-->
<template>
  <div class="health-stats-view">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-title">📊 健康统计仪表盘</h2>
      <div class="header-actions">
        <el-radio-group v-model="statsDays" size="small" @change="loadAllStats">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="14">近 14 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
        </el-radio-group>
        <el-button @click="$router.push('/health')">← 返回配置页</el-button>
      </div>
    </div>

    <!-- 各模块完成率总览 -->
    <el-card class="completion-card" shadow="never" v-loading="loading">
      <template #header>
        <span>🎯 各模块完成率</span>
      </template>

      <el-row :gutter="16">
        <el-col :span="8" v-for="item in completionData" :key="item.type">
          <div class="completion-item">
            <div class="completion-header">
              <span class="completion-icon">{{ item.icon }}</span>
              <span class="completion-name">{{ item.name }}</span>
            </div>
            <el-progress
              :percentage="item.percentage"
              :color="getCompletionColor(item.percentage)"
              :stroke-width="12"
            >
              <template #default="{ percentage }">
                <span class="completion-text">{{ percentage }}%</span>
              </template>
            </el-progress>
            <div class="completion-detail">{{ item.detail }}</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 久坐伸展/护眼完成率趋势图（子需求8） -->
    <el-card class="chart-card" shadow="never" v-if="sedentaryCompletion.daily.length > 0 || eyeCompletion.daily.length > 0">
      <template #header>
        <span>📊 久坐伸展/护眼完成率趋势</span>
      </template>

      <div class="completion-trend">
        <!-- 久坐伸展完成率趋势 -->
        <div class="trend-item" v-if="sedentaryCompletion.daily.length > 0">
          <div class="trend-header">
            <span class="trend-icon">🪑</span>
            <span class="trend-name">久坐伸展</span>
            <el-tag :type="getCompletionTagType(sedentaryCompletion.rate)" size="small">
              {{ sedentaryCompletion.rate }}%
            </el-tag>
          </div>
          <div class="trend-bars">
            <div class="trend-bar-item" v-for="day in sedentaryCompletion.daily" :key="day.date">
              <div class="trend-bar-wrapper">
                <div
                  class="trend-bar"
                  :style="{
                    height: day.total > 0 ? Math.max(2, (day.rate)) + '%' : '2px',
                    backgroundColor: getCompletionColor(day.rate)
                  }"
                  :title="`${day.date}: ${day.completed}/${day.total} (${day.rate}%)`"
                ></div>
              </div>
              <div class="trend-bar-label">{{ day.date.slice(5) }}</div>
            </div>
          </div>
        </div>

        <!-- 护眼完成率趋势 -->
        <div class="trend-item" v-if="eyeCompletion.daily.length > 0">
          <div class="trend-header">
            <span class="trend-icon">👁️</span>
            <span class="trend-name">护眼</span>
            <el-tag :type="getCompletionTagType(eyeCompletion.rate)" size="small">
              {{ eyeCompletion.rate }}%
            </el-tag>
          </div>
          <div class="trend-bars">
            <div class="trend-bar-item" v-for="day in eyeCompletion.daily" :key="day.date">
              <div class="trend-bar-wrapper">
                <div
                  class="trend-bar"
                  :style="{
                    height: day.total > 0 ? Math.max(2, (day.rate)) + '%' : '2px',
                    backgroundColor: getCompletionColor(day.rate)
                  }"
                  :title="`${day.date}: ${day.completed}/${day.total} (${day.rate}%)`"
                ></div>
              </div>
              <div class="trend-bar-label">{{ day.date.slice(5) }}</div>
            </div>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 喝水趋势柱状图 -->
    <el-card class="chart-card" shadow="never">
      <template #header>
        <span>💧 喝水趋势（柱状图）</span>
      </template>

      <div class="bar-chart" v-if="waterData.length > 0">
        <div class="chart-container">
          <div class="bar-item" v-for="item in waterData" :key="item.date">
            <div class="bar-wrapper">
              <div
                class="bar"
                :style="{
                  height: getWaterBarHeight(item.total) + '%',
                  backgroundColor: item.total >= waterTarget ? '#409eff' : '#e6a23c'
                }"
              >
                <span class="bar-value" v-if="item.total > 0">{{ item.total }}ml</span>
              </div>
            </div>
            <div class="bar-label">{{ item.dateLabel }}</div>
          </div>
        </div>
        <div class="chart-summary">
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="总饮水量">{{ waterSummary.total }} ml</el-descriptions-item>
            <el-descriptions-item label="日均饮水">{{ waterSummary.average }} ml</el-descriptions-item>
            <el-descriptions-item label="达标天数">{{ waterSummary.achievedDays }} / {{ waterData.length }} 天</el-descriptions-item>
          </el-descriptions>
        </div>
      </div>
      <el-empty v-else description="暂无饮水数据" />
    </el-card>

    <!-- 睡眠时长折线图 -->
    <el-card class="chart-card" shadow="never">
      <template #header>
        <span>😴 睡眠时长趋势（折线图）</span>
      </template>

      <div class="line-chart" v-if="sleepData.length > 0 && hasSleepData">
        <svg class="chart-svg" :viewBox="`0 0 ${chartWidth} ${chartHeight}`" preserveAspectRatio="xMidYMid meet">
          <!-- 网格线 -->
          <g class="grid-lines">
            <line
              v-for="hour in [0, 4, 6, 8, 10, 12]"
              :key="hour"
              :x1="padding.left"
              :y1="getYPosition(hour)"
              :x2="chartWidth - padding.right"
              :y2="getYPosition(hour)"
              stroke="#ebeef5"
              stroke-dasharray="4,4"
            />
            <text
              v-for="hour in [0, 4, 6, 8, 10, 12]"
              :key="`label-${hour}`"
              :x="padding.left - 10"
              :y="getYPosition(hour) + 4"
              text-anchor="end"
              fill="#909399"
              font-size="12"
            >{{ hour }}h</text>
          </g>

          <!-- 折线 -->
          <polyline
            :points="sleepLinePoints"
            fill="none"
            stroke="#409eff"
            stroke-width="2"
          />

          <!-- 数据点 -->
          <g class="data-points">
            <circle
              v-for="(point, index) in sleepChartPoints"
              :key="index"
              :cx="point.x"
              :cy="point.y"
              r="4"
              fill="#409eff"
            />
            <text
              v-for="(point, index) in sleepChartPoints"
              :key="`text-${index}`"
              :x="point.x"
              :y="point.y - 10"
              text-anchor="middle"
              fill="#606266"
              font-size="11"
            >{{ point.value }}h</text>
          </g>

          <!-- X 轴日期标签 -->
          <g class="x-labels">
            <text
              v-for="(item, index) in sleepData"
              :key="`x-${index}`"
              :x="getXPosition(index)"
              :y="chartHeight - padding.bottom + 20"
              text-anchor="middle"
              fill="#909399"
              font-size="12"
            >{{ item.dateLabel }}</text>
          </g>
        </svg>
        <div class="chart-summary">
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="平均睡眠">{{ sleepSummary.average }} 小时</el-descriptions-item>
            <el-descriptions-item label="最长睡眠">{{ sleepSummary.max }} 小时</el-descriptions-item>
            <el-descriptions-item label="最短睡眠">{{ sleepSummary.min }} 小时</el-descriptions-item>
          </el-descriptions>
        </div>
      </div>
      <el-empty v-else description="暂无睡眠数据" />
    </el-card>

    <!-- 饮食记录统计 -->
    <el-card class="chart-card" shadow="never">
      <template #header>
        <span>🍽️ 饮食记录统计</span>
      </template>

      <div class="diet-stats" v-if="dietData.length > 0">
        <el-table :data="dietData" stripe size="small">
          <el-table-column prop="dateLabel" label="日期" width="120" />
          <el-table-column label="早餐">
            <template #default="{ row }">
              <span v-if="row.breakfast">✅ {{ row.breakfast }}</span>
              <span v-else class="no-record">—</span>
            </template>
          </el-table-column>
          <el-table-column label="午餐">
            <template #default="{ row }">
              <span v-if="row.lunch">✅ {{ row.lunch }}</span>
              <span v-else class="no-record">—</span>
            </template>
          </el-table-column>
          <el-table-column label="晚餐">
            <template #default="{ row }">
              <span v-if="row.dinner">✅ {{ row.dinner }}</span>
              <span v-else class="no-record">—</span>
            </template>
          </el-table-column>
          <el-table-column label="完成率" width="100">
            <template #default="{ row }">
              <el-tag :type="getDietTagType(row.completion)" size="small">
                {{ row.completion }}%
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <el-empty v-else description="暂无饮食数据" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { useHealthStore } from '@/stores/health-store'

const healthStore = useHealthStore()

const loading = ref(false)
const statsDays = ref(7)

// 喝水数据
const waterData = ref([])
const waterTarget = ref(2000)

// 睡眠数据
const sleepData = ref([])

// 饮食数据
const dietData = ref([])

// 图表尺寸
const chartWidth = 700
const chartHeight = 300
const padding = { top: 30, right: 40, bottom: 40, left: 50 }

// 模块列表（子需求8：久坐和伸展合并为"久坐伸展"）
const moduleList = [
  { type: 'water', name: '喝水', icon: '💧' },
  { type: 'sedentary', name: '久坐伸展', icon: '🪑' },
  { type: 'eye', name: '护眼', icon: '👁️' },
  { type: 'sleep', name: '睡眠', icon: '😴' },
  { type: 'diet', name: '饮食', icon: '🍽️' }
]

// 完成率数据
const completionData = ref([])

// 久坐伸展/护眼完成率统计（从数据库查询）
const sedentaryCompletion = ref({ total: 0, completed: 0, rate: 0, daily: [] })
const eyeCompletion = ref({ total: 0, completed: 0, rate: 0, daily: [] })

/**
 * 计算两个时间点之间的睡眠时长（小时）
 */
function calculateSleepDuration (bedtime, wakeup) {
  if (!bedtime || !wakeup) return null
  const [bedH, bedM] = bedtime.split(':').map(Number)
  const [wakeH, wakeM] = wakeup.split(':').map(Number)
  let duration = (wakeH * 60 + wakeM) - (bedH * 60 + bedM)
  if (duration < 0) duration += 24 * 60
  return Math.round((duration / 60) * 10) / 10
}

// 是否有睡眠数据
const hasSleepData = computed(() => {
  return sleepData.value.some(d => d.duration !== null)
})

// 睡眠图表数据点
const sleepChartPoints = computed(() => {
  return sleepData.value.map((item, index) => ({
    x: getXPosition(index),
    y: getYPosition(item.duration || 0),
    value: item.duration || 0
  }))
})

const sleepLinePoints = computed(() => {
  return sleepChartPoints.value.map(p => `${p.x},${p.y}`).join(' ')
})

// 喝水汇总
const waterSummary = computed(() => {
  const total = waterData.value.reduce((sum, d) => sum + d.total, 0)
  const average = waterData.value.length > 0 ? Math.round(total / waterData.value.length) : 0
  const achievedDays = waterData.value.filter(d => d.total >= waterTarget.value).length
  return { total, average, achievedDays }
})

// 睡眠汇总
const sleepSummary = computed(() => {
  const durations = sleepData.value.filter(d => d.duration !== null).map(d => d.duration)
  if (durations.length === 0) return { average: 0, max: 0, min: 0 }
  const average = (durations.reduce((sum, d) => sum + d, 0) / durations.length).toFixed(1)
  const max = Math.max(...durations).toFixed(1)
  const min = Math.min(...durations).toFixed(1)
  return { average, max, min }
})

/**
 * 计算 X 坐标
 */
function getXPosition (index) {
  const count = sleepData.value.length || 1
  const width = chartWidth - padding.left - padding.right
  return padding.left + (width / (count - 1 || 1)) * index
}

/**
 * 计算 Y 坐标
 */
function getYPosition (hours) {
  const maxHours = 12
  const height = chartHeight - padding.top - padding.bottom
  return padding.top + height - (hours / maxHours) * height
}

/**
 * 喝水柱状图高度
 */
function getWaterBarHeight (total) {
  const max = Math.max(waterTarget.value * 1.2, ...waterData.value.map(d => d.total), 100)
  return Math.max(2, (total / max) * 100)
}

/**
 * 完成率颜色
 */
function getCompletionColor (percentage) {
  if (percentage >= 80) return '#67c23a'
  if (percentage >= 50) return '#409eff'
  if (percentage >= 20) return '#e6a23c'
  return '#f56c6c'
}

/**
 * 完成率标签类型（子需求8）
 */
function getCompletionTagType (percentage) {
  if (percentage >= 80) return 'success'
  if (percentage >= 50) return 'primary'
  if (percentage >= 20) return 'warning'
  return 'danger'
}

/**
 * 饮食完成率标签类型
 */
function getDietTagType (completion) {
  if (completion >= 100) return 'success'
  if (completion >= 67) return 'warning'
  return 'info'
}

/**
 * 加载所有统计数据
 */
async function loadAllStats () {
  loading.value = true
  try {
    await Promise.all([
      loadWaterStats(),
      loadSleepStats(),
      loadDietStats(),
      loadCompletionStats()  // 子需求8：加载久坐伸展/护眼完成率
    ])
    computeCompletionData()
  } catch (error) {
    console.error('加载统计数据失败:', error.message)
  } finally {
    loading.value = false
  }
}

/**
 * 加载久坐伸展/护眼完成率统计（子需求8）
 */
async function loadCompletionStats () {
  try {
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(statsDays.value - 1, 'day').format('YYYY-MM-DD')

    // 并行查询久坐伸展和护眼的完成率
    const [sedentaryResult, eyeResult] = await Promise.all([
      healthStore.fetchCompletionStats('sedentary', startDate, endDate),
      healthStore.fetchCompletionStats('eye', startDate, endDate)
    ])

    sedentaryCompletion.value = sedentaryResult || { total: 0, completed: 0, rate: 0, daily: [] }
    eyeCompletion.value = eyeResult || { total: 0, completed: 0, rate: 0, daily: [] }
  } catch (error) {
    console.error('加载完成率统计失败:', error.message)
    // 失败时使用空数据
    sedentaryCompletion.value = { total: 0, completed: 0, rate: 0, daily: [] }
    eyeCompletion.value = { total: 0, completed: 0, rate: 0, daily: [] }
  }
}

/**
 * 加载喝水统计
 */
async function loadWaterStats () {
  try {
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(statsDays.value - 1, 'day').format('YYYY-MM-DD')
    const result = await healthStore.fetchRecords('water', startDate, endDate, { size: 500 })

    // 获取目标值
    const config = healthStore.getConfig('water')
    waterTarget.value = config.config_json?.target_ml || 2000

    // 按日聚合
    const dailyMap = {}
    for (let i = statsDays.value - 1; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD')
      dailyMap[date] = { date, total: 0, dateLabel: dayjs().subtract(i, 'day').format('M/D') }
    }

    if (result && Array.isArray(result.list)) {
      for (const record of result.list) {
        if (dailyMap[record.record_date]) {
          dailyMap[record.record_date].total += record.value || 0
        }
      }
    }

    waterData.value = Object.values(dailyMap)
  } catch (error) {
    console.error('加载喝水统计失败:', error.message)
  }
}

/**
 * 加载睡眠统计
 */
async function loadSleepStats () {
  try {
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(statsDays.value - 1, 'day').format('YYYY-MM-DD')
    const result = await healthStore.fetchRecords('sleep', startDate, endDate, { size: 500 })

    const dailyMap = {}
    for (let i = statsDays.value - 1; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD')
      dailyMap[date] = {
        date,
        bedtime: null,
        wakeup: null,
        duration: null,
        dateLabel: dayjs().subtract(i, 'day').format('M/D')
      }
    }

    if (result && Array.isArray(result.list)) {
      // 记录按 record_time DESC 排序，每日取最新的入睡/起床记录
      const foundFlags = {}
      for (const record of result.list) {
        const day = dailyMap[record.record_date]
        if (!day) continue
        const flagKey = `${record.record_date}-${record.value}`
        if (foundFlags[flagKey]) continue
        const time = dayjs(record.record_time)
        if (record.value === 1) {
          day.bedtime = time.format('HH:mm')
          foundFlags[flagKey] = true
        } else if (record.value === 2) {
          day.wakeup = time.format('HH:mm')
          foundFlags[flagKey] = true
        }
      }
    }

    for (const day of Object.values(dailyMap)) {
      day.duration = calculateSleepDuration(day.bedtime, day.wakeup)
    }

    sleepData.value = Object.values(dailyMap)
  } catch (error) {
    console.error('加载睡眠统计失败:', error.message)
  }
}

/**
 * 加载饮食统计
 */
async function loadDietStats () {
  try {
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(statsDays.value - 1, 'day').format('YYYY-MM-DD')
    const result = await healthStore.fetchRecords('diet', startDate, endDate, { size: 500 })

    const dailyMap = {}
    for (let i = statsDays.value - 1; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD')
      dailyMap[date] = {
        date,
        dateLabel: dayjs(date).format('M月D日'),
        breakfast: '',
        lunch: '',
        dinner: '',
        completion: 0
      }
    }

    if (result && Array.isArray(result.list)) {
      for (const record of result.list) {
        const day = dailyMap[record.record_date]
        if (!day) continue
        const mealKey = record.value === 1 ? 'breakfast' : (record.value === 2 ? 'lunch' : 'dinner')
        const content = record.content || ''
        const parts = content.split(': ')
        day[mealKey] = parts.length > 1 ? parts.slice(1).join(': ') : content
      }
    }

    for (const day of Object.values(dailyMap)) {
      const count = [day.breakfast, day.lunch, day.dinner].filter(v => v).length
      day.completion = Math.round((count / 3) * 100)
    }

    dietData.value = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date))
  } catch (error) {
    console.error('加载饮食统计失败:', error.message)
  }
}

/**
 * 计算各模块完成率
 * 子需求8：久坐伸展/护眼完成率从数据库查询（已完成次数/总提醒次数）
 */
function computeCompletionData () {
  const result = []

  // 喝水完成率
  const waterAchieved = waterSummary.value.achievedDays
  const waterPercent = waterData.value.length > 0
    ? Math.round((waterAchieved / waterData.value.length) * 100)
    : 0
  result.push({
    type: 'water',
    name: '喝水',
    icon: '💧',
    percentage: waterPercent,
    detail: `${waterAchieved}/${waterData.value.length} 天达标，日均 ${waterSummary.value.average}ml`
  })

  // 久坐伸展完成率（子需求8：从数据库查询）
  // 口径：已完成次数/提醒次数（含完成+跳过+超时未响应），未响应提醒也计为未完成
  const sedentaryData = sedentaryCompletion.value
  result.push({
    type: 'sedentary',
    name: '久坐伸展',
    icon: '🪑',
    percentage: sedentaryData.rate,
    detail: sedentaryData.total > 0
      ? `${sedentaryData.completed}/${sedentaryData.total} 次完成，完成率 ${sedentaryData.rate}%`
      : '暂无久坐伸展提醒记录'
  })

  // 护眼完成率（子需求8：从数据库查询）
  // 口径：已完成次数/提醒次数（含完成+跳过+超时未响应），未响应提醒也计为未完成
  const eyeData = eyeCompletion.value
  result.push({
    type: 'eye',
    name: '护眼',
    icon: '👁️',
    percentage: eyeData.rate,
    detail: eyeData.total > 0
      ? `${eyeData.completed}/${eyeData.total} 次完成，完成率 ${eyeData.rate}%`
      : '暂无护眼提醒记录'
  })

  // 睡眠完成率（基于理想时长达成率）
  // 理想时长从用户配置的 target_bedtime/target_wakeup 计算，与 SleepPanel 保持一致
  const sleepConfig = healthStore.getConfig('sleep')
  const sleepConfigJson = sleepConfig?.config_json || {}
  const idealDuration = calculateSleepDuration(
    sleepConfigJson.target_bedtime || '23:00',
    sleepConfigJson.target_wakeup || '07:00'
  ) || 8
  const sleepDurations = sleepData.value.filter(d => d.duration !== null).map(d => d.duration)
  if (sleepData.value.length > 0) {
    // 分母用所有天（含未记录），未记录天视为未达标，避免只记录 1 天达标就 100%
    const achievedCount = sleepDurations.filter(d => Math.abs(d - idealDuration) <= 1).length
    const sleepPercent = Math.round((achievedCount / sleepData.value.length) * 100)
    result.push({
      type: 'sleep',
      name: '睡眠',
      icon: '😴',
      percentage: sleepPercent,
      detail: `${achievedCount}/${sleepData.value.length} 天达标（理想 ${idealDuration.toFixed(1)}h），平均 ${sleepSummary.value.average}h`
    })
  } else {
    result.push({
      type: 'sleep',
      name: '睡眠',
      icon: '😴',
      percentage: 0,
      detail: '暂无睡眠数据'
    })
  }

  // 饮食完成率
  const dietCompleted = dietData.value.filter(d => d.completion >= 100).length
  const dietPercent = dietData.value.length > 0
    ? Math.round((dietCompleted / dietData.value.length) * 100)
    : 0
  result.push({
    type: 'diet',
    name: '饮食',
    icon: '🍽️',
    percentage: dietPercent,
    detail: `${dietCompleted}/${dietData.value.length} 天三餐齐全`
  })

  completionData.value = result
}

onMounted(async () => {
  // 先加载配置（用于获取目标值等）
  try {
    await healthStore.fetchConfigs()
  } catch (error) {
    console.error('加载配置失败:', error.message)
  }
  await loadAllStats()
})
</script>

<style scoped lang="scss">
.health-stats-view {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;

  .page-title {
    margin: 0;
    font-size: 24px;
    color: #303133;
  }

  .header-actions {
    display: flex;
    gap: 12px;
    align-items: center;
  }
}

.completion-card {
  margin-bottom: 16px;

  .completion-item {
    padding: 16px;
    border-radius: 8px;
    border: 1px solid #ebeef5;
    margin-bottom: 16px;

    .completion-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;

      .completion-icon {
        font-size: 24px;
      }

      .completion-name {
        font-size: 16px;
        font-weight: bold;
        color: #303133;
      }
    }

    .completion-text {
      font-size: 14px;
      font-weight: bold;
    }

    .completion-detail {
      margin-top: 8px;
      font-size: 13px;
      color: #909399;
    }
  }
}

.chart-card {
  margin-bottom: 16px;
}

.bar-chart {
  .chart-container {
    display: flex;
    align-items: flex-end;
    justify-content: space-around;
    height: 240px;
    padding: 20px 10px 0;
    border-bottom: 1px solid #ebeef5;
  }

  .bar-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    height: 100%;
  }

  .bar-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .bar {
    width: 60%;
    min-height: 4px;
    border-radius: 4px 4px 0 0;
    transition: height 0.3s ease;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    position: relative;
  }

  .bar-value {
    position: absolute;
    top: -20px;
    font-size: 11px;
    color: #606266;
    white-space: nowrap;
  }

  .bar-label {
    margin-top: 8px;
    font-size: 12px;
    color: #909399;
  }
}

.chart-summary {
  margin-top: 20px;
}

.line-chart {
  .chart-svg {
    width: 100%;
    height: 300px;
  }
}

.diet-stats {
  .no-record {
    color: #c0c4cc;
  }
}

// 完成率趋势图样式（子需求8）
.completion-trend {
  display: flex;
  flex-direction: column;
  gap: 24px;

  .trend-item {
    .trend-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;

      .trend-icon {
        font-size: 20px;
      }

      .trend-name {
        font-size: 15px;
        font-weight: bold;
        color: #303133;
      }
    }

    .trend-bars {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      height: 120px;
      padding: 10px 0 0;
      border-bottom: 1px solid #ebeef5;
    }

    .trend-bar-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      height: 100%;
    }

    .trend-bar-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }

    .trend-bar {
      width: 70%;
      min-height: 2px;
      border-radius: 4px 4px 0 0;
      transition: height 0.3s ease;

    }

    .trend-bar-label {
      margin-top: 6px;
      font-size: 11px;
      color: #909399;
    }
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark .health-stats-view {
  .page-header .page-title {
    color: #e5eaf3;
  }

  .completion-card .completion-item {
    border-color: #414243;

    .completion-header .completion-name {
      color: #e5eaf3;
    }

    .completion-detail {
      color: #a3a6ad;
    }
  }

  .bar-chart {
    .chart-container {
      border-bottom-color: #414243;
    }

    .bar-value {
      color: #cfd3dc;
    }

    .bar-label {
      color: #a3a6ad;
    }
  }

  .diet-stats .no-record {
    color: #8d9095;
  }

  .completion-trend .trend-item {
    .trend-header .trend-name {
      color: #e5eaf3;
    }

    .trend-bars {
      border-bottom-color: #414243;
    }

    .trend-bar-label {
      color: #a3a6ad;
    }
  }

  // SVG 图表暗色适配：网格线与坐标轴文字
  .line-chart .chart-svg {
    .grid-lines line {
      stroke: #414243;
    }

    .grid-lines text {
      fill: #a3a6ad;
    }

    .data-points text {
      fill: #cfd3dc;
    }

    .x-labels text {
      fill: #a3a6ad;
    }
  }
}
</style>