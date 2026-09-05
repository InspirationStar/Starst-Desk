<!--
  随记格子组件（原"快速记录"改名，与便签功能合并）
  职责：作为便签的快速记录入口
  - 输入文字后直接调用 note-store.createNote 创建便签（标题为输入内容，无提醒）
  - 创建后清空输入框并显示成功提示
  - 展示最近便签列表（数据来自 notes 表，与便签页共用）
  - 胶囊形态显示便签总数
-->
<template>
  <div class="quick-capture-widget" :class="paperStyleClass">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="quick-capture"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态 -->
      <template #capsule>
        <div class="qc-capsule">
          <el-icon class="qc-capsule__icon"><EditPen /></el-icon>
          <span class="qc-capsule__count">{{ noteStore.list.length }}</span>
        </div>
      </template>

      <!-- 展开形态 -->
      <template #expanded>
        <widget-header
          title="随记"
          :icon="EditPen"
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
        >
          <template #actions>
            <!-- 纸张样式切换 -->
            <el-dropdown @command="handleSetPaperStyle">
              <el-button class="qc-header-btn" icon="Notebook" circle />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="lines">横线</el-dropdown-item>
                  <el-dropdown-item command="grid">方格</el-dropdown-item>
                  <el-dropdown-item command="blank">空白</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </widget-header>

        <!-- 快速创建便签入口 -->
        <div class="qc-new-item">
          <el-input
            v-model="newItemContent"
            type="textarea"
            :rows="3"
            placeholder="输入随记内容，回车快速保存为便签..."
            class="qc-new-item__input"
            @keydown.enter.ctrl="handleCreateItem"
          />
          <div class="qc-new-item__actions">
            <el-button size="small" type="primary" :loading="creating" @click="handleCreateItem">
              <el-icon><Check /></el-icon> 保存便签
            </el-button>
          </div>
        </div>

        <!-- 最近便签列表（数据来自 notes 表） -->
        <div class="qc-list win11-scrollbar">
          <div
            v-for="note in recentNotes"
            :key="note.id"
            class="qc-item"
            :class="{ 'is-pinned': Number(note.is_pinned) === 1, 'is-completed': Number(note.is_completed) === 1 }"
          >
            <!-- 置顶标记 -->
            <el-icon
              v-if="Number(note.is_pinned) === 1"
              class="qc-item__pin"
            >
              <Pointer />
            </el-icon>

            <!-- 内容 -->
            <div class="qc-item__content">
              <div class="qc-item__text">{{ note.title || '无标题' }}</div>
              <div class="qc-item__meta">
                <span class="qc-item__time">{{ formatTime(note.updated_at) }}</span>
                <span v-if="note.reminder_time" class="qc-item__reminder">
                  <el-icon><Clock /></el-icon>
                  {{ formatReminder(note.reminder_time) }}
                </span>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="qc-item__actions">
              <el-tooltip :content="Number(note.is_pinned) === 1 ? '取消置顶' : '置顶'" placement="top">
                <el-button size="small" text @click.stop="handleTogglePin(note)">
                  <el-icon><Pointer /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="删除" placement="top">
                <el-button size="small" text @click.stop="handleDeleteItem(note)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-if="recentNotes.length === 0 && !noteStore.loading" class="qc-empty">
            <el-icon size="48"><Notebook /></el-icon>
            <p>暂无随记</p>
            <p class="qc-empty__hint">输入内容后按 Ctrl+Enter 快速保存为便签</p>
          </div>
        </div>
      </template>
    </capsule-container>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { EditPen, Pointer, Delete, Notebook, Check, Clock } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'
import { useNoteStore } from '@/stores/note-store'
import { useQuickCaptureStore } from '@/stores/quick-capture-store'
import { widgetApi } from '@/utils/ipc-client'

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
} = useWidgetHeaderActions('quick-capture')

// 便签 Store（数据共用 notes 表）
const noteStore = useNoteStore()
// 随记 Store（仅用于纸张样式等本地偏好）
const quickCaptureStore = useQuickCaptureStore()

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
const contentMode = ref('summary')

// 新建记录输入内容
const newItemContent = ref('')
// 创建中状态
const creating = ref(false)

// 纸张样式类
const paperStyleClass = computed(() => {
  return `paper-style-${quickCaptureStore.paperStyle}`
})

// 最近便签列表（取前 20 条，按 updated_at 倒序）
const recentNotes = computed(() => {
  const list = Array.isArray(noteStore.list) ? noteStore.list : []
  return list.slice(0, 20)
})

