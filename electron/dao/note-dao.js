// ============================================================
// 便签 DAO
// 实现 notes 表的 CRUD、搜索筛选排序、定时查询
// 附件支持：每个便签在 userData/note-attachments/{noteId}/ 下
//           维护 manifest.json（附件元数据）与附件文件本体
// ============================================================

const { getDb, registerStmtCache } = require('./database.js')
const { generateId } = require('./../utils/id-generator.js')
const dateUtils = require('./../utils/date-utils.js')
const logger = require('./../core/logger.js')
const fs = require('fs').promises
const fsSync = require('fs')
const path = require('path')
const os = require('os')

// 兼容性兜底：测试环境下 electron 可能不可用
let app = null
try {
  app = require('electron').app
} catch {
  app = null
}

const TABLE = 'notes'

// 预编译语句缓存
const stmts = {}
registerStmtCache(stmts)

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
 * 创建便签
 * @param {object} data - { title, body, color_tag?, reminder_time?, is_pinned? }
 * @returns {object} 创建的便签记录
 */
function create (data) {
  const now = dateUtils.nowISO()
  const id = generateId()
  try {
    const result = getStmt('create', `
      INSERT INTO ${TABLE} (id, title, body, color_tag, reminder_time, is_pinned, is_completed, is_reminded, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `).run(
      id,
      data.title || null,
      data.body || null,
      data.color_tag || 'yellow',
      data.reminder_time || null,
      data.is_pinned ? 1 : 0,
      now,
      now
    )
    return getById(id)
  } catch (error) {
    logger.error('NoteDao', `create() 失败: ${error.message}`)
    throw error
  }
}

/**
 * 根据 ID 查询便签
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  try {
    return getStmt('getById', `SELECT * FROM ${TABLE} WHERE id = ?`).get(id) || null
  } catch (error) {
    logger.error('NoteDao', `getById(${id}) 失败: ${error.message}`)
    return null
  }
}

/**
 * 查询便签列表（支持关键词搜索、颜色筛选、排序、分页）
 * @param {object} options - { keyword?, color_tag?, sort_by?, sort_order?, page?, size? }
 * @returns {object} { list, total }
 */
