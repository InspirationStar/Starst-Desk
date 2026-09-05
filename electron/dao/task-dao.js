// ============================================================
// 定时任务 DAO
// 实现 tasks 表的 CRUD 与启用任务查询
// schedule_config 字段写入前 JSON.stringify，读取后 JSON.parse
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'tasks'

// 预编译语句缓存
const stmts = {}
registerStmtCache(stmts)

function getStmt (key, sql) {
  if (!stmts[key]) {
    stmts[key] = getDb().prepare(sql)
  }
  return stmts[key]
}

// ============================================================
// CRUD 方法
// ============================================================

/**
 * 创建任务
 * @param {object} data - { name, task_type, schedule_config, action_type, action_payload }
 * @returns {object} 创建的任务记录
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    const result = getStmt('create', `
      INSERT INTO ${TABLE} (id, name, task_type, schedule_config, action_type, action_payload, is_enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      data.name,
      data.task_type,
      JSON.stringify(data.schedule_config),
      data.action_type,
      JSON.stringify(data.action_payload),
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('TaskDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询任务
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    const row = getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id)
    if (!row) return null
    return deserializeRow(row)
  } catch (error) {
    logger.error('TaskDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询任务列表（支持启用/禁用筛选）
 * @param {object} options - { is_enabled?, page?, size? }
 * @returns {object} { list, total }
 */
function list (options = {}) {
  const { is_enabled, page = 1, size = 50 } = options

  const conditions = []
  const params = []

  if (is_enabled !== undefined) {
    conditions.push('is_enabled = ?')
    params.push(is_enabled ? 1 : 0)
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // 动态缓存键：避免有/无 WHERE 时 prepared statement 参数不匹配
  // 根因：getStmt 缓存键固定，但 SQL 可能带或不带 WHERE，导致参数数量不一致
  const whereKey = conditions.length > 0 ? 'WithWhere' : 'NoWhere'

  // 总数
  const totalResult = getStmt(`listTotal${whereKey}`, `SELECT COUNT(*) as total FROM ${TABLE} ${whereSql}`).get(...params)
  const total = totalResult.total

  // 列表
  const offset = (page - 1) * size
  const rows = getStmt(`list${whereKey}`, `
    SELECT * FROM ${TABLE} ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, size, offset)

  return { list: rows.map(deserializeRow), total }
}

/**
 * 更新任务
 * @param {string} id
 * @param {object} data - 要更新的字段
 * @returns {object|null} 更新后的任务
 */
function update (id, data) {
  try {
    const fields = []
    const params = []

    if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name) }
    if (data.task_type !== undefined) { fields.push('task_type = ?'); params.push(data.task_type) }
    if (data.schedule_config !== undefined) { fields.push('schedule_config = ?'); params.push(JSON.stringify(data.schedule_config)) }
    if (data.action_type !== undefined) { fields.push('action_type = ?'); params.push(data.action_type) }
    if (data.action_payload !== undefined) { fields.push('action_payload = ?'); params.push(JSON.stringify(data.action_payload)) }
    if (data.is_enabled !== undefined) { fields.push('is_enabled = ?'); params.push(data.is_enabled ? 1 : 0) }
    if (data.last_executed_at !== undefined) { fields.push('last_executed_at = ?'); params.push(data.last_executed_at) }

    if (fields.length === 0) return getById(id)

    params.push(id)
    // 关键修复：动态 SQL 不能用固定 key 缓存（同 widget-dao.js），用字段签名作为 key
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return getById(id)
  } catch (error) {
    logger.error('TaskDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 删除任务（不级联删除执行历史）
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('TaskDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 切换任务启用/禁用状态
 * @param {string} id
 * @param {boolean} enabled
 * @returns {object|null}
 */
function toggle (id, enabled) {
  try {
    getStmt('toggle', `UPDATE ${TABLE} SET is_enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id)
    return getById(id)
  } catch (error) {
    logger.error('TaskDao', `toggle(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询所有启用的任务（供调度器扫描）
 * @returns {object[]}
 */
function findEnabledTasks () {
  try {
    const rows = getStmt('findEnabled', `SELECT * FROM ${TABLE} WHERE is_enabled = 1`).all()
    return rows.map(deserializeRow)
  } catch (error) {
    logger.error('TaskDao', `findEnabledTasks() 失败: ${error.message}`)
    return []
  }
}

/**
 * 反序列化任务行（将 JSON 字符串字段解析为对象）
 * @param {object} row
 * @returns {object}
 */
function deserializeRow (row) {
  const result = { ...row }
  try {
    if (result.schedule_config) result.schedule_config = JSON.parse(result.schedule_config)
    if (result.action_payload) result.action_payload = JSON.parse(result.action_payload)
  } catch (error) {
    logger.warn('TaskDao', `deserializeRow() 解析失败: ${error.message}`)
  }
  return result
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create, getById, list, update, del, toggle, findEnabledTasks,
  clearCache
}
