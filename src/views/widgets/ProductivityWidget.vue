<!--
  生产力小部件
  功能：
  - 胶囊形态：按 contentMode 三种模式显示
    - minimal：仅趋势图标
    - summary：图标 + 今日专注时长
    - smart：图标 + 今日时长 + 本周会话数
  - 展开形态：
    - 顶部 WidgetHeader（标题"生产力" + 图标）
    - 今日专注总时长卡片
    - 本周专注趋势柱状图（7 天）
    - 快速开始专注会话按钮
    - 专注会话记录列表
    - 目标完成进度
  - 使用 CapsuleContainer + WidgetHeader 组件
  - 使用 CSS 变量适配暗色模式
  - 使用 focusApi 调用后端专注会话服务
    - 卡片圆角 4px，悬停背景 SubtleFillColorSecondary
    - 柱状图：7 根柱子，最高 60px
-->
<template>
  <div class="productivity-widget">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="productivity"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态：按 contentMode 显示不同内容 -->
      <template #capsule>
        <div class="productivity-capsule" :class="`productivity-capsule--${contentMode}`">
          <el-icon class="productivity-capsule__icon"><TrendCharts /></el-icon>
          <!-- minimal 模式：仅图标 -->
          <template v-if="contentMode !== 'minimal'">
            <span class="productivity-capsule__duration">{{ formatDuration(todaySeconds) }}</span>
            <!-- smart 模式：显示本周会话数 -->
            <span v-if="contentMode === 'smart'" class="productivity-capsule__sessions">
              {{ weekSessions }}次
            </span>
          </template>
        </div>
      </template>

      <!-- 展开形态：生产力统计 -->
      <template #expanded>
        <widget-header
          title="生产力"
          :icon="TrendCharts"
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
        <div class="productivity-content">
          <!-- 今日专注总时长卡片 -->
          <div class="productivity-today">
            <div class="productivity-today__label">今日专注</div>
            <div class="productivity-today__duration">{{ formatDuration(todaySeconds) }}</div>
            <div class="productivity-today__sessions">{{ todaySessions }} 个会话</div>
          </div>

          <!-- 本周专注趋势柱状图 -->
          <div class="productivity-chart">
            <div class="productivity-chart__title">本周趋势</div>
            <div class="productivity-chart__bars">
              <div
                v-for="day in weekBars"
                :key="day.date"
                class="productivity-chart__bar-wrapper"
              >
                <div class="productivity-chart__bar" :style="{ height: day.barHeight + 'px' }">
                  <div
                    class="productivity-chart__bar-fill"
                    :class="{ 'is-today': day.isToday }"
                    :style="{ height: day.fillHeight + '%' }"
                  ></div>
                </div>
                <div class="productivity-chart__day-label">{{ day.label }}</div>
              </div>
            </div>
          </div>

          <!-- 快速开始/取消专注会话按钮 -->
          <button
            v-if="!activeSession"
            class="productivity-start-btn"
            :disabled="starting"
            @click="handleStartFocus"
          >
            <el-icon class="productivity-start-btn__icon"><VideoPlay /></el-icon>
            <span class="productivity-start-btn__text">
              {{ starting ? '启动中...' : '开始专注 (25分钟)' }}
            </span>
          </button>
          <button
            v-else
            class="productivity-start-btn productivity-start-btn--active"
            @click="handleCancelFocus"
          >
            <el-icon class="productivity-start-btn__icon"><VideoPause /></el-icon>
            <span class="productivity-start-btn__text">取消专注</span>
          </button>

          <!-- 专注会话记录列表 -->
          <div class="productivity-content__list" v-loading="loading">
            <div
              v-for="session in sessions"
              :key="session.id"
              class="productivity-session"
              :class="`productivity-session--${session.result || 'started'}`"
            >
              <el-icon class="productivity-session__icon">
                <component :is="getSessionIcon(session.result)" />
              </el-icon>
              <div class="productivity-session__info">
                <div
                  class="productivity-session__title"
                  :title="session.title"
                  @dblclick="handleStartRename(session)"
                >
                  {{ session.title || '专注会话' }}
                </div>
                <div class="productivity-session__meta">
                  {{ formatDuration(session.total_seconds) }} · {{ formatSessionTime(session.started_at) }}
                </div>
              </div>
              <div class="productivity-session__status">
                {{ getSessionStatusLabel(session.result) }}
              </div>
              <div class="productivity-session__actions">
                <el-icon class="session-action-btn" @click.stop="handleStartRename(session)"><Edit /></el-icon>
                <el-icon class="session-action-btn session-action-btn--danger" @click.stop="handleDeleteSession(session)"><Delete /></el-icon>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-if="!loading && sessions.length === 0" class="productivity-empty">
              <el-icon class="productivity-empty__icon"><TrendCharts /></el-icon>
              <div class="productivity-empty__text">暂无专注记录</div>
              <div class="productivity-empty__hint">点击上方按钮开始第一次专注</div>
            </div>
          </div>
        </div>
      </template>
    </capsule-container>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  TrendCharts, VideoPlay, VideoPause, CircleCheckFilled, CloseBold, Clock, Delete, Edit
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { focusApi, widgetApi, invoke, on as onEvent } from '@/utils/ipc-client'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
// 胶囊内容模式：minimal/summary/smart
const contentMode = ref('summary')

