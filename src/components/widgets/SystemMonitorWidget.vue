<!--
  系统监控小部件
  职责：展示 CPU、内存、磁盘使用率
  独立组件，未注册到 widget-registry
  可通过 /widgets/settings 启用（需 leader 协调注册）
  支持胶囊折叠与 WidgetHeader 窗口按钮操作
-->
<template>
  <div class="system-monitor-widget">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="system-monitor"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态：按 contentMode 显示不同内容 -->
      <template #capsule>
        <div class="monitor-capsule" :class="`monitor-capsule--${contentMode}`">
          <el-icon class="monitor-capsule__icon"><Monitor /></el-icon>
          <!-- minimal 模式：仅图标，不显示数据 -->
          <template v-if="contentMode !== 'minimal'">
            <span class="monitor-capsule__value">{{ cpuUsage.toFixed(0) }}%</span>
            <!-- smart 模式：显示 CPU% + 内存% -->
            <span v-if="contentMode === 'smart'" class="monitor-capsule__divider">·</span>
            <span v-if="contentMode === 'smart'" class="monitor-capsule__value">{{ memoryUsage.toFixed(0) }}%</span>
          </template>
        </div>
      </template>

      <!-- 展开形态：监控详情 -->
      <template #expanded>
        <widget-header
          title="系统监控"
          :icon="Monitor"
          :is-capsule="isCapsule"
          :is-position-locked="isPositionLocked"
          :is-size-locked="isSizeLocked"
          :is-always-on-top="isAlwaysOnTop"
          :display-name="displayName"
          :collapse-behavior="collapseBehavior"
          :has-group="hasGroup"
          :chrome-mode="chromeMode"
          @toggle-capsule="handleToggleCapsule"
          @close="handleClose"
          @toggle-position-lock="handleTogglePositionLock"
          @toggle-size-lock="handleToggleSizeLock"
          @reset-position="handleResetPosition"
          @toggle-always-on-top="handleToggleAlwaysOnTop"
          @rename="handleRename"
          @change-collapse-behavior="handleChangeCollapseBehavior"
          @change-chrome-mode="handleChangeChromeMode"
          @group-merge="handleGroupMerge"
          @group-detach="handleGroupDetach"
          @group-dissolve="handleGroupDissolve"
          @open-settings="handleOpenSettings"
          @disable="handleDisable"
        />
        <div class="monitor-content">
          <div class="metrics">
            <!-- CPU 使用率 -->
            <div class="metric-item">
              <div class="metric-header">
                <span class="metric-label">CPU</span>
                <span class="metric-value">{{ cpuUsage.toFixed(1) }}%</span>
              </div>
              <el-progress
                :percentage="cpuUsage"
                :stroke-width="8"
                :color="getMetricColor(cpuUsage)"
                :show-text="false"
              />
            </div>

            <!-- 内存使用率 -->
            <div class="metric-item">
              <div class="metric-header">
                <span class="metric-label">内存</span>
                <span class="metric-value">{{ memoryUsage.toFixed(1) }}%</span>
              </div>
              <el-progress
                :percentage="memoryUsage"
                :stroke-width="8"
                :color="getMetricColor(memoryUsage)"
                :show-text="false"
              />
              <div class="metric-detail">
                {{ formatBytes(usedMemory) }} / {{ formatBytes(totalMemory) }}
              </div>
            </div>

            <!-- 磁盘使用率 -->
            <div class="metric-item">
              <div class="metric-header">
                <span class="metric-label">系统盘</span>
                <span class="metric-value">{{ diskUsage.toFixed(1) }}%</span>
              </div>
              <el-progress
                :percentage="diskUsage"
                :stroke-width="8"
                :color="getMetricColor(diskUsage)"
                :show-text="false"
              />
              <div class="metric-detail">
                {{ formatBytes(usedDisk) }} / {{ formatBytes(totalDisk) }}
              </div>
            </div>
          </div>

          <div class="widget-footer">
            <span class="update-time">更新于 {{ lastUpdate }}</span>
          </div>
        </div>
      </template>
    </capsule-container>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { Monitor } from '@element-plus/icons-vue'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'
import { invoke, widgetApi, on as onEvent } from '@/utils/ipc-client'

// 头部按钮操作（位置锁/大小锁/重置位置/置顶）
const {
  isPositionLocked,
  isSizeLocked,
  isAlwaysOnTop,
  displayName,
  hasGroup,
  chromeMode,
  handleTogglePositionLock,
  handleToggleSizeLock,
  handleResetPosition,
  handleToggleAlwaysOnTop,
  handleRename,
  handleChangeCollapseBehavior,
  handleChangeChromeMode,
  handleGroupMerge,
  handleGroupDetach,
  handleGroupDissolve,
  handleOpenSettings,
  handleDisable,
  loadLockState,
  loadGroupState,
  subscribeLocksChanged,
  cleanupLocks
} = useWidgetHeaderActions('system-monitor')

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
// 胶囊内容模式：minimal/summary/smart
const contentMode = ref('summary')

// 监控数据
const cpuUsage = ref(0)
const memoryUsage = ref(0)
const diskUsage = ref(0)
const totalMemory = ref(0)
const usedMemory = ref(0)
const totalDisk = ref(0)
const usedDisk = ref(0)
const lastUpdate = ref('--')

// 轮询定时器
let pollTimer = null
// 胶囊配置变化事件取消监听函数
let unsubscribeCapsuleChanged = null

/**
 * 格式化字节
 */
