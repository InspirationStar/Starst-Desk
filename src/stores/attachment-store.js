// ============================================================
// 附件管理 Pinia Store
// 职责：管理附件预览、上传进度、截图预览状态
// ============================================================

import { defineStore } from 'pinia'

export const useAttachmentStore = defineStore('attachment', {
  state: () => ({
    // 待发送的附件预览列表
    previewAttachments: [],
    // 是否正在上传
    isUploading: false,
    // 上传进度 (0-100)
    uploadProgress: 0,
    // 截图预览数据
    screenshotPreview: null,
    // 当前选中的消息ID（用于获取附件）
    currentMessageId: null
  }),

  getters: {
    /**
     * 是否有待发送的附件
     */
    hasAttachments (state) {
      return state.previewAttachments.length > 0
    },

    /**
     * 附件总大小
     */
    totalAttachmentSize (state) {
      return state.previewAttachments.reduce((sum, att) => sum + (att.size || 0), 0)
    },

    /**
     * 图片附件列表
     */
    imageAttachments (state) {
      return state.previewAttachments.filter(att => att.type === 'image')
    },

    /**
     * 视频附件列表
     */
    videoAttachments (state) {
      return state.previewAttachments.filter(att => att.type === 'video')
    }
  },

  actions: {
    /**
     * 添加附件到预览列表
     * @param {object} attachment
     */
    addAttachment (attachment) {
      this.previewAttachments.push(attachment)
    },

    /**
     * 从预览列表移除附件
     * @param {string} id
     */
    removeAttachment (id) {
      this.previewAttachments = this.previewAttachments.filter(att => att.id !== id)
    },

    /**
     * 清空预览附件
     */
    clearPreviews () {
      this.previewAttachments = []
      this.screenshotPreview = null
      this.uploadProgress = 0
    },

    /**
     * 设置截图预览
     * @param {object} screenshotData
     */
    setScreenshotPreview (screenshotData) {
      this.screenshotPreview = screenshotData
      // 自动添加到附件列表
      if (screenshotData) {
        this.addAttachment({
          id: screenshotData.id || `screenshot_${Date.now()}`,
          type: 'image',
          url: screenshotData.base64 || screenshotData.url,
          name: screenshotData.name || '截图.png',
          size: screenshotData.size || 0,
          width: screenshotData.width,
          height: screenshotData.height,
          isScreenshot: true
        })
      }
    },

    /**
     * 设置上传进度
     * @param {number} progress
     */
    setUploadProgress (progress) {
      this.uploadProgress = progress
      this.isUploading = progress > 0 && progress < 100
    },

    /**
     * 完成上传
     */
    finishUpload () {
      this.isUploading = false
      this.uploadProgress = 100
    }
  }
})

export default useAttachmentStore