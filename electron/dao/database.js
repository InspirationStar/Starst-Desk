// ============================================================
// 数据库实例与连接管理
// 使用 better-sqlite3 创建 SQLite 数据库单例
// 数据库文件存储位置支持自定义（通过 app_settings 表的 data_path 配置项）
// 默认位置：%APPDATA%\StarstDesk\data.db
// 启用 WAL 模式提升崩溃恢复能力
// ============================================================

const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')
const os = require('os')

/**
 * 获取日志服务实例（延迟加载，避免循环依赖）
 */
let logger = null
function getLogger () {
  if (!logger) {
    logger = require('./../core/logger.js')
  }
  return logger
}

/**
 * 默认数据目录：%APPDATA%\StarstDesk
 * 非 Windows 平台 APPDATA 环境变量不存在，回退到用户主目录下的 AppData/Roaming
 */
const DEFAULT_DATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'StarstDesk'
)

/**
 * 默认数据库文件路径：%APPDATA%\StarstDesk\data.db
 */
const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, 'data.db')

/**
 * app_settings 表中存储自定义数据目录路径的键名
 */
const DATA_PATH_KEY = 'data_path'

/**
 * 预编译语句缓存注册表
 * DAO 模块在创建 stmts 对象时注册到此 Set，closeDb() 时统一清除
 * 避免 closeDb() 后缓存的预编译语句仍引用已关闭的连接
 */
const stmtCaches = new Set()

/**
 * 注册预编译语句缓存对象，供 closeDb() 统一清除
 * @param {Object} cache DAO 模块的 stmts 对象
 */
function registerStmtCache (cache) {
  stmtCaches.add(cache)
}

/**
 * 独立配置文件路径：用于持久化 data_path，防止默认数据库被删除时配置丢失
 * 与 data.db 同目录，但独立存在——即使 data.db 被删除，配置文件仍在
 */
const CONFIG_FILE = path.join(DEFAULT_DATA_DIR, 'app-config.json')

/**
 * 从独立配置文件读取 data_path
 * @returns {string|null} 自定义路径，不存在返回 null
 */
function readDataPathFromConfigFile () {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
      return config.dataPath || null
    }
  } catch (e) {
    getLogger().error('Database', `读取配置文件失败: ${e.message}`)
  }
  return null
}

/**
 * 将 data_path 写入独立配置文件
 * @param {string|null} dataPath 自定义路径，null 表示清除
 */
function writeDataPathToConfigFile (dataPath) {
  try {
    ensureDir(DEFAULT_DATA_DIR)
    let config = {}
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    }
    if (dataPath) {
      config.dataPath = dataPath
    } else {
      delete config.dataPath
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
  } catch (e) {
    getLogger().error('Database', `写入配置文件失败: ${e.message}`)
  }
}

/**
 * 迁移脚本目录：项目根目录下的 migrations/（保留供日志参考）
 */
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations')

/**
 * 数据库实例单例
 */
let dbInstance = null

/**
 * 当前实际使用的数据库文件路径（初始化后赋值）
 */
let currentDbPath = DEFAULT_DB_PATH

/**
 * 检查 app_settings 表是否存在于当前数据库中
 * @param {Database} db better-sqlite3 实例
 * @returns {boolean}
 */
function appSettingsTableExists (db) {
  try {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'`
    ).get()
    return !!row
  } catch (e) {
    return false
  }
}

/**
 * 从已打开的数据库中读取自定义数据目录路径
 * @param {Database} db better-sqlite3 实例
 * @returns {string|null} 自定义路径，不存在返回 null
 */
function readDataPathFromDb (db) {
  if (!appSettingsTableExists(db)) {
    return null
  }
  try {
    const row = db.prepare(
      `SELECT value FROM app_settings WHERE key = ?`
    ).get(DATA_PATH_KEY)
    return row ? row.value : null
  } catch (e) {
    return null
  }
}

/**
 * 确保目录存在，不存在则递归创建
 * @param {string} dir 目录路径
 */
function ensureDir (dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    getLogger().info('Database', `创建数据库目录: ${dir}`)
  }
}

/**
 * 打开数据库连接并启用外键约束与 WAL 模式
 * @param {string} dbPath 数据库文件路径
 * @returns {Database} better-sqlite3 Database 实例
 */
function openDatabase (dbPath) {
  const db = new Database(dbPath)
  // 启用外键约束
  db.pragma('foreign_keys = ON')
  // 启用 WAL 模式（Write-Ahead Logging）
  // 优势：崩溃后恢复更快，读写不互相阻塞
  db.pragma('journal_mode = WAL')
  return db
}

