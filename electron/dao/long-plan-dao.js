// ============================================================
// 长期计划 DAO
// 实现 long_plans 表的 CRUD、周期推进、复盘标记
// 参照 group-dao.js 风格：预编译语句缓存、CommonJS、中文注释
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'long_plans'

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
 * 创建长期计划
 * @param {object} data - { goal, title, summary?, duration_text?, cycle_length_days?, total_cycles?, roadmap?, cycles?, started_at? }
 * @returns {object} 创建的长期计划
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    const roadmap = data.roadmap ? JSON.stringify(data.roadmap) : '[]'
    const cycles = data.cycles ? JSON.stringify(data.cycles) : '[]'
    getStmt('create', `
      INSERT INTO ${TABLE} (
        id, goal, title, summary, duration_text,
        cycle_length_days, total_cycles, current_cycle,
        roadmap, cycles, active, pending_review,
        started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, 0, ?, ?, ?)
    `).run(
      id,
      data.goal || '',
      data.title || '未命名长期计划',
      data.summary || null,
      data.duration_text || null,
      data.cycle_length_days || 7,
      data.total_cycles || 8,
      roadmap,
      cycles,
      data.started_at || now,
      now,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('LongPlanDao', `create() 失败: ${error.message}`)
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
    logger.error('LongPlanDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 获取当前激活的长期计划
 * 同一时间只允许一个激活的长期计划
 * @returns {object|null}
 */
function getActive () {
  try {
    const row = getStmt('getActive', `
      SELECT * FROM ${TABLE} WHERE active = 1 ORDER BY updated_at DESC LIMIT 1
    `).get()
    if (!row) return null
    return parseJsonFields(row)
  } catch (error) {
    logger.error('LongPlanDao', `getActive() 失败: ${error.message}`)
    return null
  }
}

/**
 * 更新计划
 * @param {string} id
 * @param {object} data - 可更新字段：goal/title/summary/duration_text/cycle_length_days/total_cycles/current_cycle/roadmap/cycles/active/pending_review
 * @returns {object|null}
 */
function update (id, data) {
  try {
    const now = dateUtils.nowISO()
    const fields = []
    const params = []

    if (data.goal !== undefined) { fields.push('goal = ?'); params.push(data.goal) }
    if (data.title !== undefined) { fields.push('title = ?'); params.push(data.title) }
    if (data.summary !== undefined) { fields.push('summary = ?'); params.push(data.summary) }
    if (data.duration_text !== undefined) { fields.push('duration_text = ?'); params.push(data.duration_text) }
    if (data.cycle_length_days !== undefined) { fields.push('cycle_length_days = ?'); params.push(data.cycle_length_days) }
    if (data.total_cycles !== undefined) { fields.push('total_cycles = ?'); params.push(data.total_cycles) }
    if (data.current_cycle !== undefined) { fields.push('current_cycle = ?'); params.push(data.current_cycle) }
    if (data.roadmap !== undefined) { fields.push('roadmap = ?'); params.push(JSON.stringify(data.roadmap)) }
    if (data.cycles !== undefined) { fields.push('cycles = ?'); params.push(JSON.stringify(data.cycles)) }
    if (data.active !== undefined) { fields.push('active = ?'); params.push(data.active ? 1 : 0) }
    if (data.pending_review !== undefined) { fields.push('pending_review = ?'); params.push(data.pending_review ? 1 : 0) }

    if (fields.length === 0) return getById(id)

    fields.push('updated_at = ?')
    params.push(now)
    params.push(id)

    // 关键修复：动态 SQL 不能用固定 key 缓存（同 widget-dao.js），用字段签名作为 key
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return getById(id)
  } catch (error) {
    logger.error('LongPlanDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 推进到下一周期
 * 将 current_cycle 加 1，并清除 pending_review 状态
 * @param {string} id
 * @returns {object|null}
 */
function advanceCycle (id) {
  try {
    const plan = getById(id)
    if (!plan) return null
    const nextCycle = (plan.current_cycle || 0) + 1
    // 如果已超过总周期数，标记为非激活（计划完成）
    const isActive = nextCycle < (plan.total_cycles || 8) ? 1 : 0
    return update(id, {
      current_cycle: nextCycle,
      pending_review: 0,
      active: isActive
    })
  } catch (error) {
    logger.error('LongPlanDao', `advanceCycle(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 标记需要复盘
 * @param {string} id
 * @returns {object|null}
 */
function markReview (id) {
  try {
    return update(id, { pending_review: 1 })
  } catch (error) {
    logger.error('LongPlanDao', `markReview(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 完成复盘，写入下一周期数据
 * @param {string} id
 * @param {object} newCycleData - { cycle, roadmap? }
 *   - cycle: 新周期对象（包含 title/goal/days/reviewPrompt 等）
 *   - roadmap?: 可选，更新后的路线图
 * @returns {object|null}
 */
function completeReview (id, newCycleData) {
  try {
    const plan = getById(id)
    if (!plan) return null

    const cycles = Array.isArray(plan.cycles) ? [...plan.cycles] : []
    if (newCycleData && newCycleData.cycle) {
      cycles.push(newCycleData.cycle)
    }

    // 推进 current_cycle，并清除 pending_review 状态
    const nextCycle = (plan.current_cycle || 0) + 1
    // 如果推进后已达到总周期数，标记为非激活（计划完成）
    const isActive = nextCycle < (plan.total_cycles || 8) ? 1 : 0

    const updateData = {
      cycles,
      current_cycle: nextCycle,
      pending_review: 0,
      active: isActive
    }
    if (newCycleData && newCycleData.roadmap) {
      updateData.roadmap = newCycleData.roadmap
    }

    return update(id, updateData)
  } catch (error) {
    logger.error('LongPlanDao', `completeReview(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 放弃计划
 * @param {string} id
 * @returns {object|null}
 */
function abandon (id) {
  try {
    return update(id, { active: 0, pending_review: 0 })
  } catch (error) {
    logger.error('LongPlanDao', `abandon(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 查询历史列表
 * @param {object} options - { keyword?, page?, size?, includeInactive? }
 * @returns {object} { list, total }
 */
function list (options = {}) {
  try {
    const { keyword = '', page = 1, size = 50, includeInactive = true } = options
    const conditions = []
    const params = []

    if (keyword) {
      const escaped = keyword.replace(/[%_]/g, '\\$&')
      conditions.push('(title LIKE ? ESCAPE \'\\\' OR goal LIKE ? ESCAPE \'\\\' OR summary LIKE ? ESCAPE \'\\\')')
      params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`)
    }

    if (!includeInactive) {
      conditions.push('active = 1')
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
    logger.error('LongPlanDao', `list() 失败: ${error.message}`)
    return { list: [], total: 0 }
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
    logger.error('LongPlanDao', `del(${id}) 失败: ${error.message}`)
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
  // roadmap 解析
  if (row.roadmap) {
    try { result.roadmap = JSON.parse(row.roadmap) } catch (e) { result.roadmap = [] }
  } else {
    result.roadmap = []
  }
  // cycles 解析
  if (row.cycles) {
    try { result.cycles = JSON.parse(row.cycles) } catch (e) { result.cycles = [] }
  } else {
    result.cycles = []
  }
  // 数值字段确保为数字
  result.cycle_length_days = Number(row.cycle_length_days) || 7
  result.total_cycles = Number(row.total_cycles) || 8
  result.current_cycle = Number(row.current_cycle) || 0
  result.active = Number(row.active) === 1
  result.pending_review = Number(row.pending_review) === 1
  return result
}

/**
 * 清理预编译语句缓存
 */
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create,
  getById,
  getActive,
  update,
  advanceCycle,
  markReview,
  completeReview,
  abandon,
  list,
  del,
  clearCache
}