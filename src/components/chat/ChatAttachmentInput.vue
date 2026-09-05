<!--
  聊天附件输入组件
  功能：
    - 文件选择（图片/视频/文档）
    - 截图按钮
    - 附件预览区
    - 图片生成/视频生成快捷按钮
-->
<template>
  <div class="chat-attachment-input">
    <!-- 附件预览区 -->
    <div v-if="attachments.length > 0" class="attachment-preview-list">
      <div
        v-for="attachment in attachments"
        :key="attachment.id"
        class="attachment-preview-item"
        :class="`attachment-${attachment.type}`"
      >
        <!-- 图片预览 -->
        <img
          v-if="attachment.type === 'image'"
          :src="attachment.thumb_url || attachment.url"
          class="attachment-thumb"
          @click="handlePreviewImage(attachment)"
        />
        <!-- 视频预览 -->
        <video
          v-else-if="attachment.type === 'video'"
          :src="attachment.url"
          class="attachment-thumb"
          muted
          @loadeddata="handleVideoLoaded(attachment)"
          @click="handlePreviewVideo(attachment)"
        />
        <!-- 文件图标 -->
        <div v-else class="attachment-file-icon">
          <el-icon :size="24"><Document /></el-icon>
          <span class="attachment-file-name">{{ attachment.name }}</span>
        </div>

        <!-- 删除按钮 -->
        <el-button
          class="attachment-remove-btn"
          type="danger"
          size="small"
          circle
          :icon="Close"
          @click="handleRemoveAttachment(attachment.id)"
        />
      </div>
    </div>

    <!-- 操作按钮区 -->
    <div class="attachment-actions">
      <!-- 文件选择按钮 -->
      <el-tooltip content="添加附件" placement="top">
        <el-button
          :icon="Paperclip"
          circle
          :disabled="disabled"
          @click="handleChooseFile"
        />
      </el-tooltip>

      <!-- 截图按钮 -->
      <el-tooltip content="截图" placement="top">
        <el-button
          :icon="Camera"
          circle
          :disabled="disabled"
          @click="handleScreenshot"
        />
      </el-tooltip>

      <!-- 图片生成按钮 -->
      <el-tooltip content="图片生成" placement="top">
        <el-button
          :icon="Picture"
          circle
          :disabled="disabled"
          @click="handleGenerateImage"
        />
      </el-tooltip>

      <!-- 视频生成按钮 -->
      <el-tooltip content="视频生成" placement="top">
        <el-button
          :icon="VideoPlay"
          circle
          :disabled="disabled"
          @click="handleGenerateVideo"
        />
      </el-tooltip>
    </div>

    <!-- 图片生成对话框 -->
    <el-dialog
      v-model="imageGenVisible"
      title="图片生成"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item label="提示词">
          <el-input
            v-model="imagePrompt"
            type="textarea"
            :rows="4"
            placeholder="描述你想生成的图片..."
          />
        </el-form-item>
        <el-form-item label="尺寸">
          <el-select v-model="imageSize" style="width: 100%">
            <el-option label="1K (1024x1024)" value="1K" />
            <el-option label="2K (2048x2048)" value="2K" />
            <el-option label="16:9" value="16:9" />
            <el-option label="9:16" value="9:16" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="imageGenVisible = false">取消</el-button>
        <el-button type="primary" :loading="isGeneratingImage" @click="confirmGenerateImage">
          生成
        </el-button>
      </template>
    </el-dialog>

    <!-- 视频生成对话框 -->
    <el-dialog
      v-model="videoGenVisible"
      title="视频生成"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item label="提示词">
          <el-input
            v-model="videoPrompt"
            type="textarea"
            :rows="4"
            placeholder="描述你想生成的视频..."
          />
        </el-form-item>
        <el-form-item label="时长">
          <el-select v-model="videoDuration" style="width: 100%">
            <el-option label="3秒" :value="3" />
            <el-option label="5秒" :value="5" />
            <el-option label="10秒" :value="10" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="videoGenVisible = false">取消</el-button>
        <el-button type="primary" :loading="isGeneratingVideo" @click="confirmGenerateVideo">
          生成
        </el-button>
      </template>
    </el-dialog>

    <!-- 图片预览灯箱 -->
    <el-dialog
      v-model="imagePreviewVisible"
      width="80%"
      top="5vh"
      :show-close="true"
      class="image-preview-dialog"
    >
      <img :src="previewedImageUrl" class="preview-image-full" />
    </el-dialog>

    <!-- 视频预览灯箱 -->
    <el-dialog
      v-model="videoPreviewVisible"
      width="80%"
      top="5vh"
      :show-close="true"
      class="video-preview-dialog"
    >
      <video :src="previewedVideoUrl" controls autoplay class="preview-video-full" />
    </el-dialog>


  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Paperclip, Camera, Picture, VideoPlay, Close, Document
} from '@element-plus/icons-vue'
import { screenshotApi, agnesApi, on } from '@/utils/ipc-client'


