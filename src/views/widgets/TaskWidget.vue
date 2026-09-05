<!--
  任务小部件
  功能：
  - 调用 taskApi.list 获取今日待办任务
  - 复选框勾选完成任务（调用 taskApi.toggle）
  - 任务名称、执行时间展示
  - 胶囊形态：按 contentMode 三种模式显示
    - minimal：仅任务图标
    - summary：图标 + 待办任务数
    - smart：图标 + 待办数 + 完成进度百分比
  - 监听 task:executed 事件刷新列表
  - 支持暗色模式
    - 使用 --widget-text / --widget-text-secondary 颜色变量
    - 复选框和文字间距 8px
    - 卡片样式同便签（层填充 + 层描边 + 中圆角 6px）
-->
<template>
  <div class="task-widget">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="task"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态：按 contentMode 显示不同内容 -->
      <template #capsule>
        <div class="task-capsule" :class="`task-capsule--${contentMode}`">
          <el-icon class="task-capsule__icon"><AlarmClock /></el-icon>
          <!-- minimal 模式：仅图标，不显示数字 -->
          <template v-if="contentMode !== 'minimal'">
            <span class="task-capsule__count">{{ pendingCount }}</span>
            <!-- smart 模式：显示完成进度百分比 -->
            <span v-if="contentMode === 'smart'" class="task-capsule__progress">
              {{ progressPercent }}%
            </span>
          </template>
        </div>
      </template>

      <!-- 展开形态：任务列表 -->
      <template #expanded>
        <widget-header
          title="任务"
          :icon="AlarmClock"
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
        <div class="task-content">
          <div class="task-content__list" v-loading="loading">
            <div
              v-for="task in tasks"
              :key="task.id"
              class="task-item"
              :class="{ 'is-done': isDone(task) }"
            >
              <!-- 完成状态复选框 -->
              <el-checkbox
                :model-value="isDone(task)"
                @change="(val) => handleToggle(task, val)"
              />
              <!-- 任务信息 -->
              <div class="task-item__info">
                <div class="task-item__name">{{ task.name }}</div>
                <div class="task-item__time" v-if="task.next_execute_time">
                  {{ formatTime(task.next_execute_time) }}
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <el-empty
              v-if="!loading && tasks.length === 0"
              description="今日无待办"
              :image-size="60"
            />
          </div>
        </div>
      </template>
    </capsule-container>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { AlarmClock } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { taskApi, widgetApi, on } from '@/utils/ipc-client'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
// 胶囊内容模式：minimal/summary/smart
const contentMode = ref('summary')

// 任务列表
const tasks = ref([])
const loading = ref(false)
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
} = useWidgetHeaderActions('task')

// 未完成任务数量
const pendingCount = computed(() => {
  return tasks.value.filter(t => !isDone(t)).length
})

// 已完成任务数量
const completedCount = computed(() => {
  return tasks.value.filter(t => isDone(t)).length
})

// 完成进度百分比（smart 模式显示）
// 总数为 0 时显示 0，避免除零错误
const progressPercent = computed(() => {
  const total = tasks.value.length
  if (total === 0) return 0
  return Math.round((completedCount.value / total) * 100)
})

/**
 * 判断任务是否已完成/已执行
 * 任务模块中 is_enabled=0 视为已禁用（已完成）
 */
function isDone (task) {
  return task.is_enabled === 0 || task.is_enabled === false
}

/**
 * 加载今日待办任务
 */
