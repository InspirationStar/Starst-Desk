<!--
  健康小部件
  功能：
  - 调用 healthApi.getStats 获取今日健康统计
  - 显示喝水进度（已喝/目标，进度条）
  - 显示久坐倒计时（下次提醒时间）
  - 胶囊形态：按 contentMode 三种模式显示
    - minimal：仅健康图标
    - summary：图标 + 今日提醒数
    - smart：图标 + 提醒数 + 下一条提醒时间
  - 使用 setInterval 每分钟刷新久坐倒计时
  - 支持暗色模式
    - 使用 --widget-text / --widget-text-secondary 颜色变量
    - 进度条使用强调色 --widget-accent
    - 卡片样式同便签（层填充 + 层描边 + 中圆角 6px）
-->
<template>
  <div class="health-widget">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="health"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态：按 contentMode 显示不同内容 -->
      <template #capsule>
        <div class="health-capsule" :class="`health-capsule--${contentMode}`">
          <el-icon class="health-capsule__icon"><FirstAidKit /></el-icon>
          <!-- minimal 模式：仅图标，不显示数字 -->
          <template v-if="contentMode !== 'minimal'">
            <span class="health-capsule__count">{{ reminderCount }}</span>
            <!-- smart 模式：显示下一条提醒时间 -->
            <span v-if="contentMode === 'smart'" class="health-capsule__time">
              {{ nextReminderTime }}
            </span>
          </template>
        </div>
      </template>

      <!-- 展开形态：健康统计 -->
      <template #expanded>
        <widget-header
          title="健康"
          :icon="FirstAidKit"
          :is-capsule="isCapsule"
          :is-position-locked="isPositionLocked"
          :is-size-locked="isSizeLocked"
          :is-always-on-top="isAlwaysOnTop"
          :display-name="displayName"
          :collapse-behavior="collapseBehavior"
          :has-group="hasGroup"
          @toggle-capsule="handleToggleCapsule"
          @close="handleClose"
          @toggle-position-lock="handleTogglePositionLock"
          @toggle-size-lock="handleToggleSizeLock"
          @reset-position="handleResetPosition"
          @toggle-always-on-top="handleToggleAlwaysOnTop"
          @rename="handleRename"
          @change-collapse-behavior="handleChangeCollapseBehavior"
          @group-merge="handleGroupMerge"
          @group-detach="handleGroupDetach"
          @group-dissolve="handleGroupDissolve"
          @open-settings="handleOpenSettings"
          @disable="handleDisable"
        />
        <div class="health-content">
          <!-- 喝水进度 -->
          <div class="health-section">
            <div class="health-section__title">
              <el-icon><Coffee /></el-icon>
              <span>今日饮水</span>
            </div>
            <el-progress
              :percentage="waterPercent"
              :stroke-width="12"
              :color="waterColor"
              :format="formatPercent"
            />
            <div class="health-section__detail">
              {{ waterTotal }}ml / {{ waterTarget }}ml
            </div>
          </div>

          <!-- 久坐倒计时 -->
          <div class="health-section">
            <div class="health-section__title">
              <el-icon><Timer /></el-icon>
              <span>久坐提醒</span>
            </div>
            <div class="health-section__countdown" :class="{ 'is-warning': isWarning }">
              {{ sedentaryCountdown }}
            </div>
            <div class="health-section__detail">
              {{ sedentaryEnabled ? '每 ' + sedentaryInterval + ' 分钟提醒一次' : '未启用' }}
            </div>
          </div>
        </div>
      </template>
    </capsule-container>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { FirstAidKit, Coffee, Timer } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { healthApi, widgetApi, on as onEvent } from '@/utils/ipc-client'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
// 胶囊内容模式：minimal/summary/smart
const contentMode = ref('summary')

// 喝水数据
const waterTotal = ref(0)
const waterTarget = ref(2000)
// 久坐数据
const sedentaryEnabled = ref(false)
const sedentaryInterval = ref(45)
const sedentaryNextTime = ref(null) // 下次提醒时间 dayjs 对象

