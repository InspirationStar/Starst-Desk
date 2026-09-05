// ============================================================
// 健康提醒配置 DAO
// 实现 health_configs 表的配置 CRUD
// config_json 字段 JSON 序列化/反序列化
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'health_configs'

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
 * 根据模块类型获取配置
 * @param {string} moduleType - 模块类型 (water/sedentary/eye/stretch/sleep/diet)
 * @returns {object|null}
 */
function getByModuleType (moduleType) {
  try {
    const row = getStmt('getByModule', `SELECT * FROM ${TABLE} WHERE module_type = ?`).get(moduleType)
    return row ? deserializeRow(row) : null
  } catch (error) {
    logger.error('HealthConfigDao', `getByModuleType(${moduleType}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 获取所有配置
 * @returns {object[]}
 */
function findAll () {
  try {
    const rows = getStmt('findAll', `SELECT * FROM ${TABLE}`).all()
    return rows.map(deserializeRow)
  } catch (error) {
    logger.error('HealthConfigDao', `findAll() 失败: ${error.message}`)
    return []
  }
}

/**
 * 获取所有启用的配置
 * @returns {object[]}
 */
function findAllEnabled () {
  try {
    const rows = getStmt('findAllEnabled', `SELECT * FROM ${TABLE} WHERE is_enabled = 1`).all()
    return rows.map(deserializeRow)
  } catch (error) {
    logger.error('HealthConfigDao', `findAllEnabled() 失败: ${error.message}`)
    return []
  }
}

/**
 * 创建或更新配置（UPSERT）
 * @param {object} data - { module_type, is_enabled, config_json }
 * @returns {object} 更新后的配置
 */
function upsert (data) {
  const now = dateUtils.nowISO()
  const id = data.id || generateId()
  try {
    getStmt('upsert', `
      INSERT INTO ${TABLE} (id, module_type, is_enabled, config_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(module_type) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      data.module_type,
      data.is_enabled ? 1 : 0,
      JSON.stringify(data.config_json),
      now
    )
    return getByModuleType(data.module_type)
  } catch (error) {
    logger.error('HealthConfigDao', `upsert(${data.module_type}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 更新配置
 * @param {string} moduleType
 * @param {object} data - 要更新的字段
 * @returns {object|null}
 */
function update (moduleType, data) {
  try {
    const now = dateUtils.nowISO()
    const fields = []
    const params = []

    if (data.is_enabled !== undefined) { fields.push('is_enabled = ?'); params.push(data.is_enabled ? 1 : 0) }
    if (data.config_json !== undefined) { fields.push('config_json = ?'); params.push(JSON.stringify(data.config_json)) }

    if (fields.length === 0) return getByModuleType(moduleType)

    fields.push("updated_at = ?")
    params.push(now)
    params.push(moduleType)

    // 关键修复：动态 SQL 不能用固定 key 缓存（同 widget-dao.js），用字段签名作为 key
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE module_type = ?`).run(...params)
    return getByModuleType(moduleType)
  } catch (error) {
    logger.error('HealthConfigDao', `update(${moduleType}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 反序列化配置行
 * @param {object} row
 * @returns {object}
 */
function deserializeRow (row) {
  const result = { ...row }
  try {
    if (result.config_json) result.config_json = JSON.parse(result.config_json)
  } catch (error) {
    logger.warn('HealthConfigDao', `deserializeRow() 解析失败: ${error.message}`)
  }
  return result
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  getByModuleType, findAll, findAllEnabled, upsert, update,
  clearCache
}
