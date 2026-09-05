// ============================================================
// 专注会话 DAO
// 实现 focus_sessions 表的 CRUD 和状态管理
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'focus_sessions'

const stmts = {}
registerStmtCache(stmts)

function getStmt (key, sql) {
  if (!stmts[key]) {
    stmts[key] = getDb().prepare(sql)
  }
  return stmts[key]
}

/**
 * 创建专注会话
 * @param {object} data - { mode, task_id?, group_id?, project_id?, title?, total_seconds? }
 * @returns {object}
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  const totalSeconds = data.total_seconds || 1500 // 默认 25 分钟
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (id, task_id, group_id, project_id, mode, title, total_seconds, remaining_seconds, started_at, result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?)
    `).run(
      id,
      data.task_id || null,
      data.group_id || null,
      data.project_id || null,
      data.mode || 'single',
      data.title || null,
      totalSeconds,
      totalSeconds,
      now,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('FocusSessionDao', `create() 失败: ${error.message}`)
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
    return getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('FocusSessionDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询当前进行中的会话
 * @returns {object|null}
 */
function getActiveSession () {
  try {
    return getStmt('getActive', `
      SELECT * FROM ${TABLE}
      WHERE result = 'started'
      ORDER BY started_at DESC
      LIMIT 1
    `).get() || null
  } catch (error) {
    logger.error('FocusSessionDao', `getActiveSession() 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询列表（分页）
 * @param {object} options
 * @returns {object} { list, total }
 */
function list (options = {}) {
  try {
    const { page = 1, size = 50 } = options
    const offset = (page - 1) * size

    const totalResult = getStmt('listTotal', `SELECT COUNT(*) as total FROM ${TABLE}`).get()
    const total = totalResult.total

    const rows = getStmt('list', `
      SELECT * FROM ${TABLE}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(size, offset)

    return { list: rows, total }
  } catch (error) {
    logger.error('FocusSessionDao', `list() 失败: ${error.message}`)
    return { list: [], total: 0 }
  }
}

/**
 * 更新剩余时间
 * @param {string} id
 * @param {number} remainingSeconds
 * @returns {boolean}
 */
function updateRemaining (id, remainingSeconds) {
  try {
    getStmt('updateRemaining', `
      UPDATE ${TABLE} SET remaining_seconds = ? WHERE id = ?
    `).run(remainingSeconds, id)
    return true
  } catch (error) {
    logger.error('FocusSessionDao', `updateRemaining(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 完成任务
 * @param {string} id
 * @returns {object|null}
 */
function complete (id) {
  try {
    const now = dateUtils.nowISO()
    getStmt('complete', `
      UPDATE ${TABLE}
      SET remaining_seconds = 0, completed_at = ?, result = 'completed'
      WHERE id = ?
    `).run(now, id)
    return getById(id)
  } catch (error) {
    logger.error('FocusSessionDao', `complete(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 取消任务
 * @param {string} id
 * @returns {object|null}
 */
function cancel (id) {
  try {
    const now = dateUtils.nowISO()
    getStmt('cancel', `
      UPDATE ${TABLE}
      SET completed_at = ?, result = 'cancelled'
      WHERE id = ?
    `).run(now, id)
    return getById(id)
  } catch (error) {
    logger.error('FocusSessionDao', `cancel(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 删除会话
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('FocusSessionDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 获取专注统计汇总
 * 包含总/今日专注时长与次数、按模式分类统计、最近 7 天每日专注时长
 * @returns {object} { totalSeconds, totalSessions, todaySeconds, todaySessions, modeStats, dailyStats }
 */
function getStats () {
  try {
    // 总专注时长（秒）与总会话数
    const totalResult = getStmt('statsTotal', `
      SELECT COALESCE(SUM(total_seconds), 0) as totalSeconds,
             COUNT(*) as totalSessions
      FROM ${TABLE} WHERE result = 'completed'
    `).get()

    // 今日专注时长与次数
    const today = dateUtils.today() // YYYY-MM-DD
    const todayResult = getStmt('statsToday', `
      SELECT COALESCE(SUM(total_seconds), 0) as todaySeconds,
             COUNT(*) as todaySessions
      FROM ${TABLE}
      WHERE result = 'completed' AND date(started_at) = ?
    `).get(today)

    // 按模式分类统计（single/group/project）
    const modeStats = getStmt('statsMode', `
      SELECT mode, COUNT(*) as count, COALESCE(SUM(total_seconds), 0) as seconds
      FROM ${TABLE} WHERE result = 'completed'
      GROUP BY mode
    `).all()

    // 最近 7 天每日专注时长（用本地时间边界，避免 date('now') 返回 UTC 导致时区错位）
    const dayjs = require('dayjs')
    const weekAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD 00:00:00')
    const dailyStats = getStmt('statsDaily', `
      SELECT date(started_at) as date, COALESCE(SUM(total_seconds), 0) as seconds, COUNT(*) as sessions
      FROM ${TABLE}
      WHERE result = 'completed' AND started_at >= ?
      GROUP BY date(started_at)
      ORDER BY date DESC
    `).all(weekAgo)

    return {
      totalSeconds: totalResult.totalSeconds,
      totalSessions: totalResult.totalSessions,
      todaySeconds: todayResult.todaySeconds,
      todaySessions: todayResult.todaySessions,
      modeStats: modeStats,       // [{ mode, count, seconds }]
      dailyStats: dailyStats      // [{ date, seconds, sessions }]
    }
  } catch (error) {
    logger.error('FocusSessionDao', `getStats() 失败: ${error.message}`)
    return {
      totalSeconds: 0,
      totalSessions: 0,
      todaySeconds: 0,
      todaySessions: 0,
      modeStats: [],
      dailyStats: []
    }
  }
}

function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create, getById, getActiveSession, list, updateRemaining, complete, cancel, del,
  getStats, clearCache, TABLE
}