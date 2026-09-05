<!--
  睡眠子模块面板
  功能：配置理想作息、记录入睡/起床时间、查看睡眠时长趋势
-->
<template>
  <div class="sleep-panel">
    <!-- 配置区 -->
    <el-card class="config-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>😴 睡眠提醒配置</span>
          <el-switch
            :model-value="isEnabled"
            @change="handleToggle"
            active-text="启用"
            inactive-text="禁用"
          />
        </div>
      </template>

        <el-form :model="form" label-width="120px">
          <el-form-item label="理想入睡时间">
            <el-time-picker
              ref="bedtimePicker"
              v-model="form.target_bedtime"
              format="HH:mm"
              value-format="HH:mm"
              placeholder="选择入睡时间"
              style="width: 200px"
              @change="handleAutoSave"
            />
            <span class="unit-hint">建议 22:00-23:30</span>
          </el-form-item>
          <el-form-item label="理想起床时间">
            <el-time-picker
              ref="wakeupPicker"
              v-model="form.target_wakeup"
              format="HH:mm"
              value-format="HH:mm"
              placeholder="选择起床时间"
              style="width: 200px"
              @change="handleAutoSave"
            />
            <span class="unit-hint">建议 06:00-08:00</span>
          </el-form-item>
          <el-form-item label="发布渠道">
            <el-checkbox-group v-model="form.channels" @change="handleAutoSave">
              <el-checkbox value="notification">系统通知</el-checkbox>
              <el-checkbox value="popup">应用通知</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </el-form>

      <!-- 理想睡眠时长展示（编辑模式外显示） -->
      <div class="ideal-duration" v-if="savedConfig.target_bedtime && savedConfig.target_wakeup && idealDurationHours > 0">
        <span>理想睡眠时长：{{ idealDuration }} 小时</span>
      </div>
    </el-card>

    <!-- 今日睡眠记录区 -->
    <el-card class="record-card" shadow="never">
      <template #header>
        <span>📝 今日睡眠记录</span>
      </template>

      <el-form :inline="true" :model="todayRecord" label-width="80px">
        <el-form-item label="入睡时间">
          <el-time-picker
            v-model="todayRecord.bedtime"
            format="HH:mm"
            value-format="HH:mm"
            placeholder="记录入睡时间"
            style="width: 160px"
          />
          <el-tag v-if="recordSource.bedtime === 'auto'" size="small" type="info" style="margin-left: 8px">自动</el-tag>
        </el-form-item>
        <el-form-item label="起床时间">
          <el-time-picker
            v-model="todayRecord.wakeup"
            format="HH:mm"
            value-format="HH:mm"
            placeholder="记录起床时间"
            style="width: 160px"
          />
          <el-tag v-if="recordSource.wakeup === 'auto'" size="small" type="info" style="margin-left: 8px">自动</el-tag>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSaveRecord" :loading="recording">保存记录</el-button>
        </el-form-item>
      </el-form>

      <!-- 自动记录提示 -->
      <el-alert
        v-if="recordSource.bedtime === 'auto' || recordSource.wakeup === 'auto'"
        title="系统已自动记录睡眠时间（挂起/恢复/锁屏/解锁），可手动修改后保存覆盖"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      />

      <!-- 睡眠时长与偏离状态 -->
      <div class="sleep-status" v-if="todaySleepDuration !== null">
        <el-alert
          :title="`今日睡眠时长：${todaySleepDuration} 小时`"
          :type="deviationType"
          :description="deviationText"
          show-icon
          :closable="false"
        />
      </div>
      <el-alert
        v-else-if="todayRecord.bedtime || todayRecord.wakeup"
        title="数据不完整"
        description="请同时记录入睡时间和起床时间，才能计算睡眠时长"
        type="warning"
        show-icon
        :closable="false"
      />
    </el-card>

    <!-- 最近 7 天睡眠时长折线图 -->
    <el-card class="history-card" shadow="never">
      <template #header>
        <span>📈 最近 7 天睡眠时长趋势</span>
      </template>

      <div class="line-chart" v-if="historyData.length > 0">
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

          <!-- 理想睡眠时长参考线 -->
          <line
            v-if="idealDurationHours > 0"
            :x1="padding.left"
            :y1="getYPosition(idealDurationHours)"
            :x2="chartWidth - padding.right"
            :y2="getYPosition(idealDurationHours)"
            stroke="#67c23a"
            stroke-dasharray="6,3"
            stroke-width="1.5"
          />
          <text
            v-if="idealDurationHours > 0"
            :x="chartWidth - padding.right"
            :y="getYPosition(idealDurationHours) - 6"
            text-anchor="end"
            fill="#67c23a"
            font-size="11"
          >理想 {{ idealDuration }}h</text>

          <!-- 折线 -->
          <polyline
            :points="linePoints"
            fill="none"
            stroke="#409eff"
            stroke-width="2"
          />

          <!-- 数据点 -->
          <g class="data-points">
            <circle
              v-for="(point, index) in chartPoints"
              :key="index"
              :cx="point.x"
              :cy="point.y"
              r="4"
              fill="#409eff"
            />
            <text
              v-for="(point, index) in chartPoints"
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
              v-for="(item, index) in historyData"
              :key="`x-${index}`"
              :x="getXPosition(index)"
              :y="chartHeight - padding.bottom + 20"
              text-anchor="middle"
              fill="#909399"
              font-size="12"
            >{{ item.dateLabel }}</text>
          </g>
        </svg>
      </div>
      <el-empty v-else description="暂无睡眠历史数据" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import { useHealthStore } from '@/stores/health-store'

