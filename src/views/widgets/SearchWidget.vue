<!--
  搜索小部件
  功能：
  - 胶囊形态：按 contentMode 三种模式显示
    - minimal：仅搜索图标
    - summary：图标 + "搜索"文字
    - smart：图标 + "搜索" + 最近搜索词预览
  - 展开形态：
    - 顶部 WidgetHeader（标题"搜索" + 图标）
    - 搜索输入框（带防抖）
    - 搜索范围筛选（全部/便签/待办/任务/文件）
    - 搜索结果列表（图标 + 标题 + 副标题）
    - 点击结果打开对应文件/页面
    - 搜索历史记录（无输入时显示）
    - 空状态提示
  - 使用 CapsuleContainer + WidgetHeader 组件
  - 使用 CSS 变量适配暗色模式
  - 使用 searchApi 调用后端聚合搜索
  - 使用 fileApi.openFile 打开文件结果
    - 搜索栏 Height 40，圆角 7px
    - 历史项 MinHeight 34，圆角 4px
    - 字号 12.5px（搜索栏）/ 11.5px（历史项）
-->
<template>
  <div class="search-widget">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="search"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态：按 contentMode 显示不同内容 -->
      <template #capsule>
        <div class="search-capsule" :class="`search-capsule--${contentMode}`">
          <el-icon class="search-capsule__icon"><Search /></el-icon>
          <!-- minimal 模式：仅图标 -->
          <template v-if="contentMode !== 'minimal'">
            <span class="search-capsule__label">搜索</span>
            <!-- smart 模式：显示最近搜索词预览 -->
            <span v-if="contentMode === 'smart'" class="search-capsule__preview" :title="latestQuery">
              {{ latestQuery || '点击开始' }}
            </span>
          </template>
        </div>
      </template>

      <!-- 展开形态：搜索界面 -->
      <template #expanded>
        <widget-header
          title="搜索"
          :icon="Search"
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
        <div class="search-content">
          <!-- 搜索输入框 -->
          <div class="search-bar">
            <el-input
              v-model="query"
              placeholder="搜索便签/待办/任务/文件..."
              size="small"
              clearable
              :prefix-icon="Search"
              @input="handleInput"
              @keyup.enter="handleSearch"
            />
          </div>

          <!-- 搜索范围筛选 -->
          <div class="search-scope">
            <el-radio-group v-model="scope" size="small" @change="handleScopeChange">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="note">便签</el-radio-button>
              <el-radio-button value="todo">待办</el-radio-button>
              <el-radio-button value="task">任务</el-radio-button>
              <el-radio-button value="file">文件</el-radio-button>
            </el-radio-group>
          </div>

          <!-- 搜索结果 / 历史列表 -->
          <div class="search-content__list" v-loading="loading">
            <!-- 有搜索词时显示结果 -->
            <template v-if="query.trim()">
              <div
                v-for="item in results"
                :key="`${item.type}:${item.id || item.path || item.title}`"
                class="search-result"
                @click="handleClickResult(item)"
              >
                <el-icon class="search-result__icon">
                  <component :is="getIconComponent(item.icon)" />
                </el-icon>
                <div class="search-result__text">
                  <div class="search-result__title" :title="item.title">{{ item.title }}</div>
                  <div class="search-result__subtitle" :title="item.subtitle || ''">
                    {{ item.subtitle || '' }}
                  </div>
                </div>
                <div class="search-result__type">{{ getTypeLabel(item.type) }}</div>
              </div>

              <!-- 无结果 -->
              <div v-if="!loading && results.length === 0" class="search-empty">
                <el-icon class="search-empty__icon"><Search /></el-icon>
                <div class="search-empty__text">未找到相关结果</div>
              </div>
            </template>

            <!-- 无搜索词时显示历史 -->
            <template v-else>
              <div v-if="history.length > 0" class="search-history-header">
                <span class="search-history-header__title">最近搜索</span>
                <button class="search-history-header__clear" @click="handleClearHistory">
                  清除
                </button>
              </div>
              <div
                v-for="item in history"
                :key="item.query"
                class="search-history-item"
                @click="handleClickHistory(item.query)"
              >
                <el-icon class="search-history-item__icon"><Clock /></el-icon>
                <span class="search-history-item__text">{{ item.query }}</span>
                <span class="search-history-item__count">{{ item.count }}</span>
              </div>

              <!-- 无历史空状态 -->
              <div v-if="history.length === 0" class="search-empty">
                <el-icon class="search-empty__icon"><Search /></el-icon>
                <div class="search-empty__text">开始搜索</div>
                <div class="search-empty__hint">输入关键词查找便签、待办、文件等</div>
              </div>
            </template>
          </div>
        </div>
      </template>
    </capsule-container>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  Search, Clock, EditPen, List, AlarmClock, Folder, Document,
  ChatDotRound, Setting, Pointer, Picture, DataAnalysis, Grid
} from '@element-plus/icons-vue'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { searchApi, fileApi, widgetApi, invoke, on as onEvent } from '@/utils/ipc-client'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
// 胶囊内容模式：minimal/summary/smart
const contentMode = ref('summary')

