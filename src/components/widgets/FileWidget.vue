<!--
  文件管理格子组件
  功能：
  - 显示文件夹内容（图标/列表视图）
  - 拖放文件进出格子
  - 右键菜单操作
  - QuickLook 预览
  - 排序和布局切换
  - 胶囊形态支持
-->
<template>
  <div class="file-widget" :class="{ 'is-capsule': isCapsule }">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="file"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态 -->
      <template #capsule>
        <div class="file-capsule" :class="`file-capsule--${contentMode}`">
          <el-icon class="file-capsule__icon"><FolderOpened /></el-icon>
          <template v-if="contentMode !== 'minimal'">
            <span class="file-capsule__path">{{ pathDisplay }}</span>
          </template>
        </div>
      </template>

      <!-- 展开形态 -->
      <template #expanded>
        <widget-header
          title="文件"
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
          @rename="handleWidgetRename"
          @change-collapse-behavior="handleChangeCollapseBehavior"
          @change-chrome-mode="handleChangeChromeMode"
          @group-merge="handleGroupMerge"
          @group-detach="handleGroupDetach"
          @group-dissolve="handleGroupDissolve"
          @open-settings="handleOpenSettings"
          @disable="handleDisable"
        >
          <template #actions>
            <!-- 布局切换 -->
            <el-button
              class="file-header-btn"
              :icon="layout === 'icon' ? Grid : List"
              circle
              @click="toggleLayout"
            />
            <!-- 排序按钮 -->
            <el-dropdown @command="handleSort">
              <el-button class="file-header-btn" icon="Sort" circle />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="name">名称</el-dropdown-item>
                  <el-dropdown-item command="date">日期</el-dropdown-item>
                  <el-dropdown-item command="type">类型</el-dropdown-item>
                  <el-dropdown-item command="size">大小</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </widget-header>

        <!-- 路径导航 -->
        <div class="file-nav">
          <el-button size="small" icon="ArrowLeft" @click="navigateUp" :disabled="!currentPath" />
          <el-breadcrumb separator="/">
            <el-breadcrumb-item
              v-for="(part, index) in pathParts"
              :key="index"
              @click="navigateToPart(index)"
            >
              {{ part }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <!-- 文件列表 -->
        <div
          class="file-list"
          :class="[`layout-${layout}`, 'win11-scrollbar']"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
          @contextmenu="handleContextMenu"
        >
          <!-- 空状态 -->
          <div v-if="files.length === 0 && !loading" class="file-empty">
            <el-icon size="48"><FolderOpened /></el-icon>
            <p>文件夹为空</p>
          </div>

          <!-- 加载状态 -->
          <div v-if="loading" class="file-loading">
            <el-icon class="is-loading"><Loading /></el-icon>
            <p>加载中...</p>
          </div>

          <!-- 图标视图 -->
          <template v-if="layout === 'icon'">
            <div
              v-for="file in files"
              :key="file.path"
              class="file-item file-item--icon"
              :class="{
                'is-selected': isSelected(file.path),
                'is-directory': file.isDirectory
              }"
              @click="handleClick(file, $event)"
              @dblclick="handleDoubleClick(file)"
              @contextmenu.prevent="showContextMenu($event, file)"
            >
              <div class="file-item__icon">
                <component
                  :is="getFileIcon(file)"
                  class="file-item__icon-img"
                />
              </div>
              <div class="file-item__name" :title="file.name">{{ file.name }}</div>
            </div>
          </template>

          <!-- 列表视图 -->
          <template v-else>
            <div class="file-list-header">
              <span class="file-col-name">名称</span>
              <span class="file-col-date" :class="{ 'sorted': sortBy === 'date' }" @click="handleSort('date')">日期</span>
              <span class="file-col-type" :class="{ 'sorted': sortBy === 'type' }" @click="handleSort('type')">类型</span>
              <span class="file-col-size" :class="{ 'sorted': sortBy === 'size' }" @click="handleSort('size')">大小</span>
            </div>
            <div
              v-for="file in files"
              :key="file.path"
              class="file-item file-item--list"
              :class="{
                'is-selected': isSelected(file.path),
                'is-directory': file.isDirectory
              }"
              @click="handleClick(file, $event)"
              @dblclick="handleDoubleClick(file)"
              @contextmenu.prevent="showContextMenu($event, file)"
            >
              <div class="file-item__icon">
                <component :is="getFileIcon(file)" />
              </div>
              <span class="file-col-name">{{ file.name }}</span>
              <span class="file-col-date">{{ file.dateFormatted }}</span>
              <span class="file-col-type">{{ file.isDirectory ? '文件夹' : file.type }}</span>
              <span class="file-col-size">{{ file.sizeFormatted || '-' }}</span>
            </div>
          </template>
        </div>
      </template>
    </capsule-container>

    <!-- 右键菜单 -->
    <el-dropdown-menu
      v-if="contextMenu.visible"
      :style="contextMenuStyle"
      class="file-context-menu"
    >
      <el-dropdown-item @click="handleOpen">打开</el-dropdown-item>
      <el-dropdown-item @click="handleRevealInExplorer">在资源管理器中显示</el-dropdown-item>
      <el-dropdown-item divided @click="handleCopy">复制</el-dropdown-item>
      <el-dropdown-item @click="handleCut">剪切</el-dropdown-item>
      <el-dropdown-item @click="handlePaste" :disabled="!canPaste">粘贴</el-dropdown-item>
      <el-dropdown-item divided @click="handleRename">重命名</el-dropdown-item>
      <el-dropdown-item @click="handleDelete">删除</el-dropdown-item>
    </el-dropdown-menu>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { FolderOpened, Grid, List, Sort, Loading } from '@element-plus/icons-vue'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'