// 定时器句柄
let timer = null
// 胶囊配置变化事件取消监听函数
let unsubscribeCapsuleChanged = null

const {
  isPositionLocked,
  isSizeLocked,
  isAlwaysOnTop,
  displayName,
  hasGroup,
  handleTogglePositionLock,
  handleToggleSizeLock,
  handleResetPosition,
  handleToggleAlwaysOnTop,
  handleRename,
  handleChangeCollapseBehavior,
  handleGroupMerge,
  handleGroupDetach,
  handleGroupDissolve,
  handleOpenSettings,
  handleDisable,
  loadLockState,
  loadGroupState,
  subscribeLocksChanged,
  cleanupLocks
} = useWidgetHeaderActions('health')

// 喝水百分比
const waterPercent = computed(() => {
  if (waterTarget.value <= 0) return 0
  return Math.min(100, Math.round((waterTotal.value / waterTarget.value) * 100))
})

// 今日提醒数：久坐启用时为 1（有提醒），否则 0
// 简化方案：以久坐提醒启用状态作为今日提醒数
const reminderCount = computed(() => {
  return sedentaryEnabled.value ? 1 : 0
})

// 下一条提醒时间（smart 模式显示，HH:MM 格式）
// 未启用或无下次提醒时间时显示占位符
const nextReminderTime = computed(() => {
  if (!sedentaryEnabled.value || !sedentaryNextTime.value) return '--:--'
  return sedentaryNextTime.value.format('HH:mm')
})

// 达标用成功色，进行中用强调色，未开始用警告色
const waterColor = computed(() => {
  if (waterPercent.value >= 100) return '#67c23a'
  if (waterPercent.value >= 50) return 'var(--widget-accent, #0067C0)'
  return '#e6a23c'
})

// 久坐倒计时文本
const sedentaryCountdown = computed(() => {
  if (!sedentaryEnabled.value || !sedentaryNextTime.value) return '—'
  const now = dayjs()
  const diff = sedentaryNextTime.value.diff(now, 'second')
  if (diff <= 0) return '该活动啦！'
  const minutes = Math.floor(diff / 60)
  const seconds = diff % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

// 是否为警告状态（倒计时 ≤ 5 分钟）
const isWarning = computed(() => {
  if (!sedentaryEnabled.value || !sedentaryNextTime.value) return false
  const diff = sedentaryNextTime.value.diff(dayjs(), 'minute')
  return diff <= 5 && diff >= 0
})

/**
 * 格式化进度条文字
 */
function formatPercent (percentage) {
  return `${percentage}%`
}

/**
 * 加载今日健康统计
 */
async function loadStats () {
  try {
    const today = dayjs().format('YYYY-MM-DD')
    // 获取今日饮水统计
    const waterStats = await healthApi.getStats({
      module_type: 'water',
      start_date: today,
      end_date: today,
      period: 'day'
    })
    if (waterStats && Array.isArray(waterStats) && waterStats.length > 0 && waterStats[0]) {
      waterTotal.value = waterStats[0].sum_value || 0
    }

    // 获取饮水配置（目标量）
    const waterConfig = await healthApi.getConfig('water')
    if (waterConfig && waterConfig.config_json) {
      waterTarget.value = waterConfig.config_json.target_ml || 2000
    }

    // 获取久坐配置
    const sedentaryConfig = await healthApi.getConfig('sedentary')
    if (sedentaryConfig) {
      sedentaryEnabled.value = !!sedentaryConfig.is_enabled
      if (sedentaryConfig.config_json) {
        sedentaryInterval.value = sedentaryConfig.config_json.interval_minutes || 45
      }
      // 计算下次提醒时间（简化：从现在开始计算）
      if (sedentaryEnabled.value) {
        sedentaryNextTime.value = dayjs().add(sedentaryInterval.value, 'minute')
      }
    }
  } catch (err) {
    console.error('[HealthWidget] 加载健康统计失败:', err.message)
  }
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  // 确保 newCapsule 是 boolean，避免无效值（如 undefined）导致状态错乱
  if (typeof newCapsule !== 'boolean') return
  // 同步设置，让 UI 立即响应
  // 现在点击内容区域不会触发折叠（仅胶囊点击展开 + 折叠按钮折叠），
  // 这两个场景下同步赋值不会导致尺寸抖动
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('health', newCapsule)
  } catch (err) {
    console.error('[HealthWidget] 切换胶囊失败:', err.message)
    // 失败时回滚
    isCapsule.value = !newCapsule
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('health')
  } catch (err) {
    console.error('[HealthWidget] 隐藏失败:', err.message)
  }
}

/**
 * 加载小部件配置
 */
async function loadConfig () {
  try {
    const config = await widgetApi.get('health')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      // 读取折叠行为
      if (config.collapse_behavior) {
        collapseBehavior.value = config.collapse_behavior
      }
      // 读取胶囊内容模式（compact_content_mode 字段）
      if (config.compact_content_mode) {
        contentMode.value = config.compact_content_mode
      }
    }
  } catch (err) {
    console.warn('[HealthWidget] 加载配置失败:', err.message)
  }
}