function formatBytes (bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 根据使用率返回颜色
 */
function getMetricColor (usage) {
  if (usage < 50) return '#67c23a'
  if (usage < 80) return '#e6a23c'
  return '#f56c6c'
}

/**
 * 拉取监控数据
 */
async function fetchMetrics () {
  try {
    const data = await invoke('system:setting:get', { key: 'system_metrics' })
    if (data?.value) {
      const metrics = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
      cpuUsage.value = metrics.cpuUsage || 0
      memoryUsage.value = metrics.memoryUsage || 0
      diskUsage.value = metrics.diskUsage || 0
      totalMemory.value = metrics.totalMemory || 0
      usedMemory.value = metrics.usedMemory || 0
      totalDisk.value = metrics.totalDisk || 0
      usedDisk.value = metrics.usedDisk || 0
      lastUpdate.value = new Date().toLocaleTimeString()
    }
  } catch (err) {
    console.debug('[SystemMonitor] 拉取数据失败:', err.message)
  }
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  if (typeof newCapsule !== 'boolean') return
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('system-monitor', newCapsule)
  } catch (err) {
    console.error('[SystemMonitor] 切换胶囊失败:', err.message)
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('system-monitor')
  } catch (err) {
    console.error('[SystemMonitor] 隐藏失败:', err.message)
  }
}

/**
 * 加载小部件配置
 */
async function loadConfig () {
  try {
    const config = await widgetApi.get('system-monitor')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      // 读取折叠行为
      if (config.collapse_behavior) {
        collapseBehavior.value = config.collapse_behavior
      }
      if (config.compact_content_mode) {
        contentMode.value = config.compact_content_mode
      }
    }
  } catch (err) {
    console.warn('[SystemMonitor] 加载配置失败:', err.message)
  }
}

const handleVisibilityChange = () => {
  if (document.hidden) {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  } else {
    fetchMetrics()
    pollTimer = setInterval(fetchMetrics, 30000)
  }
}

onMounted(async () => {
  await loadConfig()
  fetchMetrics()
  pollTimer = setInterval(fetchMetrics, 30000)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  // 加载锁状态并订阅锁变化广播
  await loadLockState()
  await loadGroupState()
  try {
    subscribeLocksChanged()
  } catch (err) {
    // 忽略监听注册失败
  }

  // 监听胶囊配置变化事件（来自设置页 widget:update）
  try {
    unsubscribeCapsuleChanged = onEvent('widget:capsule-changed', (data) => {
      if (data && data.widgetType === 'system-monitor') {
        if (data.isCapsule !== undefined) {
          isCapsule.value = !!Number(data.isCapsule)
        }

        // 同步折叠行为
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
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (unsubscribeCapsuleChanged) {
    unsubscribeCapsuleChanged()
    unsubscribeCapsuleChanged = null
  }
  cleanupLocks()
})
</script>

<style scoped lang="scss">
.system-monitor-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// 胶囊形态
// ============================================================
.monitor-capsule {
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

  &__value {
    font-size: var(--widget-font-title, 14px);
    font-weight: 600;
    color: var(--widget-text, #1A1A1A);
    font-variant-numeric: tabular-nums;
  }

  &__divider {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
  }

  // minimal 模式：仅图标，居中
  &--minimal {
    gap: 0;
    padding: var(--widget-spacing-xs, 4px);
  }

  // summary 模式：图标 + CPU%，居中
  &--summary {
    gap: var(--widget-spacing-xs, 4px);
  }

  // smart 模式：图标 + CPU% + 内存%，左对齐
  &--smart {
    justify-content: flex-start;
    gap: var(--widget-spacing-xs, 4px);
  }
}

// ============================================================
// 展开形态内容
// ============================================================
.monitor-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--widget-spacing-md, 12px);
  overflow: hidden;
}

.metrics {
  display: flex;
  flex-direction: column;
  gap: var(--widget-spacing-md, 12px);
  flex: 1;
}

.metric-item {
  .metric-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: var(--widget-spacing-xs, 4px);

    .metric-label {
      font-size: var(--widget-font-caption, 12px);
      color: var(--widget-text-secondary, #5A5A5A);
    }

    .metric-value {
      font-size: var(--widget-font-caption, 12px);
      font-weight: 600;
      color: var(--widget-text, #1A1A1A);
    }
  }

  .metric-detail {
    font-size: var(--widget-font-caption, 11px);
    color: var(--widget-text-tertiary, #5A5A5A);
    margin-top: var(--widget-spacing-xs, 2px);
  }
}

.widget-footer {
  margin-top: var(--widget-spacing-md, 12px);
  text-align: right;

  .update-time {
    font-size: var(--widget-font-caption, 11px);
    color: var(--widget-text-tertiary, #5A5A5A);
  }
}

// 暗色模式适配
html.dark .system-monitor-widget {
  color: var(--widget-text, #F5F5F5);

  .monitor-capsule__icon {
    // 暗色模式胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0078D4);
  }

  .monitor-capsule__value {
    color: var(--widget-text, #F5F5F5);
  }

  // 暗色模式补充：分隔符、指标标签、指标值、详情、更新时间
  .monitor-capsule__divider {
    color: var(--widget-text-tertiary, #8A8A8A);
  }

  .metric-label {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .metric-value {
    color: var(--widget-text, #F5F5F5);
  }

  .metric-detail {
    color: var(--widget-text-tertiary, #8A8A8A);
  }

  .update-time {
    color: var(--widget-text-tertiary, #8A8A8A);
  }
}
</style>
