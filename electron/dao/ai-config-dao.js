// ============================================================
// AI 模型配置 DAO
// 实现 ai_configs 表的 CRUD
// api_key_encrypted 字段存储加密后的 API 密钥
// is_active 字段确保每个类别（language / image / video）同时只有一个活动模型
// extra_config 字段以 JSON 字符串存储模型特定参数，读取时自动 parse
// model_category 字段标识模型类别（language / image / video）
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')

const TABLE = 'ai_configs'

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
 * 序列化 extra_config 为 JSON 字符串存储
 * null/undefined 返回 null，对象返回 JSON 字符串
 * @param {*} extraConfig
 * @returns {string|null}
 */
function _serializeExtraConfig (extraConfig) {
  if (extraConfig == null) return null
  if (typeof extraConfig === 'string') return extraConfig
  try {
    return JSON.stringify(extraConfig)
  } catch {
    return null
  }
}

/**
 * 解析 extra_config JSON 字符串为对象
 * 容错：null/空字符串/非法 JSON 统一返回 null
 * @param {string} raw
 * @returns {object|null}
 */
function _parseExtraConfig (raw) {
  if (!raw || typeof raw !== 'string') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * 规范化配置行：将 extra_config 从 JSON 字符串解析为对象
 * @param {object} config - 数据库行
 * @returns {object|null}
 */
function _normalizeConfig (config) {
  if (!config) return config
  return { ...config, extra_config: _parseExtraConfig(config.extra_config) }
}

/**
 * 创建 AI 模型配置
 * @param {object} data - { provider_type, name, api_endpoint, api_key_encrypted, model_name,
 *   context_tokens, max_tokens, enable_thinking, enable_vision, extra_config, model_category }
 * @returns {object} 创建的配置
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    getStmt('create', `
      INSERT INTO ${TABLE} (id, provider_type, name, api_endpoint, api_key_encrypted, model_name,
        is_active, context_tokens, max_tokens, enable_thinking, enable_vision,
        extra_config, model_category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.provider_type,
      data.name,
      data.api_endpoint,
      data.api_key_encrypted || null,
      data.model_name,
      data.context_tokens != null ? Number(data.context_tokens) : 0,
      data.max_tokens != null ? Number(data.max_tokens) : 0,
      data.enable_thinking ? 1 : 0,
      data.enable_vision ? 1 : 0,
      _serializeExtraConfig(data.extra_config),
      data.model_category || 'language',
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('AIConfigDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询配置
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    const row = getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
    return _normalizeConfig(row)
  } catch (error) {
    logger.error('AIConfigDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询所有配置
 * @returns {object[]}
 */
function findAll () {
  try {
    const rows = getStmt('findAll', `SELECT * FROM ${TABLE} ORDER BY created_at DESC`).all()
    return rows.map(_normalizeConfig)
  } catch (error) {
    logger.error('AIConfigDao', `findAll() 失败: ${error.message}`)
    return []
  }
}

/**
 * 查询当前活动的模型配置
 * @returns {object|null}
 */
function findActive () {
  try {
    const row = getStmt('findActive', `SELECT * FROM ${TABLE} WHERE is_active = 1 LIMIT 1`).get() || null
    return _normalizeConfig(row)
  } catch (error) {
    logger.error('AIConfigDao', `findActive() 失败: ${error.message}`)
    return null
  }
}

/**
 * 按提供商类型查询配置（优先返回活跃的）
 * @param {string} providerType - 如 'agnes-image'、'agnes-video'、'agnes-all'
 * @returns {object|null}
 */
function findByProviderType (providerType) {
  try {
    // 优先返回该类型中活跃的配置，否则返回该类型第一条
    const active = getStmt('findActiveByType', `SELECT * FROM ${TABLE} WHERE provider_type = ? AND is_active = 1 LIMIT 1`).get(providerType)
    if (active) return _normalizeConfig(active)
    const row = getStmt('findByType', `SELECT * FROM ${TABLE} WHERE provider_type = ? LIMIT 1`).get(providerType) || null
    return _normalizeConfig(row)
  } catch (error) {
    logger.error('AIConfigDao', `findByProviderType(${providerType}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 按模型类别查询配置列表
 * @param {string} category - 'language' / 'image' / 'video'
 * @returns {object[]}
 */
function findByModelCategory (category) {
  try {
    const rows = getStmt('findByModelCategory', `SELECT * FROM ${TABLE} WHERE model_category = ? ORDER BY created_at DESC`).all(category)
    return rows.map(_normalizeConfig)
  } catch (error) {
    logger.error('AIConfigDao', `findByModelCategory(${category}) 失败: ${error.message}`)
    return []
  }
}

/**
 * 查询所有配置（含 API Key 标识，供"已有 Key 选择"下拉使用）
 * 仅返回 id、name、provider_type，不返回明文 Key
 * @returns {object[]}
 */
function findAllWithApiKey () {
  try {
    return getStmt('findAllWithApiKey', `
      SELECT id, name, provider_type, model_category
      FROM ${TABLE}
      WHERE api_key_encrypted IS NOT NULL
      ORDER BY created_at DESC
    `).all()
  } catch (error) {
    logger.error('AIConfigDao', `findAllWithApiKey() 失败: ${error.message}`)
    return []
  }
}

/**
 * 更新配置
 * @param {string} id
 * @param {object} data - 要更新的字段
 * @returns {object|null}
 */
function update (id, data) {
  try {
    const fields = []
    const params = []

    if (data.provider_type !== undefined) { fields.push('provider_type = ?'); params.push(data.provider_type) }
    if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name) }
    if (data.api_endpoint !== undefined) { fields.push('api_endpoint = ?'); params.push(data.api_endpoint) }
    if (data.api_key_encrypted !== undefined) { fields.push('api_key_encrypted = ?'); params.push(data.api_key_encrypted) }
    if (data.model_name !== undefined) { fields.push('model_name = ?'); params.push(data.model_name) }
    if (data.context_tokens !== undefined) { fields.push('context_tokens = ?'); params.push(Number(data.context_tokens)) }
    if (data.max_tokens !== undefined) { fields.push('max_tokens = ?'); params.push(Number(data.max_tokens)) }
    if (data.enable_thinking !== undefined) { fields.push('enable_thinking = ?'); params.push(data.enable_thinking ? 1 : 0) }
    if (data.enable_vision !== undefined) { fields.push('enable_vision = ?'); params.push(data.enable_vision ? 1 : 0) }
    if (data.extra_config !== undefined) { fields.push('extra_config = ?'); params.push(_serializeExtraConfig(data.extra_config)) }
    if (data.model_category !== undefined) { fields.push('model_category = ?'); params.push(data.model_category) }

    if (fields.length === 0) return getById(id)

    params.push(id)
    // 关键修复：动态 SQL 不能用固定 key 缓存（同 widget-dao.js），用字段签名作为 key
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return getById(id)
  } catch (error) {
    logger.error('AIConfigDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 删除配置
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    // 如果删除的是当前激活的模型，清除激活状态
    const config = getById(id)
    if (config && config.is_active) {
      getStmt('clearActive', `UPDATE ${TABLE} SET is_active = 0 WHERE id = ?`).run(id)
    }
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    return result.changes > 0
  } catch (error) {
    logger.error('AIConfigDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 激活指定模型（同时取消同类别其他模型的激活状态）
 * 每个类别（language / image / video）各保留一个"当前使用"
 * @param {string} id
 * @returns {object|null}
 */
function activate (id) {
  try {
    // 先获取目标配置的 model_category
    const targetConfig = getById(id)
    if (!targetConfig) {
      logger.warn('AIConfigDao', `activate(${id}) 失败: 配置不存在`)
      return null
    }
    const category = targetConfig.model_category || 'language'
    // 只取消同类别配置的激活状态（让每个类别各有一个"当前使用"）
    getStmt('deactivateByCategory', `UPDATE ${TABLE} SET is_active = 0 WHERE model_category = ?`).run(category)
    // 再激活目标模型
    getStmt('activate', `UPDATE ${TABLE} SET is_active = 1 WHERE id = ?`).run(id)
    return getById(id)
  } catch (error) {
    logger.error('AIConfigDao', `activate(${id}) 失败: ${error.message}`)
    return null
  }
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create, getById, findAll, findActive, findByProviderType, findByModelCategory,
  findAllWithApiKey, update, del, activate,
  clearCache
}