/**
 * 启动每分钟刷新定时器
 * 久坐倒计时每分钟更新一次
 */
function startTimer () {
  timer = setInterval(() => {
    // 倒计时已用 computed 自动更新，这里只需保证响应式
    // 若倒计时归零，重新计算下次提醒时间
    if (sedentaryEnabled.value && sedentaryNextTime.value) {
      const diff = sedentaryNextTime.value.diff(dayjs(), 'second')
      if (diff <= 0) {
        sedentaryNextTime.value = dayjs().add(sedentaryInterval.value, 'minute')
      }
    }
  }, 60000)
}

function stopTimer () {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(async () => {
  await loadConfig()
  await loadLockState()
  await loadGroupState()
  await loadStats()
  startTimer()

  // 监听胶囊配置变化事件（来自设置页 widget:update）
  try {
    unsubscribeCapsuleChanged = onEvent('widget:capsule-changed', (data) => {
      if (data && data.widgetType === 'health') {
        if (data.isCapsule !== undefined) {
          isCapsule.value = !!Number(data.isCapsule)
        }

        // 同步折叠行为
        if (data.collapseBehavior !== undefined) {
          collapseBehavior.value = data.collapseBehavior
        }
        // 同步胶囊内容模式
        if (data.contentMode !== undefined) {
          contentMode.value = data.contentMode
        }
      }
    })
  } catch (err) {
    // 忽略监听注册失败
  }

  // 订阅锁状态变化
  try {
    subscribeLocksChanged()
  } catch (err) {
    // 忽略订阅注册失败
  }
})

onBeforeUnmount(() => {
  stopTimer()
  if (unsubscribeCapsuleChanged) {
    unsubscribeCapsuleChanged()
    unsubscribeCapsuleChanged = null
  }
  cleanupLocks()
})
</script>

<style scoped lang="scss">
// ============================================================
// - 内容区域内边距 12px
// - 字号：标题 14px / 正文 13px / 辅助 12px（CSS 变量）
// - 久坐提醒卡片：圆角 6px，背景 --widget-layer-fill
// - 数据数字：加粗，强调色
// - 喝水进度条：强调色，圆角
// - 颜色全部使用 CSS 变量，暗色模式通过变量自动适配
// ============================================================

.health-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// minimal 仅图标 / summary 图标+数字 / smart 图标+数字+辅助
// ============================================================
.health-capsule {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--widget-spacing-xs, 4px);
  width: 100%;
  height: 100%;
  padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);

  &__icon {
    font-size: 16px;
    // 胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0067C0);
  }

  &__count {
    font-size: var(--widget-font-title, 14px);
    font-weight: 600;
    color: var(--widget-text, #1A1A1A);
    font-variant-numeric: tabular-nums;
  }

  // smart 模式：下一条提醒时间（辅助 12px）
  &__time {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    // 分隔符前缀
    &::before {
      content: '·';
      margin-right: var(--widget-spacing-xs, 4px);
      color: var(--widget-text-tertiary, #5A5A5A);
    }
  }

  // minimal 模式：仅图标，居中
  &--minimal {
    gap: 0;
    padding: var(--widget-spacing-xs, 4px);
  }

  // smart 模式：左对齐，紧凑布局
  &--smart {
    justify-content: flex-start;
    gap: var(--widget-spacing-xs, 4px);
  }
}

// ============================================================
// 展开形态内容
// ============================================================
.health-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--widget-spacing-md, 12px);
  padding: var(--widget-spacing-md, 12px);
  overflow-y: auto;
  // 细滚动条 4px 半透明
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--widget-layer-stroke, rgba(0, 0, 0, 0.09));
    border-radius: var(--widget-radius-small, 4px);
    &:hover {
      background: var(--widget-drag-handle, #6B6B6B);
    }
  }
}

