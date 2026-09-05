// ============================================================
// 成就 DAO
// 实现 achievements 表的查询和进度更新
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const dateUtils = require('./../utils/date-utils.js')
const { generateId } = require('./../utils/id-generator.js')
const logger = require('./../core/logger.js')

const TABLE = 'achievements'

const stmts = {}
registerStmtCache(stmts)

function getStmt (key, sql) {
  if (!stmts[key]) {
    stmts[key] = getDb().prepare(sql)
  }
  return stmts[key]
}

/**
 * 查询所有成就
 * @returns {object[]}
 */
function list () {
  try {
    return getStmt('list', `SELECT * FROM ${TABLE} ORDER BY unlocked DESC, title ASC`).all()
  } catch (error) {
    logger.error('AchievementDao', `list() 失败: ${error.message}`)
    return []
  }
}

/**
 * 根据 code 查询
 * @param {string} code
 * @returns {object|null}
 */
function getByCode (code) {
  try {
    return getStmt('getByCode', `SELECT * FROM ${TABLE} WHERE code = ?`).get(code) || null
  } catch (error) {
    logger.error('AchievementDao', `getByCode(${code}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 更新成就进度并检查是否解锁
 * @param {string} code - 成就 code
 * @param {number} increment - 增加的数量
 * @returns {object|null} - 如果解锁返回成就对象，否则返回 null
 */
function updateProgress (code, increment = 1) {
  try {
    const achievement = getByCode(code)
    if (!achievement) return null

    const newCurrent = Math.min(achievement.current + increment, achievement.target)
    const wasUnlocked = achievement.unlocked === 1
    // 计算是否应该处于解锁状态（已解锁或已达标），避免已解锁成就被重新锁住
    const shouldUnlock = wasUnlocked || newCurrent >= achievement.target
    // 是否本次新解锁（用于记录 unlocked_at 时间戳）
    const isNewlyUnlocked = !wasUnlocked && newCurrent >= achievement.target

    getStmt('updateProgress', `
      UPDATE ${TABLE}
      SET current = ?,
          unlocked = ?,
          unlocked_at = CASE WHEN ? THEN ? ELSE unlocked_at END
      WHERE code = ?
    `).run(newCurrent, shouldUnlock ? 1 : 0, isNewlyUnlocked ? 1 : 0, dateUtils.nowISO(), code)

    if (isNewlyUnlocked) {
      logger.info('AchievementDao', `成就已解锁: ${achievement.title}`)
      return getByCode(code)
    }
    return null
  } catch (error) {
    logger.error('AchievementDao', `updateProgress(${code}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 设置成就进度为绝对值（非累加），并检查是否解锁
 * 适用于基于统计量的成就（如已完成任务数、项目数、累计专注秒数），
 * 避免累加语义导致的重复累加问题
 * @param {string} code - 成就 code
 * @param {number} value - 当前进度的绝对值
 * @returns {object|null} - 如果新解锁返回成就对象，否则返回 null
 */
function setProgress (code, value = 0) {
  try {
    const achievement = getByCode(code)
    if (!achievement) return null

    const newCurrent = Math.max(0, Math.min(value, achievement.target))
    const wasUnlocked = achievement.unlocked === 1
    // 计算是否应该处于解锁状态（已解锁或已达标），避免已解锁成就被重新锁住
    const shouldUnlock = wasUnlocked || newCurrent >= achievement.target
    // 是否本次新解锁（用于记录 unlocked_at 时间戳）
    const isNewlyUnlocked = !wasUnlocked && newCurrent >= achievement.target

    getStmt('setProgress', `
      UPDATE ${TABLE}
      SET current = ?,
          unlocked = ?,
          unlocked_at = CASE WHEN ? THEN ? ELSE unlocked_at END
      WHERE code = ?
    `).run(newCurrent, shouldUnlock ? 1 : 0, isNewlyUnlocked ? 1 : 0, dateUtils.nowISO(), code)

    if (isNewlyUnlocked) {
      logger.info('AchievementDao', `成就已解锁: ${achievement.title}`)
      return getByCode(code)
    }
    return null
  } catch (error) {
    logger.error('AchievementDao', `setProgress(${code}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 获取成就统计
 * @returns {object} { total, unlocked, progress }
 */
function getStats () {
  try {
    const result = getStmt('stats', `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN unlocked = 1 THEN 1 ELSE 0 END) as unlocked,
        AVG(CAST(current AS REAL) / NULLIF(target, 0)) * 100 as avg_progress
      FROM ${TABLE}
    `).get()
    return {
      total: result.total,
      unlocked: result.unlocked,
      progress: Math.round(result.avg_progress || 0)
    }
  } catch (error) {
    logger.error('AchievementDao', `getStats() 失败: ${error.message}`)
    return { total: 0, unlocked: 0, progress: 0 }
  }
}

function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

/**
 * 创建自定义成就
 * @param {object} data { code, title, description, icon, target, category, parent_code, parent_codes, position }
 * @returns {object|null} 创建的成就
 */
function create (data) {
  const maxRetries = 3
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 第一次用原始 code，后续重试生成新 code
      const code = attempt === 0 ? data.code : `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const id = generateId()
      const now = dateUtils.nowISO()
      getStmt('create', `
        INSERT INTO ${TABLE} (id, code, title, description, icon, target, current, unlocked, created_at, is_custom, category, parent_code, parent_codes, position)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 1, ?, ?, ?, ?)
      `).run(id, code, data.title, data.description || null, data.icon || 'Trophy',
             data.target || 1, now, data.category || 'custom', data.parent_code || null,
             data.parent_codes || null, data.position || 0)
      return getByCode(code)
    } catch (error) {
      // 如果是 UNIQUE 约束冲突且还有重试机会，继续重试
      if (error.message.includes('UNIQUE') && attempt < maxRetries - 1) {
        logger.warn('AchievementDao', `create() code 冲突，重试 ${attempt + 1}/${maxRetries}`)
        continue
      }
      logger.error('AchievementDao', `create() 失败: ${error.message}`)
      return null
    }
  }
  return null
}

/**
 * 更新自定义成就
 * @param {string} code 成就 code
 * @param {object} data 要更新的字段
 * @returns {object|null} 更新后的成就
 */
function update (code, data) {
  try {
    const fields = []
    const values = []
    const allowed = ['title', 'description', 'icon', 'target', 'category', 'parent_code', 'parent_codes', 'position', 'pos_x', 'pos_y', 'unlocked', 'current']
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`)
        values.push(data[key])
      }
    }
    if (fields.length === 0) return getByCode(code)
    values.push(code)
    // 用字段组合作为缓存 key，避免不同字段组合复用错误的预处理语句
    const cacheKey = 'update_' + fields.join(',')
    getStmt(cacheKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE code = ?`).run(...values)
    return getByCode(code)
  } catch (error) {
    logger.error('AchievementDao', `update(${code}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 删除自定义成就（不能删除预置成就）
 * @param {string} code 成就 code
 * @returns {boolean} 是否删除成功
 */
function remove (code) {
  try {
    const ach = getByCode(code)
    if (!ach) return false
    // 预置成就不能删除
    if (Number(ach.is_custom) !== 1) return false
    // 同时把以它为前置的成就的 parent_code 置空
    getStmt('clearParent', `UPDATE ${TABLE} SET parent_code = NULL WHERE parent_code = ?`).run(code)
    // 同时把以它为前置的成就的 parent_codes 中的引用移除
    // 查询所有有 parent_codes 的成就，在 JS 中精确匹配（避免 LIKE 子串误匹配）
    const allWithParents = getStmt('getAllWithParents', `SELECT code, parent_codes FROM ${TABLE} WHERE parent_codes IS NOT NULL AND parent_codes != ''`).all()
    const children = allWithParents.filter(child => {
      const codes = (child.parent_codes || '').split(',').map(c => c.trim()).filter(Boolean)
      return codes.includes(code)
    })
    children.forEach(child => {
      const codes = (child.parent_codes || '').split(',').filter(c => c.trim() && c !== code)
      getStmt('updateParentCodes', `UPDATE ${TABLE} SET parent_codes = ? WHERE code = ?`).run(codes.length ? codes.join(',') : null, child.code)
    })
    const result = getStmt('remove', `DELETE FROM ${TABLE} WHERE code = ? AND is_custom = 1`).run(code)
    return result.changes > 0
  } catch (error) {
    logger.error('AchievementDao', `remove(${code}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 批量更新节点位置
 * @param {Array} positions [{ code, pos_x, pos_y }]
 */
function batchUpdatePositions (positions) {
  try {
    const stmt = getStmt('updatePosition', `UPDATE ${TABLE} SET pos_x = ?, pos_y = ? WHERE code = ?`)
    const db = getDb()
    db.transaction(() => {
      positions.forEach(p => {
        stmt.run(p.pos_x, p.pos_y, p.code)
      })
    })()
  } catch (error) {
    logger.error('AchievementDao', `batchUpdatePositions() 失败: ${error.message}`)
  }
}

/**
 * 删除所有自定义成就
 * @returns {Array} 被删除的自定义成就列表（供撤销恢复用）
 */
function deleteAllCustom () {
  try {
    const customList = getStmt('listCustom', `SELECT * FROM ${TABLE} WHERE is_custom = 1`).all()
    getStmt('deleteAllCustom', `DELETE FROM ${TABLE} WHERE is_custom = 1`).run()
    // 清除预置成就中对自定义成就的引用
    const presets = getStmt('listPreset', `SELECT code, parent_codes, parent_code FROM ${TABLE} WHERE is_custom = 0 AND parent_codes IS NOT NULL`).all()
    const db = getDb()
    db.transaction(() => {
      presets.forEach(p => {
        const codes = (p.parent_codes || '').split(',').map(c => c.trim()).filter(c => c && !customList.some(cu => cu.code === c))
        getStmt('cleanParentCodes', `UPDATE ${TABLE} SET parent_codes = ?, parent_code = ? WHERE code = ?`)
          .run(codes.length ? codes.join(',') : null, codes[0] || null, p.code)
      })
    })()
    return customList
  } catch (error) {
    logger.error('AchievementDao', `deleteAllCustom() 失败: ${error.message}`)
    return []
  }
}

/**
 * 重置预置成就的布局和依赖到初始状态
 */
function resetPresetLayout () {
  try {
    // 预置成就的初始 parent_code 映射
    const initialParents = {
      first_task: null,
      ten_tasks: 'first_task',
      all_colors: 'ten_tasks',
      streak_7: 'all_colors',
      first_focus: null,
      thirty_focus_min: 'first_focus',
      hour_focus: 'thirty_focus_min',
      plan_generator: null,
      five_groups: 'plan_generator',
      three_projects: 'five_groups'
    }
    const db = getDb()
    db.transaction(() => {
      // 清除所有位置
      getStmt('clearAllPositions', `UPDATE ${TABLE} SET pos_x = NULL, pos_y = NULL`).run()
      // 重置预置成就的 parent_codes 和 parent_code
      for (const [code, parent] of Object.entries(initialParents)) {
        getStmt('resetParent_' + code, `UPDATE ${TABLE} SET parent_code = ?, parent_codes = ? WHERE code = ?`)
          .run(parent, parent, code)
      }
    })()
  } catch (error) {
    logger.error('AchievementDao', `resetPresetLayout() 失败: ${error.message}`)
  }
}

/**
 * 批量恢复成就（用于撤销重置）
 * @param {Array} achievements 完整的成就数据列表
 */
function restoreAll (achievements) {
  try {
    const db = getDb()
    db.transaction(() => {
      achievements.forEach(a => {
        // 先尝试更新，如果不存在则插入
        const existing = getByCode(a.code)
        if (existing) {
          getStmt('restoreUpdate', `UPDATE ${TABLE} SET title = ?, description = ?, icon = ?, target = ?, current = ?, unlocked = ?, unlocked_at = ?, category = ?, parent_code = ?, parent_codes = ?, position = ?, pos_x = ?, pos_y = ? WHERE code = ?`)
            .run(a.title, a.description, a.icon, a.target, a.current, a.unlocked, a.unlocked_at, a.category, a.parent_code, a.parent_codes, a.position, a.pos_x, a.pos_y, a.code)
        } else {
          getStmt('restoreInsert', `INSERT INTO ${TABLE} (id, code, title, description, icon, target, current, unlocked, unlocked_at, created_at, is_custom, category, parent_code, parent_codes, position, pos_x, pos_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(a.id, a.code, a.title, a.description, a.icon, a.target, a.current, a.unlocked, a.unlocked_at, a.created_at, a.is_custom, a.category, a.parent_code, a.parent_codes, a.position, a.pos_x, a.pos_y)
        }
      })
    })()
    return true
  } catch (error) {
    logger.error('AchievementDao', `restoreAll() 失败: ${error.message}`)
    return false
  }
}

module.exports = {
  list, getByCode, updateProgress, setProgress, getStats,
  create, update, remove,
  batchUpdatePositions,
  deleteAllCustom, resetPresetLayout, restoreAll,
  clearCache
}