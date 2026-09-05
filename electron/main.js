// ============================================================
// Starst Desk 主进程入口
// 职责：创建 BrowserWindow、加载渲染进程、管理应用生命周期
// 运行环境：Node.js（CommonJS），可访问 better-sqlite3、fs、child_process 等 Node API
// ============================================================

const { app, shell, powerMonitor, ipcMain } = require('electron')
const path = require('path')
const os = require('os')

// 开发环境开启 CDP 远程调试端口，供 chrome-devtools-mcp 连接
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// 统一 Electron userData 路径到 %APPDATA%\StarstDesk（与数据库默认目录一致）
// package.json name 为 "starst-desk"，导致 app.getPath('userData') 默认为 %APPDATA%\starst-desk
// 此处修正为 %APPDATA%\StarstDesk，使所有运行时文件统一存放，便于管理
app.setPath('userData', path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'StarstDesk'
))

// ============================================================
// 导入核心服务模块
// ============================================================
const { getDb, closeDb } = require('./dao/database.js')
const { runMigrations } = require('./core/migration.js')
const logger = require('./core/logger.js')
const windowManager = require('./core/window-manager.js')
const trayManager = require('./core/tray-manager.js')
const autoStart = require('./core/auto-start.js')
const notificationService = require('./core/notification-service.js')
const scheduler = require('./core/scheduler.js')
const healthScheduler = require('./modules/health-scheduler.js')

// 桌面小部件模块
const widgetWindowManager = require('./core/widget-window-manager.js')
const widgetHotkey = require('./core/widget-hotkey.js')

// 小部件集成模块：显示区域监听 / Windows 兼容性 / 应用生命周期恢复
const { DisplayAreaWatcher } = require('./utils/display-area-watcher.js')
const windowsCompatibility = require('./utils/windows-compatibility.js')
const { AppLifecycleRecoveryWatcher } = require('./utils/app-lifecycle-recovery.js')

// 桌宠模块
const petWindowManager = require('./core/pet-window-manager.js')
// 桌宠键盘敲击监听模块（科技球等形象的键盘反馈）
const petKeyWatcher = require('./core/pet-key-watcher.js')

// 灵动岛模块
const islandWindowManager = require('./core/island-window-manager.js')

// 活动检测模块
const activityMonitor = require('./core/activity-monitor.js')

// 定时缓存清理模块
const scheduledCacheCleaner = require('./modules/cache-cleaner.js')
const cacheService = require('./services/cache-service.js')

// 系统指标采集模块
const { startMetricsCollector, stopMetricsCollector } = require('./core/system-metrics-collector.js')

// 截图选区窗口模块
const selectionWindowManager = require('./core/selection-window.js')


// JumpList 服务（Windows 任务栏跳转列表）
const jumpListService = require('./core/jump-list-service.js')

// 专注会话服务
const { registerFocusSessionChannels } = require('./services/focus-service.js')
registerFocusSessionChannels()

// 标签服务
const { registerTagsChannels } = require('./services/tags-service.js')
registerTagsChannels()

// 待办&规划增强模块 IPC 通道注册
const { registerGroupChannels } = require('./services/group-service.js')
const { registerProjectChannels } = require('./services/project-service.js')
const { registerAchievementChannels } = require('./services/achievement-service.js')
const { registerAiPlanChannels } = require('./services/ai-plan-service.js')
registerGroupChannels()
registerProjectChannels()
registerAchievementChannels()
registerAiPlanChannels()

// 导入 IPC 通道注册（会自动调用 register() 注册所有处理器）
require('./ipc/note-channels.js')
require('./ipc/task-channels.js')
require('./ipc/health-channels.js')
require('./ipc/ai-channels.js')
require('./ipc/chat-channels.js')
require('./ipc/system-channels.js')
require('./ipc/widget-channels.js')
require('./ipc/widget-group-channels.js')
require('./ipc/file-channels.js')
// 新模块需要在 require 后调用注册函数
const { registerTodoIpcChannels } = require('./ipc/todo-channels.js')
const { registerWeatherIpcChannels } = require('./ipc/weather-channels.js')
const { registerMusicIpcChannels } = require('./ipc/music-channels.js')
const { registerDesktopOrganizationIpcChannels } = require('./ipc/desktop-organization-channels.js')
registerTodoIpcChannels()
registerWeatherIpcChannels()
registerMusicIpcChannels()
registerDesktopOrganizationIpcChannels()
require('./ipc/pet-channels.js')
require('./ipc/chat-attachment-channels.js')
require('./ipc/agnes-media-channels.js')
require('./ipc/media-channels.js')
require('./ipc/screenshot-channels.js')
require('./ipc/activity-channels.js')

