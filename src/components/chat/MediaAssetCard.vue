<!--
  媒体资产卡片组件
  职责：展示单个媒体资产（图片/视频）的缩略图与元信息
  - 图片类型：el-image 显示缩略图
  - 视频类型：video 标签取第一帧，hover 显示播放图标
  - 底部：提示词（2 行截断）、模型名称、相对时间
  - hover 显示操作遮罩：预览 / 复制 URL / 删除
  - 暗色主题适配：[data-theme='dark']
-->
<template>
  <div class="media-asset-card" :class="[`is-${asset.type}`, { 'is-selected': selected, 'is-selectable': selectable }]" :data-asset-id="asset.id" @click="handleCardClick">
    <!-- 选择模式勾选框 -->
    <div v-if="selectable" class="asset-select" @click.stop="$emit('select', asset.id)">
      <el-checkbox :model-value="selected" size="large" />
    </div>

    <!-- 媒体预览区 -->
    <div class="asset-preview" @click="handlePreview">
      <!-- 图片 -->
      <el-image
        v-if="asset.type === 'image'"
        :src="displayThumbnailUrl"
        fit="cover"
        class="asset-image"
        lazy
      >
        <template #placeholder>
          <div class="asset-placeholder">
            <el-icon><Picture /></el-icon>
            <span>加载中...</span>
          </div>
        </template>
        <template #error>
          <div class="asset-placeholder asset-placeholder--error">
            <el-icon><PictureFilled /></el-icon>
            <span>加载失败</span>
          </div>
        </template>
      </el-image>

      <!-- 视频：取第一帧 -->
      <div v-else-if="asset.type === 'video'" class="asset-video-wrap">
        <video
          :src="displayThumbnailUrl || asset.url"
          class="asset-video"
          muted
          preload="metadata"
          @loadeddata="handleVideoLoaded"
        />
        <!-- 播放图标遮罩 -->
        <div class="asset-video-badge">
          <el-icon :size="32"><VideoPlay /></el-icon>
        </div>
      </div>

      <!-- 未知类型 -->
      <div v-else class="asset-placeholder">
        <el-icon><QuestionFilled /></el-icon>
        <span>未知类型</span>
      </div>

      <!-- hover 操作遮罩 -->
      <div class="asset-overlay">
        <button class="overlay-btn" title="预览" @click.stop="handlePreview">
          <el-icon><ZoomIn /></el-icon>
        </button>
        <button class="overlay-btn" title="复制 URL" @click.stop="handleCopyUrl">
          <el-icon><CopyDocument /></el-icon>
        </button>
        <button
          v-if="asset.file_path"
          class="overlay-btn"
          title="在资源管理器中打开"
          @click.stop="handleRevealInExplorer"
        >
          <el-icon><FolderOpened /></el-icon>
        </button>
        <button class="overlay-btn overlay-btn--danger" title="删除" @click.stop="handleDelete">
          <el-icon><Delete /></el-icon>
        </button>
      </div>
    </div>

    <!-- 卡片底部信息 -->
    <div class="asset-info">
      <!-- 提示词（截断 2 行） -->
      <div class="asset-prompt" :title="asset.prompt || ''">
        {{ asset.prompt || '（无提示词）' }}
      </div>
      <!-- 元信息行 -->
      <div class="asset-meta">
        <span v-if="asset.model_name" class="meta-item meta-model">
          <el-icon><Cpu /></el-icon>
          <span>{{ asset.model_name }}</span>
        </span>
        <span v-if="fileSizeText" class="meta-item meta-size">
          <el-icon><Files /></el-icon>
          <span>{{ fileSizeText }}</span>
        </span>
        <span class="meta-item meta-time">
          <el-icon><Clock /></el-icon>
          <span>{{ relativeTime }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  Picture, PictureFilled, ZoomIn, CopyDocument, Delete,
  VideoPlay, Clock, Cpu, QuestionFilled, FolderOpened, Files
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import relativeTimePlugin from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { mediaApi, fileApi, mediaAssetApi } from '@/utils/ipc-client'
import { loadMediaDataUrl, getLocalPath } from '@/utils/media-loader'
import { ElMessage } from 'element-plus'


// 启用 dayjs 相对时间插件
dayjs.extend(relativeTimePlugin)
dayjs.locale('zh-cn')

const props = defineProps({
  // 资产对象 { id, type, url, thumbnail_url, prompt, model_name, created_at, ... }
  asset: {
    type: Object,
    required: true
  },
  // 是否处于选择模式
  selectable: {
    type: Boolean,
    default: false
  },
  // 是否被选中
  selected: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['delete', 'preview', 'copyUrl', 'select'])

// 缩略图 URL：仅用于无本地文件时的初始占位（实际显示走统一加载器）
const thumbnailUrl = computed(() => {
  return props.asset.thumbnail_url || props.asset.url || ''
})

// 本地缩略图 data URL（异步加载，使用统一资源加载器）
const localThumbnailUrl = ref('')
// 防止重复加载的标记
const thumbnailLoading = ref(false)

// 实际显示的缩略图 URL：优先统一加载器返回的 data URL（CSP 兼容），无本地文件时回退原始 URL
const displayThumbnailUrl = computed(() => {
  if (localThumbnailUrl.value) return localThumbnailUrl.value
  // 有本地路径但尚未加载完成 → 回退原始 URL（浏览器缓存可加速）
  if (props.asset.file_path) return thumbnailUrl.value || ''
  // 无本地文件 → 直接显示原始 URL
  return thumbnailUrl.value || ''
})

// 懒加载缩略图（首次显示时才加载，从本地文件读取 dataUrl）
const loadThumbnail = async () => {
  if (localThumbnailUrl.value || thumbnailLoading.value) return
  thumbnailLoading.value = true
  try {
    const url = props.asset.thumbnail_url || props.asset.url
    const dataUrl = await loadMediaDataUrl({
      url,
      localPath: props.asset.file_path
    })
    if (dataUrl) localThumbnailUrl.value = dataUrl
    // 加载后检查本地路径是否变化（file_path 为空或文件被删除后重新下载）
    if (props.asset.id) {
      const localPath = getLocalPath(url)
      if (localPath && localPath !== props.asset.file_path) {
        try {
          await mediaAssetApi.updatePath(props.asset.id, localPath)
          props.asset.file_path = localPath
        } catch {
          // 更新失败不影响显示
        }
      }
    }
  } finally {
    thumbnailLoading.value = false
  }
}

// 使用 watch 监听 asset.id 变化，首次进入时触发加载
// 替代 IntersectionObserver：避免共享 observer 实例导致的状态混乱
// 注意：localThumbnailUrl 作为 ref 跨组件实例独立，不会因筛选切换而重置
watch(() => props.asset.id, (newId) => {
  // id 变化说明是不同资产，需要重新加载
  if (newId && !localThumbnailUrl.value) {
    loadThumbnail()
  }
}, { immediate: true })


// 相对时间（如"2 小时前"）
const relativeTime = computed(() => {
  const raw = props.asset.created_at
  if (!raw) return ''
  try {
    const date = typeof raw === 'string' && raw.includes('T')
      ? raw
      : String(raw).replace(' ', 'T')
    return dayjs(date).fromNow()
  } catch (err) {
    return ''
  }
})

// 文件大小（如"1.2 MB"），file_size 为 0 或缺失时不展示
const fileSizeText = computed(() => {
  const size = props.asset.file_size
  if (!size || size <= 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
})

/**
 * 视频元数据加载完成：seek 到 0.1s 取第一帧
 */
function handleVideoLoaded (event) {
  const video = event.target
  try {
    // seek 到 0.1 秒以显示首帧（部分浏览器需 muted + setted）
    video.currentTime = 0.1
  } catch (err) {
    // 忽略 seek 错误
  }
}

/**
 * 预加载缩略图（使用 IntersectionObserver）
 */
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      loadThumbnail()
      observer.unobserve(entry.target)
    }
  })
}, { rootMargin: '100px' })

