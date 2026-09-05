<!--
  消息气泡组件
  职责：展示单条消息（用户/AI）
  - 用户消息：右对齐，蓝色背景
  - AI 消息：左对齐，灰色背景，使用 MarkdownRenderer 渲染
  - 显示时间戳
  - 流式输出时显示光标动画
  - AI 消息下方显示操作按钮（复制、重新生成）
-->
<template>
  <div class="message-bubble" :class="messageClass">
    <div class="message-avatar">
      <el-icon :size="28">
        <component :is="avatarIcon" />
      </el-icon>
    </div>

    <div class="message-main">
      <div class="message-header">
        <span class="message-role">{{ roleLabel }}</span>
        <span class="message-time">{{ formattedTime }}</span>
      </div>

      <div class="message-content">
        <!-- 用户消息：纯文本 -->
        <div v-if="isUser" class="user-content">{{ message.content }}</div>

        <!-- AI 消息：Markdown 渲染 -->
        <div v-else class="ai-content">
          <!-- 媒体生成消息 -->
          <template v-if="message.mediaType">
            <!-- 生成中 / 错误：骨架屏占位 -->
            <MediaPlaceholder
              v-if="message.mediaStatus !== 'success'"
              :type="message.mediaType"
              :progress="message.mediaProgress || 0"
              :status="message.mediaStatus || 'pending'"
              :error-message="message.mediaError || ''"
              :estimated-seconds="message.mediaEstimatedSeconds || 0"
              @retry="handleMediaRetry"
              @stop="$emit('media-stop', message)"
            />

            <!-- 图片生成成功：优先 data URL（CSP 兼容），回退到原始 URL -->
            <div v-else-if="message.mediaType === 'image'" class="media-result media-image-result">
              <!-- 资产已从资产盒子删除：显示占位符 -->
              <div v-if="assetDeleted" class="media-image-placeholder media-image-deleted">
                <el-icon :size="32"><PictureFilled /></el-icon>
                <span>该图片已从资产盒子删除</span>
                <el-button
                  type="primary"
                  size="small"
                  :icon="RefreshRight"
                  :loading="reloading"
                  @click="handleReloadToAssets"
                >
                  重新加载到资产盒子
                </el-button>
              </div>
              <el-image
                v-else-if="displayImageUrl"
                :src="displayImageUrl"
                :preview-src-list="[displayImageUrl]"
                fit="cover"
                class="media-image"
                hide-on-click-modal
                preview-teleported
                @error="handleImageError"
              />
              <div v-else-if="mediaLoadFailed" class="media-image-placeholder media-image-error">
                <el-icon :size="24"><CircleCloseFilled /></el-icon>
                <span>图片资源已失效</span>
              </div>
              <div v-else class="media-image-placeholder">
                <div class="media-image-loading">
                  <el-icon :size="24"><PictureFilled /></el-icon>
                  <span>加载中...</span>
                </div>
              </div>
              <div class="media-footer">
                <div class="media-meta">
                  <span
                    v-for="item in mediaMetaList"
                    :key="item.label"
                    class="meta-item"
                  >
                    <span class="meta-label">{{ item.label }}</span>
                    <span class="meta-value">{{ item.value }}</span>
                  </span>
                </div>
                <div class="media-actions">
                  <el-button text size="small" :icon="Download" @click="handleDownloadMedia">
                    下载
                  </el-button>
                  <el-button
                    v-if="assetDeleted"
                    text
                    size="small"
                    :icon="RefreshRight"
                    :loading="reloading"
                    @click="handleReloadToAssets"
                  >
                    重新加载到资产盒子
                  </el-button>
                  <el-button
                    v-if="canRegenerate"
                    text
                    size="small"
                    :icon="RefreshRight"
                    @click="handleRegenerateMedia"
                  >
                    重新生成
                  </el-button>
                </div>
              </div>
            </div>

            <!-- 视频生成成功：优先 data/blob URL（CSP 兼容），回退到原始 URL -->
            <div v-else-if="message.mediaType === 'video'" class="media-result media-video-result">
              <!-- 资产已从资产盒子删除：显示占位符 -->
              <div v-if="assetDeleted" class="media-video-placeholder media-video-deleted">
                <el-icon :size="32"><VideoPlay /></el-icon>
                <span>该视频已从资产盒子删除</span>
                <el-button
                  type="primary"
                  size="small"
                  :icon="RefreshRight"
                  :loading="reloading"
                  @click="handleReloadToAssets"
                >
                  重新加载到资产盒子
                </el-button>
              </div>
              <video
                v-else-if="displayVideoUrl"
                :src="displayVideoUrl"
                controls
                class="media-video"
                @error="handleVideoError"
              />
              <div v-else-if="mediaLoadFailed" class="media-video-placeholder media-video-error">
                <el-icon :size="24"><CircleCloseFilled /></el-icon>
                <span>视频资源已失效</span>
              </div>
              <div v-else class="media-video-placeholder">
                <div class="media-video-loading">
                  <el-icon :size="24"><VideoPlay /></el-icon>
                  <span>加载中...</span>
                </div>
              </div>


              <div class="media-footer">
                <div class="media-meta">
                  <span
                    v-for="item in mediaMetaList"
                    :key="item.label"
                    class="meta-item"
                  >
                    <span class="meta-label">{{ item.label }}</span>
                    <span class="meta-value">{{ item.value }}</span>
                  </span>
                </div>
                <div class="media-actions">
                  <el-button text size="small" :icon="Download" @click="handleDownloadMedia">
                    下载
                  </el-button>
                  <el-button
                    v-if="assetDeleted"
                    text
                    size="small"
                    :icon="RefreshRight"
                    :loading="reloading"
                    @click="handleReloadToAssets"
                  >
                    重新加载到资产盒子
                  </el-button>
                  <el-button
                    v-if="canRegenerate"
                    text
                    size="small"
                    :icon="RefreshRight"
                    @click="handleRegenerateMedia"
                  >
                    重新生成
                  </el-button>
                </div>
              </div>
            </div>
          </template>

          <!-- 普通 Markdown 消息 -->
          <template v-else>
            <!-- 上下文注入展示区（每轮调用模型前的注入信息） -->
            <div
              v-if="message.contextInjections && message.contextInjections.length > 0"
              class="context-injections"
            >
              <ContextInject
                v-for="(inj, idx) in message.contextInjections"
                :key="idx"
                :title="inj.title"
                :description="inj.description"
                :context-items="inj.contextItems"
              />
            </div>

            <!-- 工具调用上下文展示区 -->
            <div
              v-if="message.toolCallContexts && message.toolCallContexts.length > 0"
              class="tool-call-contexts"
            >
              <ToolCallContext
                v-for="ctx in message.toolCallContexts"
                :key="ctx.toolCallId"
                :name="ctx.name"
                :type="ctx.type"
                :prompt="ctx.prompt"
                :status="ctx.status"
                :iteration="ctx.iteration"
                :args="ctx.args"
                :context-message="ctx.contextInfo?.message"
              />
            </div>

            <!-- 思考过程（折叠，与桌宠对话面板对齐） -->
            <!-- 流式时用 streamingThinking，非流式时用 parsedContent.thinking -->
            <div v-if="displayThinking" class="message-thinking" :class="{ 'is-collapsed': !thinkingExpanded }">
              <div class="message-thinking__header" @click="thinkingExpanded = !thinkingExpanded">
                <div class="message-thinking__icon">
                  <el-icon :size="14"><MagicStick /></el-icon>
                </div>
                <span class="message-thinking__label">{{ thinkingLabel }}</span>
                <el-icon :size="12" class="message-thinking__toggle">
                  <ArrowDown v-if="!thinkingExpanded" />
                  <ArrowUp v-else />
                </el-icon>
              </div>
              <transition name="thinking-slide">
                <div v-if="thinkingExpanded" class="message-thinking__body">{{ displayThinking }}</div>
              </transition>
            </div>
            <!-- 正式内容 -->
            <MarkdownRenderer v-if="displayContent" :content="displayContent" />
            <span v-if="isStreaming" class="streaming-cursor">▋</span>
            <div v-if="!displayContent && !isStreaming && !displayThinking && (!message.toolCallContexts || message.toolCallContexts.length === 0) && (!message.contextInjections || message.contextInjections.length === 0)" class="empty-content">（空回复）</div>
          </template>
        </div>

        <!-- 附件渲染区 -->
        <div v-if="message.attachments && message.attachments.length > 0" class="message-attachments">
          <div
            v-for="attachment in message.attachments"
            :key="attachment.id"
            class="attachment-item"
            :class="`attachment-${attachment.type}`"
          >
            <!-- 图片附件：el-image 灯箱预览 -->
            <template v-if="attachment.type === 'image'">
              <el-image
                :src="attachment.thumb_url || attachment.url"
                :preview-src-list="[attachment.url]"
                fit="cover"
                class="attachment-image"
                hide-on-click-modal
                preview-teleported
                :style="attachment.width ? { width: `${attachment.width}px` } : {}"
              />
            </template>

            <!-- 视频附件 -->
            <template v-else-if="attachment.type === 'video'">
              <video
                :src="attachment.url"
                class="attachment-video"
                controls
                :poster="attachment.thumb_url"
              />
            </template>

            <!-- 文件附件 -->
            <template v-else>
              <a
                :href="attachment.url"
                :download="attachment.name"
                class="attachment-file"
              >
                <el-icon :size="24"><Document /></el-icon>
                <span class="attachment-file-name">{{ attachment.name }}</span>
                <span class="attachment-file-size">{{ formatFileSize(attachment.size) }}</span>
              </a>
            </template>
          </div>
        </div>
      </div>

      <!-- AI 消息操作按钮 -->
      <div
        v-if="isAssistant && message.content && !isStreaming && !message.mediaType"
        class="message-actions"
      >
        <el-button
          text
          size="small"
          :icon="CopyDocument"
          @click="handleCopy"
        >
          复制
        </el-button>
        <el-button
          v-if="canRegenerate"
          text
          size="small"
          :icon="RefreshRight"
          @click="$emit('regenerate')"
        >
          重新生成
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onUnmounted } from 'vue'
import {
  User, ChatDotRound, CopyDocument, RefreshRight, Document, Download,
  PictureFilled, Link, VideoPlay, CircleCloseFilled,
  MagicStick, ArrowDown, ArrowUp
} from '@element-plus/icons-vue'
import MarkdownRenderer from './MarkdownRenderer.vue'
import MediaPlaceholder from './MediaPlaceholder.vue'
import ToolCallContext from './ToolCallContext.vue'
import ContextInject from './ContextInject.vue'

