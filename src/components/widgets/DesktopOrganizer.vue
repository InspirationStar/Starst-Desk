<!--
  桌面整理组件
  功能：
  - 扫描桌面文件
  - 按类型分类预览
  - 选择目标文件夹
  - 执行整理
  - 显示历史记录
-->
<template>
  <div class="desktop-organizer">
    <widget-header
      title="桌面整理"
      :icon="FolderOpened"
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

    <div class="organizer-content">
      <!-- 扫描按钮 -->
      <div class="organizer-actions">
        <el-button
          type="primary"
          class="organizer-btn"
          :loading="scanning"
          @click="handleScan"
        >
          <el-icon><Search /></el-icon>
          扫描桌面
        </el-button>
      </div>

      <!-- 统计信息 -->
      <div v-if="scanResult" class="organizer-stats">
        <el-tag type="info">共 {{ scanResult.total }} 个项目</el-tag>
        <el-tag v-for="(count, category) in categoryCounts" :key="category" :type="getCategoryType(category)">
          {{ FILE_CATEGORIES[category]?.label || category }}: {{ count }}
        </el-tag>
      </div>

      <!-- 分类预览 -->
      <div v-if="scanResult && !showPreview" class="organizer-categories">
        <div
          v-for="(items, category) in categorizedFiles"
          :key="category"
          class="category-item"
          @click="previewCategory(category)"
        >
          <div class="category-icon">
            <el-icon><component :is="getCategoryIcon(category)" /></el-icon>
          </div>
          <div class="category-info">
            <div class="category-name">{{ FILE_CATEGORIES[category]?.label || category }}</div>
            <div class="category-count">{{ items.length }} 个项目</div>
          </div>
        </div>
      </div>

      <!-- 预览模式 -->
      <div v-else-if="showPreview" class="organizer-preview">
        <div class="preview-header">
          <el-button size="small" @click="showPreview = false">返回</el-button>
          <span class="preview-title">{{ currentCategory?.label }}</span>
        </div>
        <div class="preview-items win11-scrollbar">
          <div
            v-for="file in currentFiles"
            :key="file.path"
            class="preview-item"
          >
            <el-icon class="preview-item__icon">
              <component :is="getFileIcon(file)" />
            </el-icon>
            <div class="preview-item__info">
              <div class="preview-item__name">{{ file.name }}</div>
              <div class="preview-item__path">{{ file.path }}</div>
            </div>
          </div>
        </div>
        <div class="preview-actions">
          <el-button type="primary" @click="executeOrganization">
            <el-icon><Check /></el-icon>
            执行整理
          </el-button>
        </div>
      </div>

      <!-- 执行进度 -->
      <div v-if="organizing" class="organizer-progress">
        <el-progress :percentage="progressPercentage" :stroke-width="8" />
        <p>正在整理... {{ progressText }}</p>
      </div>

      <!-- 历史记录 -->
      <div v-if="history.length > 0" class="organizer-history">
        <div class="history-header">
          <span>整理历史</span>
          <el-button size="small" text @click="loadHistory">刷新</el-button>
        </div>
        <div class="history-list">
          <div
            v-for="item in history"
            :key="item.id"
            class="history-item"
          >
            <div class="history-info">
              <span class="history-time">{{ formatTime(item.timestamp) }}</span>
              <span class="history-count">成功 {{ item.successCount }} 项，失败 {{ item.failedCount }} 项</span>
            </div>
            <el-button size="small" text type="primary" @click="undoOrganization(item.id)">
              撤销
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { FolderOpened, Search, Check, Document, Picture, VideoCamera, Headset as Music, Collection, Folder } from '@element-plus/icons-vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'
import { desktopOrgApi, widgetApi } from '@/utils/ipc-client'
import { FILE_CATEGORIES } from '@/utils/constants/widget-categories'
import { ElMessage } from 'element-plus'

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
} = useWidgetHeaderActions('desktop-organizer')

// 状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
const contentMode = ref('summary')
const scanning = ref(false)
const organizing = ref(false)
const showPreview = ref(false)
const currentCategory = ref(null)
const scanResult = ref(null)
const history = ref([])
const progress = ref(0)

// 分类后的文件
const categorizedFiles = computed(() => {
  if (!scanResult.value?.files) return {}
  const result = {}
  for (const file of scanResult.value.files) {
    if (!result[file.category]) {
      result[file.category] = []
    }
    result[file.category].push(file)
  }
  return result
})

// 当前分类的文件
const currentFiles = computed(() => {
  if (!currentCategory.value || !scanResult.value) return []
  return categorizedFiles.value[currentCategory.value.key] || []
})