// 搜索状态
const query = ref('')
const scope = ref('all')
const results = ref([])
const history = ref([])
const loading = ref(false)

// 防抖定时器
let debounceTimer = null
// 胶囊配置变化事件取消监听函数
let unsubscribeCapsuleChanged = null

// 图标名 → 组件映射
const ICON_MAP = {
  EditPen,
  List,
  AlarmClock,
  Folder,
  Document,
  ChatDotRound,
  Setting,
  Pointer,
  Picture,
  DataAnalysis,
  Grid,
  Search
}

// 类型 → 标签映射
const TYPE_LABELS = {
  note: '便签',
  todo: '待办',
  task: '任务',
  chat: '会话',
  settings: '设置',
  file: '文件',
  folder: '文件夹'
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
} = useWidgetHeaderActions('search')

// 最近搜索词预览（smart 模式显示，截断 12 字符）
const latestQuery = computed(() => {
  if (!history.value || history.value.length === 0) return ''
  const latest = history.value[0]
  const q = latest.query || ''
  return q.length > 12 ? q.slice(0, 12) + '...' : q
})

/**
 * 获取图标组件
 */
function getIconComponent (iconName) {
  return ICON_MAP[iconName] || Document
}

/**
 * 获取类型标签
 */
function getTypeLabel (type) {
  return TYPE_LABELS[type] || type
}

/**
 * 加载搜索历史
 */
async function loadHistory () {
  try {
    const result = await searchApi.getHistory()
    history.value = result?.history || []
  } catch (err) {
    console.error('[SearchWidget] 加载历史失败:', err.message)
    history.value = []
  }
}

/**
 * 执行搜索
 */
async function handleSearch () {
  const q = query.value.trim()
  if (!q) {
    results.value = []
    return
  }
  loading.value = true
  try {
    // scope 为 'all' 时传 undefined，否则传 scope
    const type = scope.value === 'all' ? undefined : scope.value
    const result = await searchApi.query(q, { type, limit: 30 })
    results.value = result?.results || []
    // 搜索后刷新历史
    await loadHistory()
  } catch (err) {
    console.error('[SearchWidget] 搜索失败:', err.message)
    results.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 输入防抖（300ms）
 */
function handleInput () {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    handleSearch()
  }, 300)
}

/**
 * 切换搜索范围
 */
function handleScopeChange () {
  if (query.value.trim()) {
    handleSearch()
  }
}

/**
 * 点击搜索结果
 */
async function handleClickResult (item) {
  try {
    // 文件/文件夹类型：调用 fileApi 打开
    if (item.type === 'file' || item.type === 'folder') {
      const fullPath = item.payload?.fullPath || item.path
      if (fullPath) {
        if (item.type === 'folder' || item.payload?.isDirectory) {
          await fileApi.openFolder(fullPath)
        } else {
          await fileApi.openFile(fullPath)
        }
        return
      }
    }
    // 其他类型：通知主窗口跳转对应页面
    if (item.path && item.path.startsWith('/')) {
      await invoke('app:navigate', { path: item.path })
    }
  } catch (err) {
    console.warn('[SearchWidget] 打开结果失败:', err.message)
  }
}

/**
 * 点击历史项：填入搜索框并搜索
 */
function handleClickHistory (q) {
  query.value = q
  handleSearch()
}

/**
 * 清除搜索历史
 */
async function handleClearHistory () {
  try {
    await searchApi.clearHistory()
    await loadHistory()
  } catch (err) {
    console.error('[SearchWidget] 清除历史失败:', err.message)
  }
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  if (typeof newCapsule !== 'boolean') return
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('search', newCapsule)
  } catch (err) {
    console.error('[SearchWidget] 切换胶囊失败:', err.message)
    isCapsule.value = !newCapsule
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('search')
  } catch (err) {
    console.error('[SearchWidget] 隐藏失败:', err.message)
  }
}

