// ============================================================
// 小部件分组 DAO
// 实现 widget_groups 表的 CRUD、按成员查询、活跃成员切换等
// 参照 widget-dao.js / group-dao.js 风格：预编译语句缓存、CommonJS、中文注释
// member_ids 字段以 JSON 字符串存储，DAO 层负责 JSON.parse / JSON.stringify 转换
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'widget_groups'

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
// JSON 字段转换
// ============================================================

/**
 * 将数据库行转换为业务对象（解析 member_ids JSON 字符串）
 * @param {object} row
 * @returns {object|null}
 */
function fromRow (row) {
  if (!row) return null
  const result = { ...row }
  // member_ids 以 JSON 字符串存储，解析为数组
  if (row.member_ids) {
    try {
      result.member_ids = JSON.parse(row.member_ids)
      if (!Array.isArray(result.member_ids)) {
        result.member_ids = []
      }
    } catch (e) {
      logger.warn('WidgetGroupDao', `member_ids 解析失败 id=${row.id}: ${e.message}`)
      result.member_ids = []
    }
  } else {
    result.member_ids = []
  }
  return result
}

/**
 * 将成员 ID 数组序列化为 JSON 字符串
 * @param {string[]} memberIds
 * @returns {string}
 */
function serializeMemberIds (memberIds) {
  if (!Array.isArray(memberIds)) return '[]'
  return JSON.stringify(memberIds)
}

// ============================================================
// 查询方法
// ============================================================

/**
 * 查询所有小部件分组
 * @returns {object[]} 分组数组
 */
function list () {
  try {
    const rows = getStmt('list', `SELECT * FROM ${TABLE} ORDER BY updated_at DESC`).all()
    return rows.map(fromRow)
  } catch (error) {
    logger.error('WidgetGroupDao', `list() 失败: ${error.message}`)
    return []
  }
}

/**
 * 按 ID 查询分组
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    const row = getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id)
    return fromRow(row)
  } catch (error) {
    logger.error('WidgetGroupDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 按成员 widget_type 查询所属分组
 * @param {string} widgetType - 成员小部件类型
 * @returns {object|null}
 */