import { loadMediaDataUrl as loadMediaResource, saveMediaToLocal, getLocalPath } from '@/utils/media-loader'
import { mediaAssetApi } from '@/utils/ipc-client'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'


const props = defineProps({
  // 消息对象 { id, role, content, is_complete, created_at, mediaType?, mediaStatus?, mediaProgress?, mediaError?, mediaEstimatedSeconds?, mediaMetadata? }
  message: {
    type: Object,
    required: true
  },
  // 是否正在流式输出此消息
  isStreaming: {
    type: Boolean,
    default: false
  },
  // 流式输出中的思考过程（推理模型分离传输，仅流式时有值）
  streamingThinking: {
    type: String,
    default: ''
  },
  // 是否可以重新生成（通常是最后一条 AI 消息）
  canRegenerate: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['regenerate', 'media-retry', 'media-stop'])

// 角色判断
const isUser = computed(() => props.message.role === 'user')
const isAssistant = computed(() => props.message.role === 'assistant')

// 消息样式类
const messageClass = computed(() => ({
  'message-user': isUser.value,
  'message-assistant': isAssistant.value
}))

// 头像图标
const avatarIcon = computed(() => isUser.value ? User : ChatDotRound)

// 角色标签
const roleLabel = computed(() => isUser.value ? '我' : 'AI')

// 格式化时间
// 使用 dayjs 解析本地时间字符串（YYYY-MM-DD HH:mm:ss），避免 new Date() 在不同格式下的时区解析歧义
const formattedTime = computed(() => {
  if (!props.message.created_at) return ''
  const d = dayjs(props.message.created_at)
  if (!d.isValid()) return ''
  return d.format('HH:mm')
})

// ============================================================
// 思考过程显示（与桌宠 PetChatPanel/PetRichText 对齐）
// ============================================================

// 思考过程标记正则： IMD ... IMD （与 DeepSeek 官方格式一致，与 PetRichText.vue 保持同步）
const THINKING_RE = /^ IMD ([\s\S]*?) IMD \s*/

// 思考折叠展开状态
const thinkingExpanded = ref(false)

/**
 * 解析 message.content 中的 IMD 标记，分离思考过程与正式内容
 * - 流式时：message.content 只有正式内容（chat-store 未拼接 IMD 标记），思考过程通过 streamingThinking prop 传入
 * - 非流式时：message.content 可能含 IMD 标记（后端持久化格式 IMD ${thinking} IMD \n\n${content}）
 */
const parsedContent = computed(() => {
  const text = props.message.content || ''
  const match = text.match(THINKING_RE)
  if (match) {
    return {
      thinking: match[1].trim(),
      content: text.replace(THINKING_RE, '')
    }
  }
  return { thinking: '', content: text }
})

// 当前应显示的思考过程：流式时优先 streamingThinking，非流式时用 parsedContent.thinking
const displayThinking = computed(() => {
  if (props.isStreaming) return props.streamingThinking || ''
  return parsedContent.value.thinking
})

// 思考折叠区标签：流式时显示"思考中..."，非流式时显示"已深度思考"
// 注：思考用时数据后端暂未透传，故不展示用时
const thinkingLabel = computed(() => {
  if (props.isStreaming) return '思考中...'
  return '已深度思考'
})

// 当前应显示的正式内容：流式时 message.content 即正式内容，非流式时取 parsedContent.content
const displayContent = computed(() => {
  if (props.isStreaming) return props.message.content || ''
  return parsedContent.value.content
})

// 复制消息内容
async function handleCopy () {
  const text = props.message.content || ''
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      // 回退方案
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
  } catch (err) {
    console.error('[MessageBubble] 复制失败:', err)
  }
}