// 统计数据
const todaySeconds = ref(0)
const todaySessions = ref(0)
const weekSessions = ref(0)
const dailyStats = ref([]) // [{ date, seconds, sessions }]
// 会话列表
const sessions = ref([])
// 加载与启动状态
const loading = ref(false)
const starting = ref(false)

// 进行中的专注会话（不弹出主窗口，倒计时由灵动岛显示）
const activeSession = ref(null)
let focusTimer = null
let focusTotalSeconds = 0
let focusRemainingSeconds = 0

// 胶囊配置变化事件取消监听函数
let unsubscribeCapsuleChanged = null

// 会话结果 → 图标组件映射
const SESSION_ICONS = {
  completed: CircleCheckFilled,
  cancelled: CloseBold,
  started: Clock
}

// 会话结果 → 状态标签映射
const SESSION_STATUS_LABELS = {
  completed: '已完成',
  cancelled: '已取消',
  started: '进行中'
}

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
} = useWidgetHeaderActions('productivity')

// 本周柱状图数据（7 天，补齐缺失日期）
const weekBars = computed(() => {
  // 生成最近 7 天的日期列表（从 6 天前到今天）
  const today = dayjs()
  const days = []
  for (let i = 6; i >= 0; i--) {
    const date = today.subtract(i, 'day')
    const dateStr = date.format('YYYY-MM-DD')
    // 从 dailyStats 中查找对应日期的数据
    const stat = dailyStats.value.find(s => s.date === dateStr)
    const seconds = stat ? (stat.seconds || 0) : 0
    days.push({
      date: dateStr,
      label: date.format('ddd').slice(0, 1), // 周几首字（一/二/三...）
      isToday: i === 0,
      seconds,
      barHeight: 60, // 柱子容器高度
      fillHeight: seconds > 0 ? Math.max(8, Math.min(100, (seconds / maxDaySeconds.value) * 100)) : 0
    })
  }
  return days
})

// 本周最大单日专注时长（用于柱状图归一化，至少 1 避免除零）
const maxDaySeconds = computed(() => {
  const max = Math.max(1, ...dailyStats.value.map(s => s.seconds || 0))
  return max
})

/**
 * 格式化时长（秒 → "Xh Ym" 或 "Ym" 或 "0m"）
 */