// app:navigate - 小部件窗口请求主窗口导航到指定路由
const { register: registerNav, success: successNav } = require('./ipc/registry.js')
registerNav('app:navigate', async (event, data) => {
  const mainWin = windowManager.getMainWindow()
  if (mainWin && !mainWin.isDestroyed()) {
    windowManager.showMainWindow()
    mainWin.webContents.send('app:navigate', { path: data.path, query: data.query })
  }
  return successNav({ navigated: true })
})
require('./ipc/media-asset-channels.js')
// 新增：全局搜索、应用更新、发布说明
require('./ipc/search-channels.js')
require('./ipc/update-channels.js')
require('./ipc/release-notes-channels.js')

// ============================================================
// 灵动岛操作回传：处理健康提醒确认/跳过等用户操作
// ============================================================
const healthRecordDao = require('./dao/health-record-dao.js')

ipcMain.on('island:action', (event, data) => {
  if (!data || !data.moduleType) return
  const { moduleType, action } = data
  const now = new Date()
  const recordDate = now.toISOString().slice(0, 10)
  const recordTime = now.toTimeString().slice(0, 8)
  const completed = action?.value === 'completed' || action?.value === 'done'
  const isTimeout = action?.value === 'timeout'
  // 喝水便捷记录：action.value === 'water-record'，action.amount 为饮水量 ml
  const isWaterRecord = action?.value === 'water-record'
  // 饮食便捷记录：action.value === 'diet-record'，action.mealType 为餐次
  const isDietRecord = action?.value === 'diet-record'
  let content
  if (isWaterRecord) {
    content = `饮水 ${action.amount || 0}ml（灵动岛快速记录）`
  } else if (isDietRecord) {
    const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '下午茶/宵夜' }
    const mealName = mealNames[action.mealType] || '饮食'
    content = action.content
      ? `${mealName}：${action.content}（灵动岛）`
      : `${mealName} 已记录（灵动岛）`
  } else if (completed) {
    content = '已完成（灵动岛确认）'
  } else if (isTimeout) {
    content = '未执行（超时未响应）'
  } else {
    content = '稍后提醒'
  }
  try {
    healthRecordDao.record({
      module_type: moduleType,
      record_date: recordDate,
      record_time: recordTime,
      // 喝水记录 value 为饮水量 ml，饮食记录 value 为 1（已吃），其他 0/1
      value: isWaterRecord ? (action.amount || 0) : (isDietRecord ? 1 : (completed ? 1 : 0)),
      content
    })
    logger.info('Main', `灵动岛健康提醒已记录: [${moduleType}] ${isWaterRecord ? `饮水${action.amount}ml` : (isDietRecord ? '饮食记录' : (completed ? '完成' : (isTimeout ? '未执行' : '跳过')))}`)
  } catch (err) {
    logger.error('Main', `灵动岛健康提醒记录失败: ${err.message}`)
  }
  // 用户确认完成后，通知桌宠解除提醒状态（气泡+REMINDING状态）
  if (completed) {
    try {
      const petWin = petWindowManager.getPetWindow()
      if (petWin && !petWin.isDestroyed()) {
        petWin.webContents.send('pet:force-dismiss-reminder', { moduleType })
      } else {
        logger.warn('Main', '桌宠窗口不可用，无法解除提醒状态')
      }
    } catch (e) {
      logger.error('Main', `解除桌宠提醒失败: ${e.message}`)
    }
  }
  // 用户操作完成后隐藏灵动岛窗口（任务型卡片不自动隐藏，需主动关闭）
  try {
    islandWindowManager.hideIsland()
  } catch (e) {
    // 忽略
  }
})

// 渲染进程主动请求隐藏灵动岛窗口（如用户点击关闭按钮、队列清空）
ipcMain.on('island:hide', () => {
  try {
    islandWindowManager.hideIsland()
  } catch (e) {
    // 忽略
  }
})

