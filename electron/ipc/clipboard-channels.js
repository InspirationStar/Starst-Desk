// ============================================================
// 剪贴板 IPC 通道
// 注册 clipboard:* 系列 IPC 处理器
// 提供 reading/setting text、reading image、clearing clipboard 功能
// 供前端应用3使用（如复制分享链接、粘贴导入等场景）
// ============================================================

const { clipboard } = require('electron')
const { register, success, failure } = require('./registry.js')
const logger = require('./../core/logger.js')

/**
 * 注册剪贴板相关 IPC 通道
 */
function registerClipboardChannels () {
  // ============================================================
  // clipboard:read-text
  // 读取剪贴板文本
  // ============================================================
  register('clipboard:read-text', async () => {
    try {
      const text = clipboard.readText()
      return success({ text })
    } catch (error) {
      logger.error('ClipboardChannels', `clipboard:read-text 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })

  // ============================================================
  // clipboard:write-text
  // 写入剪贴板文本
  // ============================================================
  register('clipboard:write-text', async (event, data) => {
    try {
      clipboard.writeText(data?.text || '')
      return success({ success: true })
    } catch (error) {
      logger.error('ClipboardChannels', `clipboard:write-text 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })

  // ============================================================
  // clipboard:read-image
  // 读取剪贴板图片（返回 base64 或 hasImage:false）
  // ============================================================
  register('clipboard:read-image', async () => {
    try {
      const image = clipboard.readImage()
      if (image.isEmpty()) {
        return success({ hasImage: false })
      }
      // 限制大图片：像素数超过 500 万（约 5MB）时拒绝读取，避免 base64 过大导致 IPC 传输异常
      const size = image.getSize()
      if (size.width * size.height > 5000000) {
        return failure('IMAGE_TOO_LARGE', '图片过大，无法读取')
      }
      const base64 = image.toPNG().toString('base64')
      return success({ hasImage: true, base64, mimeType: 'image/png' })
    } catch (error) {
      logger.error('ClipboardChannels', `clipboard:read-image 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })

  // ============================================================
  // clipboard:clear
  // 清空剪贴板
  // ============================================================
  register('clipboard:clear', async () => {
    try {
      clipboard.clear()
      return success({ success: true })
    } catch (error) {
      logger.error('ClipboardChannels', `clipboard:clear 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })
}

module.exports = { registerClipboardChannels }