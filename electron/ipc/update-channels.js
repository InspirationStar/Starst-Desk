// ============================================================
// 应用更新 IPC 通道
// 注册 update:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const appUpdateService = require('./../services/app-update-service.js')
const logger = require('./../core/logger.js')

// ============================================================
// update:check
// 检查应用更新
// ============================================================
register('update:check', async () => {
  try {
    const status = await appUpdateService.checkForUpdates()
    return success(status)
  } catch (error) {
    logger.error('UpdateChannels', `update:check 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// update:download
// 打开下载页面（在系统浏览器中打开 GitHub Release）
// ============================================================
register('update:download', async () => {
  try {
    await appUpdateService.openDownloadPage()
    return success({ success: true })
  } catch (error) {
    logger.error('UpdateChannels', `update:download 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// update:install
// 安装更新（简化实现：等同于打开下载页面，由用户手动下载安装）
// ============================================================
register('update:install', async () => {
  try {
    await appUpdateService.openDownloadPage()
    return success({ success: true })
  } catch (error) {
    logger.error('UpdateChannels', `update:install 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// update:get-status
// 获取当前更新状态
// ============================================================
register('update:get-status', async () => {
  try {
    return success(appUpdateService.getStatus())
  } catch (error) {
    logger.error('UpdateChannels', `update:get-status 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}