// 分类统计
const categoryCounts = computed(() => {
  const counts = {}
  for (const items of Object.values(categorizedFiles.value)) {
    counts[items[0]?.category] = (counts[items[0]?.category] || 0) + items.length
  }
  return counts
})

// 进度百分比
const progressPercentage = computed(() => {
  return Math.round((progress.value / (scanResult.value?.total || 1)) * 100)
})

// 进度文本
const progressText = computed(() => {
  return `已处理 ${progress.value} / ${scanResult.value?.total || 0}`
})

/**
 * 扫描桌面文件
 */
async function handleScan () {
  scanning.value = true
  try {
    const result = await desktopOrgApi.scan()
    scanResult.value = result
    showPreview.value = false
    currentCategory.value = null
  } catch (err) {
    console.error('[DesktopOrganizer] 扫描失败:', err)
    ElMessage.error('扫描桌面失败: ' + err.message)
  } finally {
    scanning.value = false
  }
}

/**
 * 预览分类
 * @param {string} category
 */
function previewCategory (category) {
  currentCategory.value = {
    key: category,
    label: FILE_CATEGORIES[category]?.label || category
  }
  showPreview.value = true
}

/**
 * 执行整理
 */
async function executeOrganization () {
  if (!scanResult.value) return

  organizing.value = true
  progress.value = 0

  try {
    const transactionId = Date.now().toString()
    const files = scanResult.value.files

    // 分批执行
    const batchSize = 10
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      const preview = batch.map(file => ({
        source: file.path,
        destination: file.destination || file.path,
        category: file.category,
        action: 'move'
      }))

      await desktopOrgApi.execute({ preview, transactionId })
      progress.value = Math.min(i + batchSize, files.length)
    }

    ElMessage.success('桌面整理完成')
    await handleScan()
  } catch (err) {
    console.error('[DesktopOrganizer] 整理失败:', err)
    ElMessage.error('整理失败: ' + err.message)
  } finally {
    organizing.value = false
  }
}

/**
 * 撤销整理
 * @param {string} transactionId
 */
async function undoOrganization (transactionId) {
  try {
    await desktopOrgApi.undo({ transactionId })
    ElMessage.success('已撤销整理操作')
    await handleScan()
  } catch (err) {
    console.error('[DesktopOrganizer] 撤销失败:', err)
    ElMessage.error('撤销失败: ' + err.message)
  }
}

/**
 * 加载历史记录
 */
async function loadHistory () {
  try {
    const result = await desktopOrgApi.history()
    history.value = result.transactions || []
  } catch (err) {
    console.error('[DesktopOrganizer] 加载历史失败:', err)
  }
}

/**
 * 获取分类图标
 * @param {string} category
 */
function getCategoryIcon (category) {
  const icons = {
    documents: Document,
    images: Picture,
    videos: VideoCamera,
    audio: Music,
    archives: Collection,
    executables: Folder,
    shortcuts: Folder,
    code: Document,
    other: Folder
  }
  return icons[category] || Folder
}

/**
 * 获取分类标签类型
 * @param {string} category
 */
function getCategoryType (category) {
  const types = {
    documents: 'primary',
    images: 'success',
    videos: 'warning',
    audio: 'info',
    archives: 'danger',
    executables: '',
    shortcuts: '',
    code: '',
    other: 'info'
  }
  return types[category] || 'info'
}

/**
 * 获取文件图标
 * @param {object} file
 */
function getFileIcon (file) {
  if (file.isDirectory) return FolderOpened
  return getCategoryIcon(file.category)
}

/**
 * 格式化时间
 * @param {string} time
 */
function formatTime (time) {
  if (!time) return ''
  const d = new Date(time)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  if (typeof newCapsule !== 'boolean') return
  isCapsule.value = newCapsule
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('desktop-organizer')
  } catch (err) {
    console.error('[DesktopOrganizer] 隐藏失败:', err.message)
  }
}

onMounted(async () => {
  await loadHistory()
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
    const config = await widgetApi.get('desktop-organizer')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      // 读取折叠行为
      if (config.collapse_behavior) {
        collapseBehavior.value = config.collapse_behavior
      }
    }
  } catch (err) {
    console.warn('[DesktopOrganizer] 加载配置失败:', err.message)
  }
})

onBeforeUnmount(() => {
  cleanupLocks()
})
</script>

<style scoped lang="scss">
.desktop-organizer {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
}

.organizer-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--widget-spacing-md, 12px);
}

