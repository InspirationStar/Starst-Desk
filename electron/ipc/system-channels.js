// ============================================================
// 系统设置 IPC 通道
// 注册 system:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const appSettingDao = require('./../dao/app-setting-dao.js')
const autoStart = require('./../core/auto-start.js')
const windowManager = require('./../core/window-manager.js')
const widgetWindowManager = require('./../core/widget-window-manager.js')
const petWindowManager = require('./../core/pet-window-manager.js')

const logger = require('./../core/logger.js')
const cacheService = require('./../services/cache-service.js')
const { app } = require('electron')

// 需要广播到所有窗口的设置键名
// 当这些键的值变化时，向主窗口、小部件窗口与桌宠窗口推送 app:setting-changed 事件
// 渲染进程据此同步应用外观（如主题、强调色）或桌宠气泡内容（如自定义名言、鼓励间隔）
const BROADCAST_SETTINGS = new Set([
  'theme',
  'accent_color',
  'layout_density',
  'animation_preset',
  'pet_encouragement_enabled',
  'pet_encouragement_interval',
  'pet_custom_quotes',
  'pet_bubble_font_size'
])

/**
 * 向主窗口、小部件窗口与桌宠窗口广播设置变化事件
 * @param {string} key 设置键名
 * @param {*} value 设置值
 */
function broadcastSettingChanged (key, value) {
  const payload = { key, value }
  // 主窗口
  try {
    const mainWin = windowManager.getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('app:setting-changed', payload)
    }
  } catch (e) { /* 忽略主窗口发送失败 */ }
  // 所有小部件窗口
  try {
    const widgetTypes = widgetWindowManager.getWidgetWindowTypes ? widgetWindowManager.getWidgetWindowTypes() : []
    for (const widgetType of widgetTypes) {
      const win = widgetWindowManager.getWidgetWindow(widgetType)
      if (win && !win.isDestroyed()) {
        win.webContents.send('app:setting-changed', payload)
      }
    }
  } catch (e) { /* 忽略小部件窗口发送失败 */ }
  // 桌宠窗口
  try {
    const petWin = petWindowManager.getPetWindow()
    if (petWin && !petWin.isDestroyed()) {
      petWin.webContents.send('app:setting-changed', payload)
    }
  } catch (e) { /* 忽略桌宠窗口发送失败 */ }
  logger.info('SystemChannels', `已广播设置变化: ${key}=${value}`)
}