// 组件挂载后设置观察者

onMounted(() => {
  // 延迟执行以确保 DOM 已渲染
  setTimeout(() => {
    const el = document.querySelector(`[data-asset-id="${props.asset.id}"]`)
    if (el) observer.observe(el)
  }, 0)
})

onUnmounted(() => {
  observer.disconnect()
})

/**
 * 预览：透传给父组件
 */
function handlePreview () {
  emit('preview', props.asset)
}

/**
 * 卡片点击：选择模式下切换选中，非选择模式不处理（由 asset-preview 内部触发预览）
 */
function handleCardClick () {
  if (props.selectable) {
    emit('select', props.asset.id)
  }
}

/**
 * 复制 URL：透传给父组件
 */
function handleCopyUrl () {
  emit('copyUrl', props.asset.url || '')
}

/**
 * 删除：透传 id 给父组件（由父组件统一弹确认框）
 */
function handleDelete () {
  emit('delete', props.asset.id)
}

/**
 * 在资源管理器中打开文件所在位置
 */
async function handleRevealInExplorer () {
  if (!props.asset.file_path) {
    ElMessage.warning('未找到本地文件路径')
    return
  }
  try {
    await fileApi.revealInExplorer(props.asset.file_path)
  } catch (e) {
    // 文件可能已被删除，尝试重新下载后打开
    try {
      const url = props.asset.thumbnail_url || props.asset.url
      await loadMediaDataUrl({ url, localPath: props.asset.file_path })
      const newLocalPath = getLocalPath(url)
      if (newLocalPath && newLocalPath !== props.asset.file_path) {
        await mediaAssetApi.updatePath(props.asset.id, newLocalPath)
        props.asset.file_path = newLocalPath
        await fileApi.revealInExplorer(newLocalPath)
      } else {
        ElMessage.error('本地文件已被删除，请尝试重新加载到资产盒子')
      }
    } catch {
      ElMessage.error('本地文件已被删除，请尝试重新加载到资产盒子')
    }
  }
}
</script>