const props = defineProps({
  attachments: {
    type: Array,
    default: () => []
  },
  disabled: {
    type: Boolean,
    default: false
  },
  // 媒体生成模式：''（默认，由 AI 自行判断）/ image（图生）/ video（视频生）
  mediaMode: {
    type: String,
    default: '',
    validator: (val) => ['', 'image', 'video'].includes(val)
  }
})

const emit = defineEmits(['update:attachments', 'screenshot'])


// Agnes 生图状态
const imageGenVisible = ref(false)
const imagePrompt = ref('')
const imageSize = ref('1K')
const isGeneratingImage = ref(false)

// Agnes 生视频状态
const videoGenVisible = ref(false)
const videoPrompt = ref('')
const videoDuration = ref(5)
const isGeneratingVideo = ref(false)

// 图片预览
const imagePreviewVisible = ref(false)
const previewedImageUrl = ref('')

// 视频预览
const videoPreviewVisible = ref(false)
const previewedVideoUrl = ref('')

// 区域截图覆盖层状态
const screenshotOverlayVisible = ref(false)
const screenshotBgDataUrl = ref('')
// 截图选区最终裁剪后的 base64（供预览/发送用）
const screenshotResultDataUrl = ref('')

/**
 * 注册 selection:result 监听（选区窗口确认后）
 */
let _selectionUnlisten = null
function registerSelectionListener () {
  if (_selectionUnlisten) return
  _selectionUnlisten = on('selection:result', (data) => {
    console.log('[SHOT] selection result:', data)
    handleScreenshotConfirm(data)
  })
}
function unregisterSelectionListener () {
  if (_selectionUnlisten) { _selectionUnlisten(); _selectionUnlisten = null }
}



// 文件大小限制（字节）
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024 // 100MB
const MAX_FILE_SIZE = 20 * 1024 * 1024   // 20MB

// 允许的文件类型
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm']
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
]

/**
 * 生成唯一ID
 */
