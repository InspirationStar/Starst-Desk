// ============================================================
// 桌面小部件 DAO
// 实现 widgets 表的 CRUD、按类型查询、状态切换、位置更新等
// 参照 note-dao.js 风格：预编译语句缓存、CommonJS、中文注释
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'widgets'

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
// 查询方法
// ============================================================

/**
 * 查询所有小部件配置列表
 * @returns {object[]} 小部件配置数组
 */
function list () {
  try {
    return getStmt('list', `SELECT * FROM ${TABLE} ORDER BY widget_type ASC`).all()
  } catch (error) {
    logger.error('WidgetDao', `list() 失败: ${error.message}`)
    return []
  }
}

/**
 * 按类型查询单个小部件
 * @param {string} widgetType - 小部件类型
 * @returns {object|null}
 */
function getByType (widgetType) {
  try {
    return getStmt('getByType', `SELECT * FROM ${TABLE} WHERE widget_type = ?`).get(widgetType) || null
  } catch (error) {
    logger.error('WidgetDao', `getByType(${widgetType}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 按 ID 查询小部件
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    return getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('WidgetDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

// ============================================================
// 创建 / 更新 / 删除
// ============================================================

/**
 * 创建小部件记录
 * @param {object} data - { widget_type, is_enabled?, is_visible?, is_capsule?, position_x?, position_y?, width?, height?, config_json? }
 * @returns {object} 创建的小部件记录
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = data.id || generateId()
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (id, widget_type, is_enabled, is_visible, is_capsule, position_x, position_y, width, height, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.widget_type,
      data.is_enabled !== undefined ? (data.is_enabled ? 1 : 0) : 1,
      data.is_visible !== undefined ? (data.is_visible ? 1 : 0) : 1,
      data.is_capsule !== undefined ? (data.is_capsule ? 1 : 0) : 0,
      data.position_x !== undefined ? data.position_x : 100,
      data.position_y !== undefined ? data.position_y : 100,
      data.width !== undefined ? data.width : 280,
      data.height !== undefined ? data.height : 360,
      data.config_json || null,
      now,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('WidgetDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 更新小部件配置（部分字段）
 * @param {string} id
 * @param {object} data - 要更新的字段
 * @returns {object|null} 更新后的小部件
 */
function update (id, data) {
  try {
    const now = dateUtils.nowISO()
    const fields = []
    const params = []

    if (data.widget_type !== undefined) { fields.push('widget_type = ?'); params.push(data.widget_type) }
    if (data.is_enabled !== undefined) { fields.push('is_enabled = ?'); params.push(data.is_enabled ? 1 : 0) }
    if (data.is_visible !== undefined) { fields.push('is_visible = ?'); params.push(data.is_visible ? 1 : 0) }
    if (data.is_capsule !== undefined) { fields.push('is_capsule = ?'); params.push(data.is_capsule ? 1 : 0) }

    if (data.position_x !== undefined) { fields.push('position_x = ?'); params.push(data.position_x) }
    if (data.position_y !== undefined) { fields.push('position_y = ?'); params.push(data.position_y) }
    if (data.width !== undefined) { fields.push('width = ?'); params.push(data.width) }
    if (data.height !== undefined) { fields.push('height = ?'); params.push(data.height) }
    if (data.config_json !== undefined) { fields.push('config_json = ?'); params.push(data.config_json) }
    if (data.display_name !== undefined) { fields.push('display_name = ?'); params.push(data.display_name) }
    if (data.collapse_behavior !== undefined) { fields.push('collapse_behavior = ?'); params.push(data.collapse_behavior) }
    // 锁/置顶字段（schema 中 position_lock / size_lock / always_on_top，均为 INTEGER 0/1）
    if (data.position_lock !== undefined) { fields.push('position_lock = ?'); params.push(data.position_lock ? 1 : 0) }
    if (data.size_lock !== undefined) { fields.push('size_lock = ?'); params.push(data.size_lock ? 1 : 0) }
    if (data.always_on_top !== undefined) { fields.push('always_on_top = ?'); params.push(data.always_on_top ? 1 : 0) }
    if (data.compact_content_mode !== undefined) { fields.push('compact_content_mode = ?'); params.push(data.compact_content_mode) }

    if (fields.length === 0) return getById(id)

    fields.push('updated_at = ?')
    params.push(now)
    params.push(id)

    // 关键修复：动态 SQL 不能用固定 key 缓存，否则首次调用的字段组合会被永久缓存，
    //   后续不同字段组合的 update 都会复用首次 SQL，导致错误字段被更新。
    //   例如首次 update({ position_lock }) 缓存 SQL 仅含 position_lock，
    //   之后 update({ size_lock }) 仍用该 SQL，结果 position_lock 被错误写入 size_lock 的值。
    //   修复：用字段签名作为 key 的一部分，相同字段组合复用缓存，不同组合各自独立缓存。
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return getById(id)
  } catch (error) {
    logger.error('WidgetDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 更新位置/大小（拖拽节流专用，仅更新 4 个字段，不触碰其他配置）
 * @param {string} id
 * @param {object} bounds - { x, y, width, height }
 * @returns {object|null} 更新后的小部件
 */
function updateBounds (id, bounds) {
  try {
    const now = dateUtils.nowISO()
    getStmt('updateBounds', `
      UPDATE ${TABLE}
      SET position_x = ?, position_y = ?, width = ?, height = ?, updated_at = ?
      WHERE id = ?
    `).run(bounds.x, bounds.y, bounds.width, bounds.height, now, id)
    return getById(id)
  } catch (error) {
    logger.error('WidgetDao', `updateBounds(${id}) 失败: ${error.message}`)
    throw error
  }
}

// ============================================================
// 状态切换方法（按 widget_type 操作）
// ============================================================

/**
 * 启用/禁用小部件
 * @param {string} widgetType
 * @param {boolean} enabled
 * @returns {object|null} 更新后的小部件
 */
function setEnabled (widgetType, enabled) {
  try {
    const now = dateUtils.nowISO()
    getStmt('setEnabled', `
      UPDATE ${TABLE} SET is_enabled = ?, updated_at = ? WHERE widget_type = ?
    `).run(enabled ? 1 : 0, now, widgetType)
    return getByType(widgetType)
  } catch (error) {
    logger.error('WidgetDao', `setEnabled(${widgetType}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 设置小部件显隐
 * @param {string} widgetType
 * @param {boolean} visible
 * @returns {object|null} 更新后的小部件
 */
function setVisible (widgetType, visible) {
  try {
    const now = dateUtils.nowISO()
    getStmt('setVisible', `
      UPDATE ${TABLE} SET is_visible = ?, updated_at = ? WHERE widget_type = ?
    `).run(visible ? 1 : 0, now, widgetType)
    return getByType(widgetType)
  } catch (error) {
    logger.error('WidgetDao', `setVisible(${widgetType}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 切换胶囊状态
 * @param {string} widgetType
 * @param {boolean} isCapsule
 * @returns {object|null} 更新后的小部件
 */
function setCapsule (widgetType, isCapsule) {
  try {
    const now = dateUtils.nowISO()
    getStmt('setCapsule', `
      UPDATE ${TABLE} SET is_capsule = ?, updated_at = ? WHERE widget_type = ?
    `).run(isCapsule ? 1 : 0, now, widgetType)
    return getByType(widgetType)
  } catch (error) {
    logger.error('WidgetDao', `setCapsule(${widgetType}) 失败: ${error.message}`)
    throw error
  }
}

/**

 * 删除小部件记录
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('WidgetDao', `del(${id}) 失败: ${error.message}`)
    return false
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
  list,
  getByType,
  getById,
  create,
  update,
  updateBounds,
  setEnabled,
  setVisible,
  setCapsule,

  del,
  clearCache
}