// ============================================================
// 单实例锁：确保同一时间只有一个应用实例运行
// 第二次启动时聚焦到已有窗口，而非启动新实例
// ============================================================
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 已有实例在运行，当前实例立即退出
  logger.info('Main', '检测到应用已在运行，当前实例退出')
  app.quit()
} else {
  // 监听第二次实例启动事件：显示并聚焦已有窗口
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    logger.info('Main', '检测到第二次启动请求，聚焦已有窗口')
    const win = windowManager.getMainWindow()
    if (win && !win.isDestroyed()) {
      // 如果窗口被隐藏（最小化到托盘），先显示
      if (win.isMinimized() || !win.isVisible()) {
        win.show()
        win.focus()
      } else {
        win.focus()
      }
    }
  })
}

// 主窗口实例引用
let mainWindow = null

// 新模块全局实例：显示区域监听器 / 应用生命周期恢复监听器
let displayAreaWatcher = null
let lifecycleRecoveryWatcher = null

/**
 * 初始化数据库并执行迁移
 */
function initDatabase () {
  try {
    const db = getDb()
    runMigrations(db, path.join(__dirname, '..', 'migrations'))
    logger.info('Main', '数据库初始化完成')
    return true
  } catch (error) {
    logger.error('Main', `数据库初始化失败: ${error.message}`)
    return false
  }
}

/**
 * 创建主窗口
 * @param {Object} options 窗口选项
 */
function createMainWindow (options = {}) {
  mainWindow = windowManager.createMainWindow(options)

  // 窗口关闭时清空引用
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

/**
 * 初始化系统托盘
 * 注册回调：显示主窗口、打开设置、小部件管理
 */
function initTray () {
  trayManager.init({
    // 显示主窗口（若已可见则聚焦，否则显示）
    showMainWindow: () => {
      const win = windowManager.getMainWindow()
      if (win && !win.isDestroyed()) {
        if (win.isVisible()) {
          win.focus()
        } else {
          win.show()
        }
      } else {
        // 主窗口不存在则重新创建
        createMainWindow()
      }
    },
    // 打开设置页面（显示窗口并跳转到设置页）
    openSettings: () => {
      windowManager.showMainWindow()
      const win = windowManager.getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('app:navigate', { path: '/settings' })
      }
    },
    // 显示所有小部件
    showAllWidgets: () => widgetWindowManager.showAllWidgets(),
    // 隐藏所有小部件
    hideAllWidgets: () => widgetWindowManager.hideAllWidgets(),
    // 切换所有小部件显隐
    toggleAllWidgets: () => widgetWindowManager.toggleAllWidgets(),
    // 重置所有小部件（位置、尺寸、胶囊状态、锁定状态）
    resetAllWidgets: () => widgetWindowManager.resetAllWidgets(),
    // 获取小部件状态列表（用于托盘子菜单显示 ✓/✗）
    getWidgetStates: () => {
      try {
        const widgetDao = require('./dao/widget-dao.js')
        const widgetRegistry = require('./core/widget-registry.js')
        const widgets = widgetDao.list()
        return widgets.map(w => {
          const def = widgetRegistry.getDefinition(w.widget_type)
          return {
            widgetType: w.widget_type,
            title: def ? def.title : w.widget_type,
            isEnabled: !!w.is_enabled
          }
        })
      } catch (error) {
        logger.error('Main', `获取小部件状态失败: ${error.message}`)
        return []
      }
    },
    // 切换小部件启用状态
    toggleWidgetEnabled: (widgetType) => {
      try {
        const widgetDao = require('./dao/widget-dao.js')
        const widget = widgetDao.getByType(widgetType)
        if (!widget) return
        if (widget.is_enabled) {
          // 当前启用 → 禁用：销毁窗口并更新状态
          widgetWindowManager.destroyWidgetWindow(widgetType)
          widgetDao.setEnabled(widgetType, false)
        } else {
          // 当前禁用 → 启用：更新状态并创建窗口
          widgetDao.setEnabled(widgetType, true)
          widgetWindowManager.createWidgetWindow(widgetType)
        }
      } catch (error) {
        logger.error('Main', `切换小部件 ${widgetType} 启用状态失败: ${error.message}`)
      }
    },
    // 查询边缘唤起是否启用
    isEdgeHoverEnabled: () => widgetWindowManager.isEdgeHoverEnabled(),
    // 切换边缘唤起开关
    toggleEdgeHover: () => {
      const enabled = widgetWindowManager.isEdgeHoverEnabled()
      widgetWindowManager.setEdgeHoverEnabled(!enabled)
    },
    // 桌宠显隐控制
    showPet: () => petWindowManager.showPet(),
    hidePet: () => petWindowManager.hidePet(),
    togglePet: () => petWindowManager.togglePet(),
    // 查询桌宠是否可见：基于窗口实际可见性，而非配置中的 enabled 字段
    // 这样 tray 菜单的"隐藏/显示桌宠"标签能正确反映当前状态
    isPetEnabled: () => {
      const win = petWindowManager.getPetWindow()
      return !!(win && !win.isDestroyed() && win.isVisible())
    }
  })
}