// 格式化文件大小
function formatFileSize (bytes) {
  if (!bytes) return ''
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// ============================================================
// 媒体生成结果相关
// ============================================================

// 媒体 URL：优先从 mediaMetadata.url 读取，回退到从 content 解析
const mediaUrl = computed(() => {
  const meta = props.message.mediaMetadata || {}
  if (meta.url) return meta.url
  const content = props.message.content || ''
  // 图片：![生成图片](url)
  const imgMatch = content.match(/!\[[^\]]*\]\(([^)]+)\)/)
  if (imgMatch) return imgMatch[1]
  // 视频：<video src="url" ...>（兼容 src 后跟空格、斜杠等）
  const videoMatch = content.match(/<video[^>]+src=["']([^"']+)["']/)
  if (videoMatch) return videoMatch[1]
  // 直接 URL（content 就是纯 URL）
  const trimmed = content.trim()
  if (/^https?:\/\/.+/i.test(trimmed) || /^data:image\/[\w+]+;base64,.+/i.test(trimmed)) {
    return trimmed
  }
  return ''
})

// 生成参数摘要列表
const mediaMetaList = computed(() => {
  const meta = props.message.mediaMetadata || {}
  const list = []
  if (meta.model) list.push({ label: '模型', value: meta.model })
  if (meta.size) list.push({ label: '尺寸', value: meta.size })
  if (meta.ratio) list.push({ label: '比例', value: meta.ratio })
  if (meta.duration) list.push({ label: '时长', value: `${meta.duration}s` })
  if (meta.resolution) list.push({ label: '分辨率', value: meta.resolution })
  return list
})

