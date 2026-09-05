// ============================================================
// 健康数据记录 DAO
// 实现 health_records 表的记录写入与统计查询
// 统计查询按日/周/月聚合（SUM/AVG），使用索引 idx_health_rec_date
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'health_records'

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
 * 写入健康记录
 * @param {object} data - { module_type, record_date, record_time, value?, content? }
 * @returns {object} 创建的记录
 */
function record (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    getStmt('record', `
      INSERT INTO ${TABLE} (id, module_type, record_date, record_time, value, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.module_type,
      data.record_date,
      data.record_time,
      data.value ?? null,
      data.content || null,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('HealthRecordDao', `record() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询记录
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    return getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('HealthRecordDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 按日期范围查询记录
 * @param {string} moduleType
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {object} options - { page?, size? }
 * @returns {object} { list, total }
 */
function findByDateRange (moduleType, startDate, endDate, options = {}) {
  const { page = 1, size = 50 } = options
  const offset = (page - 1) * size

  const totalResult = getStmt('findByDateRangeTotal', `
    SELECT COUNT(*) as total FROM ${TABLE}
    WHERE module_type = ? AND record_date >= ? AND record_date <= ?
  `).get(moduleType, startDate, endDate)
  const total = totalResult.total

  const rows = getStmt('findByDateRange', `
    SELECT * FROM ${TABLE}
    WHERE module_type = ? AND record_date >= ? AND record_date <= ?
    ORDER BY record_time DESC
    LIMIT ? OFFSET ?
  `).all(moduleType, startDate, endDate, size, offset)

  return { list: rows, total }
}

/**
 * 查询当日某模块的累计值
 * @param {string} moduleType
 * @param {string} date - YYYY-MM-DD
 * @returns {number} 累计值，无记录返回 0
 */
function todayTotal (moduleType, date) {
  try {
    const result = getStmt('todayTotal', `
      SELECT COALESCE(SUM(value), 0) as total FROM ${TABLE}
      WHERE module_type = ? AND record_date = ?
    `).get(moduleType, date)
    return result.total || 0
  } catch (error) {
    logger.error('HealthRecordDao', `todayTotal(${moduleType}, ${date}) 失败: ${error.message}`)
    return 0
  }
}

/**
 * 查询健康统计数据（按日/周/月聚合）
 * @param {string} moduleType
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {string} period - 'day' | 'week' | 'month'
 * @returns {object[]} 统计数据列表
 */
function getStats (moduleType, startDate, endDate, period = 'day') {
  try {
    let sql = ''
    let dateGroup = ''

    if (period === 'day') {
      dateGroup = 'record_date'
    } else if (period === 'week') {
      // SQLite strftime('%W', date) 返回第几周
      dateGroup = "strftime('%Y-%W', record_date)"
    } else if (period === 'month') {
      dateGroup = "strftime('%Y-%m', record_date)"
    }

    sql = `
      SELECT ${dateGroup} as period,
             COALESCE(SUM(value), 0) as sum_value,
             COALESCE(AVG(value), 0) as avg_value,
             COUNT(*) as count
      FROM ${TABLE}
      WHERE module_type = ? AND record_date >= ? AND record_date <= ?
      GROUP BY ${dateGroup}
      ORDER BY period ASC
    `

    // 动态缓存键：按 period 区分，避免不同 SQL 复用同一 prepared statement 导致参数不匹配
    return getStmt(`getStats:${period}`, sql).all(moduleType, startDate, endDate)
  } catch (error) {
    logger.error('HealthRecordDao', `getStats() 失败: ${error.message}`)
    return []
  }
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  record, getById, findByDateRange, todayTotal, getStats,
  clearCache
}