import { fileApi, widgetApi, on } from '@/utils/ipc-client'
import { useFileStore } from '@/stores/file-store'
import { ElMessage, ElMessageBox } from 'element-plus'

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
  handleRename: handleWidgetRename,
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
} = useWidgetHeaderActions('file')

const fileStore = useFileStore()

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
const contentMode = ref('summary')

// 路径和文件
const currentPath = ref('')
const files = ref([])
const loading = ref(false)

// 布局和排序
const layout = ref('icon')
const sortBy = ref('name')
const sortOrder = ref('asc')

// 选中项
const selectedItems = ref([])
const lastSelectedIndex = ref(-1)

// 右键菜单
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  target: null
})

// 路径显示
const pathDisplay = computed(() => {
  if (!currentPath.value) return '选择文件夹'
  const parts = currentPath.value.split('\\')
  return parts[parts.length - 1] || currentPath.value
})

// 路径分 parts
const pathParts = computed(() => {
  if (!currentPath.value) return []
  return currentPath.value.split('\\').filter(Boolean)
})

// 是否可以粘贴
const canPaste = computed(() => {
  return fileStore.clipboard.operation !== null && fileStore.clipboard.items.length > 0
})

// 右键菜单位置
const contextMenuStyle = computed(() => {
  return {
    position: 'fixed',
    left: `${contextMenu.value.x}px`,
    top: `${contextMenu.value.y}px`,
    zIndex: 9999
  }
})

// 检查是否选中
function isSelected (path) {
  return selectedItems.value.includes(path)
}

/**
 * 加载文件夹内容
 */