/**
 * 处理 --autostart 启动参数：自启动时最小化到托盘
 */
function handleAutostart () {
  if (autoStart.isAutostartMode()) {
    logger.info('Main', '检测到 --autostart 参数，窗口将最小化到托盘')
    // 延迟显示，等待窗口创建完成
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.hide()
      }
    }, 1000)
  }
}

// ============================================================
// 新模块初始化：Windows 兼容性检测 / 显示区域监听 / 生命周期恢复
// ============================================================

/**
 * 检测 Windows 兼容性并注入到小部件窗口管理器
 * 启动时执行一次，缓存 OS 能力（材质支持/动画策略等）
 */
function initWindowsCompatibility () {
  try {
    const compatInfo = {
      osBuild: windowsCompatibility.osBuild(),
      isWindows11OrLater: windowsCompatibility.isWindows11OrLater(),
      supportsMica: windowsCompatibility.supportsMica(),
      supportsDesktopAcrylic: windowsCompatibility.supportsDesktopAcrylic(),
      supportsWin11DwmAttributes: windowsCompatibility.supportsWin11DwmAttributes(),
      supportsNativeWindowCorners: windowsCompatibility.supportsNativeWindowCorners(),
      shouldAnimate: windowsCompatibility.shouldAnimate(),
      isHighContrast: windowsCompatibility.isHighContrast()
    }
    widgetWindowManager.setWindowsCompatInfo(compatInfo)
    logger.info('Main', `Windows 兼容性检测: build=${compatInfo.osBuild} ` +
      `win11=${compatInfo.isWindows11OrLater} mica=${compatInfo.supportsMica} ` +
      `acrylic=${compatInfo.supportsDesktopAcrylic} animate=${compatInfo.shouldAnimate}`)
  } catch (error) {
    logger.error('Main', `Windows 兼容性检测失败: ${error.message}`)
  }
}

/**
 * 初始化显示区域监听器
 * 监听显示器数量/拓扑变化，触发小部件窗口位置恢复
 */
function initDisplayAreaWatcher () {
  try {
    displayAreaWatcher = new DisplayAreaWatcher()
    displayAreaWatcher.on('displaysChanged', () => {
      logger.info('Main', '检测到显示器拓扑变化，通知小部件窗口管理器')
      widgetWindowManager.handleDisplaysChanged()
    })
    displayAreaWatcher.start()
    logger.info('Main', '显示区域监听器已启动')
  } catch (error) {
    logger.error('Main', `显示区域监听器初始化失败: ${error.message}`)
    displayAreaWatcher = null
  }
}

/**
 * 初始化应用生命周期恢复监听器
 * 监听 powerMonitor 的 resume/unlock-screen 等事件，触发小部件窗口状态恢复
 */
function initLifecycleRecoveryWatcher () {
  try {
    lifecycleRecoveryWatcher = new AppLifecycleRecoveryWatcher({
      recoveryAction: (reasons) => {
        logger.info('Main', `生命周期恢复触发（原因: ${reasons}），通知小部件窗口管理器`)
        widgetWindowManager.handleLifecycleRecovery(reasons)
      }
    })
    lifecycleRecoveryWatcher.start()
    logger.info('Main', '生命周期恢复监听器已启动')
  } catch (error) {
    logger.error('Main', `生命周期恢复监听器初始化失败: ${error.message}`)
    lifecycleRecoveryWatcher = null
  }
}