function findByMember (widgetType) {
  if (!widgetType) return null
  try {
    // member_ids 是 JSON 数组字符串，使用 LIKE 粗筛后再 JS 精确匹配
    // 粗筛条件：member_ids 包含 widgetType 字面量（带双引号）
    const rows = getStmt('findByMember', `
      SELECT * FROM ${TABLE}
      WHERE member_ids LIKE ?
    `).all(`%"${widgetType}"%`)
    for (const row of rows) {
      const group = fromRow(row)
      if (group && Array.isArray(group.member_ids) && group.member_ids.includes(widgetType)) {
        return group
      }
    }
    return null
  } catch (error) {
    logger.error('WidgetGroupDao', `findByMember(${widgetType}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询所有包含指定成员的分组（用于校验成员是否已被占用）
 * 实际上每个成员最多属于一个分组，此方法返回数组便于校验
 * @param {string} widgetType
 * @returns {object[]}
 */
function findAllByMember (widgetType) {
  if (!widgetType) return []
  try {
    const rows = getStmt('findAllByMember', `
      SELECT * FROM ${TABLE}
      WHERE member_ids LIKE ?
    `).all(`%"${widgetType}"%`)
    return rows
      .map(fromRow)
      .filter(group => group && Array.isArray(group.member_ids) && group.member_ids.includes(widgetType))
  } catch (error) {
    logger.error('WidgetGroupDao', `findAllByMember(${widgetType}) 失败: ${error.message}`)
    return []
  }
}

// ============================================================
// 创建 / 更新 / 删除
// ============================================================

/**
 * 创建小部件分组
 * @param {object} data - { id?, name?, member_ids, active_member?, is_visible?, position_x?, position_y?, width?, height?, is_position_locked?, is_size_locked?, is_collapsed?, navigation_style?, title_display_mode?, wheel_switch_enabled?, hover_switch_enabled?, chrome_mode?, collapse_behavior? }
 * @returns {object} 创建的分组
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = data.id || generateId()
  const memberIds = Array.isArray(data.member_ids) ? data.member_ids : []
  // active_member 默认取 member_ids[0]
  const activeMember = data.active_member || (memberIds[0] || '')
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (
        id, name, member_ids, active_member, is_visible,
        position_x, position_y, width, height,
        is_position_locked, is_size_locked, is_collapsed,
        navigation_style, title_display_mode,
        wheel_switch_enabled, hover_switch_enabled,
        chrome_mode, collapse_behavior,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.name || '',
      serializeMemberIds(memberIds),
      activeMember,
      data.is_visible !== undefined ? (data.is_visible ? 1 : 0) : 1,
      data.position_x !== undefined ? data.position_x : 100,
      data.position_y !== undefined ? data.position_y : 100,
      data.width !== undefined ? data.width : 300,
      data.height !== undefined ? data.height : 400,
      data.is_position_locked !== undefined ? (data.is_position_locked ? 1 : 0) : 0,
      data.is_size_locked !== undefined ? (data.is_size_locked ? 1 : 0) : 0,
      data.is_collapsed !== undefined ? (data.is_collapsed ? 1 : 0) : 0,
      data.navigation_style || 'stack',
      data.title_display_mode || 'standard',
      // NULL 表示跟随默认
      data.wheel_switch_enabled === undefined ? null : (data.wheel_switch_enabled ? 1 : 0),
      data.hover_switch_enabled === undefined ? null : (data.hover_switch_enabled ? 1 : 0),
      data.chrome_mode || 'standard',
      data.collapse_behavior || 'system',
      now,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('WidgetGroupDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 更新分组配置（部分字段）
 * @param {string} id
 * @param {object} data - 要更新的字段
 * @returns {object|null} 更新后的分组
 */
function update (id, data) {
  try {
    const now = dateUtils.nowISO()
    const fields = []
    const params = []

    if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name) }
    if (data.member_ids !== undefined) {
      fields.push('member_ids = ?')
      params.push(serializeMemberIds(data.member_ids))
    }
    if (data.active_member !== undefined) { fields.push('active_member = ?'); params.push(data.active_member) }
    if (data.is_visible !== undefined) { fields.push('is_visible = ?'); params.push(data.is_visible ? 1 : 0) }
    if (data.position_x !== undefined) { fields.push('position_x = ?'); params.push(data.position_x) }
    if (data.position_y !== undefined) { fields.push('position_y = ?'); params.push(data.position_y) }
    if (data.width !== undefined) { fields.push('width = ?'); params.push(data.width) }
    if (data.height !== undefined) { fields.push('height = ?'); params.push(data.height) }
    if (data.is_position_locked !== undefined) { fields.push('is_position_locked = ?'); params.push(data.is_position_locked ? 1 : 0) }
    if (data.is_size_locked !== undefined) { fields.push('is_size_locked = ?'); params.push(data.is_size_locked ? 1 : 0) }
    if (data.is_collapsed !== undefined) { fields.push('is_collapsed = ?'); params.push(data.is_collapsed ? 1 : 0) }
    if (data.navigation_style !== undefined) { fields.push('navigation_style = ?'); params.push(data.navigation_style) }
    if (data.title_display_mode !== undefined) { fields.push('title_display_mode = ?'); params.push(data.title_display_mode) }
    if (data.wheel_switch_enabled !== undefined) {
      fields.push('wheel_switch_enabled = ?')
      params.push(data.wheel_switch_enabled === null ? null : (data.wheel_switch_enabled ? 1 : 0))
    }
    if (data.hover_switch_enabled !== undefined) {
      fields.push('hover_switch_enabled = ?')
      params.push(data.hover_switch_enabled === null ? null : (data.hover_switch_enabled ? 1 : 0))
    }
    if (data.chrome_mode !== undefined) { fields.push('chrome_mode = ?'); params.push(data.chrome_mode) }
    if (data.collapse_behavior !== undefined) { fields.push('collapse_behavior = ?'); params.push(data.collapse_behavior) }

    if (fields.length === 0) return getById(id)

    fields.push('updated_at = ?')
    params.push(now)
    params.push(id)

    // 关键修复：动态 SQL 不能用固定 key 缓存（同 widget-dao.js），用字段签名作为 key
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return getById(id)
  } catch (error) {
    logger.error('WidgetGroupDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 更新位置/大小（拖拽节流专用，仅更新 4 个字段）
 * @param {string} id
 * @param {object} bounds - { x, y, width, height }
 * @returns {object|null} 更新后的分组
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
    logger.error('WidgetGroupDao', `updateBounds(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 切换活跃成员（同一时间只显示一个成员）
 * @param {string} id - 分组 ID
 * @param {string} widgetType - 新活跃成员 widget_type
 * @returns {object|null} 更新后的分组
 */
function setActiveMember (id, widgetType) {
  try {
    const now = dateUtils.nowISO()
    getStmt('setActiveMember', `
      UPDATE ${TABLE} SET active_member = ?, updated_at = ? WHERE id = ?
    `).run(widgetType, now, id)
    return getById(id)
  } catch (error) {
    logger.error('WidgetGroupDao', `setActiveMember(${id}, ${widgetType}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 删除分组（解散，不删除成员小部件自身的记录）
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('WidgetGroupDao', `del(${id}) 失败: ${error.message}`)
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
  getById,
  findByMember,
  findAllByMember,
  create,
  update,
  updateBounds,
  setActiveMember,
  del,
  clearCache
}