function formatDuration (seconds) {
  const s = Number(seconds) || 0
  if (s === 0) return '0m'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * 格式化会话时间（YYYY-MM-DD HH:mm → MM-DD HH:mm）
 */
function formatSessionTime (time) {
  if (!time) return ''
  return dayjs(time).format('MM-DD HH:mm')
}

/**
 * 获取会话图标
 */
function getSessionIcon (result) {
  return SESSION_ICONS[result] || Clock
}

/**
 * 获取会话状态标签
 */
function getSessionStatusLabel (result) {
  return SESSION_STATUS_LABELS[result] || result || ''
}

/**
 * 加载专注统计
 */
async function loadStats () {
  try {
    const stats = await focusApi.stats()
    todaySeconds.value = stats?.todaySeconds || 0
    todaySessions.value = stats?.todaySessions || 0
    dailyStats.value = stats?.dailyStats || []
    // 本周会话数 = 最近 7 天会话数之和
    weekSessions.value = dailyStats.value.reduce((sum, d) => sum + (d.sessions || 0), 0)
  } catch (err) {
    console.error('[ProductivityWidget] 加载统计失败:', err.message)
  }
}

/**
 * 加载专注会话列表
 */
async function loadSessions () {
  loading.value = true
  try {
    const result = await focusApi.list({ page: 1, size: 10 })
    sessions.value = result?.list || []
  } catch (err) {
    console.error('[ProductivityWidget] 加载会话列表失败:', err.message)
    sessions.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 重命名会话（双击标题或点击编辑按钮）
 */
function handleStartRename (session) {
  const newName = prompt('重命名专注会话：', session.title || '专注会话')
  if (newName !== null && newName.trim()) {
    focusApi.updateTitle(session.id, newName.trim()).then(() => {
      session.title = newName.trim()
    }).catch(err => {
      console.error('[ProductivityWidget] 重命名失败:', err.message)
    })
  }
}

/**
 * 删除会话
 */
async function handleDeleteSession (session) {
  try {
    await focusApi.delete(session.id)
    sessions.value = sessions.value.filter(s => s.id !== session.id)
  } catch (err) {
    console.error('[ProductivityWidget] 删除会话失败:', err.message)
  }
}

/**
 * 快速开始专注会话（25 分钟，单次模式）
 * 不弹出主窗口，倒计时由灵动岛显示
 */
async function handleStartFocus () {
  starting.value = true
  try {
    const result = await focusApi.create({
      mode: 'single',
      title: '专注会话',
      total_seconds: 1500 // 25 分钟
    })
    if (result?.session?.id) {
      activeSession.value = result.session
      focusTotalSeconds = result.session.total_seconds || 1500
      focusRemainingSeconds = result.session.remaining_seconds || focusTotalSeconds
      startFocusTimer()
    }
    await loadSessions()
    await loadStats()
  } catch (err) {
    console.error('[ProductivityWidget] 启动专注失败:', err.message)
  } finally {
    starting.value = false
  }
}

/**
 * 启动倒计时定时器（仅推送灵动岛更新，不在小部件内显示倒计时）
 */
function startFocusTimer () {
  stopFocusTimer()
  focusTimer = setInterval(async () => {
    if (focusRemainingSeconds <= 0) {
      stopFocusTimer()
      activeSession.value = null
      await loadSessions()
      await loadStats()
      return
    }
    focusRemainingSeconds--
    // 推送灵动岛倒计时更新
    try {
      await invoke('focus:tick', {
        taskName: activeSession.value?.title || '专注中',
        remainingMs: focusRemainingSeconds * 1000,
        totalMs: focusTotalSeconds * 1000
      })
    } catch (e) { /* 忽略灵动岛更新失败 */ }
  }, 1000)
}

/**
 * 停止倒计时定时器
 */
function stopFocusTimer () {
  if (focusTimer) {
    clearInterval(focusTimer)
    focusTimer = null
  }
}

/**
 * 取消专注会话
 */
async function handleCancelFocus () {
  if (!activeSession.value) return
  stopFocusTimer()
  try {
    await invoke('focus:cancel', { id: activeSession.value.id })
    activeSession.value = null
    await loadSessions()
    await loadStats()
  } catch (err) {
    console.error('[ProductivityWidget] 取消专注失败:', err.message)
  }
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  if (typeof newCapsule !== 'boolean') return
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('productivity', newCapsule)
  } catch (err) {
    console.error('[ProductivityWidget] 切换胶囊失败:', err.message)
    isCapsule.value = !newCapsule
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('productivity')
  } catch (err) {
    console.error('[ProductivityWidget] 隐藏失败:', err.message)
  }
}

/**
 * 加载小部件配置
 */
async function loadConfig () {
  try {
    const config = await widgetApi.get('productivity')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      if (config.collapse_behavior) {
        const validBehaviors = ['expanded', 'click', 'smart']
        collapseBehavior.value = validBehaviors.includes(config.collapse_behavior)
          ? config.collapse_behavior
          : 'click'
      }
      if (config.compact_content_mode) {
        contentMode.value = config.compact_content_mode
      }
    }
  } catch (err) {
    console.warn('[ProductivityWidget] 加载配置失败:', err.message)
  }
}

const handleVisibilityChange = async () => {
  if (document.hidden) {
    stopFocusTimer()
  } else if (activeSession.value) {
    try {
      const res = await invoke('focus:get-active')
      if (res?.session) {
        focusRemainingSeconds = res.session.remaining_seconds || 0
        if (focusRemainingSeconds > 0) startFocusTimer()
      }
    } catch { /* 忽略 */ }
  }
}

onMounted(async () => {
  await loadConfig()
  await loadLockState()
  await loadGroupState()
  await loadStats()
  await loadSessions()

  // 恢复进行中的专注会话（小部件重启后）
  try {
    const activeResult = await invoke('focus:get-active')
    if (activeResult?.session) {
      activeSession.value = activeResult.session
      focusTotalSeconds = activeResult.session.total_seconds || 0
      focusRemainingSeconds = activeResult.session.remaining_seconds || 0
      if (focusRemainingSeconds > 0) {
        startFocusTimer()
      }
    }
  } catch (err) {
    // 忽略恢复失败
  }

  // 监听胶囊配置变化事件
  try {
    unsubscribeCapsuleChanged = onEvent('widget:capsule-changed', (data) => {
      if (data && data.widgetType === 'productivity') {
        if (data.isCapsule !== undefined) {
          isCapsule.value = !!Number(data.isCapsule)
        }
        if (data.collapseBehavior !== undefined) {
          collapseBehavior.value = data.collapseBehavior
        }
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

  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopFocusTimer()
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
// - 卡片圆角 4px，悬停背景 SubtleFillColorSecondary
// - 柱状图：7 根柱子，最高 60px
// - 颜色全部使用 CSS 变量，暗色模式通过变量自动适配
// ============================================================

.productivity-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// 胶囊形态
// ============================================================
.productivity-capsule {
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

  &__duration {
    font-size: var(--widget-font-title, 14px);
    font-weight: 600;
    color: var(--widget-text, #1A1A1A);
    font-variant-numeric: tabular-nums;
  }

  &__sessions {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
    white-space: nowrap;
    &::before {
      content: '·';
      margin-right: var(--widget-spacing-xs, 4px);
      color: var(--widget-text-tertiary, #5A5A5A);
    }
  }

  &--minimal {
    gap: 0;
    padding: var(--widget-spacing-xs, 4px);
  }

  &--smart {
    justify-content: flex-start;
    gap: var(--widget-spacing-xs, 4px);
  }
}

// ============================================================
// 展开形态内容
// ============================================================
.productivity-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--widget-spacing-md, 12px);
  overflow: hidden;
  gap: var(--widget-spacing-md, 12px);

  &__list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--widget-spacing-xs, 4px);
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
}

// ============================================================
// 今日专注卡片
// ============================================================
.productivity-today {
  display: flex;
  align-items: baseline;
  gap: var(--widget-spacing-sm, 8px);
  padding: var(--widget-spacing-md, 12px);
  background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.44));
  border-radius: var(--widget-radius-small, 4px);

  &__label {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &__duration {
    font-size: 20px;
    font-weight: 700;
    color: var(--widget-text, #1A1A1A);
    font-variant-numeric: tabular-nums;
  }

  &__sessions {
    flex: 1;
    text-align: right;
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
    font-variant-numeric: tabular-nums;
  }
}

// ============================================================
// 本周趋势柱状图
// ============================================================
.productivity-chart {
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.44));
  border-radius: var(--widget-radius-small, 4px);

  &__title {
    font-size: var(--widget-font-caption, 12px);
    font-weight: 600;
    color: var(--widget-text-secondary, #5A5A5A);
    margin-bottom: var(--widget-spacing-sm, 8px);
  }

  &__bars {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--widget-spacing-xs, 4px);
    height: 80px;
  }

  &__bar-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  &__bar {
    width: 100%;
    height: 60px;
    background: var(--widget-layer-fill-secondary, rgba(0, 0, 0, 0.04));
    border-radius: 3px;
    overflow: hidden;
    display: flex;
    align-items: flex-end;
  }

  &__bar-fill {
    width: 100%;
    background: var(--el-color-primary, #409EFF);
    border-radius: 3px;
    transition: height var(--widget-motion-normal, 250ms) ease;

    &.is-today {
      background: var(--el-color-success, #67C23A);
    }
  }

  &__day-label {
    font-size: 10px;
    color: var(--widget-text-tertiary, #5A5A5A);
  }
}

// ============================================================
// 快速开始专注按钮
// ============================================================
.productivity-start-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--widget-spacing-xs, 4px);
  min-height: 42px;
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  width: 100%;
  background: var(--el-color-primary, #409EFF);
  border: none;
  border-radius: var(--widget-radius-small, 4px);
  color: #ffffff;
  font-size: var(--widget-font-body, 13px);
  font-weight: 500;
  cursor: pointer;
  transition: opacity var(--widget-motion-fast, 167ms) ease;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &__icon {
    font-size: 16px;
  }

  &--active {
    background: var(--el-color-danger, #F56C6C);
  }
}

// ============================================================
// 专注会话记录项
// ============================================================
// 专注会话进行中（小部件内倒计时）
// ============================================================
.productivity-focus-active {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--widget-spacing-sm, 8px);
  padding: var(--widget-spacing-md, 12px);
  width: 100%;
  background: var(--widget-bg-secondary, rgba(0, 0, 0, 0.04));
  border-radius: var(--widget-radius-small, 4px);

  &__timer {
    font-size: 36px;
    font-weight: 300;
    color: var(--widget-text, #1A1A1A);
    font-variant-numeric: tabular-nums;
    letter-spacing: 2px;
    line-height: 1;
  }

  &__title {
    font-size: var(--widget-font-caption, 11px);
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &__actions {
    display: flex;
    gap: var(--widget-spacing-sm, 8px);
    width: 100%;
  }

  &__btn {
    flex: 1;
    min-height: 32px;
    border: none;
    border-radius: var(--widget-radius-small, 4px);
    font-size: var(--widget-font-body, 13px);
    font-weight: 500;
    cursor: pointer;
    transition: opacity var(--widget-motion-fast, 167ms) ease;

    &:hover {
      opacity: 0.85;
    }

    &--cancel {
      background: var(--widget-bg-tertiary, rgba(0, 0, 0, 0.08));
      color: var(--widget-text, #1A1A1A);
    }

    &--complete {
      background: var(--el-color-primary, #409EFF);
      color: #ffffff;
    }
  }
}
.productivity-session {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-sm, 8px);
  min-height: 42px;
  padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);
  border-radius: var(--widget-radius-small, 4px);
  background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.44));
  transition: background var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }

  &__icon {
    flex-shrink: 0;
    font-size: 16px;
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__title {
    font-size: var(--widget-font-body, 13px);
    color: var(--widget-text, #1A1A1A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  &__meta {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
    font-variant-numeric: tabular-nums;
  }

  &__status {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--widget-text-tertiary, #5A5A5A);
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--widget-layer-fill-secondary, rgba(0, 0, 0, 0.04));
  }

  // 状态变体
  &--completed .productivity-session__icon {
    color: var(--el-color-success, #67C23A);
  }

  &--cancelled .productivity-session__icon {
    color: var(--el-color-danger, #F56C6C);
  }

  &--started .productivity-session__icon {
    color: var(--el-color-primary, #409EFF);
  }

  &__actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity var(--widget-motion-fast, 167ms) ease;
  }

  &:hover &__actions {
    opacity: 1;
  }

  .session-action-btn {
    font-size: 14px;
    color: var(--widget-text-secondary, #5A5A5A);
    cursor: pointer;
    padding: 2px;
    border-radius: 3px;
    transition: color var(--widget-motion-fast, 167ms) ease, background var(--widget-motion-fast, 167ms) ease;

    &:hover {
      color: var(--widget-text, #1A1A1A);
      background: var(--widget-title-hover, rgba(0, 0, 0, 0.06));
    }

    &--danger:hover {
      color: var(--el-color-danger, #F56C6C);
      background: var(--widget-title-hover, rgba(245, 108, 108, 0.1));
    }
  }
}

// ============================================================
// 空状态提示
// ============================================================
.productivity-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--widget-spacing-xl, 20px) var(--widget-spacing-md, 12px);
  gap: var(--widget-spacing-xs, 4px);

  &__icon {
    font-size: 32px;
    color: var(--widget-text-tertiary, #5A5A5A);
    opacity: 0.5;
  }

  &__text {
    font-size: var(--widget-font-body, 13px);
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &__hint {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark .productivity-widget {
  color: var(--widget-text, #F5F5F5);

  .productivity-capsule__icon {
    // 暗色模式胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0078D4);
  }

  .productivity-capsule__duration,
  .productivity-today__duration,
  .productivity-session__title {
    color: var(--widget-text, #F5F5F5);
  }

  .productivity-today__label,
  .productivity-chart__title,
  .productivity-session__meta {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .productivity-today__sessions,
  .productivity-chart__day-label,
  .productivity-session__status,
  .productivity-empty__hint {
    color: var(--widget-text-tertiary, #A5A5A5);
  }

  .productivity-today,
  .productivity-chart,
  .productivity-session {
    background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.08));
  }

  .productivity-chart__bar {
    background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.06));
  }

  .productivity-session__status {
    background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.06));
  }

  .productivity-session:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
  }

  .productivity-empty__icon {
    color: var(--widget-text-tertiary, #8A8A8A);
  }

  .productivity-empty__text {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .productivity-content__list::-webkit-scrollbar-thumb {
    background: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));

    &:hover {
      background: var(--widget-drag-handle, #D6D6D6);
    }
  }
}
</style>