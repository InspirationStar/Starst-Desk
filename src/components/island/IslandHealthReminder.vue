<!--
  灵动岛健康提醒卡片
  职责：
  - 显示提醒类型图标、标题、内容
  - 久坐/护眼提醒显示倒计时确认按钮（已完成/稍后提醒）
  - 其他健康提醒（喝水/睡眠/饮食）显示"已处理"按钮
  - Fluent Design 风格
-->
<template>
  <div class="island-health-reminder" :class="{ 'has-countdown': showCountdown }">
    <!-- 左侧图标 -->
    <div class="island-health-reminder__icon">
      <el-icon v-if="iconEl">
        <component :is="iconEl" />
      </el-icon>
    </div>

    <!-- 中间内容 -->
    <div class="island-health-reminder__content">
      <div class="island-health-reminder__title" v-if="title">{{ title }}</div>
      <div class="island-health-reminder__body" v-if="body">{{ body }}</div>
      <!-- 倒计时显示（久坐/护眼提醒） -->
      <div v-if="showCountdown" class="island-health-reminder__countdown">
        <span class="countdown-num">{{ countdownSeconds }}</span>
        <span class="countdown-label">秒后自动跳过</span>
      </div>
    </div>

    <!-- 确认按钮区 -->
    <div class="island-health-reminder__actions">
      <div
        v-if="showCountdown"
        class="island-health-reminder__action"
        @click="handleDone"
      >
        ✓ 完成
      </div>
      <div
        v-else-if="action && action.label"
        class="island-health-reminder__action"
        @click="handleAction"
      >
        {{ action.label }}
      </div>
      <div
        v-else
        class="island-health-reminder__action"
        @click="handleAction"
      >
        确认
      </div>
      <div
        v-if="showCountdown"
        class="island-health-reminder__action island-health-reminder__action--skip"
        @click="handleSkip"
      >
        稍后提醒
      </div>
    </div>

    <!-- 关闭按钮 -->
    <div class="island-health-reminder__close" @click="handleClose">
      <el-icon><Close /></el-icon>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  Coffee,
  ColdDrink,
  Sunny,
  Moon,
  Refresh,
  WarningFilled,
  Close
} from '@element-plus/icons-vue'

// ============================================================
// 组件属性
// ============================================================
const props = defineProps({
  type: { type: String, default: 'health' },
  title: { type: String, default: '' },
  body: { type: String, default: '' },
  icon: { type: [String, Object], default: null },
  action: { type: Object, default: null },
  extraData: { type: Object, default: null }
})

// ============================================================
// 组件事件
// ============================================================
const emit = defineEmits(['dismiss', 'action'])

// ============================================================
// 倒计时状态（久坐/护眼提醒）
// ============================================================
const SHOW_COUNTDOWN_TYPES = ['sedentary', 'eye']
const DEFAULT_COUNTDOWN_SECONDS = 60
// 用户反馈缓冲时间（秒）：倒计时在活动时长基础上额外留出的点击完成余裕
// 避免用户按建议做完活动回来点击时刚好倒计时归零被记为超时
const FEEDBACK_BUFFER_SECONDS = 30

const moduleType = computed(() => props.extraData?.moduleType || props.type)
// 显示倒计时的条件：活动类提醒（久坐/护眼）或携带 durationMinutes 的提醒
// 未来新增需要倒计时的健康提醒只需在 extraData 中传 durationMinutes 即可
const showCountdown = computed(() =>
  SHOW_COUNTDOWN_TYPES.includes(moduleType.value) ||
  (Number.isFinite(props.extraData?.durationMinutes) && props.extraData.durationMinutes > 0)
)
const countdownSeconds = ref(DEFAULT_COUNTDOWN_SECONDS)
let countdownTimer = null
// 是否已主动响应（完成/跳过/超时），防止卸载时重复记录
const hasResolved = ref(false)

function startCountdown () {
  clearCountdown()
  // 从模块配置读取实际倒计时时长（分钟转秒），兜底使用默认值
  // 护眼提醒: durationMinutes = duration_minutes（如 5 分钟 → 300 秒）
  // 久坐伸展: 未配置独立时长时使用 DEFAULT_COUNTDOWN_SECONDS 兜底
  // 倒计时 = 活动时长 + 反馈缓冲，确保用户做完活动后有余裕点击完成而非刚好归零
  const durationMinutes = props.extraData?.durationMinutes
  countdownSeconds.value = Number.isFinite(durationMinutes) && durationMinutes > 0
    ? Math.round(durationMinutes * 60) + FEEDBACK_BUFFER_SECONDS
    : DEFAULT_COUNTDOWN_SECONDS
  countdownTimer = setInterval(() => {
    if (countdownSeconds.value > 0) {
      countdownSeconds.value--
    } else {
      clearCountdown()
      handleTimeout()
    }
  }, 1000)
}

