<!--
  久坐伸展子模块面板（子需求8：合并久坐和伸展）
  功能：
  - 配置久坐伸展提醒间隔、自定义提醒内容
  - 倒计时显示、暂停/继续控制
  - 预设伸展动作指导（原 StretchPanel 功能）
  - 启用状态与数据库同步（子需求5）
-->
<template>
  <div class="sedentary-panel">
    <!-- 配置区 + 状态区（左右双栏） -->
    <div class="config-status-row">
    <!-- 配置区 -->
    <el-card class="config-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>🪑🤸 久坐伸展提醒配置</span>
          <el-switch
            :model-value="pendingEnabled"
            @change="handleToggle"
            active-text="启用"
            inactive-text="禁用"
          />
        </div>
      </template>

      <el-form :model="form" label-width="120px">
        <el-form-item label="提醒间隔">
          <el-input-number
            v-model="form.interval_minutes"
            :min="1"
            :max="120"
            :step="5"
            style="width: 200px"
            @blur="handleAutoSave"
            @change="handleAutoSave"
          />
          <span class="unit-hint">分钟（建议 45，1-120）</span>
        </el-form-item>
        <el-form-item label="自定义提醒内容">
          <el-input
            v-model="form.custom_content"
            type="textarea"
            :rows="3"
            placeholder="留空则使用默认动作指导"
            maxlength="200"
            show-word-limit
            @change="handleAutoSave"
          />
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
          <div class="countdown-circle" :class="{ paused: isPaused, warning: isWarning }">
            <div class="countdown-time">{{ countdownDisplay }}</div>
            <div class="countdown-label">距下次提醒</div>
          </div>
        </div>

        <div class="status-info">
          <el-tag :type="isPaused ? 'info' : 'success'" size="large">
            {{ isPaused ? '已暂停' : '运行中' }}
          </el-tag>
          <span class="interval-text">提醒间隔：{{ savedConfig.interval_minutes }} 分钟</span>
        </div>

        <div class="control-buttons">
          <el-button
            v-if="!isPaused"
            type="warning"
            plain
            @click="handlePause"
          >
            暂停提醒
          </el-button>
          <el-button
            v-else
            type="success"
            @click="handleResume"
          >
            继续提醒
          </el-button>
          <el-button @click="handleReset">重置计时</el-button>
        </div>
      </div>

      <el-empty v-else description="请先启用久坐伸展提醒" />
    </el-card>
    </div>

    <!-- 预设伸展动作（合并自原 StretchPanel） -->
    <el-card class="preset-card" shadow="never">
      <template #header>
        <span>� 预设伸展动作</span>
      </template>

      <el-row :gutter="16">
        <el-col :span="8" v-for="action in presetActions" :key="action.name">
          <el-card class="action-card" shadow="hover" @click="showActionDetail(action)">
            <div class="action-header">
              <span class="action-icon">{{ action.icon }}</span>
              <span class="action-name">{{ action.name }}</span>
            </div>
            <p class="action-desc">{{ action.description }}</p>
            <div class="action-meta">
              <el-tag size="small" type="info">{{ action.duration }} 秒</el-tag>
              <el-tag size="small">{{ action.repeats }} 次</el-tag>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </el-card>

    <!-- 动作指导详情对话框 -->
    <el-dialog
      v-model="detailVisible"
      :title="currentAction ? `${currentAction.icon} ${currentAction.name}` : ''"
      width="500px"
    >
      <div v-if="currentAction" class="action-detail">
        <p class="detail-desc">{{ currentAction.description }}</p>
        <div class="detail-meta">
          <el-tag type="info">建议时长：{{ currentAction.duration }} 秒</el-tag>
          <el-tag type="success">重复次数：{{ currentAction.repeats }} 次</el-tag>
        </div>
        <el-divider />
        <p class="detail-steps-title">动作步骤：</p>
        <ol class="detail-steps">
          <li v-for="(step, index) in currentAction.steps" :key="index">{{ step }}</li>
        </ol>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" @click="useAsCustomContent">设为提醒内容</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useHealthStore } from '@/stores/health-store'
import { healthApi } from '@/utils/ipc-client'

const healthStore = useHealthStore()

// 配置表单（合并了原 sedentary 和 stretch 的字段）
const form = reactive({
  interval_minutes: 45,
  custom_content: '',
  channels: ['notification', 'popup']
})

// 启用状态：computed 绑定到 store，确保与数据库同步（子需求5）
const isEnabled = computed(() => healthStore.isModuleEnabled('sedentary'))
// 立即保存模式下无需暂存启用状态，直接绑定到 store
const pendingEnabled = computed(() => isEnabled.value)
const saving = ref(false)
const isPaused = ref(false)
const detailVisible = ref(false)
const currentAction = ref(null)
// 标记表单是否已从 store 初始化过，防止后续挂载覆盖用户编辑中的值
const formInitialized = ref(false)

