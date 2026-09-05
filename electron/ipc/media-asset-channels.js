// ============================================================
// 媒体资产 IPC 通道
// 注册 media-asset:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const mediaAssetDao = require('./../dao/media-asset-dao.js')
const logger = require('./../core/logger.js')

// ============================================================
// media-asset:list
// 分页查询资产列表（支持 type / session_id / keyword 过滤）
// ============================================================
register('media-asset:list', async (event, data) => {
  try {
    const params = data || {}
    const result = mediaAssetDao.list({
      type: params.type || '',
      session_id: params.session_id || '',
      page: params.page || 1,
      pageSize: params.pageSize || 50,
      keyword: params.keyword || ''
    })
    return success(result)
  } catch (error) {
    logger.error('MediaAssetChannels', `media-asset:list 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// media-asset:get
// 按 ID 查询单个资产
// ============================================================
register('media-asset:get', async (event, data) => {
  try {
    if (!data.id) {
      return failure('ASSET_ID_REQUIRED', '资产 ID 不能为空')
    }
    const asset = mediaAssetDao.getById(data.id)
    if (!asset) {
      return failure('ASSET_NOT_FOUND', '资产不存在')
    }
    return success(asset)
  } catch (error) {
    logger.error('MediaAssetChannels', `media-asset:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// media-asset:create
// 创建资产记录
// ============================================================
register('media-asset:create', async (event, data) => {
  try {
    if (!data.type || !data.url) {
      return failure('REQUIRED_FIELDS', 'type, url 不能为空')
    }
    if (data.type !== 'image' && data.type !== 'video') {
      return failure('INVALID_TYPE', "type 必须为 'image' 或 'video'")
    }
    const asset = mediaAssetDao.create(data)
    return success(asset)
  } catch (error) {
    logger.error('MediaAssetChannels', `media-asset:create 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// media-asset:delete
// 删除资产（同时删除本地文件）
// ============================================================
register('media-asset:delete', async (event, data) => {
  try {
    if (!data.id) {
      return failure('ASSET_ID_REQUIRED', '资产 ID 不能为空')
    }
    // 先获取资产信息（用于获取 file_path）
    const asset = mediaAssetDao.getById(data.id)
    if (asset && asset.file_path) {
      try {
        const fs = require('fs')
        const path = require('path')
        // 删除本地文件
        if (fs.existsSync(asset.file_path)) {
          fs.unlinkSync(asset.file_path)
        }
        // 同时删除同目录下的缩略图（如果有）
        const thumbPath = path.join(path.dirname(asset.file_path), '.thumb_' + path.basename(asset.file_path))
        if (fs.existsSync(thumbPath)) {
          fs.unlinkSync(thumbPath)
        }
      } catch (err) {
        logger.warn('MediaAssetChannels', `删除本地文件失败（不影响数据库删除）: ${err.message}`)
      }
    }
    const result = mediaAssetDao.del(data.id)
    return success({ deleted: result })
  } catch (error) {
    logger.error('MediaAssetChannels', `media-asset:delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// media-asset:batch-delete
// 批量删除资产（同时删除本地文件）
// 参数：{ ids: [...] }
// 返回：{ deleted: number }
// ============================================================
register('media-asset:batch-delete', async (event, data) => {
  try {
    if (!data || !Array.isArray(data.ids) || data.ids.length === 0) {
      return failure('IDS_REQUIRED', 'ids 不能为空且必须为数组')
    }
    const fs = require('fs')
    const path = require('path')
    // 先收集所有需要删除的本地文件路径
    const filePaths = []
    for (const id of data.ids) {
      const asset = mediaAssetDao.getById(id)
      if (asset && asset.file_path) {
        filePaths.push(asset.file_path)
      }
    }
    // 删除本地文件
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
        const thumbPath = path.join(path.dirname(filePath), '.thumb_' + path.basename(filePath))
        if (fs.existsSync(thumbPath)) {
          fs.unlinkSync(thumbPath)
        }
      } catch (err) {
        logger.warn('MediaAssetChannels', `删除本地文件失败: ${err.message}`)
      }
    }
    const deleted = mediaAssetDao.batchDelete(data.ids)
    return success({ deleted })
  } catch (error) {
    logger.error('MediaAssetChannels', `media-asset:batch-delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// media-asset:stats
// 获取资产统计信息（总图片数、总视频数、总大小）
// ============================================================
register('media-asset:stats', async (event, data) => {
  try {
    const stats = mediaAssetDao.getStats()
    return success(stats)
  } catch (error) {
    logger.error('MediaAssetChannels', `media-asset:stats 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// media-asset:updatePath
// 更新本地存储路径
// ============================================================
register('media-asset:updatePath', async (event, data) => {
  try {
    if (!data.id) {
      return failure('ASSET_ID_REQUIRED', '资产 ID 不能为空')
    }
    const asset = mediaAssetDao.updateFilePath(data.id, data.file_path)
    if (!asset) {
      return failure('ASSET_NOT_FOUND', '资产不存在或更新失败')
    }
    return success(asset)
  } catch (error) {
    logger.error('MediaAssetChannels', `media-asset:updatePath 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// media-asset:findByMessageIds
// 按 message_id 批量查询资产
// 参数：{ message_ids: [...] }
// 返回：{ list: [...] }
// ============================================================
register('media-asset:findByMessageIds', async (event, data) => {
  try {
    if (!data || !Array.isArray(data.message_ids)) {
      return failure('MESSAGE_IDS_REQUIRED', 'message_ids 必须为数组')
    }
    const list = mediaAssetDao.findByMessageIds(data.message_ids)
    return success({ list })
  } catch (error) {
    logger.error('MediaAssetChannels', `media-asset:findByMessageIds 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}