function generateId () {
  return `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 格式化文件大小
 */
function formatFileSize (bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/**
 * 获取文件扩展名
 */
function getFileExtension (filename) {
  return filename.split('.').pop()?.toLowerCase() || ''
}

/**
 * 选择文件
 */
async function handleChooseFile () {
  // 创建文件输入元素
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.mp4,.webm,.pdf,.doc,.docx,.txt'

  input.onchange = async (e) => {
    const files = Array.from(e.target.files)
    for (const file of files) {
      await handleFileSelect(file)
    }
  }

  input.click()
}

/**
 * 处理文件选择
 */
async function handleFileSelect (file) {
  const extension = getFileExtension(file.name)
  let attachmentType = 'file'
  let maxSize = MAX_FILE_SIZE

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension)) {
    attachmentType = 'image'
    maxSize = MAX_IMAGE_SIZE
  } else if (['mp4', 'webm'].includes(extension)) {
    attachmentType = 'video'
    maxSize = MAX_VIDEO_SIZE
  }

  // 检查文件大小
  if (file.size > maxSize) {
    ElMessage.error(`${file.name} 文件大小超过限制`)
    return
  }

  // 读取文件为 base64
  const reader = new FileReader()
  reader.onload = (e) => {
    const attachment = {
      id: generateId(),
      type: attachmentType,
      url: e.target.result,
      name: file.name,
      size: file.size,
      thumb_url: attachmentType === 'image' ? e.target.result : null
    }
    emit('update:attachments', [...props.attachments, attachment])
  }
  reader.readAsDataURL(file)
}

/**
 * 删除附件
 */
function handleRemoveAttachment (id) {
  const newAttachments = props.attachments.filter(att => att.id !== id)
  emit('update:attachments', newAttachments)
}

/**
 * 触发截图：打开全屏选区窗口（GDI BitBlt 直截区域，绕过 desktopCapturer 1.7s）
 */
async function handleScreenshot () {
  try {
    registerSelectionListener()
    await screenshotApi.openSelection()
  } catch (error) {
    ElMessage.error(`截图失败: ${error.message}`)
  }
}

/**
 * 确认截图：把选区坐标传给主进程，用 GDI BitBlt 截取区域并输出 base64
 */
async function handleScreenshotConfirm (selectionRect) {
  screenshotOverlayVisible.value = false
  screenshotBgDataUrl.value = ''

  try {
    const result = await screenshotApi.area(selectionRect)
    if (result && result.dataUrl) {
      const attachment = {
        id: generateId(),
        type: 'image',
        url: result.dataUrl,
        name: `截图_${Date.now()}.png`,
        size: 0,
        thumb_url: result.dataUrl,
        isScreenshot: true,
        width: result.width,
        height: result.height
      }
      emit('update:attachments', [...props.attachments, attachment])
      emit('screenshot', attachment)
      ElMessage.success('截图已添加到附件')
    } else {
      ElMessage.error('截图失败：未获取到截图数据')
    }
  } catch (error) {
    ElMessage.error(`截图失败: ${error.message}`)
  }
}

/**
 * 取消区域截图
 */
function handleScreenshotCancel () {
  screenshotOverlayVisible.value = false
  screenshotBgDataUrl.value = ''

}


/**
 * 打开 Agnes 生图对话框
 */
function handleGenerateImage () {
  imageGenVisible.value = true
  imagePrompt.value = ''
}

/**
 * 确认生成图片
 */
async function confirmGenerateImage () {
  if (!imagePrompt.value.trim()) {
    ElMessage.warning('请输入提示词')
    return
  }

  isGeneratingImage.value = true
  try {
    const sizeMap = {
      '1K': '1024x1024',
      '2K': '2048x2048',
      '16:9': '2624x1472',
      '9:16': '1472x2624'
    }
    const result = await agnesApi.generateImage({
      prompt: imagePrompt.value,
      size: sizeMap[imageSize.value] || '1024x1024'
    })

    if (result && result.url) {
      const attachment = {
        id: generateId(),
        type: 'image',
        url: result.url,
        name: 'generated_image.png',
        size: 0,
        isAgnesGenerated: true
      }
      emit('update:attachments', [...props.attachments, attachment])
      ElMessage.success('图片生成成功')
      imageGenVisible.value = false
      imagePrompt.value = ''
    }
  } catch (error) {
    ElMessage.error(`图片生成失败: ${error.message}`)
  } finally {
    isGeneratingImage.value = false
  }
}

/**
 * 打开 Agnes 生视频对话框
 */
function handleGenerateVideo () {
  videoGenVisible.value = true
  videoPrompt.value = ''
}

/**
 * 确认生成视频
 */
async function confirmGenerateVideo () {
  if (!videoPrompt.value.trim()) {
    ElMessage.warning('请输入提示词')
    return
  }

  isGeneratingVideo.value = true
  try {
    // 计算帧数
    const numFrames = Math.min(441, Math.max(81, Math.round(videoDuration.value * 24)))
    const result = await agnesApi.generateVideo({
      prompt: videoPrompt.value,
      height: 768,
      width: 1152,
      num_frames: numFrames,
      frame_rate: 24
    })

    if (result && result.video_id) {
      const attachment = {
        id: generateId(),
        type: 'video',
        url: null,
        name: 'generating_video.mp4',
        size: 0,
        videoId: result.video_id,
        isAgnesGenerated: true,
        isGenerating: true
      }
      emit('update:attachments', [...props.attachments, attachment])
      ElMessage.success('视频生成任务已创建，请稍候...')
      videoGenVisible.value = false
      videoPrompt.value = ''

      // 开始轮询视频生成状态
      pollVideoResult(result.video_id, attachment.id)
    }
  } catch (error) {
    ElMessage.error(`视频生成失败: ${error.message}`)
  } finally {
    isGeneratingVideo.value = false
  }
}

/**
 * 轮询视频生成结果
 */
async function pollVideoResult (videoId, attachmentId) {
  const maxAttempts = 60
  let attempts = 0

  const poll = async () => {
    attempts++
    try {
      const result = await agnesApi.getVideoResult({ video_id: videoId })
      if (result && result.status === 'completed' && result.metadata?.url) {
        // 更新附件 URL
        const updatedAttachments = props.attachments.map(att => {
          if (att.id === attachmentId) {
            return { ...att, url: result.metadata.url, isGenerating: false }
          }
          return att
        })
        emit('update:attachments', updatedAttachments)
        ElMessage.success('视频生成完成')
        return
      }

      if (result && result.status === 'failed') {
        ElMessage.error('视频生成失败')
        return
      }

      if (attempts < maxAttempts) {
        setTimeout(poll, 5000)
      } else {
        ElMessage.warning('视频生成超时，请稍后重试')
      }
    } catch (error) {
      console.error('[ChatAttachmentInput] 轮询视频结果失败:', error)
      if (attempts < maxAttempts) {
        setTimeout(poll, 5000)
      }
    }
  }

  poll()
}

/**
 * 预览图片
 */
function handlePreviewImage (attachment) {
  previewedImageUrl.value = attachment.url
  imagePreviewVisible.value = true
}

/**
 * 预览视频
 */
function handlePreviewVideo (attachment) {
  previewedVideoUrl.value = attachment.url
  videoPreviewVisible.value = true
}

/**
 * 视频加载完成
 */
function handleVideoLoaded (attachment) {
  // 可以在此处理视频加载完成的事件
}

/**
 * 获取文件图标
 */
function getFileIcon (type) {
  switch (type) {
    case 'image': return 'Image'
    case 'video': return 'VideoCamera'
    default: return 'Document'
  }
}
</script>

<style scoped lang="scss">
.chat-attachment-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

// 附件预览列表
.attachment-preview-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  background: #f5f7fa;
  border-radius: 8px;
}

.attachment-preview-item {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  border: 1px solid #e4e7ed;

  .attachment-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    cursor: pointer;
    transition: transform 0.2s;

    &:hover {
      transform: scale(1.05);
    }
  }

  .attachment-file-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    gap: 4px;
    padding: 4px;

    .attachment-file-name {
      font-size: 10px;
      color: #606266;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      width: 100%;
      padding: 0 2px;
    }
  }

  .attachment-remove-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    padding: 0;
    opacity: 0;
    transition: opacity 0.2s;

    &:hover {
      opacity: 1;
    }
  }

  &:hover {
    .attachment-remove-btn {
      opacity: 1;
    }
  }
}

// 操作按钮区
.attachment-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}


// 图片预览对话框
.image-preview-dialog {
  .preview-image-full {
    max-width: 100%;
    max-height: 80vh;
    display: block;
    margin: 0 auto;
  }
}

// 视频预览对话框
.video-preview-dialog {
  .preview-video-full {
    max-width: 100%;
    max-height: 80vh;
    display: block;
    margin: 0 auto;
  }
}

// 暗色模式适配
[data-theme='dark'] {
  .attachment-preview-list {
    background: #1d1e1f;
  }

  .attachment-preview-item {
    background: #2b2d30;
    border-color: #414243;

    .attachment-file-name {
      color: #bfcbd9;
    }
  }

}
</style>