// 已保存的配置（来自 store，用于状态区/倒计时显示，避免未保存的编辑立即生效）
const savedConfig = computed(() => {
  const config = healthStore.getConfig('sedentary')
  return config.config_json || {}
})

// 倒计时剩余秒数
const remainingSeconds = ref(45 * 60)

// 倒计时定时器
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

// 预设动作列表（合并自原 StretchPanel）
const presetActions = [
  {
    name: '颈椎操',
    icon: '🧘',
    description: '缓慢转动颈部，缓解颈椎疲劳，适合长时间低头工作者',
    duration: 15,
    repeats: 5,
    steps: [
      '坐直身体，双肩放松，目视前方',
      '缓慢低头，下巴尽量贴近胸部，保持 5 秒',
      '缓慢抬头后仰，保持 5 秒',
      '向左侧偏头，左耳尽量贴近左肩，保持 5 秒',
      '向右侧偏头，右耳尽量贴近右肩，保持 5 秒',
      '顺时针缓慢转动颈部 5 圈，再逆时针 5 圈'
    ]
  },
  {
    name: '肩部伸展',
    icon: '💪',
    description: '耸肩与肩部环绕，缓解肩部肌肉紧张',
    duration: 20,
    repeats: 10,
    steps: [
      '双臂自然下垂，放松肩部',
      '双肩同时向上耸起，尽量靠近耳朵，保持 3 秒',
      '缓慢放下双肩，重复 10 次',
      '双肩向前环绕 10 圈',
      '双肩向后环绕 10 圈'
    ]
  },
  {
    name: '腰部扭转',
    icon: '🔄',
    description: '坐姿腰部扭转，活动腰椎，缓解久坐腰酸',
    duration: 15,
    repeats: 8,
    steps: [
      '坐直身体，双脚平放地面',
      '右手扶住左膝，身体向左扭转，保持 10 秒',
      '回正后，左手扶住右膝，身体向右扭转，保持 10 秒',
      '交替进行，每侧 8 次'
    ]
  },
  {
    name: '扩胸运动',
    icon: '🙆',
    description: '扩胸伸展，打开胸腔，改善含胸驼背',
    duration: 10,
    repeats: 10,
    steps: [
      '站立或坐直，双臂自然下垂',
      '双臂向两侧平举，与肩同高',
      '双臂尽量向后伸展，感受胸部拉伸，保持 5 秒',
      '回到起始位置，重复 10 次'
    ]
  },
  {
    name: '腿部拉伸',
    icon: '🦵',
    description: '坐姿腿部伸展，促进下肢血液循环',
    duration: 15,
    repeats: 5,
    steps: [
      '坐直身体，双手扶住椅子边缘',
      '左腿伸直抬起，脚尖向上勾，保持 10 秒',
      '左腿放下，换右腿重复相同动作',
      '交替进行，每腿 5 次'
    ]
  },
  {
    name: '手腕活动',
    icon: '✋',
    description: '手腕环绕与伸展，预防鼠标手',
    duration: 10,
    repeats: 10,
    steps: [
      '伸直右手，掌心向前，用左手轻轻向后按压手指，保持 10 秒',
      '翻转右手掌心向后，用左手向前按压手背，保持 10 秒',
      '右手握拳，顺时针环绕手腕 10 圈',
      '逆时针环绕手腕 10 圈',
      '换左手重复以上动作'
    ]
  }
]

/**
 * 启动倒计时
 */
