// ============================================================
// 标签 DAO
// 实现 tags 表的 CRUD、按名称查询、按颜色统计
// 参照 todo-dao.js 风格：预编译语句缓存、CommonJS、中文注释
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'tags'

// 预编译语句缓存
const stmts = {}
registerStmtCache(stmts)

/**
 * 获取或初始化预编译语句
 */
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
 * 创建标签
 * @param {object} data - { name, color? }
 * @returns {object} 创建的标签记录
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (id, name, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      data.name || '',
      data.color || 'blue',
      now,
      now
    )
    return get(id)
  } catch (error) {
    logger.error('TagDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询标签
 * @param {string} id
 * @returns {object|null}
 */
function get (id) {
  try {
    return getStmt('get', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('TagDao', `get(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询所有标签
 * @param {object} options - { keyword?, color?, sort? }
 *   - keyword: 按名称模糊匹配
 *   - color: 按颜色过滤
 *   - sort: 'name' | 'updated'，默认按 updated_at DESC
 * @returns {object[]} 标签数组
 */
function list (options = {}) {
  try {
    const conditions = []
    const params = []
    if (options.keyword) {
      conditions.push('name LIKE ?')
      params.push(`%${options.keyword}%`)
    }
    if (options.color) {
      conditions.push('color = ?')
      params.push(options.color)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const orderBy = options.sort === 'name'
      ? 'ORDER BY name ASC'
      : 'ORDER BY updated_at DESC'
    return getStmt(`list:${where}:${orderBy}`, `SELECT * FROM ${TABLE} ${where} ${orderBy}`).all(...params)
  } catch (error) {
    logger.error('TagDao', `list() 失败: ${error.message}`)
    return []
  }
}

/**
 * 更新标签（部分字段）
 * @param {string} id
 * @param {object} data - { name?, color? }
 * @returns {object|null} 更新后的标签
 */
function update (id, data) {
  try {
    const now = dateUtils.nowISO()
    const fields = []
    const params = []
    if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name) }
    if (data.color !== undefined) { fields.push('color = ?'); params.push(data.color) }
    if (fields.length === 0) return get(id)
    fields.push('updated_at = ?')
    params.push(now)
    params.push(id)
    // 用字段签名作为 key，避免不同字段组合复用同一缓存 SQL
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return get(id)
  } catch (error) {
    logger.error('TagDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 删除标签
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('TagDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 按名称查询标签（用于查重）
 * @param {string} name
 * @returns {object|null}
 */
function getByName (name) {
  try {
    return getStmt('getByName', `SELECT * FROM ${TABLE} WHERE name = ?`).get(name) || null
  } catch (error) {
    logger.error('TagDao', `getByName(${name}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 获取标签统计（按颜色分组 + 总数）
 * @returns {object} { total, colorStats: [{ color, count }] }
 */
function getStats () {
  try {
    const totalResult = getStmt('statsTotal', `SELECT COUNT(*) as total FROM ${TABLE}`).get()
    const colorStats = getStmt('statsColor', `
      SELECT color, COUNT(*) as count
      FROM ${TABLE}
      GROUP BY color
      ORDER BY count DESC
    `).all()
    return { total: totalResult.total, colorStats }
  } catch (error) {
    logger.error('TagDao', `getStats() 失败: ${error.message}`)
    return { total: 0, colorStats: [] }
  }
}

// ============================================================
// 缓存管理
// ============================================================

/**
 * 清理预编译语句缓存（测试用）
 */
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create,
  get,
  list,
  update,
  del,
  getByName,
  getStats,
  clearCache
}