async function loadFolder (folderPath) {
  loading.value = true
  try {
    const result = await fileApi.listFiles(folderPath)
    files.value = Array.isArray(result) ? result : []
    currentPath.value = folderPath
    selectedItems.value = []
    fileStore.currentPath = folderPath
    fileStore.files = files.value
  } catch (err) {
    console.error('[FileWidget] 加载文件夹失败:', err.message)
    ElMessage.error(`无法打开文件夹: ${err.message}`)
    files.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 处理点击事件
 */
function handleClick (file, event) {
  if (event.ctrlKey || event.metaKey) {
    // Ctrl+点击：切换选中状态
    const index = selectedItems.value.indexOf(file.path)
    if (index === -1) {
      selectedItems.value.push(file.path)
    } else {
      selectedItems.value.splice(index, 1)
    }
    lastSelectedIndex.value = files.value.findIndex(f => f.path === file.path)
  } else if (event.shiftKey && lastSelectedIndex.value !== -1) {
    // Shift+点击：范围选择
    const startIndex = Math.min(lastSelectedIndex.value, files.value.findIndex(f => f.path === file.path))
    const endIndex = Math.max(lastSelectedIndex.value, files.value.findIndex(f => f.path === file.path))
    const range = files.value.slice(startIndex, endIndex + 1).map(f => f.path)
    selectedItems.value = [...new Set([...selectedItems.value, ...range])]
  } else {
    // 普通点击：单选
    selectedItems.value = [file.path]
    lastSelectedIndex.value = files.value.findIndex(f => f.path === file.path)
  }
}

/**
 * 处理双击事件
 */
async function handleDoubleClick (file) {
  if (file.isDirectory) {
    await loadFolder(file.path)
  } else {
    await fileApi.openFile(file.path)
  }
}

/**
 * 切换布局
 */
function toggleLayout () {
  layout.value = layout.value === 'icon' ? 'list' : 'icon'
}

/**
 * 处理排序
 */
function handleSort (sortType) {
  if (sortBy.value === sortType) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = sortType
    sortOrder.value = 'asc'
  }
  // 排序逻辑在 store 中处理
  fileStore.setSort(sortType, sortOrder.value)
}

/**
 * 导航到上级目录
 */
async function navigateUp () {
  if (!currentPath.value) return
  const parts = currentPath.value.split('\\')
  if (parts.length > 1) {
    parts.pop()
    const parentPath = parts.join('\\')
    await loadFolder(parentPath)
  }
}

/**
 * 导航到路径分 part
 */
async function navigateToPart (index) {
  const parts = currentPath.value.split('\\').filter(Boolean)
  if (index < parts.length) {
    const targetPath = parts.slice(0, index + 1).join('\\')
    await loadFolder(targetPath)
  }
}

/**
 * 处理拖拽进入
 */
function handleDragOver (event) {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * 处理拖拽离开
 */
function handleDragLeave (event) {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * 处理放置
 */
async function handleDrop (event) {
  event.preventDefault()
  event.stopPropagation()

  const items = event.dataTransfer.items
  if (!items || items.length === 0) return

  try {
    const paths = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const entry = item.webkitGetAsEntry?.()
      if (entry) {
        paths.push(entry.fullPath)
      }
    }

    if (paths.length > 0) {
      // 这里需要实现从浏览器拖入的处理逻辑
      console.log('[FileWidget] 拖入文件:', paths)
      ElMessage.success(`已接收 ${paths.length} 个文件`)
    }
  } catch (err) {
    console.error('[FileWidget] 处理拖入失败:', err)
  }
}

/**
 * 显示右键菜单
 */
function showContextMenu (event, file) {
  event.preventDefault()
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    target: file
  }

  // 如果没有选中当前项，则选中它
  if (!isSelected(file.path)) {
    selectedItems.value = [file.path]
  }
}

/**
 * 隐藏右键菜单
 */
function hideContextMenu () {
  contextMenu.value.visible = false
}

/**
 * 处理右键菜单命令
 */
async function handleOpen () {
  const file = contextMenu.value.target
  if (!file) return

  if (file.isDirectory) {
    await loadFolder(file.path)
  } else {
    await fileApi.openFile(file.path)
  }
  hideContextMenu()
}

async function handleRevealInExplorer () {
  const file = contextMenu.value.target
  if (!file) return
  await fileApi.revealInExplorer(file.path)
  hideContextMenu()
}

async function handleCopy () {
  if (selectedItems.value.length === 0) return
  await fileStore.copyItems()
  ElMessage.success(`已复制 ${selectedItems.value.length} 项`)
  hideContextMenu()
}

async function handleCut () {
  if (selectedItems.value.length === 0) return
  await fileStore.cutItems()
  ElMessage.success(`已剪切 ${selectedItems.value.length} 项`)
  hideContextMenu()
}

async function handlePaste () {
  if (!canPaste.value || !currentPath.value) return
  await fileStore.pasteItems(currentPath.value)
  ElMessage.success('已粘贴')
  hideContextMenu()
}

async function handleRename () {
  const file = contextMenu.value.target
  if (!file) return

  try {
    const { value } = await ElMessageBox.prompt('请输入新名称', '重命名', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: file.name
    })

    if (value && value !== file.name) {
      const ext = path.extname(file.name)
      const newName = value + (ext && !file.isDirectory ? ext : '')
      const newPath = path.join(path.dirname(file.path), newName)
      await fileApi.renameItem(file.path, newPath)
      await loadFolder(path.dirname(file.path))
      ElMessage.success('重命名成功')
    }
  } catch (err) {
    if (err !== 'cancel') {
      console.error('[FileWidget] 重命名失败:', err)
    }
  }
  hideContextMenu()
}