async function loadTasks () {
  loading.value = true
  try {
    const result = await taskApi.list({ filter: 'today', page: 1, size: 20 })
    // 兼容不同响应结构
    if (Array.isArray(result)) {
      tasks.value = result
    } else {
      tasks.value = result?.list || []
    }
  } catch (err) {
    console.error('[TaskWidget] 加载任务失败:', err.message)
    tasks.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 切换任务完成状态
 */
async function handleToggle (task, enabled) {
  // enabled 为 false 表示禁用（标记为已完成）
  try {
    await taskApi.toggle(task.id, enabled)
    // 本地同步更新
    const index = tasks.value.findIndex(t => t.id === task.id)
    if (index !== -1) {
      tasks.value[index] = { ...tasks.value[index], is_enabled: enabled ? 1 : 0 }
    }
  } catch (err) {
    console.error('[TaskWidget] 切换任务状态失败:', err.message)
    // 失败时刷新列表恢复正确状态
    await loadTasks()
  }
}

/**
 * 格式化执行时间
 */
function formatTime (time) {
  if (!time) return ''
  return dayjs(time).format('HH:mm')
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
    await widgetApi.toggleCapsule('task', newCapsule)
  } catch (err) {
    console.error('[TaskWidget] 切换胶囊失败:', err.message)
    // 失败时回滚
    isCapsule.value = !newCapsule
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('task')
  } catch (err) {
    console.error('[TaskWidget] 隐藏失败:', err.message)
  }
}

/**
 * 加载小部件配置
 */
async function loadConfig () {
  try {
    const config = await widgetApi.get('task')
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
    console.warn('[TaskWidget] 加载配置失败:', err.message)
  }
}

// task:executed 事件取消监听函数
let unsubscribeTaskExecuted = null

onMounted(async () => {
  await loadConfig()
  await loadLockState()
  await loadGroupState()
  await loadTasks()

  // 监听任务执行事件，自动刷新列表
  try {
    unsubscribeTaskExecuted = on('task:executed', () => {
      loadTasks()
    })
  } catch (err) {
    // 忽略监听注册失败
  }

  // 监听胶囊配置变化事件（来自设置页 widget:update）
  try {
    unsubscribeCapsuleChanged = on('widget:capsule-changed', (data) => {
      if (data && data.widgetType === 'task') {
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
  if (unsubscribeTaskExecuted) {
    unsubscribeTaskExecuted()
    unsubscribeTaskExecuted = null
  }
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
// - 任务列表项：复选框+文字，行高 36px，圆角 4px，悬停背景 rgba(0,0,0,0.04)
// - 完成态任务：删除线 + 辅助色
// - 颜色全部使用 CSS 变量，暗色模式通过变量自动适配
// ============================================================

.task-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// minimal 仅图标 / summary 图标+数字 / smart 图标+数字+辅助
// ============================================================
.task-capsule {
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

  // smart 模式：完成进度百分比（辅助 12px）
  &__progress {
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
.task-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--widget-spacing-md, 12px);
  overflow: hidden;

  &__list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--widget-spacing-xs, 4px);
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
}

// ============================================================
// 任务列表项
// 完成态：删除线 + 辅助色
// ============================================================
.task-item {
  display: flex;
  align-items: center;
  // 行高 36px
  min-height: 36px;
  // 复选框和文字间距 8px
  gap: var(--widget-spacing-sm, 8px);
  padding: 0 var(--widget-spacing-sm, 8px);
  // 圆角 4px（小圆角）
  border-radius: var(--widget-radius-small, 4px);
  transition: background var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }

  &__info {
    flex: 1;
    min-width: 0;
  }

  &__name {
    // 正文 13px
    font-size: var(--widget-font-body, 13px);
    color: var(--widget-text, #1A1A1A);
    line-height: 1.4;
    word-break: break-all;
  }

  &__time {
    // 辅助 12px
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
    margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }

  // 已完成状态：删除线 + 辅助色
  &.is-done {
    .task-item__name {
      text-decoration: line-through;
      color: var(--widget-text-tertiary, #5A5A5A);
    }
  }
}

// ============================================================
// 暗色模式适配
// CSS 变量已在 widget.scss 中通过 html.dark 覆盖
// 此处仅保留 scoped 选择器内的变量回退兼容
// ============================================================
html.dark .task-widget {
  color: var(--widget-text, #F5F5F5);

  .task-capsule__icon {
    // 暗色模式胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0078D4);
  }

  .task-capsule__count,
  .task-item__name {
    color: var(--widget-text, #F5F5F5);
  }

  .task-item__time {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .task-item:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
  }

  .task-item.is-done .task-item__name {
    color: var(--widget-text-tertiary, #A5A5A5);
  }

  // 暗色模式补充：进度百分比、滚动条
  .task-capsule__progress {
    color: var(--widget-text-secondary, #A5A5A5);

    &::before {
      color: var(--widget-text-tertiary, #8A8A8A);
    }
  }

  .task-content__list::-webkit-scrollbar-thumb {
    background: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));

    &:hover {
      background: var(--widget-drag-handle, #D6D6D6);
    }
  }
}
</style>
