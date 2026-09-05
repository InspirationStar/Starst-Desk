// ============================================================
// AI 会话 DAO
// 实现 chat_sessions 表的 CRUD
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'chat_sessions'

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
 * 创建会话
 * @param {object} data - { title, model_config_id, system_prompt? }
 * @returns {object} 创建的会话
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (id, title, model_config_id, system_prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.title,
      data.model_config_id,
      data.system_prompt || null,
      now,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('ChatSessionDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询会话
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    return getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('ChatSessionDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询所有会话（按更新时间倒序）
 * @param {object} options - { page?, size? }
 * @returns {object} { list, total }
 */
function list (options = {}) {
  const { page = 1, size = 50 } = options
  const offset = (page - 1) * size

  const totalResult = getStmt('listTotal', `SELECT COUNT(*) as total FROM ${TABLE}`).get()
  const total = totalResult.total

  const rows = getStmt('list', `
    SELECT * FROM ${TABLE}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(size, offset)

  return { list: rows, total }
}

/**
 * 更新会话（更新标题、system_prompt、updated_at）
 * @param {string} id
 * @param {object} data
 * @returns {object|null}
 */
function update (id, data) {
  try {
    const fields = []
    const params = []

    if (data.title !== undefined) { fields.push('title = ?'); params.push(data.title) }
    if (data.system_prompt !== undefined) { fields.push('system_prompt = ?'); params.push(data.system_prompt) }
    if (data.model_config_id !== undefined) { fields.push('model_config_id = ?'); params.push(data.model_config_id) }

    if (fields.length === 0) return getById(id)

    // 使用 dateUtils.nowISO() 保持与其他写入方法时区一致（本地时间）
    // 避免 SQLite datetime('now') 返回 UTC 导致 updated_at 时区不一致
    fields.push('updated_at = ?')
    params.push(dateUtils.nowISO())
    params.push(id)

    // 关键修复：动态 SQL 不能用固定 key 缓存（同 widget-dao.js），用字段签名作为 key
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return getById(id)
  } catch (error) {
    logger.error('ChatSessionDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 删除会话（级联删除关联消息）
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('ChatSessionDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 批量删除会话（级联删除关联消息）
 * @param {Array<string>} ids - 会话 ID 数组
 * @returns {number} 成功删除的数量
 */
function bulkDelete (ids) {
  if (!ids || ids.length === 0) return 0
  try {
    const placeholders = ids.map(() => '?').join(', ')
    const result = getStmt('bulkDelete', `DELETE FROM ${TABLE} WHERE id IN (${placeholders})`).run(...ids)
    return result.changes
  } catch (error) {
    logger.error('ChatSessionDao', `bulkDelete() 失败: ${error.message}`)
    return 0
  }
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create, getById, list, update, del, bulkDelete, clearCache
}

