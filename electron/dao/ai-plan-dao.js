// ============================================================
// AI 规划历史 DAO
// 实现 ai_plans 表的 CRUD
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'ai_plans'

const stmts = {}
registerStmtCache(stmts)

function getStmt (key, sql) {
  if (!stmts[key]) {
    stmts[key] = getDb().prepare(sql)
  }
  return stmts[key]
}

/**
 * 保存规划
 * @param {object} data - { prompt, plan_json }
 * @returns {object}
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (id, prompt, plan_json, created_at, applied)
      VALUES (?, ?, ?, ?, 0)
    `).run(id, data.prompt, data.planJson, now)
    return getById(id)
  } catch (error) {
    logger.error('AiPlanDao', `create() 失败: ${error.message}`)
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
    logger.error('AiPlanDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询列表（最近 N 条）
 * @param {number} limit
 * @returns {object[]}
 */
function list (limit = 20) {
  try {
    return getStmt('list', `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT ?`).all(limit)
  } catch (error) {
    logger.error('AiPlanDao', `list() 失败: ${error.message}`)
    return []
  }
}

/**
 * 标记为已应用
 * @param {string} id
 * @returns {boolean}
 */
function markApplied (id) {
  try {
    getStmt('markApplied', `UPDATE ${TABLE} SET applied = 1 WHERE id = ?`).run(id)
    return true
  } catch (error) {
    logger.error('AiPlanDao', `markApplied(${id}) 失败: ${error.message}`)
    return false
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
    logger.error('AiPlanDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create, getById, list, markApplied, del,
  clearCache
}