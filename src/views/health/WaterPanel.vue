<!--
  喝水子模块面板
  功能：配置喝水提醒、记录饮水量、查看饮水趋势
-->
<template>
  <div class="water-panel">
    <!-- 配置区 + 状态区（左右双栏） -->
    <div class="config-status-row">
    <!-- 配置区 -->
    <el-card class="config-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>💧 喝水提醒配置</span>
          <el-switch
            :model-value="isEnabled"
            @change="handleToggle"
            active-text="启用"
            inactive-text="禁用"
          />
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-form-item label="每日目标">
          <el-input-number
            v-model="form.target_ml"
            :min="500"
            :max="10000"
            :step="100"
            style="width: 200px"
            @blur="handleAutoSave"
            @change="handleAutoSave"
          />
          <span class="unit-hint">ml（建议 2000，500-10000）</span>
        </el-form-item>
        <el-form-item label="提醒间隔">
          <el-input-number
            v-model="form.interval_minutes"
            :min="1"
            :max="1440"
            :step="5"
            style="width: 200px"
            @blur="handleAutoSave"
            @change="handleAutoSave"
          />
          <span class="unit-hint">分钟（建议 60，1-1440）</span>
        </el-form-item>
        <el-form-item label="每杯容量">
          <el-input-number
            v-model="form.cup_size_ml"
            :min="50"
            :max="500"
            :step="50"
            style="width: 200px"
            @blur="handleAutoSave"
            @change="handleAutoSave"
          />
          <span class="unit-hint">ml（灵动岛快速记录用，建议 200）</span>
        </el-form-item>
        <el-form-item label="发布渠道">
          <el-checkbox-group v-model="form.channels" @change="handleAutoSave">
            <el-checkbox value="notification">系统通知</el-checkbox>
            <el-checkbox value="popup">应用通知</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 状态区 -->
    <el-card class="status-card" shadow="never">
      <template #header>
        <span>⏱️ 提醒状态</span>
      </template>

      <div class="countdown-area" v-if="isEnabled">
        <div class="countdown-display">
          <div class="countdown-circle" :class="{ warning: isWarning }">
            <div class="countdown-time">{{ countdownDisplay }}</div>
            <div class="countdown-label">距下次喝水提醒</div>
          </div>
        </div>

        <div class="status-info">
          <el-tag type="success" size="large">运行中</el-tag>
          <span class="info-text">
            间隔 {{ savedConfig.interval_minutes || form.interval_minutes }} 分钟 / 目标 {{ form.target_ml }} ml
          </span>
        </div>

        <el-button type="primary" plain @click="handleStartNow">立即提醒喝水</el-button>
      </div>

      <el-empty v-else description="请先启用喝水提醒" />
    </el-card>
    </div>

    <el-card class="record-card" shadow="never">
      <template #header>
        <span>📊 今日饮水量</span>
      </template>

      <div class="today-progress">
        <el-progress
          :percentage="todayPercent"
          :format="formatProgress"
          :stroke-width="20"
          :color="progressColor"
        />
        <div class="progress-info">
          <span class="current">{{ todayTotal }} ml</span>
          <span class="separator">/</span>
          <span class="target">{{ form.target_ml }} ml</span>
        </div>
      </div>

      <!-- 快速记录按钮 -->
      <div class="quick-record">
        <span class="quick-label">快速记录：</span>
        <el-button type="primary" plain @click="handleQuickAdd(200)">+200ml</el-button>
        <el-button type="primary" plain @click="handleQuickAdd(300)">+300ml</el-button>
        <el-button type="primary" plain @click="handleQuickAdd(500)">+500ml</el-button>
        <el-input
          v-model="customAmount"
          placeholder="自定义"
          type="number"
          :min="1"
          style="width: 150px; margin-left: 8px"
          @input="sanitizeCustomAmount"
        >
          <template #append>ml</template>
        </el-input>
        <el-button type="primary" @click="handleCustomAdd" :disabled="!customAmount || customAmount <= 0">记录</el-button>
      </div>
    </el-card>

    <!-- 最近 7 天饮水趋势图 -->
    <el-card class="history-card" shadow="never">
      <template #header>
        <span>📈 最近 7 天饮水趋势</span>
      </template>

      <div class="bar-chart" v-if="historyData.length > 0">
        <div class="chart-container">
          <div
            v-for="item in historyData"
            :key="item.date"
            class="bar-item"
          >
            <div class="bar-wrapper">
              <div
                class="bar"
                :style="{
                  height: getBarHeight(item.total) + '%',
                  backgroundColor: getBarColor(item.total)
                }"
              >
                <span class="bar-value" v-if="item.total > 0">{{ item.total }}</span>
              </div>
              <div class="bar-target-line" :style="{ bottom: getTargetLinePosition() + '%' }"></div>
            </div>
            <div class="bar-label">{{ item.dateLabel }}</div>
          </div>
        </div>
        <div class="chart-legend">
          <span class="legend-item">
            <span class="legend-color" style="backgroundColor: #409eff"></span>
            已达标
          </span>
          <span class="legend-item">
            <span class="legend-color" style="backgroundColor: #e6a23c"></span>
            未达标
          </span>
          <span class="legend-item">
            <span class="legend-line"></span>
            目标线 ({{ form.target_ml }}ml)
          </span>
        </div>
      </div>
      <el-empty v-else description="暂无历史数据" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { useHealthStore } from '@/stores/health-store'