// ============================================================
// system:setting:get
// ============================================================
register('system:setting:get', async (event, data) => {
  try {
    const value = appSettingDao.get(data.key)
    return success({ key: data.key, value })
  } catch (error) {
    logger.error('SystemChannels', `system:setting:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:setting:set
// ============================================================
register('system:setting:set', async (event, data) => {
  try {
    appSettingDao.set(data.key, data.value)
    // 外观相关设置变化时广播到所有窗口，通知渲染进程同步应用
    if (BROADCAST_SETTINGS.has(data.key)) {
      broadcastSettingChanged(data.key, data.value)
    }
    return success({ success: true })
  } catch (error) {
    logger.error('SystemChannels', `system:setting:set 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:autostart:get
// 返回 { enabled, devMode }
// - enabled: 当前自启状态
// - devMode: 是否开发模式（开发模式下自启动可能不生效）
// ============================================================
register('system:autostart:get', async (event, data) => {
  try {
    const enabled = autoStart.isEnabled()
    return success({ enabled, devMode: autoStart.isDevMode ? autoStart.isDevMode() : false })
  } catch (error) {
    logger.error('SystemChannels', `system:autostart:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:autostart:set
// ============================================================
register('system:autostart:set', async (event, data) => {
  try {
    autoStart.setEnabled(data.enabled)
    return success({ enabled: data.enabled })
  } catch (error) {
    logger.error('SystemChannels', `system:autostart:set 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:select-folder
// 弹出系统文件夹选择对话框，返回所选路径（用户取消返回 null）
// ============================================================
register('system:select-folder', async (event, data) => {
  try {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog({
      title: data?.title || '选择文件夹',
      defaultPath: data?.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return success({ path: null, cancelled: true })
    }
    return success({ path: result.filePaths[0], cancelled: false })
  } catch (error) {
    logger.error('SystemChannels', `system:select-folder 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:get-data-path
// 获取当前数据目录信息
// 返回 { currentPath, customPath, defaultPath, dbFilePath }
// - currentPath: 当前实际使用的数据目录
// - customPath: 已配置的自定义路径（未配置为 null）
// - defaultPath: 默认数据目录
// - dbFilePath: 当前数据库文件完整路径
// ============================================================
register('system:get-data-path', async (event, data) => {
  try {
    const database = require('./../dao/database.js')
    return success({
      currentPath: database.getDataPath(),
      customPath: database.getCustomDataPath(),
      defaultPath: database.getDefaultDataPath(),
      dbFilePath: database.getDbFilePath()
    })
  } catch (error) {
    logger.error('SystemChannels', `system:get-data-path 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:set-data-path
// 设置自定义数据目录路径（保存到 app_settings，并验证路径可写）
// 传入 { path: null } 或 { path: '' } 表示恢复默认
// 注意：此通道仅保存配置，实际切换需重启应用生效
// ============================================================
register('system:set-data-path', async (event, data) => {
  try {
    const database = require('./../dao/database.js')
    const targetPath = data?.path

    // 恢复默认：清除自定义路径配置
    if (!targetPath || String(targetPath).trim() === '') {
      const ok = database.setDataPath(null)
      if (!ok) {
        return failure('SAVE_FAILED', '清除自定义路径配置失败')
      }
      // 若当前不在默认目录，恢复默认后需重启生效
      const pathLib = require('path')
      const currentPath = database.getDataPath()
      const defaultPath = database.getDefaultDataPath()
      const needRestart = pathLib.resolve(currentPath) !== pathLib.resolve(defaultPath)
      return success({
        savedPath: null,
        defaultPath,
        needRestart,
        message: needRestart ? '已恢复默认数据目录，重启应用后生效' : '已是默认数据目录'
      })
    }

    // 验证路径非空且为字符串
    if (typeof targetPath !== 'string') {
      return failure('INVALID_PATH', '路径参数无效')
    }

    // 保存配置（内部会验证路径可写）
    const ok = database.setDataPath(targetPath)
    if (!ok) {
      return failure('SAVE_FAILED', '保存数据目录配置失败，请检查路径是否可写')
    }

    const fs = require('fs')
    const pathLib = require('path')
    const normalizedPath = pathLib.resolve(targetPath)
    const currentPath = database.getDataPath()
    // 若保存的路径与当前路径相同，无需重启
    const needRestart = pathLib.resolve(currentPath) !== normalizedPath

    return success({
      savedPath: normalizedPath,
      defaultPath: database.getDefaultDataPath(),
      needRestart,
      message: needRestart ? '数据目录已更改，重启应用后生效' : '数据目录未变化'
    })
  } catch (error) {
    logger.error('SystemChannels', `system:set-data-path 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:export
// 导出所有配置为 JSON 文件（不含加密密钥）
// ============================================================
register('system:export', async (event, data) => {
  try {
    const { dialog } = require('electron')
    const fs = require('fs')
    const path = require('path')

    const { savePath } = await dialog.showSaveDialog({
      title: '导出配置',
      defaultPath: path.join(require('os').homedir(), 'starst-desk-config.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (!savePath) return success({ cancelled: true })

    // 读取所有配置（不含加密密钥）
    const allSettings = appSettingDao.getAll()
    const exportData = {
      exported_at: new Date().toISOString(),
      settings: Object.fromEntries(allSettings),
      notes: [],
      tasks: [],
      health_configs: [],
      health_records: [],
      chat_sessions: [],
      chat_messages: []
      // 注意：ai_configs 中的 api_key_encrypted 不导出
    }

    fs.writeFileSync(savePath, JSON.stringify(exportData, null, 2), 'utf-8')
    return success({ path: savePath })
  } catch (error) {
    logger.error('SystemChannels', `system:export 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:import
// 从 JSON 文件导入配置（覆盖当前配置）
// ============================================================
register('system:import', async (event, data) => {
  try {
    const { dialog } = require('electron')
    const fs = require('fs')

    const result = await dialog.showOpenDialog({
      title: '导入配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return success({ cancelled: true })
    }

    const filePath = result.filePaths[0]
    const content = fs.readFileSync(filePath, 'utf-8')
    const importData = JSON.parse(content)

    if (!importData || typeof importData !== 'object') {
      return failure('INVALID_FORMAT', '配置文件格式无效')
    }

    // 导入 settings（键值对）
    let importedCount = 0
    if (importData.settings && typeof importData.settings === 'object') {
      for (const [key, value] of Object.entries(importData.settings)) {
        // 跳过可能的加密密钥
        if (key.includes('key') || key.includes('secret') || key.includes('password')) {
          continue
        }
        try {
          appSettingDao.set(key, value)
          importedCount++
        } catch (e) {
          logger.warn('SystemChannels', `导入设置 ${key} 失败: ${e.message}`)
        }
      }
    }

    logger.info('SystemChannels', `配置导入成功: ${filePath}, 导入 ${importedCount} 项设置`)
    return success({
      path: filePath,
      importedCount,
      importedAt: importData.exported_at
    })
  } catch (error) {
    logger.error('SystemChannels', `system:import 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:backup
// 完整数据备份（含便签/待办/任务/健康/会话等所有数据）
// ============================================================
register('system:backup', async (event, data) => {
  try {
    const { dialog } = require('electron')
    const fs = require('fs')
    const path = require('path')
    const dayjs = require('dayjs')

    const { savePath } = await dialog.showSaveDialog({
      title: '数据备份',
      defaultPath: path.join(require('os').homedir(), `starst-desk-backup-${dayjs().format('YYYYMMDD-HHmmss')}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (!savePath) return success({ cancelled: true })

    const backupData = {
      backup_at: new Date().toISOString(),
      version: '1.0',
      settings: Object.fromEntries(appSettingDao.getAll())
    }

    // 备份各数据表
    try { backupData.notes = require('./../dao/note-dao.js').list({ limit: 100000 }) } catch (e) { backupData.notes = [] }
    try {
      const todoDao = require('./../dao/todo-dao.js')
      const todos = todoDao.list({ limit: 100000 })
      backupData.todos = Array.isArray(todos) ? todos : (todos?.items || todos?.list || [])
    } catch (e) { backupData.todos = [] }
    try {
      const taskDao = require('./../dao/task-dao.js')
      const tasks = taskDao.list({})
      backupData.tasks = Array.isArray(tasks) ? tasks : (tasks?.items || tasks?.list || [])
    } catch (e) { backupData.tasks = [] }
    try { backupData.health_configs = require('./../dao/health-config-dao.js').list() } catch (e) { backupData.health_configs = [] }
    try { backupData.health_records = require('./../dao/health-record-dao.js').list({ limit: 100000 }) } catch (e) { backupData.health_records = [] }
    try { backupData.chat_sessions = require('./../dao/chat-session-dao.js').list() } catch (e) { backupData.chat_sessions = [] }
    try { backupData.ai_configs = require('./../dao/ai-config-dao.js').list() } catch (e) { backupData.ai_configs = [] }

    // 移除敏感字段
    if (Array.isArray(backupData.ai_configs)) {
      backupData.ai_configs = backupData.ai_configs.map(c => {
        const { api_key_encrypted, ...rest } = c
        return rest
      })
    }

    fs.writeFileSync(savePath, JSON.stringify(backupData, null, 2), 'utf-8')
    logger.info('SystemChannels', `数据备份成功: ${savePath}`)
    return success({ path: savePath, size: fs.statSync(savePath).size })
  } catch (error) {
    logger.error('SystemChannels', `system:backup 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:restore
// 从备份文件恢复数据
// ============================================================
register('system:restore', async (event, data) => {
  try {
    const { dialog } = require('electron')
    const fs = require('fs')

    const result = await dialog.showOpenDialog({
      title: '恢复数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return success({ cancelled: true })
    }

    const filePath = result.filePaths[0]
    const content = fs.readFileSync(filePath, 'utf-8')
    const backupData = JSON.parse(content)

    if (!backupData || typeof backupData !== 'object') {
      return failure('INVALID_FORMAT', '备份文件格式无效')
    }

    const stats = { settings: 0, notes: 0, todos: 0, tasks: 0 }

    // 恢复 settings
    if (backupData.settings && typeof backupData.settings === 'object') {
      for (const [key, value] of Object.entries(backupData.settings)) {
        if (key.includes('key') || key.includes('secret') || key.includes('password')) continue
        try {
          appSettingDao.set(key, value)
          stats.settings++
        } catch (e) { /* 忽略单项失败 */ }
      }
    }

    // 恢复便签
    if (Array.isArray(backupData.notes)) {
      const noteDao = require('./../dao/note-dao.js')
      for (const note of backupData.notes) {
        try {
          noteDao.create(note)
          stats.notes++
        } catch (e) {
          // 已存在则尝试更新
          try { noteDao.update(note); stats.notes++ } catch (_) { /* 忽略 */ }
        }
      }
    }

    // 恢复待办
    if (Array.isArray(backupData.todos)) {
      const todoDao = require('./../dao/todo-dao.js')
      for (const todo of backupData.todos) {
        try {
          todoDao.create(todo)
          stats.todos++
        } catch (e) {
          try { todoDao.update(todo); stats.todos++ } catch (_) { /* 忽略 */ }
        }
      }
    }

    // 恢复任务
    if (Array.isArray(backupData.tasks)) {
      const taskDao = require('./../dao/task-dao.js')
      for (const task of backupData.tasks) {
        try {
          taskDao.create(task)
          stats.tasks++
        } catch (e) {
          try { taskDao.update(task); stats.tasks++ } catch (_) { /* 忽略 */ }
        }
      }
    }

    logger.info('SystemChannels', `数据恢复成功: ${filePath}`, stats)
    return success({ path: filePath, restoredAt: backupData.backup_at, stats })
  } catch (error) {
    logger.error('SystemChannels', `system:restore 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:quit
// 退出应用（实际调用 app.quit()）
// ============================================================
register('system:quit', async (event, data) => {
  try {
    app.quit()
    return success({ success: true })
  } catch (error) {
    logger.error('SystemChannels', `system:quit 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:restart
// 重启应用（先退出当前实例，再重新启动）
// ============================================================
register('system:restart', async (event, data) => {
  try {
    app.relaunch()
    app.quit()
    return success({ success: true })
  } catch (error) {
    logger.error('SystemChannels', `system:restart 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:cache:stats
// 获取缓存统计信息
// ============================================================
register('system:cache:stats', async (event, data) => {
  try {
    const stats = cacheService.getCacheStats()
    return success(stats)
  } catch (error) {
    logger.error('SystemChannels', `system:cache:stats 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:cache:clear
// 清除缓存（type: 'all'|'browser'|'code'|'gpu'）
// ============================================================
register('system:cache:clear', async (event, data) => {
  try {
    const type = data?.type || 'all'
    const result = await cacheService.clearCache(type)
    cacheService.updateLastClearTime()

    // 清理后提示渲染进程刷新 session 缓存
    try {
      const win = windowManager.getMainWindow()
      if (win && !win.isDestroyed()) {
        // 重新加载主窗口以使 Chromium 重建缓存
        win.webContents.reloadIgnoringCache()
        logger.info('SystemChannels', '已触发主窗口重新加载（忽略缓存）')
      }
    } catch (e) {
      logger.warn('SystemChannels', `触发窗口重载失败: ${e.message}`)
    }

    return success(result)
  } catch (error) {
    logger.error('SystemChannels', `system:cache:clear 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:scheduled-clear:get
// 获取定时清理配置
// ============================================================
register('system:scheduled-clear:get', async (event, data) => {
  try {
    const intervalHours = cacheService.getScheduledClearInterval()
    const lastClearTime = cacheService.getLastClearTime()
    // 判断是否启用：配置键存在且值有效
    const rawVal = appSettingDao.get('scheduled_cache_clear_interval')
    const enabled = rawVal !== null && rawVal !== undefined
    return success({ enabled, intervalHours, lastClearTime })
  } catch (error) {
    logger.error('SystemChannels', `system:scheduled-clear:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:scheduled-clear:set
// 设置定时清理间隔（小时），传入 null 则禁用
// ============================================================
register('system:scheduled-clear:set', async (event, data) => {
  try {
    const { intervalHours } = data || {}
    if (intervalHours === null || intervalHours === undefined) {
      // 禁用定时清理
      appSettingDao.del('scheduled_cache_clear_interval')
      return success({ enabled: false })
    }
    const hours = parseInt(intervalHours, 10)
    if (isNaN(hours) || hours < 1 || hours > 168) {
      return failure('INVALID_INTERVAL', '间隔时间必须在 1-168 小时之间')
    }
    cacheService.setScheduledClearInterval(hours)
    return success({ enabled: true, intervalHours: hours })
  } catch (error) {
    logger.error('SystemChannels', `system:scheduled-clear:set 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================

// system:window:minimize
// 最小化窗口（无边框窗口自定义按钮使用）
// ============================================================
register('system:window:minimize', async (event, data) => {
  try {
    const win = windowManager.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.minimize()
      return success({ success: true })
    }
    return failure('NO_WINDOW', '主窗口不存在')
  } catch (error) {
    logger.error('SystemChannels', `system:window:minimize 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// system:window:close
// 关闭窗口（实际为隐藏到托盘，由 window-manager 的 close 拦截处理）
// ============================================================
register('system:window:close', async (event, data) => {
  try {
    const win = windowManager.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.close()
      return success({ success: true })
    }
    return failure('NO_WINDOW', '主窗口不存在')
  } catch (error) {
    logger.error('SystemChannels', `system:window:close 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// window:set-always-on-top
// 设置主窗口是否置顶（截图时临时置顶，确保 overlay 能捕获鼠标事件）
// ============================================================
register('window:set-always-on-top', async (event, data) => {
  try {
    const win = windowManager.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(!!data)
      return success({ success: true })
    }
    return failure('NO_WINDOW', '主窗口不存在')
  } catch (error) {
    logger.error('SystemChannels', `window:set-always-on-top 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}