/**
 * 创建便签（随记快速入口）
 * 输入文字后直接调用 note-store.createNote 创建便签
 * 标题为输入内容，无提醒，默认颜色 yellow
 */
async function handleCreateItem () {
  const content = newItemContent.value.trim()
  if (!content) {
    ElMessage.warning('请输入随记内容')
    return
  }

  creating.value = true
  try {
    const result = await noteStore.createNote({
      title: content,
      body: '',
      color_tag: 'yellow',
      reminder_time: null,
      is_pinned: 0
    })
    if (result) {
      ElMessage.success('已保存为便签')
      newItemContent.value = ''
    } else {
      ElMessage.error(noteStore.error || '保存失败')
    }
  } catch (err) {
    console.error('[QuickCaptureWidget] 创建便签失败:', err)
    ElMessage.error(err.message || '保存失败')
  } finally {
    creating.value = false
  }
}

/**
 * 切换便签置顶状态
 */
async function handleTogglePin (note) {
  try {
    const success = await noteStore.togglePin(note)
    if (success) {
      ElMessage.success(Number(note.is_pinned) === 1 ? '已取消置顶' : '已置顶')
      await noteStore.fetchNotes()
    } else {
      ElMessage.error('操作失败')
    }
  } catch (err) {
    console.error('[QuickCaptureWidget] 切换置顶失败:', err)
    ElMessage.error('操作失败')
  }
}

/**
 * 删除便签
 */
async function handleDeleteItem (note) {
  try {
    await ElMessageBox.confirm(
      `确定删除便签"${note.title || '无标题'}"吗？此操作不可恢复。`,
      '删除确认',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
    const success = await noteStore.delete(note.id)
    if (success) {
      ElMessage.success('删除成功')
    } else {
      ElMessage.error('删除失败')
    }
  } catch (err) {
    // 用户取消或操作失败
    if (err && err.message) {
      console.error('[QuickCaptureWidget] 删除失败:', err)
    }
  }
}

/**
 * 格式化时间
 */
function formatTime (time) {
  if (!time) return ''
  const t = dayjs(time)
  const now = dayjs()
  if (t.isSame(now, 'day')) return `今天 ${t.format('HH:mm')}`
  if (t.isSame(now.subtract(1, 'day'), 'day')) return `昨天 ${t.format('HH:mm')}`
  if (t.isSame(now, 'year')) return t.format('MM-DD HH:mm')
  return t.format('YYYY-MM-DD')
}

/**
 * 格式化提醒时间
 */
function formatReminder (time) {
  if (!time) return ''
  const t = dayjs(time)
  const now = dayjs()
  if (t.isSame(now, 'day')) return t.format('今天 HH:mm')
  if (t.isSame(now.add(1, 'day'), 'day')) return t.format('明天 HH:mm')
  return t.format('MM-DD HH:mm')
}

/**
 * 设置纸张样式
 */
function handleSetPaperStyle (style) {
  quickCaptureStore.setPaperStyle(style)
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  if (typeof newCapsule !== 'boolean') return
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('quick-capture', newCapsule)
  } catch (err) {
    console.error('[QuickCaptureWidget] 切换胶囊失败:', err.message)
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('quick-capture')
  } catch (err) {
    console.error('[QuickCaptureWidget] 隐藏失败:', err.message)
  }
}

onMounted(async () => {
  // 加载便签列表（数据共用 notes 表）
  await noteStore.fetchNotes()
  // 加载锁状态并订阅锁变化广播
  await loadLockState()
  await loadGroupState()
  try {
    subscribeLocksChanged()
  } catch (err) {
    // 忽略监听注册失败
  }

  // 加载小部件配置
  try {
    const config = await widgetApi.get('quick-capture')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      // 读取折叠行为
      if (config.collapse_behavior) {
        collapseBehavior.value = config.collapse_behavior
      }
    }
  } catch (err) {
    console.warn('[QuickCaptureWidget] 加载配置失败:', err.message)
  }
})

onBeforeUnmount(() => {
  cleanupLocks()
})
</script>

<style scoped lang="scss">
// ============================================================
// QuickCaptureWidget 样式
// ============================================================

.quick-capture-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// 纸张样式
// ============================================================
.paper-style-lines {
  background-image: repeating-linear-gradient(
    transparent,
    transparent 27px,
    var(--widget-divider, rgba(208, 208, 208, 0.62)) 27px,
    var(--widget-divider, rgba(208, 208, 208, 0.62)) 28px
  );
  background-position: 0 var(--widget-spacing-sm, 8px);
}

