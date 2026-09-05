// ============================================================
// 应用设置 DAO
// 实现 app_settings 表的键值对读写操作
// 使用 prepared statements 参数化查询，防止 SQL 注入
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'app_settings'

// 预编译语句缓存，避免重复 prepare
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
 * 根据 key 获取配置值
 * @param {string} key - 配置键
 * @returns {string|null} 配置值，不存在返回 null
 */
function get (key) {
  try {
    const row = getStmt('get', `SELECT value FROM ${TABLE} WHERE key = ?`).get(key)
    return row ? row.value : null
  } catch (error) {
    logger.error('AppSettingDao', `get(${key}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 设置或更新配置值（UPSERT）
 * @param {string} key - 配置键
 * @param {string} value - 配置值
 * @returns {boolean} 是否成功
 */
function set (key, value) {
  try {
    const now = dateUtils.nowISO()
    getStmt('set', `
      INSERT INTO ${TABLE} (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, now)
    return true
  } catch (error) {
    logger.error('AppSettingDao', `set(${key}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 获取所有配置（键值对 Map）
 * @returns {Map<string, string>} 配置映射
 */
function getAll () {
  try {
    const rows = getStmt('getAll', `SELECT key, value FROM ${TABLE}`).all()
    const map = new Map()
    for (const row of rows) {
      map.set(row.key, row.value)
    }
    return map
  } catch (error) {
    logger.error('AppSettingDao', `getAll() 失败: ${error.message}`)
    return new Map()
  }
}

/**
 * 删除指定 key 的配置
 * @param {string} key - 配置键
 * @returns {boolean} 是否成功
 */
function del (key) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE key = ?`).run(key)
    return result.changes > 0
  } catch (error) {
    logger.error('AppSettingDao', `del(${key}) 失败: ${error.message}`)
    return false
  }
}

// ============================================================
// 业务便捷方法
// ============================================================

/**
 * 获取整数类型配置值
 * @param {string} key
 * @param {number} [defaultVal=0]
 * @returns {number}
 */
function getInt (key, defaultVal = 0) {
  const val = get(key)
  if (val === null) return defaultVal
  const num = parseInt(val, 10)
  return isNaN(num) ? defaultVal : num
}

/**
 * 获取布尔类型配置值
 * @param {string} key
 * @param {boolean} [defaultVal=false]
 * @returns {boolean}
 */
function getBool (key, defaultVal = false) {
  const val = get(key)
  if (val === null) return defaultVal
  return val === '1' || val === 'true'
}

/**
 * 获取 JSON 类型配置值（反序列化）
 * @param {string} key
 * @param {*} [defaultVal=null]
 * @returns {*}
 */
function getJson (key, defaultVal = null) {
  const val = get(key)
  if (val === null) return defaultVal
  try {
    return JSON.parse(val)
  } catch (error) {
    logger.error('AppSettingDao', `getJson(${key}) 解析失败: ${error.message}`)
    return defaultVal
  }
}

/**
 * 设置 JSON 类型配置值（序列化后存储）
 * @param {string} key
 * @param {*} value
 * @returns {boolean}
 */
function setJson (key, value) {
  try {
    return set(key, JSON.stringify(value))
  } catch (error) {
    logger.error('AppSettingDao', `setJson(${key}) 失败: ${error.message}`)
    return false
  }
}

module.exports = {
  get, set, getAll, del,
  getInt, getBool, getJson, setJson
}
