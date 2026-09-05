// ============================================================
// 任务执行历史 DAO
// 实现 task_executions 表的记录写入与查询
// 插入超限时自动删除最旧记录，保留最近 1000 条
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'task_executions'
const MAX_HISTORY = 1000

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
 * 记录任务执行结果
 * @param {object} data - { task_id, result, error_message }
 * @returns {object} 创建的执行历史
 */
function record (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    getStmt('record', `
      INSERT INTO ${TABLE} (id, task_id, executed_at, result, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.task_id,
      data.executed_at || now,
      data.result,
      data.error_message || null,
      now
    )

    // 超出限制时删除最旧记录
    trimHistory(data.task_id)

    return getById(id)
  } catch (error) {
    logger.error('TaskExecutionDao', `record() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询执行历史
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    return getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('TaskExecutionDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 根据任务 ID 查询执行历史列表（按时间倒序，分页）
 * @param {string} taskId
 * @param {object} options - { page?, size? }
 * @returns {object} { list, total }
 */
function findByTaskId (taskId, options = {}) {
  const { page = 1, size = 50 } = options
  const offset = (page - 1) * size

  const totalResult = getStmt('findByTaskIdTotal', `SELECT COUNT(*) as total FROM ${TABLE} WHERE task_id = ?`).get(taskId)
  const total = totalResult.total

  const rows = getStmt('findByTaskId', `
    SELECT * FROM ${TABLE} WHERE task_id = ?
    ORDER BY executed_at DESC
    LIMIT ? OFFSET ?
  `).all(taskId, size, offset)

  return { list: rows, total }
}

/**
 * 查询最近 N 条执行记录
 * @param {number} [limit=1000]
 * @returns {object[]}
 */
function findRecent (limit = 1000) {
  try {
    return getStmt('findRecent', `
      SELECT * FROM ${TABLE}
      ORDER BY executed_at DESC
      LIMIT ?
    `).all(limit)
  } catch (error) {
    logger.error('TaskExecutionDao', `findRecent() 失败: ${error.message}`)
    return []
  }
}

/**
 * 清理指定任务的最旧执行历史，确保不超过限制
 * @param {string} taskId
 */
function trimHistory (taskId) {
  try {
    const countResult = getStmt('countByTask', `SELECT COUNT(*) as cnt FROM ${TABLE} WHERE task_id = ?`).get(taskId)
    if (countResult.cnt > MAX_HISTORY) {
      const deleteCount = countResult.cnt - MAX_HISTORY
      getStmt('trimHistory', `
        DELETE FROM ${TABLE} WHERE id IN (
          SELECT id FROM ${TABLE} WHERE task_id = ?
          ORDER BY created_at ASC
          LIMIT ?
        )
      `).run(taskId, deleteCount)
    }
  } catch (error) {
    logger.warn('TaskExecutionDao', `trimHistory() 失败: ${error.message}`)
  }
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  record, getById, findByTaskId, findRecent,
  clearCache
}