// 下载文件名
const mediaFilename = computed(() => {
  const type = props.message.mediaType
  const ext = type === 'image' ? 'png' : 'mp4'
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `agnes-${type || 'media'}-${ts}.${ext}`
})

// 下载媒体文件（fetch + Blob 方式，跨域兼容更好）
async function handleDownloadMedia () {
  const url = mediaUrl.value
  if (!url) {
    console.warn('[MessageBubble] 无可下载的媒体 URL')
    return
  }
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = mediaFilename.value
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
  } catch (err) {
    console.error('[MessageBubble] 下载失败，回退到直接打开:', err)
    // 回退方案：新窗口打开
    window.open(url, '_blank')
  }
}

// 重新生成媒体（透传 regenerate 事件，由 ChatView 处理）
function handleRegenerateMedia () {
  emit('regenerate')
}

// 媒体重试（透传给父组件，由父组件重新触发生成）
function handleMediaRetry () {
  emit('media-retry', props.message)
}

// ============================================================
// 媒体加载兜底处理
// 解决跨域(CORS)/URL 重定向导致 el-image、video 加载失败问题
// 策略：用 fetch + blob 方式将外部 URL 转换为本地 blob URL，绕过跨域限制
// 若预加载失败或仍加载失败，显示兜底 UI（下载 + 新窗口打开）
// ============================================================

