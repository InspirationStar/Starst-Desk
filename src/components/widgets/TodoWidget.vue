<!--
  规划待办小部件
  功能：
  - 调用 todoApi.list({ size: 8 }) 获取最近待办列表
  - 列表展示待办标题、完成状态勾选、删除按钮
  - 顶部"新建"按钮，点击调用 todoApi.create() 创建空待办并刷新
  - 勾选待办调用 todoApi.toggle() 切换完成状态
  - 删除待办调用 todoApi.delete()
  - 胶囊形态：按 contentMode 三种模式显示
    - minimal：仅待办图标
    - summary：图标 + 待办数量数字
    - smart：图标 + 数量 + "条待办" + 最近待办标题预览
  - 支持暗色模式
    - 使用 --widget-text / --widget-text-secondary 颜色变量
    - 列表项间距 4px
    - 卡片使用层填充和层描边
    - 圆角 4px（小圆角）
-->
<template>
  <div class="todo-widget">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="todo"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态：按 contentMode 显示不同内容 -->
      <template #capsule>
        <div class="todo-capsule" :class="`todo-capsule--${contentMode}`">
          <el-icon class="todo-capsule__icon"><List /></el-icon>
          <!-- minimal 模式：仅图标，不显示数字 -->
          <template v-if="contentMode !== 'minimal'">
            <span class="todo-capsule__count">{{ activeCount }}</span>
            <!-- smart 模式：显示"条待办"文字 + 最近待办标题预览 -->
            <span v-if="contentMode === 'smart'" class="todo-capsule__unit">条待办</span>
            <span v-if="contentMode === 'smart'" class="todo-capsule__preview" :title="latestTodoTitle">
              {{ latestTodoTitle || '暂无待办' }}
            </span>
          </template>
        </div>
      </template>

      <!-- 展开形态：待办列表 -->
      <template #expanded>
        <widget-header
          title="规划"
          :icon="List"
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
        <div class="todo-content">
          <!-- 新建待办按钮 -->
          <div class="todo-content__toolbar">
            <el-button
              size="small"
              type="primary"
              :icon="Plus"
              :loading="creating"
              @click="handleCreate"
            >
              新建
            </el-button>
          </div>

          <!-- 待办列表 -->
          <div class="todo-content__list" v-loading="loading">
            <div
              v-for="todo in todos"
              :key="todo.id"
              class="todo-item"
              :class="{ 'is-completed': isCompleted(todo) }"
            >
              <!-- 完成状态勾选 -->
              <el-checkbox
                :model-value="isCompleted(todo)"
                class="todo-item__checkbox"
                @change="(val) => handleToggleComplete(todo, val)"
              />
              <!-- 待办标题 -->
              <div class="todo-item__title" @click="handleClickTodo(todo)">
                {{ todo.title || '无标题' }}
              </div>
              <!-- 删除按钮 -->
              <el-icon
                class="todo-item__delete"
                @click.stop="handleDelete(todo)"
              >
                <Close />
              </el-icon>
            </div>

            <!-- 空状态 -->
            <el-empty
              v-if="!loading && todos.length === 0"
              description="暂无待办"
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
import { List, Plus, Close } from '@element-plus/icons-vue'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'
import { todoApi, widgetApi, invoke, on as onEvent } from '@/utils/ipc-client'

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
} = useWidgetHeaderActions('todo')

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
// 胶囊内容模式：minimal/summary/smart
const contentMode = ref('summary')

// 待办列表
const todos = ref([])
// 加载与创建状态
const loading = ref(false)
const creating = ref(false)
// 胶囊配置变化事件取消监听函数
let unsubscribeCapsuleChanged = null

// 未完成待办数量（胶囊形态显示）
const activeCount = computed(() => {
  return todos.value.filter(t => !isCompleted(t)).length
})

// 最近待办标题预览（smart 模式显示，截断 12 字符）
const latestTodoTitle = computed(() => {
  if (!todos.value || todos.value.length === 0) return ''
  const latest = todos.value[0]
  const title = latest.title || '无标题'
  return title.length > 12 ? title.slice(0, 12) + '...' : title
})

/**
 * 判断待办是否已完成
 * todo-service 中 is_enabled=1 表示未完成（启用/激活），is_enabled=0 表示已完成
 * @param {object} todo 待办对象
 * @returns {boolean}
 */
function isCompleted (todo) {
  return Number(todo.is_enabled) === 0
}

/**
 * 加载最近 8 条待办
 */
