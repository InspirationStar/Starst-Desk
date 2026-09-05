// ============================================================
// 全局搜索 IPC 通道
// 注册 search:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const searchService = require('./../services/search-service.js')
const logger = require('./../core/logger.js')

// ============================================================
// search:query
// 执行聚合搜索
// ============================================================
register('search:query', async (event, data) => {
  try {
    const { query, type, limit } = data || {}
    const result = await searchService.search(query, { type, limit })
    return success(result)
  } catch (error) {
    logger.error('SearchChannels', `search:query 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// search:history
// 获取搜索历史
// ============================================================
register('search:history', async () => {
  try {
    return success({ history: searchService.getHistory() })
  } catch (error) {
    logger.error('SearchChannels', `search:history 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// search:clear-history
// 清除搜索历史
// ============================================================
register('search:clear-history', async () => {
  try {
    searchService.clearHistory()
    return success({ success: true })
  } catch (error) {
    logger.error('SearchChannels', `search:clear-history 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}