// 图片加载失败标记
const imageLoadError = ref(false)
// 媒体资源加载失败标记（loadMediaResource 返回空，说明 URL 已失效）
const mediaLoadFailed = ref(false)
// 资产是否已从资产盒子删除
const assetDeleted = ref(false)
// 重新加载中
const reloading = ref(false)
// 本地图片 data URL（主进程 IPC 下载后返回的 base64 data URL，绕过 CORS）
const localImageUrl = ref('')
// 实际显示的图片 URL：优先 dataUrl / 本地加载的 dataUrl / data:blob: URL，不回退远程 URL
const displayImageUrl = computed(() => {
  const dataUrl = props.message.mediaMetadata?.dataUrl
  if (dataUrl) return String(dataUrl)
  const localUrl = localImageUrl.value
  if (localUrl) return String(localUrl)
  // data:/blob: URL 可直接使用（CSP 允许）
  const url = mediaUrl.value
  if (url && /^(data|blob):/.test(url)) return url
  // 远程 URL 不直接使用，由 loadMediaResource 异步加载为 dataUrl
  return ''
})

// 视频加载失败标记
const videoLoadError = ref(false)
// 本地视频 data URL
const localVideoUrl = ref('')
// 实际显示的视频 URL：优先 dataUrl / 本地加载的 dataUrl / data:blob: URL，不回退远程 URL
const displayVideoUrl = computed(() => {
  const dataUrl = props.message.mediaMetadata?.dataUrl
  if (dataUrl) return String(dataUrl)
  const localUrl = localVideoUrl.value
  if (localUrl) return String(localUrl)
  const url = mediaUrl.value
  if (url && /^(data|blob):/.test(url)) return url
  return ''
})


// 释放本地 blob URL
function revokeLocalImage () {
  if (localImageUrl.value) {
    URL.revokeObjectURL(localImageUrl.value)
    localImageUrl.value = ''
  }
}

function revokeLocalVideo () {
  if (localVideoUrl.value) {
    URL.revokeObjectURL(localVideoUrl.value)
    localVideoUrl.value = ''
  }
}

// 监听 mediaUrl / message.id 变化，先检查资产是否存在，再决定是否预加载
// 合并为单个 watch 避免并发时序问题：assetDeleted 未确定就触发下载
watch(
  () => [mediaUrl.value, props.message.id],
  async ([url, msgId]) => {
    // 1. 检查资产是否已在资产盒子中
    assetDeleted.value = false
    if (msgId && props.message.mediaType) {
      try {
        const { list: assets } = await mediaAssetApi.findByMessageIds([msgId])
        assetDeleted.value = !assets || assets.length === 0
      } catch {
        assetDeleted.value = false
      }
    }

    // 2. 重置加载状态
    imageLoadError.value = false
    videoLoadError.value = false
    mediaLoadFailed.value = false
    revokeLocalImage()
    revokeLocalVideo()

    // 3. 资产已删除时不预加载（避免下载到磁盘），用户点击"重新加载"时再加载
    if (!url || assetDeleted.value) return
    // data: / blob: URL 无需转换
    if (/^(data|blob):/.test(url)) return
    // 如果已有 dataUrl（finalizeMediaPlaceholder 已设置），无需预加载
    if (props.message.mediaMetadata?.dataUrl) return
    // 如果 backfill 已标记为加载失败（URL 已失效），直接显示错误状态
    if (props.message.mediaMetadata?.loadFailed) {
      mediaLoadFailed.value = true
      return
    }

    // 4. 使用统一资源加载器预加载
    const localPath = props.message.mediaMetadata?.localPath
    const type = props.message.mediaType
    if (type === 'image') {
      try {
        const result = await loadMediaResource({ url, localPath })
        localImageUrl.value = result
        if (!result) mediaLoadFailed.value = true
      } catch (err) {
        mediaLoadFailed.value = true
        console.warn('[MessageBubble] 图片预加载失败:', err)
      }
    } else if (type === 'video') {
      try {
        const result = await loadMediaResource({ url, localPath })
        localVideoUrl.value = result
        if (!result) mediaLoadFailed.value = true
      } catch (err) {
        mediaLoadFailed.value = true
        console.warn('[MessageBubble] 视频预加载失败:', err)
      }
    }
  },
  { immediate: true }
)