.organizer-actions {
  margin-bottom: var(--widget-spacing-lg, 16px);
}

.organizer-btn {
  width: 100%;
}

.organizer-stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--widget-spacing-xs, 4px);
  margin-bottom: var(--widget-spacing-md, 12px);
}

.organizer-categories {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--widget-spacing-sm, 8px);
}

.category-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--widget-spacing-md, 12px);
  border-radius: var(--widget-radius-medium, 6px);
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.5));
  border: 1px solid var(--widget-layer-stroke, rgba(0, 0, 0, 0.09));
  cursor: pointer;
  transition: all var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
    transform: translateY(-2px);
  }
}

.category-icon {
  font-size: 24px;
  color: var(--widget-accent, #0067C0);
  margin-bottom: var(--widget-spacing-xs, 4px);
}

.category-info {
  text-align: center;
}

.category-name {
  font-size: var(--widget-font-body, 13px);
  font-weight: 500;
  color: var(--widget-text, #1A1A1A);
}

.category-count {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
}

.organizer-preview {
  border: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
  border-radius: var(--widget-radius-medium, 6px);
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-sm, 8px);
  padding: var(--widget-spacing-sm, 8px);
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.5));
  border-bottom: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
}

.preview-title {
  font-size: var(--widget-font-body, 13px);
  font-weight: 500;
  color: var(--widget-text, #1A1A1A);
}

.preview-items {
  max-height: 300px;
  overflow-y: auto;
}

.preview-item {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-sm, 8px);
  padding: var(--widget-spacing-sm, 8px);
  border-bottom: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.3));

  &:last-child {
    border-bottom: none;
  }
}

.preview-item__icon {
  font-size: 20px;
  color: var(--widget-text-secondary, #5A5A5A);
}

.preview-item__info {
  flex: 1;
  min-width: 0;
}

.preview-item__name {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text, #1A1A1A);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-item__path {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-actions {
  padding: var(--widget-spacing-sm, 8px);
  border-top: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
  display: flex;
  justify-content: flex-end;
  gap: var(--widget-spacing-sm, 8px);
}

.organizer-progress {
  text-align: center;
  padding: var(--widget-spacing-xl, 20px);

  p {
    margin-top: var(--widget-spacing-sm, 8px);
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
  }
}

.organizer-history {
  margin-top: var(--widget-spacing-lg, 16px);
  border-top: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
  padding-top: var(--widget-spacing-md, 12px);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--widget-spacing-sm, 8px);
  font-size: var(--widget-font-body, 13px);
  font-weight: 500;
  color: var(--widget-text, #1A1A1A);
}

.history-list {
  max-height: 150px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--widget-spacing-xs, 4px) 0;
  border-bottom: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.3));
}

.history-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-time {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text, #1A1A1A);
}

.history-count {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
}

// 暗色模式
html.dark .category-item {
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.08));
  border-color: var(--widget-layer-stroke, rgba(255, 255, 255, 0.12));
}

html.dark .category-item:hover {
  background: var(--widget-title-hover, rgba(255, 255, 255, 0.12));
}

html.dark .preview-header,
html.dark .preview-actions {
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.08));
  border-color: var(--widget-divider, rgba(60, 60, 60, 0.62));
}

html.dark .preview-item {
  border-color: var(--widget-divider, rgba(60, 60, 60, 0.3));
}

html.dark .preview-item__name {
  color: var(--widget-text, #F5F5F5);
}

html.dark .preview-item__path {
  color: var(--widget-text-secondary, #A5A5A5);
}

html.dark .history-header {
  color: var(--widget-text, #F5F5F5);
}

html.dark .history-time {
  color: var(--widget-text, #F5F5F5);
}

html.dark .history-count {
  color: var(--widget-text-secondary, #A5A5A5);
}

// 暗色模式补充：分类名称、计数、预览标题、预览图标、进度文字、分割线
html.dark .category-name,
html.dark .preview-title {
  color: var(--widget-text, #F5F5F5);
}

html.dark .category-count,
html.dark .preview-item__icon,
html.dark .organizer-progress p {
  color: var(--widget-text-secondary, #A5A5A5);
}

html.dark .organizer-preview,
html.dark .organizer-history {
  border-color: var(--widget-divider, rgba(60, 60, 60, 0.62));
}

html.dark .preview-item {
  border-color: var(--widget-divider, rgba(60, 60, 60, 0.3));
}

html.dark .history-item {
  border-bottom-color: var(--widget-divider, rgba(60, 60, 60, 0.3));
}
</style>