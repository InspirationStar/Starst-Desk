// ============================================================
// 发布说明 IPC 通道
// 注册 release-notes:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const releaseNotesService = require('./../services/release-notes-service.js')
const logger = require('./../core/logger.js')

// ============================================================
// release-notes:list
// 获取所有发布说明
// ============================================================
register('release-notes:list', async () => {
  try {
    return success({ list: releaseNotesService.list() })
  } catch (error) {
    logger.error('ReleaseNotesChannels', `release-notes:list 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// release-notes:get-current
// 获取当前版本的发布说明
// ============================================================
register('release-notes:get-current', async () => {
  try {
    return success({ note: releaseNotesService.getCurrent() })
  } catch (error) {
    logger.error('ReleaseNotesChannels', `release-notes:get-current 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}