async function handleDelete () {
  if (selectedItems.value.length === 0) return

  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedItems.value.length} 项吗？`,
      '确认删除',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await fileStore.deleteItems()
    ElMessage.success('已删除')
  } catch (err) {
    if (err !== 'cancel') {
      console.error('[FileWidget] 删除失败:', err)
    }
  }
  hideContextMenu()
}

/**
 * 获取文件图标
 */
function getFileIcon (file) {
  if (file.isDirectory) {
    return FolderOpened
  }

  const ext = path.extname(file.name).toLowerCase()
  const iconMap = {
    '.jpg': 'Picture',
    '.jpeg': 'Picture',
    '.png': 'Picture',
    '.gif': 'Picture',
    '.bmp': 'Picture',
    '.webp': 'Picture',
    '.mp4': 'Video',
    '.avi': 'Video',
    '.mov': 'Video',
    '.mp3': 'Music',
    '.wav': 'Music',
    '.pdf': 'Document',
    '.doc': 'Document',
    '.docx': 'Document',
    '.xls': 'Document',
    '.xlsx': 'Document',
    '.ppt': 'Document',
    '.pptx': 'Document',
    '.zip': 'Zip',
    '.rar': 'Zip',
    '.7z': 'Zip',
    '.txt': 'Document',
    '.md': 'Document',
    '.js': 'Code',
    '.ts': 'Code',
    '.py': 'Code',
    '.json': 'Code',
    '.html': 'Code',
    '.css': 'Code',
    '.exe': 'Application',
    '.lnk': 'Shortcut'
  }

  return iconMap[ext] || 'Document'
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  if (typeof newCapsule !== 'boolean') return
  isCapsule.value = newCapsule
  try {
    await fileApi.toggleCapsule('file', newCapsule)
  } catch (err) {
    console.error('[FileWidget] 切换胶囊失败:', err.message)
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await fileApi.hide('file')
  } catch (err) {
    console.error('[FileWidget] 隐藏失败:', err.message)
  }
}

// 全局点击事件：点击其他地方隐藏右键菜单
function handleClickOutside (event) {
  if (!contextMenu.value.visible) return
  const target = event.target
  if (!target.closest('.file-context-menu') && !target.closest('.file-item')) {
    hideContextMenu()
  }
}

onMounted(async () => {
  // 获取桌面路径作为默认路径
  try {
    const desktopPath = await fileApi.getDesktopPath()
    await loadFolder(desktopPath)
  } catch (err) {
    console.warn('[FileWidget] 获取桌面路径失败:', err.message)
  }

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
    const config = await widgetApi.get('file')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      // 读取折叠行为
      if (config.collapse_behavior) {
        collapseBehavior.value = config.collapse_behavior
      }
    }
  } catch (err) {
    console.warn('[FileWidget] 加载配置失败:', err.message)
  }

  // 监听全局点击事件
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  cleanupLocks()
})
</script>

<style scoped lang="scss">
// ============================================================
// ============================================================

.file-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
  position: relative;
}

// ============================================================
// 胶囊形态
// ============================================================
.file-capsule {
  display: flex;
  align-items: center;
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  gap: var(--widget-spacing-sm, 8px);

  &__icon {
    font-size: 20px;
    // 胶囊图标使用强调色，随 accent_color 切换
    color: var(--widget-accent, #0067C0);
  }

  &__path {
    font-size: var(--widget-font-body, 13px);
    color: var(--widget-text, #1A1A1A);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 150px;
  }

  &--minimal {
    justify-content: center;
    padding: var(--widget-spacing-xs, 4px);
  }

  &--smart {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--widget-spacing-xs, 4px);
  }
}

// ============================================================
// 导航栏
// ============================================================
.file-nav {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-sm, 8px);
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  border-bottom: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.5));
}

html.dark .file-nav {
  border-bottom-color: var(--widget-divider, rgba(60, 60, 60, 0.62));
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.08));
}

// ============================================================
// 文件列表
// ============================================================
.file-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--widget-spacing-md, 12px);
  display: grid;
  gap: var(--widget-spacing-sm, 8px);

  // 图标视图
  &.layout-icon {
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    justify-items: center;
  }

  // 列表视图
  &.layout-list {
    grid-template-columns: 1fr;
  }
}

// ============================================================
// 文件项（图标视图）
// ============================================================
.file-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--widget-spacing-sm, 8px);
  border-radius: var(--widget-radius-medium, 6px);
  cursor: pointer;
  transition: background var(--widget-motion-fast, 167ms) ease;
  user-select: none;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }

  &.is-selected {
    background: var(--widget-accent-wash, rgba(0, 103, 192, 0.09));

    .file-item__name {
      color: var(--widget-accent, #0067C0);
    }
  }

  &--icon {
    .file-item__icon {
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--widget-spacing-xs, 4px);

      .file-item__icon-img {
        font-size: 40px;
        color: var(--widget-text-secondary, #5A5A5A);
      }
    }

    .file-item__name {
      font-size: var(--widget-font-caption, 12px);
      text-align: center;
      word-break: break-all;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.3;
    }
  }

  &--list {
    flex-direction: row;
    align-items: center;
    padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);
    gap: var(--widget-spacing-md, 12px);

    .file-item__icon {
      width: 24px;
      height: 24px;
      flex-shrink: 0;

      svg {
        font-size: 20px;
      }
    }

    .file-col-name {
      flex: 1;
      font-size: var(--widget-font-body, 13px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-col-date,
    .file-col-type,
    .file-col-size {
      font-size: var(--widget-font-caption, 12px);
      color: var(--widget-text-secondary, #5A5A5A);
      width: 100px;
      text-align: right;
    }
  }

  &__name {
    font-size: var(--widget-font-body, 13px);
    color: var(--widget-text, #1A1A1A);
    word-break: break-all;
  }
}

// ============================================================
// 列表视图表头
// ============================================================
.file-list-header {
  display: flex;
  align-items: center;
  padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);
  gap: var(--widget-spacing-md, 12px);
  border-bottom: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
  position: sticky;
  top: 0;
  background: var(--widget-bg, #F3F3F3);
  z-index: 1;
}

html.dark .file-list-header {
  border-bottom-color: var(--widget-divider, rgba(60, 60, 60, 0.62));
  background: var(--widget-bg, #1F1F1F);
}

.file-col-name {
  flex: 1;
}

.file-col-date,
.file-col-type,
.file-col-size {
  width: 100px;
  text-align: right;
}

.sorted {
  color: var(--widget-accent, #0067C0);
  cursor: pointer;
}

// ============================================================
// 空状态和加载状态
// ============================================================
.file-empty,
.file-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--widget-spacing-sm, 8px);
  padding: var(--widget-spacing-xl, 20px);
  color: var(--widget-text-secondary, #5A5A5A);
  font-size: var(--widget-font-caption, 12px);
}

// ============================================================
// 右键菜单
// ============================================================
.file-context-menu {
  position: fixed;
  z-index: 9999;
}

// ============================================================
// 暗色模式
// ============================================================
html.dark .file-widget {
  color: var(--widget-text, #F5F5F5);
}

html.dark .file-item:hover {
  background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
}

html.dark .file-item.is-selected {
  background: var(--widget-accent-wash, rgba(0, 120, 212, 0.15));
}

html.dark .file-item__icon svg {
  color: var(--widget-text-secondary, #A5A5A5);
}

html.dark .file-item__name {
  color: var(--widget-text, #F5F5F5);
}

// 暗色模式补充：胶囊、列表表头、列文字、空状态
html.dark .file-capsule__path {
  color: var(--widget-text, #F5F5F5);
}

// 暗色模式胶囊图标使用强调色，随 accent_color 切换
html.dark .file-capsule__icon {
  color: var(--widget-accent, #0078D4);
}

html.dark .file-list-header,
html.dark .file-col-date,
html.dark .file-col-type,
html.dark .file-col-size,
html.dark .file-empty,
html.dark .file-loading {
  color: var(--widget-text-secondary, #A5A5A5);
}

html.dark .file-item--list .file-col-name {
  color: var(--widget-text, #F5F5F5);
}
</style>