/**
 * 加载小部件配置
 */
async function loadConfig () {
  try {
    const config = await widgetApi.get('search')
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
    console.warn('[SearchWidget] 加载配置失败:', err.message)
  }
}

onMounted(async () => {
  await loadConfig()
  await loadLockState()
  await loadGroupState()
  await loadHistory()

  // 监听胶囊配置变化事件
  try {
    unsubscribeCapsuleChanged = onEvent('widget:capsule-changed', (data) => {
      if (data && data.widgetType === 'search') {
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
})

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
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
// - 搜索栏 Height 40，圆角 7px
// - 历史项 MinHeight 34，圆角 4px
// - 字号 12.5px（搜索栏）/ 11.5px（历史项）
// - 颜色全部使用 CSS 变量，暗色模式通过变量自动适配
// ============================================================

.search-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// 胶囊形态
// ============================================================
.search-capsule {
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

  &__label {
    font-size: var(--widget-font-body, 13px);
    font-weight: 500;
    color: var(--widget-text, #1A1A1A);
    white-space: nowrap;
  }

  &__preview {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
.search-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--widget-spacing-md, 12px);
  overflow: hidden;
  gap: var(--widget-spacing-sm, 8px);

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
// 搜索栏
// ============================================================
.search-bar {
  .el-input {
    :deep(.el-input__wrapper) {
      border-radius: 7px;
    }
  }
}

// ============================================================
// 搜索范围筛选
// ============================================================
.search-scope {
  :deep(.el-radio-button__inner) {
    padding: 4px 8px;
    font-size: var(--widget-font-caption, 12px);
  }
}

// ============================================================
// 搜索结果项
// ============================================================
.search-result {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-sm, 8px);
  min-height: 42px;
  padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);
  border-radius: var(--widget-radius-small, 4px);
  background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.44));
  cursor: pointer;
  transition: background var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }

  &__icon {
    flex-shrink: 0;
    font-size: 16px;
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &__text {
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

  &__subtitle {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  &__type {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--widget-text-tertiary, #5A5A5A);
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--widget-layer-fill-secondary, rgba(0, 0, 0, 0.04));
  }
}

// ============================================================
// 搜索历史
// ============================================================
.search-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--widget-spacing-xs, 4px);
  margin-bottom: var(--widget-spacing-xs, 4px);

  &__title {
    font-size: var(--widget-font-caption, 12px);
    font-weight: 600;
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &__clear {
    background: transparent;
    border: none;
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-tertiary, #5A5A5A);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    transition: background var(--widget-motion-fast, 167ms) ease;

    &:hover {
      background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
      color: var(--widget-text-secondary, #5A5A5A);
    }
  }
}

.search-history-item {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-sm, 8px);
  min-height: 34px;
  padding: 0 var(--widget-spacing-sm, 8px);
  border-radius: var(--widget-radius-small, 4px);
  cursor: pointer;
  transition: background var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }

  &__icon {
    flex-shrink: 0;
    font-size: 14px;
    color: var(--widget-text-tertiary, #5A5A5A);
  }

  &__text {
    flex: 1;
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text, #1A1A1A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__count {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--widget-text-tertiary, #5A5A5A);
    font-variant-numeric: tabular-nums;
  }
}

// ============================================================
// 空状态提示
// ============================================================
.search-empty {
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
html.dark .search-widget {
  color: var(--widget-text, #F5F5F5);

  .search-capsule__icon {
    // 暗色模式胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0078D4);
  }

  .search-capsule__label,
  .search-result__title,
  .search-history-item__text {
    color: var(--widget-text, #F5F5F5);
  }

  .search-result__subtitle,
  .search-history-header__title {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .search-result__type,
  .search-history-item__count,
  .search-empty__hint {
    color: var(--widget-text-tertiary, #A5A5A5);
  }

  .search-result:hover,
  .search-history-item:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
  }

  .search-result {
    background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.08));

    &__type {
      background: var(--widget-layer-fill-secondary, rgba(255, 255, 255, 0.06));
    }
  }

  .search-empty__icon {
    color: var(--widget-text-tertiary, #8A8A8A);
  }

  .search-empty__text {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  .search-content__list::-webkit-scrollbar-thumb {
    background: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));

    &:hover {
      background: var(--widget-drag-handle, #D6D6D6);
    }
  }
}
</style>