import { healthApi } from '@/utils/ipc-client'

const healthStore = useHealthStore()

// 配置表单
const form = reactive({
  target_ml: 2000,
  interval_minutes: 60,
  cup_size_ml: 200,
  channels: ['notification', 'popup']
})

// 标记表单是否已从 store 初始化过，防止后续挂载覆盖用户编辑中的值
const formInitialized = ref(false)

// 启用状态：computed 绑定到 store，确保与数据库同步（子需求5）
const isEnabled = computed(() => healthStore.isModuleEnabled('water'))
// savedConfig 用于配置展示
const savedConfig = computed(() => {
  const config = healthStore.getConfig('water')
  return config?.config_json || {}
})
const saving = ref(false)
const customAmount = ref('')

// 倒计时剩余秒数
const remainingSeconds = ref(60 * 60)
let countdownTimer = null

// 倒计时显示文字
const countdownDisplay = computed(() => {
  const total = Math.max(0, remainingSeconds.value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

// 是否接近提醒时间（剩余 5 分钟内）
const isWarning = computed(() => {
  return remainingSeconds.value <= 300 && remainingSeconds.value > 0
})

/**
 * 启动倒计时
 */
function startCountdown () {
  stopCountdown()
  countdownTimer = setInterval(() => {
    if (!isEnabled.value) return
    if (remainingSeconds.value > 0) {
      remainingSeconds.value--
    } else {
      remainingSeconds.value = (savedConfig.value.interval_minutes || form.interval_minutes) * 60
    }
  }, 1000)
}

/**
 * 停止倒计时
 */
function stopCountdown () {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

/**
 * 重置倒计时
 */
function resetCountdown () {
  remainingSeconds.value = (savedConfig.value.interval_minutes || form.interval_minutes) * 60
}

/**
 * 从主进程同步倒计时（基于最后提醒时间计算真实剩余，避免切页重置）
 */
async function syncCountdownFromServer () {
  const interval = (savedConfig.value.interval_minutes || form.interval_minutes) * 60
  try {
    const times = await healthApi.getLastReminded()
    const last = times?.water
    if (last) {
      const elapsed = Math.floor((Date.now() - last) / 1000)
      const remaining = interval - elapsed
      remainingSeconds.value = remaining > 0 ? remaining : interval
    } else {
      remainingSeconds.value = interval
    }
  } catch {
    remainingSeconds.value = interval
  }
}

/**
 * 立即触发喝水提醒
 * 通过 IPC 调用主进程 notificationService 发送五重通知（含灵动岛）
 */
async function handleStartNow () {
  try {
    await healthApi.triggerReminder('water')
  } catch (err) {
    console.error('[WaterPanel] 触发喝水提醒失败:', err.message)
    ElMessage.error('触发提醒失败: ' + err.message)
  }
  resetCountdown()
}

// 自动保存配置
let saveTimer = null
function handleAutoSave () {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await healthStore.updateConfig('water', { ...form }, isEnabled.value)
      resetCountdown()
    } catch (error) {
      console.error('自动保存失败:', error.message)
    }
  }, 300)
}

// 今日饮水量
const todayTotal = ref(0)

// 历史数据
const historyData = ref([])

// 今日进度百分比
const todayPercent = computed(() => {
  if (form.target_ml <= 0) return 0
  return Math.min(100, Math.round((todayTotal.value / form.target_ml) * 100))
})

// 进度条颜色
const progressColor = computed(() => {
  if (todayPercent.value >= 100) return '#67c23a'
  if (todayPercent.value >= 50) return '#409eff'
  return '#e6a23c'
})

/**
 * 格式化进度条文字
 */
function formatProgress (percentage) {
  return `${percentage}%`
}

/**
 * 加载配置
 */
async function loadConfig () {
  // 确保 store 配置已加载（子需求5）
  if (!healthStore.configs || !healthStore.configs.water) {
    await healthStore.fetchConfigs()
  }
  const config = healthStore.getConfig('water')
  const configJson = config?.config_json || {}
  // 仅首次挂载时从 store 填充表单；若用户已在当前会话编辑过则不覆盖，避免切回页面丢失未保存输入
  if (!formInitialized.value) {
    form.target_ml = configJson.target_ml || 2000
    form.interval_minutes = configJson.interval_minutes || 60
    form.cup_size_ml = configJson.cup_size_ml || 200
    form.channels = configJson.channels || ['notification', 'popup']
    formInitialized.value = true
  }

  await syncCountdownFromServer()
}

/**
 * 切换启用状态
 */
async function handleToggle (enabled) {
  saving.value = true
  try {
    await healthStore.updateConfig('water', { ...form }, enabled)
    ElMessage.success(enabled ? '喝水提醒已启用' : '喝水提醒已禁用')
    resetCountdown()
  } catch (error) {
    ElMessage.error('保存失败：' + error.message)
  } finally {
    saving.value = false
  }
}

/**

 * 快速记录饮水量
 */
async function handleQuickAdd (amount) {
  try {
    await healthStore.addWaterRecord(amount)
    todayTotal.value += amount
    ElMessage.success(`已记录 ${amount}ml 饮水`)
    await loadHistory()
  } catch (error) {
    ElMessage.error('记录失败：' + error.message)
  }
}

/**
 * 即时校验自定义饮水量：拦截负数、0 和非数字
 */
function sanitizeCustomAmount () {
  const raw = customAmount.value
  if (raw === '' || raw === null || raw === undefined) return
  const num = Number(raw)
  if (isNaN(num) || num <= 0) {
    customAmount.value = ''
  }
}

/**
 * 自定义饮水量记录
 */
async function handleCustomAdd () {
  const amount = parseInt(customAmount.value, 10)
  if (!amount || amount <= 0) {
    ElMessage.warning('请输入有效的饮水量')
    return
  }

  // 超过 2000ml 时提示确认
  if (amount > 2000) {
    try {
      await ElMessageBox.confirm(
        `数值较大（${amount}ml），确认保存？`,
        '提示',
        { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
  }

  try {
    await healthStore.addWaterRecord(amount)
    todayTotal.value += amount
    customAmount.value = ''
    ElMessage.success(`已记录 ${amount}ml 饮水`)
    await loadHistory()
  } catch (error) {
    ElMessage.error('记录失败：' + error.message)
  }
}

/**
 * 加载今日饮水量
 */
async function loadTodayTotal () {
  try {
    const result = await healthStore.fetchTodayStats('water')
    if (result && Array.isArray(result.records)) {
      todayTotal.value = result.records.reduce((sum, r) => sum + (r.value || 0), 0)
    }
  } catch (error) {
    console.error('加载今日饮水量失败:', error.message)
  }
}

/**
 * 加载最近 7 天历史数据
 */
async function loadHistory () {
  try {
    const endDate = dayjs().format('YYYY-MM-DD')
    const startDate = dayjs().subtract(6, 'day').format('YYYY-MM-DD')
    const result = await healthStore.fetchRecords('water', startDate, endDate, { size: 200 })

    // 按日聚合
    const dailyMap = {}
    for (let i = 6; i >= 0; i--) {
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

    historyData.value = Object.values(dailyMap)
  } catch (error) {
    console.error('加载历史数据失败:', error.message)
  }
}

/**
 * 计算柱状图高度百分比
 */
function getBarHeight (total) {
  const max = Math.max(form.target_ml * 1.2, ...historyData.value.map(d => d.total), 100)
  return Math.max(2, (total / max) * 100)
}

/**
 * 获取柱状图颜色
 */
function getBarColor (total) {
  return total >= form.target_ml ? '#409eff' : '#e6a23c'
}

/**
 * 目标线位置
 */
function getTargetLinePosition () {
  const max = Math.max(form.target_ml * 1.2, ...historyData.value.map(d => d.total), 100)
  return (form.target_ml / max) * 100
}

onMounted(async () => {
  await loadConfig()
  await loadTodayTotal()
  await loadHistory()
  startCountdown()
})

// 监听已保存的间隔变化，重置倒计时（仅在保存配置后触发，避免编辑时立即生效）
watch(() => savedConfig.value.interval_minutes, () => {
  if (isEnabled.value) resetCountdown()
})

onUnmounted(() => {
  stopCountdown()
})
</script>

<style scoped lang="scss">
.water-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

// 配置区 + 状态区左右双栏（窄屏自动堆叠）
.config-status-row {
  display: flex;
  gap: 16px;
  align-items: stretch;

  .config-card {
    flex: 1 1 58%;
    min-width: 0;
  }

  .status-card {
    flex: 1 1 42%;
    min-width: 0;
  }

  @media (max-width: 880px) {
    flex-direction: column;

    .config-card,
    .status-card {
      flex: 1 1 100%;
    }
  }
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

.countdown-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.countdown-display {
  display: flex;
  justify-content: center;
}

.countdown-circle {
  width: 180px;
  height: 180px;
  border-radius: 50%;
  border: 6px solid #409eff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #ecf5ff;
  transition: all 0.3s ease;

  &.warning {
    border-color: #e6a23c;
    background-color: #fdf6ec;
    animation: pulse 1s infinite;
  }

  .countdown-time {
    font-size: 42px;
    font-weight: bold;
    color: #303133;
    font-family: 'Courier New', monospace;
  }

  .countdown-label {
    margin-top: 8px;
    font-size: 14px;
    color: #909399;
  }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.status-info {
  display: flex;
  align-items: center;
  gap: 16px;

  .info-text {
    color: #606266;
    font-size: 14px;
  }
}

.today-progress {
  margin-bottom: 20px;

  .progress-info {
    margin-top: 8px;
    text-align: center;
    font-size: 16px;

    .current {
      color: #409eff;
      font-weight: bold;
    }

    .separator {
      margin: 0 8px;
      color: #c0c4cc;
    }

    .target {
      color: #909399;
    }
  }
}

.quick-record {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;

  .quick-label {
    color: #606266;
    margin-right: 4px;
  }
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
    z-index: 2;
  }

  .bar-value {
    position: absolute;
    top: -20px;
    font-size: 12px;
    color: #606266;
    white-space: nowrap;
  }

  .bar-target-line {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background-color: #f56c6c;
    border-top: 1px dashed #f56c6c;
    z-index: 1;
  }

  .bar-label {
    margin-top: 8px;
    font-size: 13px;
    color: #909399;
  }

  .chart-legend {
    display: flex;
    justify-content: center;
    gap: 24px;
    margin-top: 16px;
    font-size: 13px;
    color: #606266;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .legend-color {
    width: 12px;
    height: 12px;
    border-radius: 2px;
  }

  .legend-line {
    width: 16px;
    height: 0;
    border-top: 1px dashed #f56c6c;
  }
}


// 编辑入口按钮样式
:deep(.el-button--primary.is-link) {
  font-size: 13px;
  padding: 0 4px;
}

// 暗色模式适配
html.dark .water-panel {
  // 次要提示文字
  .unit-hint {
    color: #a3a6ad;
  }

  // 倒计时圆盘：浅色背景改为半透明主色
  .countdown-circle {
    background-color: rgba(64, 158, 255, 0.15);

    &.warning {
      background-color: rgba(230, 162, 60, 0.15);
    }

    .countdown-time {
      color: #e5eaf3;
    }

    .countdown-label {
      color: #a3a6ad;
    }
  }

  .status-info .info-text {
    color: #cfd3dc;
  }

  .today-progress .progress-info {
    .separator {
      color: #8d9095;
    }

    .target {
      color: #a3a6ad;
    }
  }

  .quick-record .quick-label {
    color: #cfd3dc;
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

    .chart-legend {
      color: #cfd3dc;
    }
  }

  // 快速记录按钮暗色模式适配
  :deep(.el-button--primary.is-plain) {
    color: #79bbff;
    background-color: rgba(64, 158, 255, 0.1);
    border-color: rgba(64, 158, 255, 0.4);

    &:hover,
    &:focus,
    &:active {
      color: #a0cfff;
      background-color: rgba(64, 158, 255, 0.2);
      border-color: rgba(64, 158, 255, 0.6);
    }
  }
}
</style>