.paper-style-grid {
  background-image:
    linear-gradient(var(--widget-divider, rgba(208, 208, 208, 0.3)) 1px, transparent 1px),
    linear-gradient(90deg, var(--widget-divider, rgba(208, 208, 208, 0.3)) 1px, transparent 1px);
  background-size: 20px 20px;
}

.paper-style-blank {
  background: transparent;
}

// ============================================================
// 胶囊形态
// ============================================================
.qc-capsule {
  display: flex;
  align-items: center;
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  gap: var(--widget-spacing-sm, 8px);

  &__icon {
    font-size: 20px;
    color: var(--widget-accent, #0067C0);
  }

  &__count {
    font-size: var(--widget-font-title, 14px);
    font-weight: 600;
    color: var(--widget-text, #1A1A1A);
  }
}

// ============================================================
// 新建记录
// ============================================================
.qc-new-item {
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  border-bottom: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
}

.qc-new-item__input {
  margin-bottom: var(--widget-spacing-sm, 8px);
}

.qc-new-item__actions {
  display: flex;
  gap: var(--widget-spacing-xs, 4px);
}

// ============================================================
// 记录列表
// ============================================================
.qc-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--widget-spacing-sm, 8px);
}

.qc-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--widget-spacing-sm, 8px);
  padding: var(--widget-spacing-sm, 8px);
  border-radius: var(--widget-radius-medium, 6px);
  cursor: default;
  transition: background var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));

    // 悬浮时显示操作按钮
    .qc-item__actions {
      opacity: 1;
    }
  }

  &.is-pinned {
    background: var(--widget-accent-wash, rgba(0, 103, 192, 0.09));

    &:hover {
      background: var(--widget-accent-wash, rgba(0, 103, 192, 0.12));
    }
  }

  &.is-completed {
    .qc-item__text {
      text-decoration: line-through;
      opacity: 0.65;
    }
  }
}

html.dark .qc-item:hover {
  background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
}

html.dark .qc-item.is-pinned {
  background: var(--widget-accent-wash, rgba(0, 120, 212, 0.15));
}

.qc-item__pin {
  position: absolute;
  top: var(--widget-spacing-xs, 4px);
  right: var(--widget-spacing-xs, 4px);
  font-size: 14px;
  color: var(--widget-accent, #0067C0);
}

.qc-item__content {
  flex: 1;
  min-width: 0;
}

.qc-item__text {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text, #1A1A1A);
  line-height: 1.5;
  word-break: break-all;
}

.qc-item__meta {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-sm, 8px);
  margin-top: 4px;
  flex-wrap: wrap;
}

.qc-item__time {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
}

.qc-item__reminder {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
}

.qc-item__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--widget-motion-fast, 167ms) ease;
  flex-shrink: 0;
}

// ============================================================
// 空状态
// ============================================================
.qc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--widget-spacing-sm, 8px);
  padding: var(--widget-spacing-xl, 20px);
  color: var(--widget-text-secondary, #5A5A5A);

  &__hint {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
  }
}

// ============================================================
// 标题栏按钮
// ============================================================
.qc-header-btn {
  min-width: 32px;
  height: 32px;
}

// ============================================================
// 暗色模式
// ============================================================
html.dark .quick-capture-widget {
  color: var(--widget-text, #F5F5F5);
}

html.dark .qc-item__text,
html.dark .qc-item__time,
html.dark .qc-item__reminder {
  color: var(--widget-text, #F5F5F5);
}

html.dark .qc-item__pin {
  color: var(--widget-accent, #0078D4);
}
</style>


// 暗色模式补充：胶囊计数、分割线、空状态、纸张样式
html.dark .qc-capsule__count {
  color: var(--widget-text, #F5F5F5);
}

html.dark .qc-new-item {
  border-bottom-color: var(--widget-divider, rgba(60, 60, 60, 0.62));
}

html.dark .qc-empty {
  color: var(--widget-text-secondary, #A5A5A5);

  .qc-empty__hint {
    color: var(--widget-text-tertiary, #8A8A8A);
  }
}

// 暗色模式下纸张样式背景线调暗
html.dark .paper-style-lines {
  background-image: repeating-linear-gradient(
    transparent,
    transparent 27px,
    var(--widget-divider, rgba(60, 60, 60, 0.62)) 27px,
    var(--widget-divider, rgba(60, 60, 60, 0.62)) 28px
  );
}

html.dark .paper-style-grid {
  background-image:
    linear-gradient(var(--widget-divider, rgba(60, 60, 60, 0.3)) 1px, transparent 1px),
    linear-gradient(90deg, var(--widget-divider, rgba(60, 60, 60, 0.3)) 1px, transparent 1px);
}