// 重新加载到资产盒子
// 策略：先尝试下载文件到本地，URL 失效则拒绝创建记录，避免死锁
async function handleReloadToAssets () {
  if (!props.message.id || !mediaUrl.value) return
  reloading.value = true
  try {
    const url = mediaUrl.value
    const meta = props.message.mediaMetadata || {}
    const type = props.message.mediaType || 'image'
    const isImage = type === 'image'
    const loadedUrl = isImage ? localImageUrl.value : localVideoUrl.value

    // 尝试获取本地路径：优先已知 localPath / 缓存，再尝试远程下载
    let localPath = meta.localPath || getLocalPath(url) || null
    if (!localPath) {
      const saveResult = await saveMediaToLocal(url)
      if (saveResult?.localPath) localPath = saveResult.localPath
    }

    // 无本地文件且无已加载 data URL → URL 已失效，无法恢复
    if (!localPath && !loadedUrl) {
      ElMessage.error('资源 URL 已失效，无法重新加载到资产盒子')
      return
    }

    await mediaAssetApi.create({
      type,
      url,
      thumbnail_url: meta.thumbnailUrl || meta.url || '',
      prompt: meta.prompt || '',
      model_name: meta.model || '',
      session_id: props.message.session_id || null,
      message_id: props.message.id,
      file_path: localPath,
      metadata: meta
    })

    assetDeleted.value = false
    mediaLoadFailed.value = false

    // 若媒体未显示且本地有文件，重新加载为 data URL
    if (!loadedUrl && localPath) {
      const result = await loadMediaResource({ url, localPath })
      if (isImage) localImageUrl.value = result
      else localVideoUrl.value = result
      if (!result) mediaLoadFailed.value = true
    }

    ElMessage.success('已重新加载到资产盒子')
  } catch (err) {
    ElMessage.error(`重新加载失败：${err?.message || '未知错误'}`)
  } finally {
    reloading.value = false
  }
}

// 组件卸载时释放 blob URL，避免内存泄漏
onUnmounted(() => {
  revokeLocalImage()
  revokeLocalVideo()
})

// el-image 加载失败：显示兜底 UI
function handleImageError () {
  console.warn('[MessageBubble] el-image 加载失败:', displayImageUrl.value)
  imageLoadError.value = true
}

// video 加载失败：显示兜底 UI
function handleVideoError () {
  console.warn('[MessageBubble] video 加载失败:', displayVideoUrl.value)
  videoLoadError.value = true
}

// 在新窗口打开媒体原始 URL
function handleOpenInNewWindow () {
  const url = mediaUrl.value
  if (url) window.open(url, '_blank')
}
</script>

<style scoped lang="scss">
.message-bubble {
  display: flex;
  gap: 12px;
  margin: 16px 0;

  // 用户消息：右对齐
  &.message-user {
    flex-direction: row-reverse;

    .message-main {
      align-items: flex-end;
    }

    .message-avatar {
      background: #409eff;
      color: #fff;
    }
  }

  // AI 消息：左对齐
  &.message-assistant {
    .message-avatar {
      background: #67c23a;
      color: #fff;
    }
  }
}