<style scoped lang="scss">
.media-asset-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
  transition: box-shadow 0.2s ease, transform 0.2s ease;

  &:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    transform: translateY(-2px);

    .asset-overlay {
      opacity: 1;
      pointer-events: auto;
    }
  }

  // 选中状态高亮
  &.is-selected {
    border-color: var(--el-color-primary, #409eff);
    box-shadow: 0 0 0 2px var(--el-color-primary, #409eff);
  }

  // 选择模式：整个卡片可点击
  &.is-selectable {
    cursor: pointer;
  }
}

// 选择模式勾选框
.asset-select {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  cursor: pointer;

  :deep(.el-checkbox) {
    margin: 0;
  }
}

// 媒体预览区
.asset-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: #f5f7fa;
  cursor: zoom-in;
  overflow: hidden;
}

.asset-image {
  width: 100%;
  height: 100%;

  :deep(.el-image__inner) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

// 视频区
.asset-video-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
}

.asset-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

// 视频播放图标徽章（始终显示，标识视频类型）
.asset-video-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #ffffff;
  opacity: 0.85;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  pointer-events: none;
  transition: opacity 0.2s ease;

  .asset-preview:hover & {
    opacity: 0;
  }
}

// 占位（加载中 / 失败 / 未知类型）
.asset-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #909399;
  font-size: 13px;
  background: #f5f7fa;

  .el-icon {
    font-size: 32px;
  }

  &.asset-placeholder--error {
    color: #c0c4cc;
    background: #fef0f0;
  }
}

// hover 操作遮罩
.asset-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.overlay-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: #303133;
  cursor: pointer;
  font-size: 18px;
  transition: background 0.2s ease, color 0.2s ease, transform 0.15s ease;

  &:hover {
    background: #ffffff;
    transform: scale(1.08);
  }

  &.overlay-btn--danger:hover {
    background: #f56c6c;
    color: #ffffff;
  }
}

// 卡片底部信息
.asset-info {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.asset-prompt {
  font-size: 13px;
  line-height: 1.4;
  color: #303133;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
  min-height: 36px;
}

.asset-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #909399;

  .meta-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;

    .el-icon {
      font-size: 12px;
      flex-shrink: 0;
    }

    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .meta-model {
    flex: 1;
    min-width: 0;
  }

  .meta-time {
    flex-shrink: 0;
  }
}

// ============================================================
// 暗色主题适配
// ============================================================
[data-theme='dark'] {
  .media-asset-card {
    background: #252526;
    border-color: #414243;

    &:hover {
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }
  }

  .asset-preview {
    background: #1d1e1f;
  }

  .asset-placeholder {
    color: #a3a6ad;
    background: #1d1e1f;

    &.asset-placeholder--error {
      color: #6e7681;
      background: #2a1d1d;
    }
  }

  .asset-info {
    .asset-prompt {
      color: #e5eaf3;
    }

    .asset-meta {
      color: #a3a6ad;
    }
  }
}
</style>