async function loadTodos () {
  loading.value = true
  try {
    const result = await todoApi.list({ page: 1, size: 8 })
    todos.value = result?.list || []
  } catch (err) {
    console.error('[TodoWidget] 加载待办失败:', err.message)
    todos.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 新建待办
 */
async function handleCreate () {
  creating.value = true
  try {
    await todoApi.create({ title: '', is_enabled: 1 })
    await loadTodos()
  } catch (err) {
    console.error('[TodoWidget] 新建待办失败:', err.message)
  } finally {
    creating.value = false
  }
}

/**
 * 切换待办完成状态
 * @param {object} todo 待办对象
 * @param {boolean} completed 是否完成
 */
async function handleToggleComplete (todo, completed) {
  try {
    // is_enabled: 1=未完成（激活），0=已完成
    await todoApi.toggle(todo.id, completed ? 0 : 1)
    await loadTodos()
  } catch (err) {
    console.error('[TodoWidget] 切换完成状态失败:', err.message)
  }
}

/**
 * 删除待办
 * @param {object} todo 待办对象
 */
async function handleDelete (todo) {
  try {
    await todoApi.delete(todo.id)
    await loadTodos()
  } catch (err) {
    console.error('[TodoWidget] 删除待办失败:', err.message)
  }
}

/**
 * 点击待办项，通知主窗口跳转到规划页
 */
async function handleClickTodo (todo) {
  try {
    // 通过 app:navigate 通道通知主窗口打开规划页
    await invoke('app:navigate', { path: '/todo' })
  } catch (err) {
    // 主窗口可能未注册该通道，忽略错误
    console.warn('[TodoWidget] 跳转主窗口失败:', err.message)
  }
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  // 确保 newCapsule 是 boolean，避免无效值（如 undefined）导致状态错乱
  if (typeof newCapsule !== 'boolean') return
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('todo', newCapsule)
  } catch (err) {
    console.error('[TodoWidget] 切换胶囊失败:', err.message)
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('todo')
  } catch (err) {
    console.error('[TodoWidget] 隐藏失败:', err.message)
  }
}

/**
 * 加载小部件配置
 */
async function loadConfig () {
  try {
    const config = await widgetApi.get('todo')
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
    console.warn('[TodoWidget] 加载配置失败:', err.message)
  }
}

onMounted(async () => {
  await loadConfig()
  await loadTodos()
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
      if (data && data.widgetType === 'todo') {
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
})

onBeforeUnmount(() => {
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
// - 列表项：行高 38px，圆角 4px，悬停背景 rgba(0,0,0,0.04)
// - 颜色全部使用 CSS 变量，暗色模式通过变量自动适配
// ============================================================

.todo-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// 胶囊形态：参考 NoteWidget
// minimal 仅图标 / summary 图标+数字 / smart 图标+数字+辅助
// ============================================================
.todo-capsule {
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

  // 数量字号 14px 加粗
  &__count {
    font-size: var(--widget-font-title, 14px);
    font-weight: 600;
    color: var(--widget-text, #1A1A1A);
    font-variant-numeric: tabular-nums;
  }

  // smart 模式：单位文字（辅助 12px）
  &__unit {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
    white-space: nowrap;
  }

  // smart 模式：最近待办标题预览（辅助 12px）
  &__preview {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
.todo-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--widget-spacing-md, 12px);
  overflow: hidden;

  &__toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--widget-spacing-sm, 8px);

    :deep(.el-button--primary) {
      background: transparent;
      border-color: var(--widget-accent, #0067C0);
      color: var(--widget-accent, #0067C0);
      border-radius: var(--widget-radius-small, 4px);
      transition: background var(--widget-motion-fast, 167ms) ease,
                  color var(--widget-motion-fast, 167ms) ease;

      &:hover,
      &:focus {
        // 悬停填充强调色，文字反白
        background: var(--widget-accent, #0067C0);
        color: #FFFFFF;
        border-color: var(--widget-accent, #0067C0);
      }

      &:active {
        // 按下加深
        filter: brightness(0.92);
      }
    }
  }

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
// 待办列表项
// ============================================================
.todo-item {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-sm, 8px);
  // 行高 38px
  min-height: 38px;
  padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);
  // 圆角 4px（小圆角）
  border-radius: var(--widget-radius-small, 4px);
  cursor: pointer;
  transition: background var(--widget-motion-fast, 167ms) ease;

  &__checkbox {
    flex-shrink: 0;
  }

  &__title {
    flex: 1;
    // 正文 13px
    font-size: var(--widget-font-body, 13px);
    font-weight: 500;
    color: var(--widget-text, #1A1A1A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  &__delete {
    flex-shrink: 0;
    font-size: 14px;
    color: var(--widget-text-tertiary, #5A5A5A);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--widget-motion-fast, 167ms) ease,
                color var(--widget-motion-fast, 167ms) ease;

    &:hover {
      color: var(--widget-accent, #0067C0);
    }
  }

  // 悬停：显示删除按钮 + 背景高亮
  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));

    .todo-item__delete {
      opacity: 1;
    }
  }

  // 已完成状态：标题置灰 + 删除线
  &.is-completed {
    .todo-item__title {
      color: var(--widget-text-tertiary, #5A5A5A);
      text-decoration: line-through;
    }
  }
}

// ============================================================
// 暗色模式适配
// CSS 变量已在 widget.scss 中通过 html.dark 覆盖
// ============================================================
html.dark .todo-widget {
  color: var(--widget-text, #F5F5F5);

  .todo-capsule__icon {
    // 暗色模式胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0078D4);
  }

  .todo-capsule__count,
  .todo-item__title {
    color: var(--widget-text, #F5F5F5);
  }

  .todo-item:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
  }

  // 暗色模式补充：单位、预览、删除按钮、已完成态
  .todo-capsule__unit {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .todo-capsule__preview {
    color: var(--widget-text-tertiary, #8A8A8A);

    &::before {
      color: var(--widget-text-tertiary, #8A8A8A);
    }
  }

  .todo-item__delete {
    color: var(--widget-text-tertiary, #8A8A8A);

    &:hover {
      color: var(--widget-accent, #0078D4);
    }
  }

  .todo-item.is-completed .todo-item__title {
    color: var(--widget-text-tertiary, #A5A5A5);
  }

  // 暗色模式下滚动条颜色调暗
  .todo-content__list::-webkit-scrollbar-thumb {
    background: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));

    &:hover {
      background: var(--widget-drag-handle, #D6D6D6);
    }
  }
}
</style>