const healthStore = useHealthStore()

// 配置表单
const form = reactive({
  target_bedtime: '23:00',
  target_wakeup: '07:00',
  channels: ['notification', 'popup']
})

// 启用状态：computed 绑定到 store，确保与数据库同步（子需求5）
const isEnabled = computed(() => healthStore.isModuleEnabled('sleep'))
// 立即保存模式下无需暂存启用状态，直接绑定到 store
const pendingEnabled = computed(() => isEnabled.value)
const saving = ref(false)
const recording = ref(false)
// 标记表单是否已从 store 初始化过，防止后续挂载覆盖用户编辑中的值
const formInitialized = ref(false)

// 已保存的配置（来自 store，用于理想睡眠时长展示）
const savedConfig = computed(() => {
  const config = healthStore.getConfig('sleep')
  return config.config_json || {}
})

// 今日睡眠记录
const todayRecord = reactive({
  bedtime: '',
  wakeup: ''
})

// 记录来源标记（auto=自动记录, manual=手动修改）
const recordSource = reactive({
  bedtime: '',
  wakeup: ''
})

// 历史数据
const historyData = ref([])

// 图表尺寸
const chartWidth = 700
const chartHeight = 300
const padding = { top: 30, right: 40, bottom: 40, left: 50 }

/**
 * 计算两个时间点之间的睡眠时长（小时）
 * 处理跨夜情况（如 23:00 入睡，07:00 起床）
 */
function calculateSleepDuration (bedtime, wakeup) {
  if (!bedtime || !wakeup) return null
  const [bedH, bedM] = bedtime.split(':').map(Number)
  const [wakeH, wakeM] = wakeup.split(':').map(Number)
  let duration = (wakeH * 60 + wakeM) - (bedH * 60 + bedM)
  // 跨夜：起床时间小于入睡时间，加 24 小时
  if (duration < 0) duration += 24 * 60
  return Math.round((duration / 60) * 10) / 10 // 保留 1 位小数
}

// 理想睡眠时长
const idealDurationHours = computed(() => {
  return calculateSleepDuration(form.target_bedtime, form.target_wakeup) || 0
})

const idealDuration = computed(() => idealDurationHours.value.toFixed(1))

// 今日睡眠时长
const todaySleepDuration = computed(() => {
  return calculateSleepDuration(todayRecord.bedtime, todayRecord.wakeup)
})

