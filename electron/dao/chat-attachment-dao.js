// ============================================================
// AI 附件 DAO
// 实现 chat_attachments 表的插入与查询
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'chat_attachments'

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
 * 创建附件记录
 * @param {object} data - { message_id, session_id, type, name, file_path?, file_url?, file_size?, mime_type?, width?, height? }
 * @returns {object} 创建的附件
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (id, message_id, session_id, type, name, file_path, file_url, file_size, mime_type, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.message_id,
      data.session_id,
      data.type,
      data.name,
      data.file_path || null,
      data.file_url || null,
      data.file_size || 0,
      data.mime_type || null,
      data.width || null,
      data.height || null,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('ChatAttachmentDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询附件
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    return getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('ChatAttachmentDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询消息的所有附件
 * @param {string} messageId
 * @returns {object[]}
 */
function findByMessage (messageId) {
  try {
    return getStmt('findByMessage', `SELECT * FROM ${TABLE} WHERE message_id = ? ORDER BY created_at ASC`).all(messageId)
  } catch (error) {
    logger.error('ChatAttachmentDao', `findByMessage(${messageId}) 失败: ${error.message}`)
    return []
  }
}

/**
 * 查询会话的所有附件
 * @param {string} sessionId
 * @returns {object[]}
 */
function findBySession (sessionId) {
  try {
    return getStmt('findBySession', `SELECT * FROM ${TABLE} WHERE session_id = ? ORDER BY created_at ASC`).all(sessionId)
  } catch (error) {
    logger.error('ChatAttachmentDao', `findBySession(${sessionId}) 失败: ${error.message}`)
    return []
  }
}

/**
 * 删除附件
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('ChatAttachmentDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 删除消息的所有附件（级联）
 * @param {string} messageId
 * @returns {number} 删除数量
 */
function deleteByMessage (messageId) {
  try {
    const result = getStmt('deleteByMessage', `DELETE FROM ${TABLE} WHERE message_id = ?`).run(messageId)
    return result.changes
  } catch (error) {
    logger.error('ChatAttachmentDao', `deleteByMessage(${messageId}) 失败: ${error.message}`)
    return 0
  }
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create, getById, findByMessage, findBySession, del, deleteByMessage,
  clearCache
}