function startCountdown () {
  stopCountdown()
  countdownTimer = setInterval(() => {
    if (isPaused.value || !isEnabled.value) return
    if (remainingSeconds.value > 0) {
      remainingSeconds.value--
    } else {
      // 倒计时归零，重置
      remainingSeconds.value = savedConfig.value.interval_minutes * 60
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
  remainingSeconds.value = savedConfig.value.interval_minutes * 60
}

/**
 * 从主进程同步倒计时（基于最后提醒时间计算真实剩余，避免切页重置）
 */
async function syncCountdownFromServer () {
  const interval = savedConfig.value.interval_minutes * 60
  try {
    const times = await healthApi.getLastReminded()
    const last = times?.sedentary
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
 * 加载配置
 */
async function loadConfig () {
  // 确保 store 配置已加载（子需求5）
  if (!healthStore.configs || !healthStore.configs.sedentary) {
    await healthStore.fetchConfigs()
  }
  const config = healthStore.getConfig('sedentary')
  const configJson = config.config_json || {}
  // 仅首次挂载时从 store 填充表单；若用户已在当前会话编辑过则不覆盖，避免切回页面丢失未保存输入
  if (!formInitialized.value) {
    form.interval_minutes = configJson.interval_minutes || 45
    form.custom_content = configJson.custom_content || ''
    // 深拷贝 channels，避免与 store 共享引用导致修改立即同步到 store
    form.channels = Array.isArray(configJson.channels) ? [...configJson.channels] : ['notification', 'popup']
    formInitialized.value = true
  }

  await syncCountdownFromServer()
}

/**
 * 切换启用状态（立即保存）
 */
async function handleToggle (enabled) {
  saving.value = true
  try {
    await healthStore.updateConfig('sedentary', { ...form }, enabled)
    ElMessage.success(enabled ? '久坐伸展提醒已启用' : '久坐伸展提醒已禁用')
    resetCountdown()
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
      await healthStore.updateConfig('sedentary', { ...form }, pendingEnabled.value)
      resetCountdown()
    } catch (error) {
      console.error('自动保存失败:', error.message)
    }
  }, 300)
}

/**
 * 暂停提醒
 */
async function handlePause () {
  try {
    await healthStore.pauseSedentary()
    isPaused.value = true
    ElMessage.info('久坐伸展提醒已暂停')
  } catch (error) {
    ElMessage.error('暂停失败：' + error.message)
  }
}

/**
 * 继续提醒
 */
function handleResume () {
  isPaused.value = false
  healthStore.resumeSedentary()
  ElMessage.success('久坐伸展提醒已继续')
}

/**
 * 重置计时
 */
function handleReset () {
  resetCountdown()
  ElMessage.info('计时已重置')
}

/**
 * 显示动作详情
 */
function showActionDetail (action) {
  currentAction.value = action
  detailVisible.value = true
}

/**
 * 将当前动作设为自定义提醒内容
 */
function useAsCustomContent () {
  if (!currentAction.value) return
  const action = currentAction.value
  form.custom_content = `${action.name}：${action.description}（建议时长 ${action.duration} 秒，重复 ${action.repeats} 次）`
  detailVisible.value = false
  handleAutoSave()
  ElMessage.success('已设为提醒内容')
}

// 监听已保存的间隔变化，重置倒计时（仅在保存配置后触发，避免编辑时立即生效）
watch(() => savedConfig.value.interval_minutes, () => {
  if (isEnabled.value) {
    resetCountdown()
  }
})

onMounted(async () => {
  await loadConfig()
  startCountdown()
})

onUnmounted(() => {
  stopCountdown()
})
</script>

<style scoped lang="scss">
.sedentary-panel {
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

  &.paused {
    border-color: #909399;
    background-color: #f4f4f5;
  }

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

  .interval-text {
    color: #606266;
    font-size: 14px;
  }
}

.control-buttons {
  display: flex;
  gap: 12px;
}

// 预设动作卡片样式（合并自原 StretchPanel）
.action-card {
  margin-bottom: 16px;
  cursor: pointer;
  transition: transform 0.2s ease;

  &:hover {
    transform: translateY(-4px);
  }

  .action-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;

    .action-icon {
      font-size: 24px;
    }

    .action-name {
      font-size: 16px;
      font-weight: bold;
      color: #303133;
    }
  }

  .action-desc {
    color: #606266;
    font-size: 13px;
    line-height: 1.6;
    margin: 8px 0;
  }

  .action-meta {
    display: flex;
    gap: 8px;
  }
}

.action-detail {
  .detail-desc {
    color: #606266;
    line-height: 1.8;
    margin-bottom: 16px;
  }

  .detail-meta {
    display: flex;
    gap: 12px;
  }

  .detail-steps-title {
    color: #303133;
    font-weight: bold;
    margin-bottom: 8px;
  }

  .detail-steps {
    margin: 0;
    padding-left: 24px;
    line-height: 2;
    color: #606266;
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
html.dark .sedentary-panel {
  .unit-hint {
    color: #a3a6ad;
  }

  // 倒计时圆盘：浅色背景改为半透明
  .countdown-circle {
    background-color: rgba(64, 158, 255, 0.15);

    &.paused {
      border-color: #414243;
      background-color: rgba(144, 147, 153, 0.15);
    }

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

  .status-info .interval-text {
    color: #cfd3dc;
  }

  .action-card {
    .action-header .action-name {
      color: #e5eaf3;
    }

    .action-desc {
      color: #cfd3dc;
    }
  }

  .action-detail {
    .detail-desc {
      color: #cfd3dc;
    }

    .detail-steps-title {
      color: #e5eaf3;
    }

    .detail-steps {
      color: #cfd3dc;
    }
  }

  .config-readonly .config-row {
    border-bottom-color: #414243;
  }
}
</style>
