<!--
  护眼子模块面板
  功能：配置护眼提醒间隔与时长、倒计时显示、眼保健操/望远放松指导
-->
<template>
  <div class="eye-panel">
    <!-- 配置区 + 状态区（左右双栏） -->
    <div class="config-status-row">
    <!-- 配置区 -->
    <el-card class="config-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>👁️ 护眼提醒配置</span>
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
            :max="1440"
            :step="5"
            style="width: 200px"
            @blur="handleAutoSave"
            @change="handleAutoSave"
          />
          <span class="unit-hint">分钟（建议 30，1-1440）</span>
        </el-form-item>
        <el-form-item label="护眼时长">
          <el-input-number
            v-model="form.duration_minutes"
            :min="1"
            :max="1440"
            :step="1"
            style="width: 200px"
            @blur="handleAutoSave"
            @change="handleAutoSave"
          />
          <span class="unit-hint">分钟（建议 5，1-1440）</span>
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
            <div class="countdown-label">距下次护眼提醒</div>
          </div>
        </div>

        <div class="status-info">
          <el-tag type="success" size="large">运行中</el-tag>
          <span class="info-text">
            间隔 {{ savedConfig.interval_minutes }} 分钟 / 时长 {{ savedConfig.duration_minutes }} 分钟
          </span>
        </div>

        <el-button type="primary" plain @click="handleStartNow">立即开始护眼</el-button>
      </div>

      <el-empty v-else description="请先启用护眼提醒" />
    </el-card>
    </div>

    <!-- 眼保健操/望远放松指导 -->
    <el-card class="guide-card" shadow="never">
      <template #header>
        <span>💆 护眼活动指导</span>
      </template>

      <el-tabs v-model="activeGuide">
        <el-tab-pane label="眼保健操" name="exercise">
          <ol class="guide-list">
            <li><strong>按揉睛明穴</strong>：用食指按揉内眼角上方凹陷处，共 32 拍</li>
            <li><strong>按压四白穴</strong>：用食指按压瞳孔直下 1 厘米处，共 32 拍</li>
            <li><strong>按揉太阳穴</strong>：用大拇指按揉太阳穴，食指轮刮眼眶，共 32 拍</li>
            <li><strong>按揉风池穴</strong>：用双手食指和中指按揉后颈发际处，共 32 拍</li>
            <li><strong>按压头部</strong>：双手张开按压头部，从前往后，共 32 拍</li>
          </ol>
        </el-tab-pane>

        <el-tab-pane label="望远放松" name="distance">
          <ol class="guide-list">
            <li>寻找 6 米以外的远处景物（窗外建筑、树木等）</li>
            <li>持续注视远处目标 {{ savedConfig.duration_minutes }} 分钟，保持目光专注</li>
            <li>每 30 秒眨眼一次，保持眼部湿润</li>
            <li>深呼吸放松，缓解眼部紧张</li>
            <li>结束后转动眼球，左右各 5 圈</li>
          </ol>
        </el-tab-pane>

        <el-tab-pane label="20-20-20 法则" name="rule">
          <div class="rule-content">
            <p class="rule-title">📌 国际通用护眼法则</p>
            <p>每使用屏幕 <strong>20 分钟</strong>，看向 <strong>20 英尺（约 6 米）</strong>以外的地方，持续 <strong>20 秒</strong>。</p>
            <p>此法则由美国眼科学会推荐，可有效缓解数字视疲劳（Digital Eye Strain）。</p>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useHealthStore } from '@/stores/health-store'
import { healthApi } from '@/utils/ipc-client'

const healthStore = useHealthStore()

// 配置表单
const form = reactive({
  interval_minutes: 30,
  duration_minutes: 5,
  channels: ['notification', 'popup']
})

// 启用状态：computed 绑定到 store，确保与数据库同步（子需求5）
const isEnabled = computed(() => healthStore.isModuleEnabled('eye'))
// 立即保存模式下无需暂存启用状态，直接绑定到 store
const pendingEnabled = computed(() => isEnabled.value)
const saving = ref(false)
const activeGuide = ref('exercise')
// 标记表单是否已从 store 初始化过，防止后续挂载覆盖用户编辑中的值
const formInitialized = ref(false)

// 已保存的配置（来自 store，用于状态区/倒计时/指导显示，避免未保存的编辑立即生效）
const savedConfig = computed(() => {
  const config = healthStore.getConfig('eye')
  return config.config_json || {}
})

// 倒计时剩余秒数
const remainingSeconds = ref(30 * 60)
let countdownTimer = null

// 倒计时显示文字
const countdownDisplay = computed(() => {
  const total = Math.max(0, remainingSeconds.value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

// 是否接近提醒时间
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
    const last = times?.eye
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
  if (!healthStore.configs || !healthStore.configs.eye) {
    await healthStore.fetchConfigs()
  }
  const config = healthStore.getConfig('eye')
  const configJson = config.config_json || {}
  // 仅首次挂载时从 store 填充表单；若用户已在当前会话编辑过则不覆盖，避免切回页面丢失未保存输入
  if (!formInitialized.value) {
    form.interval_minutes = configJson.interval_minutes || 30
    form.duration_minutes = configJson.duration_minutes || 5
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
    await healthStore.updateConfig('eye', { ...form }, enabled)
    ElMessage.success(enabled ? '护眼提醒已启用' : '护眼提醒已禁用')
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
      await healthStore.updateConfig('eye', { ...form }, pendingEnabled.value)
      resetCountdown()
    } catch (error) {
      console.error('自动保存失败:', error.message)
    }
  }, 300)
}

/**
 * 立即开始护眼活动
 * 通过 IPC 调用主进程 notificationService 发送五重通知（含灵动岛）
 */
async function handleStartNow () {
  try {
    await healthApi.triggerReminder('eye')
  } catch (err) {
    console.error('[EyePanel] 触发护眼提醒失败:', err.message)
    ElMessage.error('触发提醒失败: ' + err.message)
  }
  activeGuide.value = 'exercise'
  resetCountdown()
}

// 监听已保存的间隔变化（仅在保存配置后触发，避免编辑时立即生效）
watch(() => savedConfig.value.interval_minutes, () => {
  if (isEnabled.value) resetCountdown()
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
.eye-panel {
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

.guide-list {
  margin: 0;
  padding-left: 24px;
  line-height: 2.2;
  color: #606266;

  li {
    margin-bottom: 8px;
  }
}

.rule-content {
  line-height: 2;
  color: #606266;

  .rule-title {
    font-size: 16px;
    font-weight: bold;
    color: #303133;
    margin-bottom: 12px;
  }

  p {
    margin-bottom: 8px;
  }
}

// 暗色模式适配：修复 el-button type="primary" plain 按钮字体颜色
// applyAccentToDom 在暗色下用黑色混合 light-*，导致 hover 字体变暗，显式覆盖为亮色
html.dark .eye-panel {
  .unit-hint {
    color: #a3a6ad;
  }

  // 倒计时圆盘：浅色背景改为半透明
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

  .guide-list {
    color: #cfd3dc;
  }

  .rule-content {
    color: #cfd3dc;

    .rule-title {
      color: #e5eaf3;
    }
  }

  .config-readonly .config-row {
    border-bottom-color: #414243;
  }

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
</style>