.message-avatar {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-main {
  display: flex;
  flex-direction: column;
  max-width: 75%;
  min-width: 0;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: #909399;

  .message-role {
    font-weight: 600;
  }
}

.message-content {
  border-radius: 8px;
  padding: 10px 14px;
  word-break: break-word;

  .user-content {
    white-space: pre-wrap;
    background: #ecf5ff;
    color: #303133;
    border-radius: 8px;
    padding: 10px 14px;
  }

  .ai-content {
    background: #f5f7fa;
    color: #303133;
    border-radius: 8px;
    padding: 10px 14px;
    min-width: 60px;
    min-height: 24px;
  }

  // 思考过程折叠区（推理模型，与 ContextInject 风格统一：el-icon + CSS 变量 + 左边框 + 折叠箭头）
  .message-thinking {
    margin: 0 0 8px;
    border-left: 2px solid var(--el-color-info-light-5);
    border-radius: 0 4px 4px 0;
    background: var(--el-fill-color-lighter);
    overflow: hidden;

    &__header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }

    &__icon {
      display: flex;
      align-items: center;
    }

    &__label {
      flex: 1;
      font-weight: 500;
    }

    &__toggle {
      color: var(--el-text-color-placeholder);
    }

    &__body {
      padding: 4px 10px 8px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--el-text-color-secondary);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 200px;
      overflow-y: auto;

      &::-webkit-scrollbar {
        width: 4px;
      }
      &::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.15);
        border-radius: 2px;
      }
    }
  }

  .tool-call-contexts {
    margin-bottom: 8px;

    > * + * {
      margin-top: 8px;
    }
  }

  .context-injections {
    margin-bottom: 6px;

    > * + * {
      margin-top: 4px;
    }
  }

  .empty-content {
    color: #c0c4cc;
    font-style: italic;
  }
}

// 思考过程展开/收起动画
.thinking-slide-enter-active,
.thinking-slide-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.thinking-slide-enter-from,
.thinking-slide-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.thinking-slide-enter-to,
.thinking-slide-leave-from {
  opacity: 1;
  max-height: 220px;
}

// 流式光标动画
.streaming-cursor {
  display: inline-block;
  margin-left: 2px;
  color: #409eff;
  font-weight: bold;
  animation: blink 1s step-start infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.message-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  margin-left: 4px;
}

// ============================================================
// 媒体生成结果区
// ============================================================
.media-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 360px;
}

