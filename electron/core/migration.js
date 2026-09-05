// ============================================================
// 数据库迁移服务 + 设置迁移服务
// 启动时读取 schema_version，扫描 migrations/ 目录中版本号
// 大于当前版本的脚本，按顺序在事务中执行
// ============================================================

const fs = require('fs')
const path = require('path')
const logger = require('./logger.js')

/**
 * 获取当前 schema 版本
 * @param {object} db - better-sqlite3 Database 实例
 * @returns {number} 当前版本号，首次为 0
 */
function getCurrentSchemaVersion (db) {
  try {
    const result = db.prepare("SELECT value FROM app_settings WHERE key = 'schema_version'").get()
    return result ? parseInt(result.value, 10) : 0
  } catch (error) {
    // 表不存在时返回 0（首次安装）
    logger.info('Migration', 'schema_version 表尚未初始化，返回 0')
    return 0
  }
}

/**
 * 更新 schema_version
 * @param {object} db - better-sqlite3 Database 实例
 * @param {number} version - 新版本号
 */
function setSchemaVersion (db, version) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('schema_version', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(version.toString())
}

/**
 * 扫描 migrations 目录，返回按版本号排序的 SQL 文件名列表
 * @param {string} migrationsDir - 迁移脚本目录绝对路径
 * @returns {string[]} 排序后的迁移文件名列表
 */
function getMigrationFiles (migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    logger.warn('Migration', `迁移脚本目录不存在: ${migrationsDir}`)
    return []
  }

  return fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort() // 按文件名字典序排序（保证版本号顺序）
}

/**
 * 从迁移文件名中提取版本号
 * 例如：001_initial.sql -> 1, 002_add_index.sql -> 2
 * @param {string} filename 迁移文件名
 * @returns {number} 版本号
 */