// ============================================================
// 睡眠时间自动记录（子需求6 + 子需求7.2）
// 监听 powerMonitor 的 suspend/resume/lock-screen/unlock-screen 事件
// suspend 时记录睡眠开始时间到数据库
// resume 时记录起床时间到数据库
// 子需求7.2： additionally 记录应用启动（开机/首次启动）和退出（关机）时间
//   - 应用启动 → 记录起床时间（value=2）
//   - 应用退出 → 记录入睡时间（value=1）
// ============================================================

/**
 * 记录睡眠事件到数据库（封装，避免重复代码）
 * @param {number} value - 1=入睡, 2=起床
 * @param {string} content - 记录描述
 */
function recordSleepEvent (value, content) {
  try {
    const dayjs = require('dayjs')
    const healthRecordDao = require('./dao/health-record-dao.js')
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
    const today = dayjs().format('YYYY-MM-DD')
    healthRecordDao.record({
      module_type: 'sleep',
      record_date: today,
      record_time: now,
      value,
      content
    })
    logger.info('Main', `睡眠记录已写入: ${content} @ ${now}`)
  } catch (error) {
    logger.error('Main', `记录睡眠事件失败: ${error.message}`)
  }
}

/**
 * 初始化睡眠自动记录
 * 监听系统挂起（suspend）和恢复（resume）事件
 * suspend → 记录入睡时间（value=1）
 * resume → 记录起床时间（value=2）
 * 子需求7.2：应用启动时记录起床时间（视为开机/起床信号）
 */
function initSleepAutoRecord () {
  try {
    // 子需求7.2：应用启动时记录起床时间（视为开机/起床信号）
    recordSleepEvent(2, '自动记录起床（应用启动）')

    // 监听系统挂起（睡眠/休眠）
    powerMonitor.on('suspend', () => {
      logger.info('Main', '检测到系统挂起，自动记录入睡时间')
      recordSleepEvent(1, '自动记录入睡（系统挂起）')
    })

    // 监听系统恢复（唤醒）
    powerMonitor.on('resume', () => {
      logger.info('Main', '检测到系统恢复，自动记录起床时间')
      recordSleepEvent(2, '自动记录起床（系统恢复）')
    })

    // 监听屏幕锁定/解锁（作为睡眠记录的补充信号）
    // lock-screen → 记录入睡时间（用户可能离开电脑）
    // unlock-screen → 记录起床时间（用户回到电脑）
    powerMonitor.on('lock-screen', () => {
      logger.info('Main', '检测到屏幕锁定，自动记录入睡时间')
      recordSleepEvent(1, '自动记录入睡（屏幕锁定）')
    })

    powerMonitor.on('unlock-screen', () => {
      logger.info('Main', '检测到屏幕解锁，自动记录起床时间')
      recordSleepEvent(2, '自动记录起床（屏幕解锁）')
    })

    logger.info('Main', '睡眠自动记录已初始化（监听 suspend/resume/lock-screen/unlock-screen + 应用启动起床信号）')
  } catch (error) {
    logger.error('Main', `睡眠自动记录初始化失败: ${error.message}`)
  }
}

// ============================================================
// 应用生命周期事件处理
// ============================================================