// ============================================================
// 健康分区卡片
// ============================================================
.health-section {
  display: flex;
  flex-direction: column;
  gap: var(--widget-spacing-xs, 4px);
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.8));
  border: 1px solid var(--widget-layer-stroke, rgba(0, 0, 0, 0.09));
  border-radius: var(--widget-radius-medium, 6px);
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  transition: background var(--widget-motion-fast, 167ms) ease,
              border-color var(--widget-motion-fast, 167ms) ease;

  &__title {
    display: flex;
    align-items: center;
    gap: var(--widget-spacing-xs, 4px);
    // 辅助 12px
    font-size: var(--widget-font-caption, 12px);
    font-weight: 500;
    color: var(--widget-text-secondary, #5A5A5A);

    .el-icon {
      font-size: 13px;
    }
  }

  &__detail {
    // 辅助 12px
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  // 久坐倒计时数据数字：加粗，强调色
  &__countdown {
    font-size: 22px;
    font-weight: 700;
    color: var(--widget-accent, #0067C0);
    font-variant-numeric: tabular-nums;
    text-align: center;
    padding: var(--widget-spacing-xs, 4px) 0;
    letter-spacing: 1px;

    // 警告状态：使用警告色（语义色，深浅色一致）
    &.is-warning {
      color: var(--el-color-warning, #e6a23c);
    }
  }

  // 喝水进度条：确保强调色与圆角
  :deep(.el-progress-bar__outer) {
    border-radius: var(--widget-radius-small, 4px);
  }
  :deep(.el-progress-bar__inner) {
    border-radius: var(--widget-radius-small, 4px);
  }
}

// ============================================================
// 暗色模式适配
// CSS 变量已在 widget.scss 中通过 html.dark 覆盖
// 此处仅保留 scoped 选择器内的变量回退兼容
// ============================================================
html.dark .health-widget {
  color: var(--widget-text, #F5F5F5);

  .health-capsule__icon {
    // 暗色模式胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0078D4);
  }

  .health-section__countdown {
    color: var(--widget-accent, #0078D4);
  }

  .health-section {
    background: var(--widget-layer-fill, rgba(255, 255, 255, 0.12));
    border-color: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));
  }

  .health-section__title,
  .health-section__detail {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .health-section__countdown.is-warning {
    color: #e6a23c;
  }

  // 暗色模式补充：胶囊计数、时间、滚动条
  .health-capsule__count {
    color: var(--widget-text, #F5F5F5);
  }

  .health-capsule__time {
    color: var(--widget-text-secondary, #A5A5A5);

    &::before {
      color: var(--widget-text-tertiary, #8A8A8A);
    }
  }

  .health-content::-webkit-scrollbar-thumb {
    background: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));

    &:hover {
      background: var(--widget-drag-handle, #D6D6D6);
    }
  }
}
</style>
