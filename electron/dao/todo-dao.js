// ============================================================
// 待办 DAO
// 实现 todos 表的 CRUD、按类型查询、完成状态切换
// 参照 note-dao.js 风格：预编译语句缓存、CommonJS、中文注释
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'todos'

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
 * 创建待办
 * @param {object} data - { title, is_enabled?, color?, due_date?, recurrence?, attachments? }
 * @returns {object} 创建的待办记录
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (id, title, is_enabled, color, due_date, recurrence, attachments, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.title || null,
      data.is_enabled !== undefined ? (data.is_enabled ? 1 : 0) : 1,
      data.color || 'blue',
      data.due_date || null,
      data.recurrence || null,
      data.attachments || null,
      now,
      now
    )
    return get(id)
  } catch (error) {
    logger.error('TodoDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询待办
 * @param {string} id
 * @returns {object|null}
 */
function get (id) {
  try {
    return getStmt('get', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('TodoDao', `get(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询待办列表（返回数组，支持关键词搜索、颜色筛选、排序）
 * @param {object} [options] - { keyword?, color?, status?, sort_by?, sort_order? }
 * @returns {object[]} 待办数组
 */
function list (options = {}) {
  const {
    keyword = '',
    color = '',
    status = '',
    sort_by = 'updated_at',
    sort_order = 'DESC'
  } = options

  // 构建 WHERE 条件
  const conditions = []
  const params = []

  // 关键词搜索（对 title 进行 LIKE 模糊匹配）
  // 转义 LIKE 通配符 _ 和 %，避免用户输入的特殊字符被当作通配符
  if (keyword) {
    const escapedKeyword = keyword.replace(/[%_]/g, '\\$&')
    conditions.push(`title LIKE ? ESCAPE '\\'`)
    params.push(`%${escapedKeyword}%`)
  }

  // 颜色筛选
  if (color) {
    conditions.push('color = ?')
    params.push(color)
  }

  // 状态筛选：active=未完成(is_enabled=1)，completed=已完成(is_enabled=0)
  if (status === 'active') {
    conditions.push('is_enabled = 1')
  } else if (status === 'completed') {
    conditions.push('is_enabled = 0')
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // 排序字段白名单校验，防止 SQL 注入
  const allowedSortFields = ['updated_at', 'created_at', 'title', 'due_date', 'is_enabled']
  const safeSortField = allowedSortFields.includes(sort_by) ? sort_by : 'updated_at'
  const safeOrder = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'

  try {
    return getStmt('list', `
      SELECT * FROM ${TABLE}
      ${whereSql}
      ORDER BY ${safeSortField} ${safeOrder}
    `).all(...params)
  } catch (error) {
    logger.error('TodoDao', `list() 失败: ${error.message}`)
    return []
  }
}

/**
 * 更新待办
 * @param {string} id
 * @param {object} data - 要更新的字段
 * @returns {object|null} 更新后的待办
 */
function update (id, data) {
  try {
    const now = dateUtils.nowISO()
    const fields = []
    const params = []

    if (data.title !== undefined) { fields.push('title = ?'); params.push(data.title) }
    if (data.is_enabled !== undefined) { fields.push('is_enabled = ?'); params.push(data.is_enabled ? 1 : 0) }
    if (data.color !== undefined) { fields.push('color = ?'); params.push(data.color) }
    if (data.due_date !== undefined) { fields.push('due_date = ?'); params.push(data.due_date) }
    if (data.recurrence !== undefined) { fields.push('recurrence = ?'); params.push(data.recurrence) }
    if (data.attachments !== undefined) { fields.push('attachments = ?'); params.push(data.attachments) }

    if (fields.length === 0) return get(id)

    fields.push('updated_at = ?')
    params.push(now)
    params.push(id)

    // 关键修复：动态 SQL 不能用固定 key 缓存（同 widget-dao.js），用字段签名作为 key
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return get(id)
  } catch (error) {
    logger.error('TodoDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 删除待办
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('TodoDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

// ============================================================
// 业务查询方法
// ============================================================

/**
 * 切换待办完成状态
 * is_enabled: 1=未完成（激活），0=已完成
 * @param {string} id
 * @param {boolean} enabled - true=未完成，false=已完成
 * @returns {object|null} 更新后的待办
 */
function setEnabled (id, enabled) {
  try {
    const now = dateUtils.nowISO()
    getStmt('setEnabled', `
      UPDATE ${TABLE} SET is_enabled = ?, updated_at = ? WHERE id = ?
    `).run(enabled ? 1 : 0, now, id)
    return get(id)
  } catch (error) {
    logger.error('TodoDao', `setEnabled(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 按类型查询待办（保留以兼容 service 层调用，todos 表无 type 字段，按 color 维度查询）
 * @param {string} type - 此处语义为 color 标签
 * @returns {object[]}
 */
function getByType (type) {
  try {
    return getStmt('getByType', `SELECT * FROM ${TABLE} WHERE color = ? ORDER BY updated_at DESC`).all(type)
  } catch (error) {
    logger.error('TodoDao', `getByType(${type}) 失败: ${error.message}`)
    return []
  }
}

/**
 * 查询已到期但未完成的待办（供调度器/提醒使用）
 * @param {string} now - ISO 8601 格式当前时间
 * @returns {object[]} 到期待办列表
 */
function findOverdue (now) {
  try {
    return getStmt('findOverdue', `
      SELECT * FROM ${TABLE}
      WHERE due_date IS NOT NULL
        AND due_date < ?
        AND is_enabled = 1
      ORDER BY due_date ASC
    `).all(now)
  } catch (error) {
    logger.error('TodoDao', `findOverdue() 失败: ${error.message}`)
    return []
  }
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create,
  get,
  list,
  update,
  delete: del,
  del,
  setEnabled,
  getByType,
  findOverdue,
  clearCache
}