function list (options = {}) {
  const {
    keyword = '',
    color_tag = '',
    sort_by = 'updated_at',
    sort_order = 'DESC',
    page = 1,
    size = 50
  } = options

  // 构建 WHERE 条件
  const conditions = []
  const params = []

  // 关键词搜索（对 title 和 body 进行 LIKE 模糊匹配）
  // 转义 LIKE 通配符 _ 和 %，避免用户输入的特殊字符被当作通配符
  if (keyword) {
    const escapedKeyword = keyword.replace(/[%_]/g, '\\$&')
    conditions.push(`(title LIKE ? ESCAPE '\\' OR body LIKE ?)`)
    params.push(`%${escapedKeyword}%`, `%${escapedKeyword}%`)
  }

  // 颜色筛选
  if (color_tag) {
    conditions.push('color_tag = ?')
    params.push(color_tag)
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // 动态缓存键：避免有/无 WHERE 时 prepared statement 参数不匹配
  // 根因：getStmt 缓存键固定，但 SQL 可能带或不带 WHERE，导致参数数量不一致
  const whereKey = conditions.length > 0 ? 'WithWhere' : 'NoWhere'

  // 排序字段白名单校验，防止 SQL 注入
  const allowedSortFields = ['updated_at', 'created_at', 'title', 'is_pinned', 'reminder_time']
  const safeSortField = allowedSortFields.includes(sort_by) ? sort_by : 'updated_at'
  const safeOrder = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'

  // 查询总数
  const totalResult = getStmt(`listTotal${whereKey}`, `SELECT COUNT(*) as total FROM ${TABLE} ${whereSql}`).get(...params)
  const total = totalResult.total

  // 查询列表（分页）
  const offset = (page - 1) * size
  const listResult = getStmt(`list${whereKey}`, `
    SELECT * FROM ${TABLE}
    ${whereSql}
    ORDER BY ${safeSortField} ${safeOrder}
    LIMIT ? OFFSET ?
  `).all(...params, size, offset)

  return { list: listResult, total }
}

/**
 * 更新便签
 * @param {string} id
 * @param {object} data - 要更新的字段
 * @returns {object|null} 更新后的便签
 */
function update (id, data) {
  try {
    const now = dateUtils.nowISO()
    const fields = []
    const params = []

    if (data.title !== undefined) { fields.push('title = ?'); params.push(data.title) }
    if (data.body !== undefined) { fields.push('body = ?'); params.push(data.body) }
    if (data.color_tag !== undefined) { fields.push('color_tag = ?'); params.push(data.color_tag) }
    if (data.reminder_time !== undefined) { fields.push('reminder_time = ?'); params.push(data.reminder_time) }
    if (data.is_pinned !== undefined) { fields.push('is_pinned = ?'); params.push(data.is_pinned ? 1 : 0) }
    if (data.is_completed !== undefined) { fields.push('is_completed = ?'); params.push(data.is_completed ? 1 : 0) }
    if (data.is_reminded !== undefined) { fields.push('is_reminded = ?'); params.push(data.is_reminded ? 1 : 0) }

    if (fields.length === 0) return getById(id)

    fields.push("updated_at = ?")
    params.push(now)
    params.push(id)

    // 关键修复：动态 SQL 不能用固定 key 缓存（同 widget-dao.js），用字段签名作为 key
    const updateKey = `update:${fields.join(',')}`
    getStmt(updateKey, `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return getById(id)
  } catch (error) {
    logger.error('NoteDao', `update(${id}) 失败: ${error.message}`)
    throw error
  }
}

/**
 * 删除便签
 * 同时清理该便签关联的附件目录与 manifest.json
 * @param {string} id
 * @returns {boolean}
 */
function del (id) {
  try {
    const result = getStmt('del', `DELETE FROM ${TABLE} WHERE id = ?`).run(id)
    if (result.changes > 0) {
      // 异步清理附件目录，失败不影响便签删除
      clearAttachments(id).catch(err => {
        logger.warn('NoteDao', `del(${id}) 清理附件失败: ${err.message}`)
      })
    }
    return result.changes > 0
  } catch (error) {
    logger.error('NoteDao', `del(${id}) 失败: ${error.message}`)
    return false
  }
}

// ============================================================
// 附件管理方法
// 附件存储路径：{userData}/note-attachments/{noteId}/
//   - manifest.json：附件元数据列表
//   - {文件名}：附件文件本体（managed 模式）
// ============================================================

/**
 * 获取便签附件根目录
 * @param {string} noteId
 * @returns {string}
 */
function getAttachmentDirectory (noteId) {
  const base = app ? path.join(app.getPath('userData'), 'note-attachments') : path.join(os.tmpdir(), 'note-attachments')
  return path.join(base, noteId)
}

/**
 * 读取附件 manifest.json
 * @param {string} noteId
 * @returns {Promise<object>} { attachments: [] }
 */
async function readAttachmentManifest (noteId) {
  const manifestPath = path.join(getAttachmentDirectory(noteId), 'manifest.json')
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { attachments: [] }
  }
}

/**
 * 写入附件 manifest.json
 * @param {string} noteId
 * @param {object} manifest
 */
async function writeAttachmentManifest (noteId, manifest) {
  const dir = getAttachmentDirectory(noteId)
  await fs.mkdir(dir, { recursive: true })
  const manifestPath = path.join(dir, 'manifest.json')
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

/**
 * 列出便签的所有附件
 * @param {string} noteId
 * @returns {Promise<object[]>} 附件数组，每项含 filePath/displayName/type/storageMode/addedAt
 */
async function listAttachments (noteId) {
  const manifest = await readAttachmentManifest(noteId)
  return manifest.attachments || []
}

/**
 * 添加附件（从源路径导入）
 * @param {string} noteId 便签 ID
 * @param {string} sourcePath 源文件路径
 * @param {boolean} [copyToManagedStorage=true] 是否复制到托管目录（false=保留链接）
 * @returns {Promise<object|null>} 新增的附件对象
 */
async function addAttachment (noteId, sourcePath, copyToManagedStorage = true) {
  if (!noteId || !sourcePath) return null
  try {
    await fs.access(sourcePath)
  } catch {
    logger.error('NoteDao', `addAttachment 源文件不存在: ${sourcePath}`)
    return null
  }

  const normalizedSource = path.resolve(sourcePath)
  const dir = getAttachmentDirectory(noteId)
  let attachment

  if (!copyToManagedStorage) {
    // 链接模式：仅记录路径，不复制文件
    attachment = {
      filePath: normalizedSource,
      displayName: path.basename(normalizedSource),
      type: getAttachmentType(normalizedSource),
      storageMode: 'linked',
      addedAt: new Date().toISOString()
    }
  } else {
    // 托管模式：复制到便签附件目录
    await fs.mkdir(dir, { recursive: true })
    const destPath = await getAvailablePath(path.join(dir, path.basename(normalizedSource)))
    await fs.copyFile(normalizedSource, destPath)
    attachment = {
      filePath: destPath,
      displayName: path.basename(destPath),
      type: getAttachmentType(destPath),
      storageMode: 'managed',
      addedAt: new Date().toISOString()
    }
  }

  // 更新 manifest
  const manifest = await readAttachmentManifest(noteId)
  manifest.attachments = manifest.attachments || []
  manifest.attachments.push(attachment)
  await writeAttachmentManifest(noteId, manifest)
  return attachment
}

/**
 * 移除指定附件
 * @param {string} noteId
 * @param {string} attachmentFilePath 附件文件路径（与 manifest 中的 filePath 匹配）
 * @returns {Promise<boolean>}
 */
async function removeAttachment (noteId, attachmentFilePath) {
  if (!noteId || !attachmentFilePath) return false
  const manifest = await readAttachmentManifest(noteId)
  const attachments = manifest.attachments || []
  const idx = attachments.findIndex(a => a.filePath === attachmentFilePath)
  if (idx < 0) return false

  const [removed] = attachments.splice(idx, 1)

  // 托管模式下删除文件本体
  if (removed.storageMode === 'managed') {
    try {
      await fs.unlink(removed.filePath)
    } catch (err) {
      logger.warn('NoteDao', `removeAttachment 删除文件失败: ${err.message}`)
    }
  }

  await writeAttachmentManifest(noteId, manifest)
  return true
}

/**
 * 清空便签的所有附件（删除便签时调用）
 * @param {string} noteId
 * @returns {Promise<boolean>}
 */
async function clearAttachments (noteId) {
  if (!noteId) return false
  const dir = getAttachmentDirectory(noteId)
  try {
    await fs.rm(dir, { recursive: true, force: true })
    return true
  } catch (err) {
    if (err.code === 'ENOENT') return true
    logger.error('NoteDao', `clearAttachments(${noteId}) 失败: ${err.message}`)
    return false
  }
}

/**
 * 获取附件类型
 * @param {string} filePath
 * @returns {string} 'image'|'video'|'pdf'|'file'
 */
function getAttachmentType (filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tiff', '.tif', '.heic', '.heif']
  const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm']
  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  if (ext === '.pdf') return 'pdf'
  return 'file'
}

/**
 * 获取可用路径（处理同名冲突）
 * @param {string} targetPath
 * @returns {Promise<string>}
 */
async function getAvailablePath (targetPath) {
  let finalPath = targetPath
  let counter = 1
  while (true) {
    try {
      await fs.access(finalPath)
      const ext = path.extname(targetPath)
      const base = path.basename(targetPath, ext)
      finalPath = path.join(path.dirname(targetPath), `${base}_${counter}${ext}`)
      counter++
    } catch {
      return finalPath
    }
  }
}

// ============================================================
// 业务查询方法
// ============================================================

/**
 * 查询到期未提醒的便签（供调度器调用）
 * @param {string} now - ISO 8601 格式当前时间
 * @returns {object[]} 到期便签列表
 */
function findDueReminders (now) {
  try {
    return getStmt('findDueReminders', `
      SELECT * FROM ${TABLE}
      WHERE reminder_time IS NOT NULL
        AND reminder_time <= ?
        AND is_reminded = 0
        AND is_completed = 0
      ORDER BY reminder_time ASC
    `).all(now)
  } catch (error) {
    logger.error('NoteDao', `findDueReminders() 失败: ${error.message}`)
    return []
  }
}

/**
 * 查询指定时间范围内即将到期的未完成便签（供桌宠待办提醒使用）
 * @param {string} fromIso - ISO 8601 起始时间（含）
 * @param {string} toIso   - ISO 8601 结束时间（含）
 * @returns {object[]} 即将到期的便签列表，按 reminder_time 升序
 */
function findUpcomingReminders (fromIso, toIso) {
  try {
    return getStmt('findUpcomingReminders', `
      SELECT * FROM ${TABLE}
      WHERE reminder_time IS NOT NULL
        AND reminder_time >= ?
        AND reminder_time <= ?
        AND is_reminded = 0
        AND is_completed = 0
      ORDER BY reminder_time ASC
    `).all(fromIso, toIso)
  } catch (error) {
    logger.error('NoteDao', `findUpcomingReminders() 失败: ${error.message}`)
    return []
  }
}

/**
 * 标记便签为已提醒
 * @param {string} id
 * @returns {boolean}
 */
function markReminded (id) {
  try {
    // 使用 dateUtils.nowISO() 保持与其他写入方法时区一致（本地时间）
    // 避免 SQLite datetime('now') 返回 UTC 导致 updated_at 时区不一致
    const now = dateUtils.nowISO()
    getStmt('markReminded', `
      UPDATE ${TABLE} SET is_reminded = 1, updated_at = ? WHERE id = ?
    `).run(now, id)
    return true
  } catch (error) {
    logger.error('NoteDao', `markReminded(${id}) 失败: ${error.message}`)
    return false
  }
}

/**
 * 标记过期未提醒便签为已提醒（启动时用，防止重复触发）
 * @param {string} startedAt - 应用启动时间（ISO 8601）
 * @returns {number} 标记数量
 */
function markMissedReminders (startedAt) {
  try {
    const result = getStmt('markMissedReminders', `
      UPDATE ${TABLE} SET is_reminded = 1, updated_at = ?
      WHERE reminder_time IS NOT NULL
        AND reminder_time < ?
        AND is_reminded = 0
    `).run(startedAt, startedAt)
    return result.changes
  } catch (error) {
    logger.error('NoteDao', `markMissedReminders() 失败: ${error.message}`)
    return 0
  }
}

// 清理缓存
function clearCache () {
  Object.keys(stmts).forEach(key => delete stmts[key])
}

module.exports = {
  create, getById, list, update, del,
  findDueReminders, findUpcomingReminders, markReminded, markMissedReminders,
  clearCache,
  // 附件管理
  getAttachmentDirectory,
  readAttachmentManifest,
  writeAttachmentManifest,
  listAttachments,
  addAttachment,
  removeAttachment,
  clearAttachments,
  getAttachmentType
}