app.whenReady().then(() => {
  // 0. 启动早期清理磁盘缓存（此时 Chromium 尚未占用缓存文件句柄，能真正删除）
  //    仅当距上次清理已超过定时间隔（默认 24 小时）时才执行，
  //    避免每次启动都清空缓存导致 Chromium 缓存永远无法命中（HTTP/JS 编译/GPU 着色器缓存失效）
  try {
    if (cacheService.shouldClear()) {
      const r = cacheService.cleanupDiskCache()
      cacheService.updateLastClearTime()
      if (r.clearedMB > 0) {
        logger.info('Main', `启动早期清理磁盘缓存完成，释放约 ${r.clearedMB} MB`)
      }
    }
  } catch (e) {
    logger.warn('Main', `启动早期清理磁盘缓存失败: ${e.message}`)
  }

  // 1. 初始化数据库
  initDatabase()

  // 2. 创建主窗口
  createMainWindow()

  // 3. 初始化系统托盘
  initTray()

  // 4. 处理自启动参数
  handleAutostart()

  // 5. 启动调度器（处理错过的任务后按需启动定时扫描）
  scheduler.handleMissedTasks()
  scheduler.syncRunningState()

  // 6. 启动健康提醒调度器（按需启动：有启用模块才定时扫描）
  healthScheduler.syncRunningState()

  // 6.5 初始化新模块：Windows 兼容性检测 / 表面注册表 / 显示区域监听 / 生命周期恢复
  //   这些模块需在小部件窗口创建之前初始化，确保 createWidgetWindow 时可用
  try {
    initWindowsCompatibility()
    widgetWindowManager.initSurfaceRegistry()
    initDisplayAreaWatcher()
    initLifecycleRecoveryWatcher()
  } catch (error) {
    logger.error('Main', `新模块初始化失败: ${error.message}`)
  }

  // 7. 初始化桌面小部件：创建已启用的小部件窗口并注册全局热键
  try {
    widgetWindowManager.initAllWidgets()
    widgetHotkey.init()
  } catch (error) {
    logger.error('Main', `桌面小部件初始化失败: ${error.message}`)
  }

  // 8. 初始化桌宠：根据 pet_enabled 配置决定是否创建窗口
  try {
    petWindowManager.init()
  } catch (error) {
    logger.error('Main', `桌宠初始化失败: ${error.message}`)
  }

  // 8.5 初始化灵动岛：注册 IPC 通道，窗口默认隐藏
  try {
    islandWindowManager.init()
  } catch (error) {
    logger.error('Main', `灵动岛初始化失败: ${error.message}`)
  }

  // 9. 启动活动检测服务：空闲检测、键鼠统计、前台窗口采样
  //    仅在用户未关闭活动追踪时启动（默认开启）
  try {
    const appSettingDao = require('./dao/app-setting-dao.js')
    if (appSettingDao.getBool('activity_tracking_enabled', true)) {
      activityMonitor.start()
    }
  } catch (error) {
    logger.error('Main', `活动检测服务启动失败: ${error.message}`)
  }

  // 9.5 启动桌宠键盘敲击监听：全局按键分类 → 推送到桌宠窗口做敲击反馈
  //     仅在桌宠已启用时启动，避免禁用时空转 25ms 轮询
  try {
    if (petWindowManager.getConfig().enabled) {
      petKeyWatcher.start()
    }
  } catch (error) {
    logger.error('Main', `键盘敲击监听启动失败: ${error.message}`)
  }

  // 10. 启动定时缓存清理调度器
  try {
    scheduledCacheCleaner.start()
  } catch (error) {
    logger.error('Main', `定时缓存清理启动失败: ${error.message}`)
  }

  // 11. 初始化睡眠自动记录：监听 powerMonitor suspend/resume 事件（子需求6）
  try {
    initSleepAutoRecord()
  } catch (error) {
    logger.error('Main', `睡眠自动记录初始化失败: ${error.message}`)
  }

  // 12. 设置 Windows 任务栏跳转列表（JumpList）
  try {
    jumpListService.setupJumpList()
  } catch (error) {
    logger.error('Main', `JumpList 设置失败: ${error.message}`)
  }

  // 13. 处理 JumpList 启动参数：从任务栏跳转列表启动时跳转到对应页面
  try {
    const targetPath = jumpListService.parseJumpListArgs(process.argv)
    if (targetPath && mainWindow) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app:navigate', { path: targetPath })
        }
      }, 1000)
    }
  } catch (error) {
    logger.error('Main', `JumpList 参数解析失败: ${error.message}`)
  }

  // 14. 启动系统指标采集器：仅当系统监控小部件启用时才轮询CPU/内存/磁盘
  //     避免未启用小部件时无谓的 5 秒周期采集开销
  try {
    const widgetDao = require('./dao/widget-dao.js')
    const sysMonitorWidget = widgetDao.getByType('system-monitor')
    if (sysMonitorWidget && Number(sysMonitorWidget.is_enabled) === 1) {
      startMetricsCollector()
    } else {
      logger.info('Main', '系统监控小部件未启用，跳过系统指标采集器')
    }
  } catch (error) {
    logger.error('Main', `系统指标采集器启动失败: ${error.message}`)
  }

  // 15. 注册选区窗口 IPC 通道
  try {
    selectionWindowManager.setMainWindow(mainWindow)
    selectionWindowManager.registerSelectionChannels()
    logger.info('Main', '选区窗口通道已注册')
  } catch (error) {
    logger.error('Main', `选区窗口通道注册失败: ${error.message}`)
  }


  logger.info('Main', '应用启动完成')

  // macOS 下点击 dock 图标时，若没有窗口则重新创建
  app.on('activate', () => {
    if (windowManager.getMainWindow() === null) {
      createMainWindow()
    }
  })
})