function parseMigrationVersion (filename) {
  const match = filename.match(/^(\d+)_/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * 执行单个迁移脚本
 * 在事务中执行，失败则回滚并记录日志
 * @param {object} db - better-sqlite3 Database 实例
 * @param {string} filePath - 迁移脚本绝对路径
 * @param {string} filename  - 迁移文件名（用于日志）
 */
function executeMigration (db, filePath, filename) {
  const version = parseMigrationVersion(filename)
  logger.info('Migration', `开始执行迁移: ${filename} (version=${version})`)

  const sql = fs.readFileSync(filePath, 'utf-8')

  // better-sqlite3 的事务 API
  // 在事务开始前强制开启延迟外键检查，支持表重建类迁移（DROP + RENAME）操作
  // 注意：PRAGMA defer_foreign_keys 必须在事务开始前设置，而非事务内部
  db.pragma('defer_foreign_keys = ON')
  const transaction = db.transaction(() => {
    db.exec(sql)
  })

  try {
    transaction()
    setSchemaVersion(db, version)
    logger.info('Migration', `迁移执行成功: ${filename}`)
  } catch (error) {
    logger.error('Migration', `迁移执行失败: ${filename}, 错误: ${error.message}`)
    throw error // 重新抛出，让上层处理
  }
}

/**
 * 执行所有待处理的迁移脚本
 * 这是 MigrationService 的主入口
 * @param {object} db - better-sqlite3 Database 实例
 * @param {string} migrationsDir - 迁移脚本目录绝对路径
 */
function runMigrations (db, migrationsDir) {
  try {
    const currentVersion = getCurrentSchemaVersion(db)
    const migrationFiles = getMigrationFiles(migrationsDir)

    const pendingMigrations = migrationFiles.filter(file => {
      const version = parseMigrationVersion(file)
      return version > currentVersion
    })

    if (pendingMigrations.length === 0) {
      logger.info('Migration', `当前已是最新版本 (schema_version=${currentVersion})，无需迁移`)
      return
    }

    logger.info('Migration', `发现 ${pendingMigrations.length} 个待执行迁移:`, pendingMigrations)

    for (const file of pendingMigrations) {
      const filePath = path.join(migrationsDir, file)
      executeMigration(db, filePath, file)
    }

    const latestVersion = getCurrentSchemaVersion(db)
    logger.info('Migration', `所有迁移执行完成，最新 schema_version=${latestVersion}`)
  } catch (error) {
    logger.error('Migration', `迁移执行失败: ${error.message}`)
    throw error
  }
}

// ============================================================
// 对 JSON 设置文件执行版本间迁移，处理遗留字段、修复兼容性问题
// ============================================================

const CURRENT_SETTINGS_SCHEMA_VERSION = 5

/**
 * 迁移 0→1：初始化遗留设置
 * 合并分散的遗留迁移逻辑（WidgetCompactSettingsVersion、遗留 WidgetCollapsedStyle 等）
 * @param {object} settings - 设置对象
 */
function migrateSettings0To1 (settings) {
  // 遗留迁移：确保 WidgetCompactSettingsVersion 至少为 1
  // 旧设置可能为 0，使用不同的紧凑布局
  if (settings.widgetCompactSettingsVersion === undefined ||
    settings.widgetCompactSettingsVersion < 1) {
    settings.widgetCompactSettingsVersion = 1
  }

  // 遗留迁移：规范化已废弃的 WidgetCollapsedStyle 值
  // 旧的 "Collapsed" 样式被替换为 "Click" 行为
  if (settings.widgetCollapseBehavior === 'Collapsed') {
    settings.widgetCollapseBehavior = 'Click'
  }

  // 确保各集合字段已初始化
  if (!settings.featureWidgetEnabledStates) {
    settings.featureWidgetEnabledStates = {}
  }
  if (!Array.isArray(settings.widgets)) {
    settings.widgets = []
  }
  // 旧设置没有分组
  if (!Array.isArray(settings.widgetGroups)) {
    settings.widgetGroups = []
  }
  if (!Array.isArray(settings.deletedWidgetIds)) {
    settings.deletedWidgetIds = []
  }
  if (!Array.isArray(settings.recentOrganizationHistory)) {
    settings.recentOrganizationHistory = []
  }
}

/**
 * 迁移 1→2：移除早期 Tabs 兼容迁移写入的隐式 wheel-off 覆盖
 * 导航跟随应用默认的组也应能跟随应用的滚轮设置
 * 显式导航样式和未来的每组选择保持不变
 * @param {object} settings - 设置对象
 */
function migrateSettings1To2 (settings) {
  if (!Array.isArray(settings.widgetGroups)) {
    settings.widgetGroups = []
  }
  for (const group of settings.widgetGroups) {
    if (normalizeNavigationStyle(group.navigationStyle, true) === 'FollowDefault' &&
      group.wheelSwitchEnabled === false) {
      group.wheelSwitchEnabled = null
    }
  }
}

/**
 * 迁移 2→3：修复从 Tabs 改为 FollowDefault 的组
 * 这些组可能保留了兼容性 wheel-off 值，尽管应用级滚轮设置已启用
 * @param {object} settings - 设置对象
 */
function migrateSettings2To3 (settings) {
  if (!Array.isArray(settings.widgetGroups)) {
    settings.widgetGroups = []
  }
  for (const group of settings.widgetGroups) {
    if (normalizeNavigationStyle(group.navigationStyle, true) === 'FollowDefault' &&
      group.wheelSwitchEnabled === false) {
      group.wheelSwitchEnabled = null
    }
  }
}

/**
 * 迁移 3→4：标记遗留默认文件 widget 体验为已解析
 * 现有配置文件不应仅因当前没有文件 widget 就收到新的默认 widget
 * @param {object} settings - 设置对象
 */
function migrateSettings3To4 (settings) {
  settings.hasResolvedInitialFileWidgetSetup = true
}

/**
 * 迁移 4→5：迁移遗留搜索结果限制
 * 之前被视为应用默认值的 50 现在迁移为 200
 * 未来的 50、100、200 选择是用户选择，由正常设置验证保留
 * @param {object} settings - 设置对象
 */
function migrateSettings4To5 (settings) {
  if (settings.searchMaxResults === 50) {
    settings.searchMaxResults = 200
  }
}

/**
 * 规范化导航样式名称
 * @param {string} style - 原始样式
 * @param {boolean} allowFollowDefault - 是否允许 FollowDefault
 * @returns {string} 规范化后的样式
 */
function normalizeNavigationStyle (style, allowFollowDefault) {
  if (!style || typeof style !== 'string') {
    return allowFollowDefault ? 'FollowDefault' : 'Tabs'
  }
  const lower = style.toLowerCase()
  if (lower === 'tabs') return 'Tabs'
  if (lower === 'stack') return 'Stack'
  if (lower === 'followdefault' || lower === 'follow-default') {
    return allowFollowDefault ? 'FollowDefault' : 'Tabs'
  }
  return allowFollowDefault ? 'FollowDefault' : 'Tabs'
}

// 设置迁移步骤注册表（按 FromVersion 排序）
const settingsMigrations = [
  { fromVersion: 0, migrate: migrateSettings0To1 },
  { fromVersion: 1, migrate: migrateSettings1To2 },
  { fromVersion: 2, migrate: migrateSettings2To3 },
  { fromVersion: 3, migrate: migrateSettings3To4 },
  { fromVersion: 4, migrate: migrateSettings4To5 }
]

/**
 * 运行设置迁移，将设置从当前架构版本升级到最新
 * @param {object} settings - 设置对象（会被原地修改）
 * @returns {boolean} 是否应用了任何迁移
 */
function runSettingsMigrations (settings) {
  if (!settings || typeof settings !== 'object') {
    return false
  }

  // 确保有 schemaVersion 字段
  if (typeof settings.schemaVersion !== 'number') {
    settings.schemaVersion = 0
  }

  if (settings.schemaVersion >= CURRENT_SETTINGS_SCHEMA_VERSION) {
    return false
  }

  let anyApplied = false
  let version = settings.schemaVersion

  for (const migration of settingsMigrations) {
    if (migration.fromVersion >= version &&
      migration.fromVersion < CURRENT_SETTINGS_SCHEMA_VERSION) {
      try {
        migration.migrate(settings)
        version = migration.fromVersion + 1
        anyApplied = true
        logger.info('SettingsMigration', `已应用迁移: 版本 ${migration.fromVersion} → ${version}`)
      } catch (e) {
        logger.error('SettingsMigration', `迁移 ${migration.fromVersion} 失败: ${e.message}`)
      }
    }
  }

  settings.schemaVersion = CURRENT_SETTINGS_SCHEMA_VERSION
  return anyApplied
}

/**
 * 从文件加载设置，执行迁移，写回文件
 * @param {string} settingsPath - settings.json 文件路径
 * @returns {{settings: object, migrated: boolean}} 设置对象和是否迁移
 */
function loadAndMigrateSettings (settingsPath) {
  if (!fs.existsSync(settingsPath)) {
    // 新配置文件，创建默认设置
    const defaultSettings = {
      schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      widgetCompactSettingsVersion: 1,
      widgetCollapseBehavior: 'Click',
      featureWidgetEnabledStates: {},
      widgets: [],
      widgetGroups: [],
      deletedWidgetIds: [],
      recentOrganizationHistory: [],
      hasResolvedInitialFileWidgetSetup: false,
      searchMaxResults: 200
    }
    saveSettings(settingsPath, defaultSettings)
    return { settings: defaultSettings, migrated: false }
  }

  let settings
  try {
    const json = fs.readFileSync(settingsPath, 'utf8')
    settings = JSON.parse(json)
  } catch (e) {
    logger.error('SettingsMigration', `读取设置文件失败: ${e.message}`)
    throw new Error(`设置文件无效: ${e.message}`)
  }

  const migrated = runSettingsMigrations(settings)
  if (migrated) {
    saveSettings(settingsPath, settings)
    logger.info('SettingsMigration', `设置已迁移到版本 ${CURRENT_SETTINGS_SCHEMA_VERSION}`)
  }

  return { settings, migrated }
}

/**
 * 原子写入设置文件
 * @param {string} settingsPath - 文件路径
 * @param {object} settings - 设置对象
 */
function saveSettings (settingsPath, settings) {
  const dir = path.dirname(settingsPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  // 原子写入：先写临时文件再重命名
  const tmpPath = `${settingsPath}.tmp`
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8')
    fs.renameSync(tmpPath, settingsPath)
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* 忽略清理失败 */ }
    throw e
  }
}

module.exports = {
  // 数据库迁移
  runMigrations,
  // 设置迁移
  runSettingsMigrations,
  loadAndMigrateSettings,
  saveSettings,
  currentSettingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION
}