// 偏离状态类型
const deviationType = computed(() => {
  if (todaySleepDuration.value === null) return 'info'
  const diff = Math.abs(todaySleepDuration.value - idealDurationHours.value)
  if (diff <= 1) return 'success'
  if (diff <= 2) return 'warning'
  return 'error'
})

// 偏离状态文字
const deviationText = computed(() => {
  if (todaySleepDuration.value === null) return ''
  const diff = todaySleepDuration.value - idealDurationHours.value
  if (Math.abs(diff) <= 1) return '作息规律，睡眠时长接近理想值'
  if (diff > 0) return `比理想时长多 ${diff.toFixed(1)} 小时，注意避免睡眠过多`
  return `比理想时长少 ${Math.abs(diff).toFixed(1)} 小时，建议调整作息`
})

// 图表数据点坐标
const chartPoints = computed(() => {
  return historyData.value.map((item, index) => ({
    x: getXPosition(index),
    y: getYPosition(item.duration || 0),
    value: item.duration || 0
  }))
})

// 折线 points 属性
const linePoints = computed(() => {
  return chartPoints.value.map(p => `${p.x},${p.y}`).join(' ')
})

/**
 * 计算 X 坐标
 */
function getXPosition (index) {
  const count = historyData.value.length || 1
  const width = chartWidth - padding.left - padding.right
  return padding.left + (width / (count - 1 || 1)) * index
}

/**
 * 计算 Y 坐标（0-12 小时范围）
 */
function getYPosition (hours) {
  const maxHours = 12
  const height = chartHeight - padding.top - padding.bottom
  return padding.top + height - (hours / maxHours) * height
}

/**
 * 加载配置
 */
async function loadConfig () {
  // 确保 store 配置已加载（子需求5）
  if (!healthStore.configs || !healthStore.configs.sleep) {
    await healthStore.fetchConfigs()
  }
  const config = healthStore.getConfig('sleep')
  const configJson = config.config_json || {}
  // 仅首次挂载时从 store 填充表单；若用户已在当前会话编辑过则不覆盖，避免切回页面丢失未保存输入
  if (!formInitialized.value) {
    form.target_bedtime = configJson.target_bedtime || '23:00'
    form.target_wakeup = configJson.target_wakeup || '07:00'
    form.channels = Array.isArray(configJson.channels) ? [...configJson.channels] : ['notification', 'popup']
    formInitialized.value = true
  }
}

/**
 * 切换启用状态（立即保存）
 */
async function handleToggle (enabled) {
  saving.value = true
  try {
    await healthStore.updateConfig('sleep', { ...form }, enabled)
    ElMessage.success(enabled ? '睡眠提醒已启用' : '睡眠提醒已禁用')
  } catch (error) {
    ElMessage.error('保存失败：' + error.message)
  } finally {
    saving.value = false
  }
}

/**
 * 自动保存配置（防抖）
 */
let saveTimer = null
function handleAutoSave () {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await healthStore.updateConfig('sleep', { ...form }, pendingEnabled.value)
    } catch (error) {
      console.error('自动保存失败:', error.message)
    }
  }, 300)
}

/**
 * 保存今日睡眠记录（子需求6：支持手动修改，先删除旧记录再写入新记录）
 */
async function handleSaveRecord () {
  if (!todayRecord.bedtime && !todayRecord.wakeup) {
    ElMessage.warning('请至少记录入睡或起床时间')
    return
  }

  recording.value = true
  try {
    const today = dayjs().format('YYYY-MM-DD')

    // 手动修改：先删除今日旧记录，再写入新记录
    if (todayRecord.bedtime) {
      await healthStore.deleteSleepRecord(today, 1)
      await healthStore.autoRecordSleep('suspend', todayRecord.bedtime, today)
    }
    if (todayRecord.wakeup) {
      await healthStore.deleteSleepRecord(today, 2)
      await healthStore.autoRecordSleep('resume', todayRecord.wakeup, today)
    }
    ElMessage.success('睡眠记录已保存')
    await loadHistory()
    await loadTodayRecord()
  } catch (error) {
    ElMessage.error('保存失败：' + error.message)
  } finally {
    recording.value = false
  }
}