// 所有窗口关闭事件处理
// Windows/Linux：不退出应用，保持托盘运行
// macOS：保持应用活跃（符合 macOS 习惯）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 不直接 quit，让托盘保持运行
    logger.info('Main', '所有窗口已关闭，应用保持在托盘运行')
  }
})

// 应用退出前清理资源
app.on('before-quit', () => {
  logger.info('Main', '应用正在退出，清理资源...')

  // 子需求7.2：应用退出时记录入睡时间（视为关机/入睡信号）
  recordSleepEvent(1, '自动记录入睡（应用退出）')

  scheduler.stop()
  healthScheduler.stop()
  // 停止定时缓存清理
  try {
    scheduledCacheCleaner.stop()
  } catch (error) {
    logger.error('Main', `定时缓存清理停止失败: ${error.message}`)
  }
  // 退出时清理磁盘缓存（Chromium 释放句柄后，能删除运行时被占用的目录）
  try {
    const r = cacheService.cleanupDiskCache()
    if (r.clearedMB > 0) {
      logger.info('Main', `退出时清理磁盘缓存完成，释放约 ${r.clearedMB} MB`)
    }
  } catch (e) {
    logger.warn('Main', `退出时清理磁盘缓存失败: ${e.message}`)
  }
  // 停止活动检测服务，落库最后一段数据
  try {
    activityMonitor.stop()
  } catch (error) {
    logger.error('Main', `活动检测服务停止失败: ${error.message}`)
  }
  // 停止系统指标采集器
  try {
    stopMetricsCollector()
  } catch (error) {
    logger.error('Main', `系统指标采集器停止失败: ${error.message}`)
  }
  // 停止桌宠键盘敲击监听
  try {
    petKeyWatcher.stop()
  } catch (error) {
    logger.error('Main', `键盘敲击监听停止失败: ${error.message}`)
  }
  // 停止专注护盾
  try {
    require('./core/focus-guard.js').stopGuard()
  } catch (error) {
    logger.error('Main', `专注护盾停止失败: ${error.message}`)
  }
  // 标记应用即将退出，跳过小部件窗口 close 拦截
  widgetWindowManager.setAppWillQuit(true)
  windowManager.setAppWillQuit(true)
  // 标记应用即将退出，跳过桌宠窗口 close 拦截
  petWindowManager.setAppWillQuit(true)
  // 标记应用即将退出，跳过灵动岛窗口 close 拦截
  islandWindowManager.setAppWillQuit(true)
  // 销毁所有小部件窗口
  widgetWindowManager.destroyAllWidgets()
  // 销毁桌宠窗口
  petWindowManager.destroyPetWindow()
  // 销毁灵动岛窗口
  islandWindowManager.destroyIslandWindow()
  // 销毁选区窗口
  selectionWindowManager.destroySelectionWindow()
  // 销毁新模块监听器（显示区域监听 / 生命周期恢复）
  try {
    if (displayAreaWatcher) {
      displayAreaWatcher.dispose()
      displayAreaWatcher = null
    }
  } catch (error) {
    logger.error('Main', `显示区域监听器销毁失败: ${error.message}`)
  }
  try {
    if (lifecycleRecoveryWatcher) {
      lifecycleRecoveryWatcher.dispose()
      lifecycleRecoveryWatcher = null
    }
  } catch (error) {
    logger.error('Main', `生命周期恢复监听器销毁失败: ${error.message}`)
  }
  trayManager.destroy()
  closeDb()
})

// 捕获未捕获异常，避免应用崩溃无提示
process.on('uncaughtException', (error) => {
  logger.error('Main', `未捕获异常: ${error.message}`)
  logger.error('Main', error.stack)
})

process.on('unhandledRejection', (reason) => {
  logger.error('Main', `未处理的 Promise 拒绝: ${reason}`)
})

// 导出主窗口获取方法，供后续模块使用
module.exports = {
  getMainWindow: () => windowManager.getMainWindow(),
  createMainWindow,
  notificationService,
  trayManager
}
