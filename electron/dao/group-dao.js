// ============================================================
// 任务流 DAO
// 实现 groups 表的 CRUD
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'groups'

const stmts = {}
registerStmtCache(stmts)

function getStmt (key, sql) {
  if (!stmts[key]) {
    stmts[key] = getDb().prepare(sql)
  }
  return stmts[key]
}

/**
 * 创建任务流
 * @param {object} data - { name, description, steps }
 * @returns {object} 创建的任务流
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    const steps = data.steps ? JSON.stringify(data.steps) : '[]'
    getStmt('create', `
      INSERT INTO ${TABLE} (id, name, description, steps, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.name || '未命名任务流',
      data.description || null,
      steps,
      now,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('GroupDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    const row = getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id)
    if (!row) return null
    return parseJsonFields(row)
  } catch (error) {
    logger.error('GroupDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询列表
 * @param {object} options - { keyword?, page?, size? }
 * @returns {object} { list, total }
 */
function list (options = {}) {
  try {
    const { keyword = '', page = 1, size = 50 } = options
    const conditions = []
    const params = []

    if (keyword) {
      const escaped = keyword.replace(/[%_]/g, '\\$&')
      conditions.push('(name LIKE ? ESCAPE \'\\\' OR description LIKE ?)')
      params.push(`%${escaped}%`, `%${escaped}%`)
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    // 动态缓存键：避免有/无 WHERE 时 prepared statement 参数不匹配
    // 根因：getStmt 缓存键固定，但 SQL 可能带或不带 WHERE，导致参数数量不一致
    const whereKey = conditions.length > 0 ? 'WithWhere' : 'NoWhere'
    const offset = (page - 1) * size

    const totalResult = getStmt(`listTotal${whereKey}`, `SELECT COUNT(*) as total FROM ${TABLE} ${whereSql}`).get(...params)
    const total = totalResult.total

    const rows = getStmt(`list${whereKey}`, `
      SELECT * FROM ${TABLE}
      ${whereSql}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, size, offset)

    return {
      list: rows.map(parseJsonFields),
      total
    }
  } catch (error) {
    logger.error('GroupDao', `list() 失败: ${error.message}`)
    return { list: [], total: 0 }
  }
}

/**
 * 更新
 * @param {string} id
 * @param {object} data
 * @returns {object|null}
 */
function update (id, data) {
  try {
    const now = dateUtils.nowISO()
    const fields = []
    const params = []

    if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); params.push(data.description) }
    if (data.steps !== undefined) { fields.push('steps = ?'); params.push(JSON.stringify(data.steps)) }

    if (fields.length === 0) return getById(id)

    fields.push("updated_at = ?")
    params.push(now)
    params.push(id)

    // 关键修复：动态 SQL 不能用固定 key 缓存（同 widget-dao.js），用字段签名作为 key
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return getById(id)
  } catch (error) {
    logger.error('GroupDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 删除
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('GroupDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 解析 JSON 字段
 * @param {object} row
 * @returns {object}
 */
function parseJsonFields (row) {
  if (!row) return row
  const result = { ...row }
  if (row.steps) {
    try { result.steps = JSON.parse(row.steps) } catch (e) { result.steps = [] }
  } else {
    result.steps = []
  }
  return result
}

function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create, getById, list, update, del,
  clearCache
}