function clearCountdown () {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

function handleDone () {
  if (hasResolved.value) return
  hasResolved.value = true
  clearCountdown()
  emit('action', { action: { label: 'done', value: 'completed' }, moduleType: moduleType.value })
}

function handleSkip () {
  if (hasResolved.value) return
  hasResolved.value = true
  clearCountdown()
  // 用户主动点击"稍后提醒"，表示有意推迟
  emit('action', { action: { label: 'skip', value: 'skipped' }, moduleType: moduleType.value })
}

function handleTimeout () {
  if (hasResolved.value) return
  hasResolved.value = true
  clearCountdown()
  // 倒计时归零，用户未响应，记录为"未执行"而非"稍后提醒"
  emit('action', { action: { label: 'timeout', value: 'timeout' }, moduleType: moduleType.value })
}

/**
 * 关闭按钮：倒计时提醒未响应时记录为未完成，再 dismiss
 */
function handleClose () {
  if (showCountdown.value && !hasResolved.value) {
    handleTimeout()
  }
  emit('dismiss')
}

// ============================================================
// 图标映射
// ============================================================
const healthIconMap = {
  water: ColdDrink,
  sedentary: Coffee,
  eye: Sunny,
  sleep: Moon,
  posture: Refresh,
  break: Close
}

const iconEl = computed(() => {
  if (props.icon) return props.icon
  const subType = props.extraData?.subType
  if (subType && healthIconMap[subType]) return healthIconMap[subType]
  if (healthIconMap[props.type]) return healthIconMap[props.type]
  return WarningFilled
})

// ============================================================
// 普通操作（无倒计时）
// ============================================================
function handleAction () {
  // 必须传递 moduleType，否则主进程 island:action 处理器无法记录
  // props.action 是 Vue reactive Proxy，需转为普通对象，否则 Electron IPC 结构化克隆会报错
  const action = props.action ? { label: props.action.label, value: props.action.value } : { label: '确认', value: 'dismissed' }
  emit('action', { action, moduleType: moduleType.value })
}

// ============================================================
// 生命周期
// ============================================================
onMounted(() => {
  if (showCountdown.value) startCountdown()
})

onBeforeUnmount(() => {
  // 倒计时提醒被卸载（切页/换卡片/关岛）且用户未响应，记录为未完成
  // 确保完成率分母 = 实际提醒次数，避免未响应提醒"蒸发"导致完成率虚高
  if (showCountdown.value && !hasResolved.value) {
    handleTimeout()
  }
  clearCountdown()
})
</script>

<style lang="scss" scoped>
.island-health-reminder {
  width: 100%;
  min-height: 56px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--island-card-bg);
  border: var(--island-card-border);
  box-shadow: var(--island-card-shadow);
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--island-text-primary);
  user-select: none;
  position: relative;
  z-index: 1;

  // 有倒计时时增加最小高度
  &.has-countdown {
    min-height: 72px;
    align-items: flex-start;
    padding-top: 14px;
  }

  &__icon {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: #67c23a;
  }

  &__content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--island-text-title);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__body {
    font-size: 12px;
    line-height: 1.4;
    color: var(--island-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  // 倒计时显示
  &__countdown {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-top: 4px;

    .countdown-num {
      font-size: 18px;
      font-weight: 700;
      color: #f5a623;
      font-family: 'Courier New', monospace;
    }

    .countdown-label {
      font-size: 11px;
      color: var(--island-text-tertiary);
    }
  }

  &__actions {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-right: 20px;
  }

  &__action {
    padding: 5px 12px;
    border-radius: 6px;
    background: rgba(103, 194, 58, 0.2);
    color: #85ce61;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s ease;
    white-space: nowrap;

    &:hover {
      background: rgba(103, 194, 58, 0.32);
    }

    &--skip {
      background: var(--island-skip-bg);
      color: var(--island-skip-color);

      &:hover {
        background: var(--island-skip-bg-hover);
        color: var(--island-skip-color-hover);
      }
    }
  }

  &__close {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--island-close-color);
    cursor: pointer;
    border-radius: 4px;
    transition: color 0.2s ease, background 0.2s ease;

    &:hover {
      color: var(--island-close-color-hover);
      background: var(--island-close-bg-hover);
    }
  }
}
</style>
