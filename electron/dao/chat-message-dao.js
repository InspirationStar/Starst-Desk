// ============================================================
// AI 消息 DAO
// 实现 chat_messages 表的插入与查询
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'chat_messages'

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
 * 插入消息
 * @param {object} data - { session_id, role, content, is_complete? }
 * @returns {object} 创建的消息
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (id, session_id, role, content, is_complete, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.session_id,
      data.role,
      data.content,
      data.is_complete !== undefined ? (data.is_complete ? 1 : 0) : 1,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('ChatMessageDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询消息
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    return getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('ChatMessageDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询会话的所有消息（按创建时间正序）
 * @param {string} sessionId
 * @param {object} options - { page?, size? }
 * @returns {object} { list, total }
 */
function findBySession (sessionId, options = {}) {
  const { page = 1, size = 100 } = options
  const offset = (page - 1) * size

  const totalResult = getStmt('findBySessionTotal', `SELECT COUNT(*) as total FROM ${TABLE} WHERE session_id = ?`).get(sessionId)
  const total = totalResult.total

  const rows = getStmt('findBySession', `
    SELECT * FROM ${TABLE} WHERE session_id = ?
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).all(sessionId, size, offset)

  return { list: rows, total }
}

/**
 * 更新消息内容
 * @param {string} id 消息 ID
 * @param {string} content 新内容
 * @returns {object|null} 更新后的消息
 */
function update (id, content) {
  try {
    getStmt('update', `UPDATE ${TABLE} SET content = ? WHERE id = ?`).run(content, id)
    return getById(id)
  } catch (error) {
    logger.error('ChatMessageDao', `update(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 标记消息为已完成
 * @param {string} id
 * @returns {boolean}
 */
function markComplete (id) {
  try {
    getStmt('markComplete', `UPDATE ${TABLE} SET is_complete = 1 WHERE id = ?`).run(id)
    return true
  } catch (error) {
    logger.error('ChatMessageDao', `markComplete(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 删除指定消息（用于重新生成场景）
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('ChatMessageDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 删除会话的所有消息（辅助方法）
 * @param {string} sessionId
 * @returns {number} 删除数量
 */
function deleteBySession (sessionId) {
  try {
    const result = getStmt('deleteBySession', `DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId)
    return result.changes
  } catch (error) {
    logger.error('ChatMessageDao', `deleteBySession(${sessionId}) 失败: ${error.message}`)
    return 0
  }
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

/**
 * 追加上下文注入记录到消息
 * @param {string} id 消息 ID
 * @param {object} injection 上下文注入信息
 */
function appendContextInjection (id, injection) {
  try {
    const msg = getById(id)
    const list = msg?.context_injections ? JSON.parse(msg.context_injections) : []
    list.push(injection)
    getStmt('appendContextInjection', `UPDATE ${TABLE} SET context_injections = ? WHERE id = ?`).run(JSON.stringify(list), id)
  } catch (error) {
    logger.error('ChatMessageDao', `appendContextInjection(${id}) 失败: ${error.message}`)
  }
}

/**
 * 追加工具调用上下文记录到消息
 * @param {string} id 消息 ID
 * @param {object} context 工具调用上下文
 */
function appendToolCallContext (id, context) {
  try {
    const msg = getById(id)
    const list = msg?.tool_call_contexts ? JSON.parse(msg.tool_call_contexts) : []
    list.push(context)
    getStmt('appendToolCallContext', `UPDATE ${TABLE} SET tool_call_contexts = ? WHERE id = ?`).run(JSON.stringify(list), id)
  } catch (error) {
    logger.error('ChatMessageDao', `appendToolCallContext(${id}) 失败: ${error.message}`)
  }
}

module.exports = {
  create, getById, findBySession, update, markComplete, del, deleteBySession,
  appendContextInjection, appendToolCallContext,
  clearCache
}