// 图片结果
.media-image-result {
  .media-image {
    width: 100%;
    max-height: 360px;
    border-radius: 8px;
    overflow: hidden;
    cursor: zoom-in;

    :deep(.el-image__inner) {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  // 加载中占位（CSP 阻止外部 URL 时显示）
  .media-image-placeholder {
    width: 100%;
    max-height: 360px;
    min-height: 200px;
    border-radius: 8px;
    background: linear-gradient(135deg, #f0f2f5 0%, #e4e7ed 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    .media-image-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: #909399;
      font-size: 13px;
    }
  }

  // 资源已失效占位
  .media-image-error {
    background: linear-gradient(135deg, #fef0f0 0%, #fde2e2 100%);
    color: #f56c6c;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
  }

  // 资产已删除占位
  .media-image-deleted {
    background: linear-gradient(135deg, #f4f4f5 0%, #e4e7ed 100%);
    color: #909399;
    flex-direction: column;
    gap: 12px;
    font-size: 13px;
    padding: 32px 16px;
  }
}

// 视频结果
.media-video-result {
  .media-video {
    width: 100%;
    max-height: 360px;
    border-radius: 8px;
    background: #000;
    display: block;
  }

  // 加载中占位
  .media-video-placeholder {
    width: 100%;
    max-height: 360px;
    min-height: 200px;
    border-radius: 8px;
    background: linear-gradient(135deg, #f0f2f5 0%, #e4e7ed 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    .media-video-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: #909399;
      font-size: 13px;
    }
  }

  // 资源已失效占位
  .media-video-error {
    background: linear-gradient(135deg, #fef0f0 0%, #fde2e2 100%);
    color: #f56c6c;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
  }

  // 资产已删除占位
  .media-video-deleted {
    background: linear-gradient(135deg, #f4f4f5 0%, #e4e7ed 100%);
    color: #909399;
    flex-direction: column;
    gap: 12px;
    font-size: 13px;
    padding: 32px 16px;
  }
}

// 参数摘要 + 操作按钮
.media-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.media-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  .meta-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    background: #ecf5ff;
    border-radius: 10px;
    font-size: 11px;
    line-height: 1.6;

    .meta-label {
      color: #909399;
    }

    .meta-value {
      color: #303133;
      font-weight: 500;
    }
  }
}

.media-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

// 媒体加载失败兜底 UI
.media-image-fallback,
.media-video-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 200px;
  padding: 24px;
  border-radius: 8px;
  background: #f5f7fa;
  border: 1px dashed #dcdfe6;

  .fallback-icon {
    color: #c0c4cc;
  }

  .fallback-text {
    font-size: 14px;
    color: #606266;
    font-weight: 500;
  }

  .fallback-hint {
    font-size: 12px;
    color: #909399;
  }

  .fallback-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
}

// 附件渲染区
.message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.attachment-item {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e4e7ed;
  background: #fff;

  &.attachment-image {
    .attachment-image {
      max-width: 200px;
      max-height: 200px;
      cursor: pointer;
      transition: transform 0.2s;

      &:hover {
        transform: scale(1.02);
      }
    }
  }

  &.attachment-video {
    .attachment-video {
      max-width: 300px;
      max-height: 200px;
      border-radius: 8px;
    }
  }

  &.attachment-file {
    .attachment-file {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 80px;
      height: 80px;
      padding: 8px;
      text-decoration: none;
      color: #606266;
      transition: background 0.2s;

      &:hover {
        background: #f5f7fa;
      }

      .attachment-file-name {
        font-size: 11px;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
        max-width: 70px;
      }

      .attachment-file-size {
        font-size: 9px;
        color: #909399;
        margin-top: 2px;
      }
    }
  }
}

// 暗色模式适配
[data-theme='dark'] {
  .message-content {
    .user-content {
      background: #2a3a4d;
      color: #e5edf5;
    }

    .ai-content {
      background: #2b2d30;
      color: #e5edf5;
    }

    // 思考过程折叠区暗色适配（CSS 变量自动适配主色，仅滚动条 thumb 需覆盖）
    .message-thinking {
      &__body {
        &::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
        }
      }
    }

    .empty-content {
      color: #6e7681;
    }
  }

  .message-header {
    color: #909399;
  }

  // 媒体结果区暗色适配
  .media-video-result {
    .media-video {
      background: #1a1a1a;
    }
  }

  // 媒体加载失败兜底 UI 暗色适配
  .media-image-fallback,
  .media-video-fallback {
    background: #2b2d30;
    border-color: #414243;

    .fallback-icon {
      color: #6e7681;
    }

    .fallback-text {
      color: #e5edf5;
    }

    .fallback-hint {
      color: #909399;
    }
  }

  .media-meta {
    .meta-item {
      background: #2a3a4d;

      .meta-label {
        color: #909399;
      }

      .meta-value {
        color: #e5edf5;
      }
    }
  }

  .message-attachments {
    .attachment-item {
      background: #2b2d30;
      border-color: #414243;

      &.attachment-file {
        .attachment-file {
          color: #bfcbd9;

          &:hover {
            background: #36383c;
          }

          .attachment-file-size {
            color: #a3a6ad;
          }
        }
      }
    }
  }

  // 媒体加载中占位暗色适配（避免浅色渐变背景刺眼）
  .media-image-placeholder,
  .media-video-placeholder {
    background: linear-gradient(135deg, #252627 0%, #2a2b2c 100%);

    .media-image-loading,
    .media-video-loading {
      color: #a3a6ad;
    }
  }

  // 资源已失效占位暗色适配
  .media-image-error,
  .media-video-error {
    background: linear-gradient(135deg, #2a1a1a 0%, #2e1d1d 100%);
    color: #f89898;
  }
}
</style>