/**
 * 初始化并返回数据库实例（单例模式）
 * 自动创建目录、启用 WAL 模式
 *
 * 初始化流程：
 * 1. 先用默认路径打开数据库
 * 2. 检查 app_settings 表是否存在，读取 data_path 配置
 * 3. 若存在自定义路径且与当前路径不同，关闭重连到自定义路径
 * 4. 启用外键约束与 WAL 模式
 *
 * @returns {Database} better-sqlite3 Database 实例
 */
function getDb () {
  if (dbInstance) {
    return dbInstance
  }

  try {
    // 步骤 1：确保默认目录存在并用默认路径打开数据库
    ensureDir(path.dirname(DEFAULT_DB_PATH))
    let db = openDatabase(DEFAULT_DB_PATH)
    currentDbPath = DEFAULT_DB_PATH

    // 步骤 2：读取自定义数据路径配置（先从默认数据库，读不到再从独立配置文件恢复）
    let customDataDir = readDataPathFromDb(db)
    if (!customDataDir) {
      // 默认数据库可能被删除/重建，尝试从独立配置文件恢复
      customDataDir = readDataPathFromConfigFile()
      if (customDataDir) {
        getLogger().info('Database', `从配置文件恢复 data_path: ${customDataDir}`)
        // 回写到默认数据库，保持一致
        ensureAppSettingsTable(db)
        const now = new Date().toISOString()
        db.prepare(`
          INSERT INTO app_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(DATA_PATH_KEY, customDataDir, now)
      }
    }
    getLogger().info('Database', `启动时读取 data_path 配置: ${customDataDir || '(未配置)'}`)

    // 步骤 3：若存在自定义路径且与默认路径不同，关闭重连
    if (customDataDir && customDataDir.trim() !== '') {
      const customDbPath = path.join(customDataDir, 'data.db')
      // 仅当路径不同时才切换，避免无谓重连
      if (path.resolve(customDbPath) !== path.resolve(DEFAULT_DB_PATH)) {
        try {
          // 关闭默认连接
          db.close()
          // 确保自定义目录存在
          ensureDir(customDataDir)
          // 用自定义路径重新打开
          db = openDatabase(customDbPath)
          currentDbPath = customDbPath
          getLogger().info('Database', `已切换到自定义数据目录: ${customDataDir}`)
        } catch (switchErr) {
          // 切换失败时回退到默认路径
          getLogger().error('Database', `切换到自定义数据目录失败，回退默认路径: ${switchErr.message}`)
          db = openDatabase(DEFAULT_DB_PATH)
          currentDbPath = DEFAULT_DB_PATH
        }
      }
    }

    dbInstance = db

    getLogger().info('Database', `数据库已初始化: ${currentDbPath}`)
    getLogger().info('Database', `WAL 模式已启用，外键约束已开启`)

    // 不在这里执行迁移，由 main.js 统一调用 runMigrations()
    getLogger().info('Database', `数据库已就绪，等待迁移服务执行 (migrations: ${MIGRATIONS_DIR})`)

    return dbInstance
  } catch (error) {
    getLogger().error('Database', `数据库初始化失败: ${error.message}`)
    throw error
  }
}

/**
 * 关闭数据库连接
 * 应用退出前调用
 */
function closeDb () {
  if (dbInstance) {
    // 先清除所有 DAO 的预编译语句缓存，避免引用已关闭的连接
    for (const cache of stmtCaches) {
      Object.keys(cache).forEach(k => delete cache[k])
    }
    try {
      dbInstance.close()
      getLogger().info('Database', '数据库连接已关闭')
    } catch (error) {
      getLogger().error('Database', `关闭数据库连接失败: ${error.message}`)
    }
    dbInstance = null
  }
}

/**
 * 获取当前数据目录路径（数据库文件所在目录）
 * @returns {string} 当前数据目录绝对路径
 */
function getDataPath () {
  return path.dirname(currentDbPath)
}

/**
 * 获取当前数据库文件完整路径
 * @returns {string} 当前数据库文件绝对路径
 */
function getDbFilePath () {
  return currentDbPath
}

/**
 * 获取默认数据目录路径
 * @returns {string} 默认数据目录绝对路径
 */
function getDefaultDataPath () {
  return DEFAULT_DATA_DIR
}

/**
 * 获取默认数据库的连接（用于读写 data_path 配置）
 *
 * 关键设计：data_path 配置必须始终写入默认数据库，
 * 因为 getDb() 启动时只从默认数据库读取该配置。
 * 若写入当前数据库（可能是自定义数据库），重启后默认数据库读不到配置，
 * 会导致数据目录重置为默认。
 *
 * @returns {{db: Database, shouldClose: boolean}} 数据库实例及是否需要关闭
 */
function getDefaultDbConnection () {
  // 若当前就是默认数据库，直接复用单例
  const isCurrentDefault = dbInstance &&
    path.resolve(currentDbPath) === path.resolve(DEFAULT_DB_PATH)
  if (isCurrentDefault) {
    return { db: dbInstance, shouldClose: false }
  }
  // 否则临时打开默认数据库
  ensureDir(path.dirname(DEFAULT_DB_PATH))
  return { db: openDatabase(DEFAULT_DB_PATH), shouldClose: true }
}

/**
 * 确保 app_settings 表存在（默认数据库可能未执行迁移）
 * @param {Database} db better-sqlite3 实例
 */
function ensureAppSettingsTable (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
}

/**
 * 保存自定义数据目录路径到 app_settings 表
 * 注意：此方法仅保存配置，实际切换需重启应用生效
 *
 * 重要：配置始终写入**默认数据库**，而非当前数据库。
 * 因为 getDb() 启动时先打开默认数据库并从中读取 data_path 配置。
 * 若写入当前数据库（可能是自定义数据库A），重启后默认数据库读不到配置，
 * 会重置为默认目录。
 *
 * @param {string} dirPath 自定义数据目录路径，传入 null/空字符串则清除配置恢复默认
 * @returns {boolean} 是否保存成功
 */
function setDataPath (dirPath) {
  let conn = null
  try {
    // 验证目录可写（仅在有自定义路径时）
    if (dirPath && String(dirPath).trim() !== '') {
      const normalizedPath = path.resolve(dirPath)
      ensureDir(normalizedPath)
      const tmpFile = path.join(normalizedPath, `.starst-desk-write-test-${Date.now()}`)
      fs.writeFileSync(tmpFile, 'test', 'utf-8')
      fs.unlinkSync(tmpFile)
    }

    // 始终操作默认数据库
    conn = getDefaultDbConnection()
    const db = conn.db
    ensureAppSettingsTable(db)

    if (!dirPath || String(dirPath).trim() === '') {
      // 清除配置，恢复默认
      db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(DATA_PATH_KEY)
      writeDataPathToConfigFile(null)
      getLogger().info('Database', '已清除自定义数据目录配置，将恢复默认路径')
      return true
    }

    // 规范化路径并写入配置（UPSERT）
    const normalizedPath = path.resolve(dirPath)
    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(DATA_PATH_KEY, normalizedPath, now)

    // 同时写入独立配置文件（防止默认数据库被删除时配置丢失）
    writeDataPathToConfigFile(normalizedPath)

    getLogger().info('Database', `已保存自定义数据目录配置: ${normalizedPath}`)

    // 验证写入是否真的持久化到默认数据库
    const verify = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(DATA_PATH_KEY)
    getLogger().info('Database', `验证写入结果: data_path = ${verify ? verify.value : '(未找到!)'}`)

    return true
  } catch (error) {
    getLogger().error('Database', `保存自定义数据目录配置失败: ${error.message}`)
    return false
  } finally {
    if (conn && conn.shouldClose) {
      try { conn.db.close() } catch (e) { /* 忽略关闭失败 */ }
    }
  }
}

/**
 * 读取已配置的自定义数据目录路径
 * 始终从默认数据库读取（与 setDataPath 写入位置一致）
 * @returns {string|null} 自定义路径，未配置返回 null
 */
function getCustomDataPath () {
  let conn = null
  try {
    conn = getDefaultDbConnection()
    // 先从默认数据库读
    let result = readDataPathFromDb(conn.db)
    // 读不到时从独立配置文件读（默认数据库可能被删除/重建）
    if (!result) {
      result = readDataPathFromConfigFile()
    }
    return result
  } catch (error) {
    getLogger().error('Database', `读取自定义数据目录配置失败: ${error.message}`)
    return null
  } finally {
    if (conn && conn.shouldClose) {
      try { conn.db.close() } catch (e) { /* 忽略关闭失败 */ }
    }
  }
}

module.exports = {
  getDb,
  closeDb,
  registerStmtCache,
  getDataPath,
  getDbFilePath,
  getDefaultDataPath,
  setDataPath,
  getCustomDataPath
}
