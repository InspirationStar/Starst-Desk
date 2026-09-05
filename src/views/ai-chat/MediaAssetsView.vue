<!--
  媒体资产盒子页面
  职责：展示与管理 AI 生成的图片/视频资产
  - 顶部工具栏：类型筛选 / 搜索 / 统计
  - 资产网格：CSS Grid 响应式布局
  - 分页：el-pagination
  - 空状态：el-empty
  - 预览灯箱：图片放大 / 视频播放
  - 删除确认 / 复制 URL
  - 暗色主题适配
-->
<template>
  <div class="media-assets-view">
    <div class="assets-container">
      <!-- 页头 -->
      <header class="page-header">
        <div class="header-left">
          <el-button :icon="ArrowLeft" text @click="$router.push('/ai-chat')">返回对话</el-button>
          <h2 class="page-title">资产盒子</h2>
        </div>
        <div class="header-actions">
          <el-button :icon="Setting" @click="openStorageConfig">存储设置</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="handleRefresh">刷新</el-button>
          <el-button :icon="Delete" @click="toggleSelectMode">
            {{ selectMode ? '退出管理' : '批量管理' }}
          </el-button>
        </div>
      </header>

      <!-- 顶部工具栏：筛选 + 搜索 + 统计 -->
      <div class="assets-toolbar">
        <div class="toolbar-left">
          <!-- 类型筛选 -->
          <el-radio-group v-model="filterType" @change="handleFilterChange">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="image">图片</el-radio-button>
            <el-radio-button value="video">视频</el-radio-button>
          </el-radio-group>

          <!-- 搜索框 -->
          <el-input
            v-model="keyword"
            placeholder="按提示词搜索..."
            clearable
            :prefix-icon="Search"
            class="toolbar-search"
            @input="handleSearchDebounced"
            @clear="handleSearch"
          />

          <!-- 分类筛选（按会话） -->
          <el-select
            v-model="filterSessionId"
            placeholder="按会话筛选"
            clearable

            class="toolbar-session-filter"
            @change="handleSessionFilterChange"
          >
            <el-option
              v-for="session in sessionList"
              :key="session.id"
              :label="session.title || '未命名会话'"
              :value="session.id"
            />
          </el-select>
        </div>

        <div class="toolbar-right">
          <!-- 统计信息 -->
          <div class="stats-block">
            <div class="stats-item">
              <el-icon class="stats-icon stats-icon--image"><Picture /></el-icon>
              <span class="stats-label">图片</span>
              <span class="stats-value">{{ stats.imageCount || 0 }}</span>
            </div>
            <div class="stats-item">
              <el-icon class="stats-icon stats-icon--video"><VideoPlay /></el-icon>
              <span class="stats-label">视频</span>
              <span class="stats-value">{{ stats.videoCount || 0 }}</span>
            </div>
            <div class="stats-item">
              <el-icon class="stats-icon stats-icon--size"><Files /></el-icon>
              <span class="stats-label">总大小</span>
              <span class="stats-value">{{ formatSize(stats.totalSize) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 资产列表（按日期分组 + 滚动容器） -->
      <div
        class="assets-scroll"
        v-loading="loading"
        element-loading-text="加载资产中..."
      >
        <div v-for="group in groupedAssetList" :key="group.date" class="asset-date-group">
          <div class="asset-date-header">
            <span class="date-label">{{ group.label }}</span>
            <span class="date-count">{{ group.items.length }} 项</span>
          </div>
          <div class="assets-grid">
            <MediaAssetCard
              v-for="asset in group.items"
              :key="asset.id"
              :asset="asset"
              :selectable="selectMode"
              :selected="selectedIds.has(asset.id)"
              @delete="handleDelete"
              @preview="handlePreview"
              @copy-url="handleCopyUrl"
              @select="handleSelectToggle"
            />
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="!loading && assetList.length === 0" class="assets-empty">
          <el-empty description="还没有生成任何媒体资产">
            <el-button type="primary" @click="$router.push('/ai-chat')">去 AI 对话生成</el-button>
          </el-empty>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="total > 0 && !selectMode" class="assets-pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[12, 24, 48, 96]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="fetchList"
          @size-change="handleSizeChange"
        />
      </div>

      <!-- 批量操作栏（选择模式时显示，固定在容器底部） -->
      <transition name="batch-bar">
        <div v-if="selectMode" class="batch-action-bar">
          <el-checkbox
            :model-value="isAllSelected"
            :indeterminate="isIndeterminate"
            @change="handleSelectAll"
          >
            全选
          </el-checkbox>
          <span class="batch-count">已选 {{ selectedIds.size }} 项</span>
          <div class="batch-actions">
            <el-button
              type="danger"
              :icon="Delete"
              :disabled="selectedIds.size === 0"
              @click="handleBatchDelete"
            >
              删除选中
            </el-button>
          </div>
        </div>
      </transition>
    </div>

    <!-- 预览灯箱 -->
    <el-dialog
      v-model="previewVisible"
      :title="previewTitle"
      width="auto"
      class="preview-dialog"
      :show-close="true"
      append-to-body
      destroy-on-close
      align-center
    >
      <div class="preview-content">
        <!-- 图片预览：优先使用本地 data URL（CSP 兼容） -->
        <img
          v-if="previewAsset && previewAsset.type === 'image'"
          :src="previewDataUrl || previewAsset.url"
          class="preview-image"
          alt="预览图片"
        />
        <!-- 视频预览：优先使用本地 data URL（CSP 兼容） -->
        <video
          v-else-if="previewAsset && previewAsset.type === 'video'"
          :src="previewDataUrl || previewAsset.url"
          class="preview-video"
          controls
          autoplay
        />
      </div>
      <!-- 预览底部信息 -->
      <template #footer v-if="previewAsset">
        <div class="preview-footer">
          <div class="preview-prompt">{{ previewAsset.prompt || '（无提示词）' }}</div>
          <div class="preview-actions">
            <el-button
              v-if="previewAsset.file_path"
              size="small"
              :icon="FolderOpened"
              @click="handleRevealInExplorer(previewAsset.file_path)"
            >
              打开位置
            </el-button>
            <el-button size="small" :icon="CopyDocument" @click="handleCopyUrl(previewAsset.url)">
              复制 URL
            </el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="handleDelete(previewAsset.id)">
              删除
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 存储位置配置对话框 -->
    <el-dialog
      v-model="storageConfigVisible"
      title="存储位置设置"
      width="520px"
      append-to-body
      destroy-on-close
    >
      <div class="storage-config">
        <p class="storage-tip">
          设置媒体资产的本地存储路径。生成的图片/视频将保存到该目录下。
        </p>
        <el-input
          v-model="storagePath"
          placeholder="请选择存储路径"
          readonly
          :prefix-icon="FolderOpened"
        >
          <template #append>
            <el-button :icon="Folder" @click="selectStoragePath">选择</el-button>
          </template>
        </el-input>
        <div v-if="storagePath" class="storage-current">
          当前存储路径：<span class="storage-path">{{ storagePath }}</span>
        </div>
      </div>
      <template #footer>
        <el-button @click="storageConfigVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingPath" @click="saveStoragePath">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  ArrowLeft, Refresh, Search, Picture, VideoPlay, Files,
  CopyDocument, Delete, Setting, FolderOpened, Folder
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { mediaAssetApi, systemApi, mediaApi, fileApi } from '@/utils/ipc-client'
import { loadMediaDataUrl, clearMediaCache, getLocalPath } from '@/utils/media-loader'
import MediaAssetCard from '@/components/chat/MediaAssetCard.vue'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'

dayjs.locale('zh-cn')

// ============================================================
// 列表与筛选状态
// ============================================================
const loading = ref(false)
const assetList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(24)

// 会话筛选
const filterSessionId = ref('')
const sessionList = ref([])

// 按日期分组资产列表（今天 / 昨天 / 具体日期）
const groupedAssetList = computed(() => {
  if (!assetList.value.length) return []
  const today = dayjs().startOf('day')
  const yesterday = today.subtract(1, 'day')
  const groups = new Map()
  for (const asset of assetList.value) {
    const raw = asset.created_at
    let d
    try {
      d = dayjs(typeof raw === 'string' && raw.includes('T') ? raw : String(raw).replace(' ', 'T'))
    } catch {
      d = dayjs()
    }
    if (!d.isValid()) d = dayjs()
    const dateKey = d.format('YYYY-MM-DD')
    if (!groups.has(dateKey)) {
      let label
      if (d.isSame(today, 'day')) label = '今天'
      else if (d.isSame(yesterday, 'day')) label = '昨天'
      else label = d.format('M月D日')
      groups.set(dateKey, { date: dateKey, label, items: [] })
    }
    groups.get(dateKey).items.push(asset)
  }
  return Array.from(groups.values())
})

// 筛选条件
const filterType = ref('')        // '' | 'image' | 'video'
const keyword = ref('')

// 统计信息
const stats = reactive({
  imageCount: 0,
  videoCount: 0,
  totalSize: 0
})

// 预览相关
const previewVisible = ref(false)
const previewAsset = ref(null)
const previewDataUrl = ref('')  // CSP 兼容：本地 data URL 优先


// 存储位置配置
const STORAGE_PATH_KEY = 'media_asset_storage_path'
const storageConfigVisible = ref(false)
const storagePath = ref('')
const savingPath = ref(false)

// ============================================================
// 批量选择模式
// ============================================================
const selectMode = ref(false)
const selectedIds = ref(new Set())

// 是否全选当前页
const isAllSelected = computed(() => {
  return assetList.value.length > 0 && assetList.value.every(a => selectedIds.value.has(a.id))
})

// 是否半选（部分选中）
const isIndeterminate = computed(() => {
  const selectedCount = assetList.value.filter(a => selectedIds.value.has(a.id)).length
  return selectedCount > 0 && selectedCount < assetList.value.length
})

// 切换选择模式
function toggleSelectMode () {
  selectMode.value = !selectMode.value
  if (!selectMode.value) {
    selectedIds.value = new Set()
  }
}

// 切换单个选中
function handleSelectToggle (id) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

// 全选/取消全选当前页
function handleSelectAll (val) {
  const next = new Set(selectedIds.value)
  if (val) {
    assetList.value.forEach(a => next.add(a.id))
  } else {
    assetList.value.forEach(a => next.delete(a.id))
  }
  selectedIds.value = next
}

// 批量删除
async function handleBatchDelete () {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${ids.length} 项资产吗？删除后不可恢复。`,
      '批量删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  try {
    const result = await mediaAssetApi.batchDelete(ids)
    // 清理被删除资产的缓存
    assetList.value.forEach(a => {
      if (ids.includes(a.id)) clearMediaCache(a.url)
    })
    ElMessage.success(`已删除 ${result.deleted} 项`)
    selectedIds.value = new Set()
    // 若删除后当前页空了，回退到上一页
    if (assetList.value.length === ids.length && page.value > 1) {
      page.value -= 1
    }
    fetchList()
    fetchStats()
  } catch (err) {
    console.error('[MediaAssetsView] 批量删除失败:', err)
    ElMessage.error(err.message || '批量删除失败')
  }
}

// 搜索防抖计时器
let searchTimer = null

// 预览标题
const previewTitle = computed(() => {
  if (!previewAsset.value) return '预览'
  return previewAsset.value.type === 'image' ? '图片预览' : '视频预览'
})

// ============================================================
// 数据加载
// ============================================================

/**
 * 加载资产列表
 */
async function fetchList () {
  loading.value = true
  try {
    const params = {
      page: page.value,
      pageSize: pageSize.value
    }
    if (filterType.value) params.type = filterType.value
    if (filterSessionId.value) params.session_id = filterSessionId.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()

    const result = await mediaAssetApi.list(params)
    assetList.value = result.list || result.items || []
    total.value = result.total || 0
    // 同步服务端返回的分页参数，避免越界
    if (result.page) page.value = result.page
    if (result.pageSize) pageSize.value = result.pageSize
  } catch (err) {
    console.error('[MediaAssetsView] 加载资产列表失败:', err)
    ElMessage.error(err.message || '加载资产列表失败')
    assetList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/**
 * 加载统计信息
 */
async function fetchStats () {
  try {
    const result = await mediaAssetApi.stats()
    Object.assign(stats, {
      imageCount: result.imageCount || 0,
      videoCount: result.videoCount || 0,
      totalSize: result.totalSize || 0
    })
  } catch (err) {
    console.error('[MediaAssetsView] 加载统计信息失败:', err)
    // 统计失败不弹错，仅静默
  }
}

/**
 * 刷新（重新加载列表 + 统计）
 */
function handleRefresh () {
  fetchList()
  fetchStats()
}

// ============================================================
// 筛选 / 搜索 / 分页
// ============================================================

/**
 * 类型筛选变化：重置到第一页并重新加载
 */
function handleFilterChange () {
  page.value = 1
  fetchList()
}

/**
 * 防抖搜索（300ms）
 */
function handleSearchDebounced () {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    handleSearch()
  }, 300)
}

/**
 * 触发搜索：重置到第一页
 */
function handleSearch () {
  page.value = 1
  fetchList()
}

/**
 * 每页条数变化：重置到第一页
 */
function handleSizeChange () {
  page.value = 1
  fetchList()
}

/**
 * 会话筛选变化
 */
function handleSessionFilterChange () {
  page.value = 1
  fetchList()
  loadSessionList()
}

/**
 * 加载会话列表（用于筛选下拉）
 */
async function loadSessionList () {
  try {
    const { chatApi } = await import('@/utils/ipc-client')
    const result = await chatApi.listSessions()
    sessionList.value = Array.isArray(result) ? result : (result?.list || [])
  } catch (err) {
    console.error('[MediaAssetsView] 加载会话列表失败:', err)
    sessionList.value = []
  }
}

// ============================================================
// 卡片操作
// ============================================================

/**
 * 预览资产：打开灯箱，通过统一加载器加载 data URL（CSP 兼容）
 */
function handlePreview (asset) {
  previewAsset.value = asset
  previewVisible.value = true
  previewDataUrl.value = ''
  // 统一加载：本地优先，回退 URL 下载
  loadPreviewFromLocal(asset.file_path)
}

/**
 * 从本地路径或 URL 加载预览（使用统一资源加载器）
 */
async function loadPreviewFromLocal (localPath) {
  const asset = previewAsset.value
  const url = asset?.url
  const dataUrl = await loadMediaDataUrl({
    url,
    localPath
  })
  previewDataUrl.value = dataUrl || ''
  // 加载后检查本地路径是否变化（文件被删除后重新下载）
  if (asset?.id) {
    const newLocalPath = getLocalPath(url)
    if (newLocalPath && newLocalPath !== localPath) {
      try {
        await mediaAssetApi.updatePath(asset.id, newLocalPath)
        asset.file_path = newLocalPath
      } catch {
        // 更新失败不影响预览
      }
    }
  }
}

/**

 * 在资源管理器中打开文件所在位置
 */
async function handleRevealInExplorer (filePath) {
  if (!filePath) {
    ElMessage.warning('未找到本地文件路径')
    return
  }
  try {
    await fileApi.revealInExplorer(filePath)
  } catch (e) {
    // 文件可能已被删除，尝试重新下载后打开
    try {
      const asset = previewAsset.value
      const url = asset?.url
      if (url) {
        await loadMediaDataUrl({ url, localPath: filePath })
        const newLocalPath = getLocalPath(url)
        if (newLocalPath && newLocalPath !== filePath) {
          if (asset?.id) {
            await mediaAssetApi.updatePath(asset.id, newLocalPath)
            asset.file_path = newLocalPath
          }
          await fileApi.revealInExplorer(newLocalPath)
          return
        }
      }
      ElMessage.error('本地文件已被删除，请尝试重新加载到资产盒子')
    } catch {
      ElMessage.error('本地文件已被删除，请尝试重新加载到资产盒子')
    }
  }
}

/**
 * 复制 URL 到剪贴板
 */
async function handleCopyUrl (url) {
  if (!url) {
    ElMessage.warning('无可复制的 URL')
    return
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url)
    } else {
      // 回退方案：临时 textarea + execCommand
      const textarea = document.createElement('textarea')
      textarea.value = url
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    ElMessage.success('URL 已复制到剪贴板')
  } catch (err) {
    console.error('[MediaAssetsView] 复制 URL 失败:', err)
    ElMessage.error('复制失败，请手动复制')
  }
}

/**
 * 删除资产：弹确认框，确认后调用 API 并刷新
 */
async function handleDelete (id) {
  if (!id) return
  try {
    await ElMessageBox.confirm(
      '确定要删除该资产吗？删除后不可恢复。',
      '删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch (err) {
    // 用户取消
    return
  }

  try {
    await mediaAssetApi.delete(id)
    clearMediaCache(assetList.value.find(a => a.id === id)?.url)
    ElMessage.success('删除成功')
    // 如果删除后当前页空了，回退到上一页
    if (assetList.value.length === 1 && page.value > 1) {
      page.value -= 1
    }
    // 刷新列表与统计
    fetchList()
    fetchStats()
    // 如果预览灯箱打开的是被删除资产，关闭灯箱
    if (previewAsset.value && previewAsset.value.id === id) {
      previewVisible.value = false
      previewAsset.value = null
    }
  } catch (err) {
    console.error('[MediaAssetsView] 删除资产失败:', err)
    ElMessage.error(err.message || '删除失败')
  }
}

// ============================================================
// 存储位置配置
// ============================================================

/**
 * 打开存储配置对话框，并加载当前已保存的路径
 */
async function openStorageConfig () {
  storageConfigVisible.value = true
  try {
    const result = await systemApi.getSetting(STORAGE_PATH_KEY)
    storagePath.value = result?.value || ''
  } catch (err) {
    console.error('[MediaAssetsView] 读取存储路径失败:', err)
    storagePath.value = ''
  }
}

/**
 * 调用系统文件夹选择对话框
 */
async function selectStoragePath () {
  try {
    const result = await systemApi.selectFolder({
      title: '选择媒体资产存储路径',
      defaultPath: storagePath.value || undefined
    })
    if (result?.cancelled) return
    if (result?.path) {
      storagePath.value = result.path
    }
  } catch (err) {
    console.error('[MediaAssetsView] 选择文件夹失败:', err)
    ElMessage.error(err.message || '选择文件夹失败')
  }
}

/**
 * 保存存储路径到 app_settings 表
 */
async function saveStoragePath () {
  if (!storagePath.value.trim()) {
    ElMessage.warning('请先选择存储路径')
    return
  }
  savingPath.value = true
  try {
    await systemApi.setSetting(STORAGE_PATH_KEY, storagePath.value.trim())
    ElMessage.success('存储路径已保存')
    storageConfigVisible.value = false
  } catch (err) {
    console.error('[MediaAssetsView] 保存存储路径失败:', err)
    ElMessage.error(err.message || '保存失败')
  } finally {
    savingPath.value = false
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 格式化文件大小
 */
function formatSize (bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const idx = Math.min(i, sizes.length - 1)
  return parseFloat((bytes / Math.pow(k, idx)).toFixed(1)) + ' ' + sizes[idx]
}

// ============================================================
// 生命周期
// ============================================================
onMounted(() => {
  fetchList()
  fetchStats()
  loadSessionList()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<style scoped lang="scss">
.media-assets-view {
  width: 100%;
  height: 100%;
  background: #f5f7fa;
  padding: 16px 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.assets-container {
  max-width: 1400px;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 8px;
  padding: 20px 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  position: relative;
}

// 页头
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-shrink: 0;

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .page-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #303133;
  }
}

// 顶部工具栏
.assets-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
  padding: 12px 0;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
}

.toolbar-search {
  width: 240px;
}

// 统计信息块
.stats-block {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  background: #f5f7fa;
  border-radius: 6px;

  .stats-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: #606266;
  }

  .stats-icon {
    font-size: 16px;

    &.stats-icon--image {
      color: #409eff;
    }

    &.stats-icon--video {
      color: #67c23a;
    }

    &.stats-icon--size {
      color: #e6a23c;
    }
  }

  .stats-label {
    color: #909399;
  }

  .stats-value {
    font-weight: 600;
    color: #303133;
  }
}

// 资产滚动容器
.assets-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #c0c4cc;
    border-radius: 3px;

    &:hover {
      background: #909399;
    }
  }
}

// 日期分组
.asset-date-group {
  margin-bottom: 8px;
}

.asset-date-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  position: sticky;
  top: 0;
  background: #ffffff;
  z-index: 2;

  .date-count {
    font-size: 12px;
    font-weight: 400;
    color: #909399;
  }
}

// 资产网格：CSS Grid 响应式布局
.assets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

// 空状态
.assets-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}

// 分页
.assets-pagination {
  display: flex;
  justify-content: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
  flex-shrink: 0;
}

// ============================================================
// 预览灯箱
// ============================================================
.preview-dialog {
  :deep(.el-dialog__body) {
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

  :deep(.el-dialog__header) {
    margin-right: 0;
    padding: 12px 20px;
    background: #ffffff;
  }

  :deep(.el-dialog__footer) {
    padding: 12px 20px;
    background: #ffffff;
  }
}

.preview-content {
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 90vw;
  max-height: 80vh;
}

.preview-image {
  max-width: 90vw;
  max-height: 80vh;
  object-fit: contain;
  display: block;
}

.preview-video {
  max-width: 90vw;
  max-height: 80vh;
  display: block;
}

.preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  .preview-prompt {
    flex: 1;
    min-width: 0;
    color: #606266;
    font-size: 13px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .preview-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
}

// ============================================================
// 存储位置配置对话框
// ============================================================
.storage-config {
  .storage-tip {
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.6;
    color: #909399;
  }

  .storage-current {
    margin-top: 12px;
    font-size: 13px;
    color: #606266;

    .storage-path {
      color: #409eff;
      word-break: break-all;
    }
  }
}

// ============================================================
// 暗色主题适配
// ============================================================
[data-theme='dark'] {
  .media-assets-view {
    background: #1d1e1f;
  }

  .assets-container {
    background: #252526;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .page-header {
    .page-title {
      color: #e5eaf3;
    }
  }

  .assets-toolbar {
    border-bottom-color: #414243;
  }

  .assets-scroll {
    &::-webkit-scrollbar-thumb {
      background: #414243;

      &:hover {
        background: #555;
      }
    }
  }

  .asset-date-header {
    color: #e5eaf3;
    border-bottom-color: #414243;
    background: #252526;

    .date-count {
      color: #a3a6ad;
    }
  }

  .stats-block {
    background: #1d1e1f;

    .stats-item {
      color: #cfd3dc;
    }

    .stats-label {
      color: #a3a6ad;
    }

    .stats-value {
      color: #e5eaf3;
    }
  }

  .assets-pagination {
    border-top-color: #414243;
  }

  .preview-dialog {
    :deep(.el-dialog__header) {
      background: #252526;
    }

    :deep(.el-dialog__footer) {
      background: #252526;
    }
  }

  .preview-footer {
    .preview-prompt {
      color: #cfd3dc;
    }
  }

  // 存储配置对话框暗色适配
  .storage-config {
    .storage-tip {
      color: #a3a6ad;
    }

    .storage-current {
      color: #cfd3dc;

      .storage-path {
        color: #66b1ff;
      }
    }
  }

  // 批量操作栏暗色适配
  .batch-action-bar {
    background: #252526;
    border-color: #414243;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.3);

    .batch-count {
      color: #a3a6ad;
    }
  }
}

// 批量操作浮动栏（固定在容器底部，使用 sticky 定位避免超出）
.batch-action-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  margin: 0 -24px -20px;
  background: #ffffff;
  border-top: 1px solid #ebeef5;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
  width: calc(100% + 48px);
  position: sticky;
  bottom: 0;
  z-index: 10;

  .batch-count {
    font-size: 13px;
    color: #606266;
  }

  .batch-actions {
    margin-left: auto;
  }
}

.toolbar-session-filter {
  width: 200px;
  flex-shrink: 0;
}

.assets-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
  padding-bottom: 8px;


  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #c0c4cc;
    border-radius: 3px;

    &:hover {
      background: #909399;
    }
  }
}

// 批量操作栏过渡动画
.batch-bar-enter-active,
.batch-bar-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.batch-bar-enter-from,
.batch-bar-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>