/**
 * 加载今日睡眠记录
 * records 按 record_time DESC 排序（最新的在前），取第一条匹配的记录
 */
async function loadTodayRecord () {
  try {
    const result = await healthStore.fetchTodayStats('sleep')
    if (result && Array.isArray(result.records)) {
      // 遍历记录（最新的在前），首次匹配到的入睡/起床时间即为最新值
      let bedtimeFound = false
      let wakeupFound = false
      for (const record of result.records) {
        // value=1 表示入睡，value=2 表示起床
        if (record.value === 1 && !bedtimeFound) {
          const time = dayjs(record.record_time)
          todayRecord.bedtime = time.format('HH:mm')
          // 标记记录来源（自动记录 vs 手动修改）
          recordSource.bedtime = record.content?.includes('自动') ? 'auto' : 'manual'
          bedtimeFound = true
        } else if (record.value === 2 && !wakeupFound) {
          const time = dayjs(record.record_time)
          todayRecord.wakeup = time.format('HH:mm')
          recordSource.wakeup = record.content?.includes('自动') ? 'auto' : 'manual'
          wakeupFound = true
        }
        // 两条都已找到，提前退出
        if (bedtimeFound && wakeupFound) break
      }
    }
  } catch (error) {
    console.error('加载今日睡眠记录失败:', error.message)
  }
}

/**
 * 加载最近 7 天睡眠历史
 * records 按 record_time DESC 排序，每日取最新的入睡/起床记录
 */
async function loadHistory () {
  try {
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(6, 'day').format('YYYY-MM-DD')
    const result = await healthStore.fetchRecords('sleep', startDate, endDate, { size: 200 })

    // 按日聚合
    const dailyMap = {}
    for (let i = 6; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD')
      dailyMap[date] = { date, bedtime: null, wakeup: null, duration: null, dateLabel: dayjs().subtract(i, 'day').format('M/D') }
    }

    if (result && Array.isArray(result.list)) {
      // 记录按 record_time DESC 排序，首次匹配到的即为最新值
      const foundFlags = {} // { 'date-1': true, 'date-2': true }
      for (const record of result.list) {
        const day = dailyMap[record.record_date]
        if (!day) continue
        const flagKey = `${record.record_date}-${record.value}`
        if (foundFlags[flagKey]) continue // 已找到最新的，跳过旧记录
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

    // 计算每日睡眠时长
    for (const day of Object.values(dailyMap)) {
      day.duration = calculateSleepDuration(day.bedtime, day.wakeup)
    }

    historyData.value = Object.values(dailyMap)
  } catch (error) {
    console.error('加载睡眠历史失败:', error.message)
  }
}

onMounted(async () => {
  await loadConfig()
  await loadTodayRecord()
  await loadHistory()
})
</script>

<style scoped lang="scss">
.sleep-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.unit-hint {
  margin-left: 12px;
  color: #909399;
  font-size: 13px;
}

.ideal-duration {
  margin-top: 16px;
}

.sleep-status {
  margin-top: 16px;
}

.line-chart {
  .chart-svg {
    width: 100%;
    height: 300px;
  }
}

// 配置只读展示样式
.config-readonly {
  .config-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #f0f0f0;

    &:last-child {
      border-bottom: none;
    }

    .config-label {
      color: var(--el-text-color-secondary);
      font-size: 13px;
      flex-shrink: 0;
    }

    .config-value {
      color: var(--el-text-color-primary);
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .config-text {
      font-weight: normal;
      max-width: 300px;
      word-break: break-all;
    }

    .config-hint {
      color: var(--el-text-color-placeholder);
      font-size: 12px;
    }

    .config-channels {
      display: flex;
      gap: 4px;
    }
  }
}

// 编辑入口按钮样式
:deep(.el-button--primary.is-link) {
  font-size: 13px;
  padding: 0 4px;
}

// 暗色模式适配
html.dark .sleep-panel {
  .unit-hint {
    color: #a3a6ad;
  }

  .config-readonly .config-row {
    border-bottom-color: #414243;
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