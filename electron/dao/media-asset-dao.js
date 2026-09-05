// ============================================================
// 媒体资产 DAO
// 实现 media_assets 表的增删改查，存储 AI 生成的图片/视频资产
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'media_assets'

// 预编译语句缓存
const stmts = {}
registerStmtCache(stmts)

function getStmt (key, sql) {
  if (!stmts[key]) {
    stmts[key] = getDb().prepare(sql)
  }
  return stmts[key]
}

/**
 * 创建媒体资产记录
 * @param {object} data - { type, url, thumbnail_url?, prompt?, model_name?, session_id?, message_id?, file_path?, file_size? }
 * @returns {object} 创建的资产
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    // 省略 config_id/metadata：只写入不读取，前端从不展示或查询这两个字段
    getStmt('create', `
      INSERT INTO ${TABLE} (id, type, url, thumbnail_url, prompt, model_name, session_id, message_id, file_path, file_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.type,
      data.url,
      data.thumbnail_url || null,
      data.prompt || null,
      data.model_name || null,
      data.session_id || null,
      data.message_id || null,
      data.file_path || null,
      data.file_size || 0,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('MediaAssetDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询资产
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    return getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('MediaAssetDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 分页查询资产列表
 * @param {object} options - { type?, session_id?, page?, pageSize?, keyword? }
 * @returns {object} { list, total }
 */
function list (options = {}) {
  const {
    type = '',
    session_id = '',
    page = 1,
    pageSize = 50,
    keyword = ''
  } = options

  try {
    // 构建 WHERE 条件
    const conditions = []
    const params = []

    // 类型筛选
    if (type) {
      conditions.push('type = ?')
      params.push(type)
    }

    // 会话筛选
    if (session_id) {
      conditions.push('session_id = ?')
      params.push(session_id)
    }

    // 关键词搜索（对 prompt 字段进行 LIKE 模糊匹配）
    // 转义 LIKE 通配符 _ 和 %，避免用户输入的特殊字符被当作通配符
    if (keyword) {
      const escapedKeyword = keyword.replace(/[%_]/g, '\\$&')
      conditions.push(`prompt LIKE ? ESCAPE '\\'`)
      params.push(`%${escapedKeyword}%`)
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // 查询总数（动态 SQL 以 SQL 文本作为缓存键，避免不同条件复用同一语句）
    const totalSql = `SELECT COUNT(*) as total FROM ${TABLE} ${whereSql}`
    const totalResult = getStmt('total:' + totalSql, totalSql).get(...params)
    const total = totalResult.total

    // 查询列表（分页，按 created_at DESC 排序）
    const offset = (page - 1) * pageSize
    const listSql = `SELECT * FROM ${TABLE} ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    const listResult = getStmt('list:' + listSql, listSql).all(...params, pageSize, offset)

    return { list: listResult, total }
  } catch (error) {
    logger.error('MediaAssetDao', `list() 失败: ${error.message}`)
    return { list: [], total: 0 }
  }
}

/**
 * 删除资产
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('MediaAssetDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 按会话删除资产（级联）
 * @param {string} sessionId
 * @returns {number} 删除数量
 */
function deleteBySession (sessionId) {
  try {
    const result = getStmt('deleteBySession', `DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId)
    return result.changes
  } catch (error) {
    logger.error('MediaAssetDao', `deleteBySession(${sessionId}) 失败: ${error.message}`)
    return 0
  }
}

/**
 * 获取资产统计信息
 * @returns {object} { totalImages, totalVideos, totalSize }
 */
function getStats () {
  try {
    const result = getStmt('getStats', `
      SELECT
        COALESCE(SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END), 0) as total_images,
        COALESCE(SUM(CASE WHEN type = 'video' THEN 1 ELSE 0 END), 0) as total_videos,
        COALESCE(SUM(file_size), 0) as total_size
      FROM ${TABLE}
    `).get()
    return {
      totalImages: result.total_images,
      totalVideos: result.total_videos,
      totalSize: result.total_size
    }
  } catch (error) {
    logger.error('MediaAssetDao', `getStats() 失败: ${error.message}`)
    return { totalImages: 0, totalVideos: 0, totalSize: 0 }
  }
}

/**
 * 更新本地存储路径
 * @param {string} id
 * @param {string} filePath
 * @returns {object|null} 更新后的资产
 */
function updateFilePath (id, filePath) {
  try {
    getStmt('updateFilePath', `UPDATE ${TABLE} SET file_path = ? WHERE id = ?`).run(filePath, id)
    return getById(id)
  } catch (error) {
    logger.error('MediaAssetDao', `updateFilePath(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 按 message_id 批量查询资产
 * @param {string[]} messageIds - 消息 ID 数组
 * @returns {Array<{id, message_id, file_path, url, type}>} 资产列表
 */
function findByMessageIds (messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return []
  }
  try {
    // 动态构建占位符，以 SQL 文本作为缓存键
    const placeholders = messageIds.map(() => '?').join(', ')
    const sql = `SELECT id, message_id, file_path, url, type FROM ${TABLE} WHERE message_id IN (${placeholders})`
    const stmt = getStmt('findByMessageIds:' + sql, sql)
    return stmt.all(...messageIds)
  } catch (error) {
    logger.error('MediaAssetDao', `findByMessageIds() 失败: ${error.message}`)
    return []
  }
}

/**
 * 批量删除资产
 * @param {string[]} ids - 资产 ID 数组
 * @returns {number} 删除数量
 */
function batchDelete (ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0
  }
  try {
    const placeholders = ids.map(() => '?').join(', ')
    const sql = `DELETE FROM ${TABLE} WHERE id IN (${placeholders})`
    const stmt = getStmt('batchDelete:' + sql, sql)
    const result = stmt.run(...ids)
    return result.changes
  } catch (error) {
    logger.error('MediaAssetDao', `batchDelete() 失败: ${error.message}`)
    return 0
  }
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create, getById, list, del, batchDelete, deleteBySession, getStats, updateFilePath,
  findByMessageIds, clearCache
}