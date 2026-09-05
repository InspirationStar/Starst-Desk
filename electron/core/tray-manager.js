// ============================================================
// 系统托盘管理服务
// 创建托盘图标、注册右键菜单、实现图标闪烁（用于提醒）
// 点击托盘图标唤起主窗口
// 右键菜单包含：显示主窗口、小部件管理、设置、退出
// 集成托盘切换决策策略、请求队列、动画中断协调器、批量动画驱动
// ============================================================

const { Tray, Menu, nativeImage, app } = require('electron')
const path = require('path')
const logger = require('./logger.js')
const appSettingDao = require('./../dao/app-setting-dao.js')
const trayToggleDecisionPolicy = require('./tray-toggle-decision-policy.js')
const trayToggleRequestQueueFactory = require('./tray-toggle-request-queue.js')
const trayAnimationInterruptionCoordinator = require('./tray-animation-interruption-coordinator.js')
const batchAnimationDriverFactory = require('./widget-tray-batch-animation-driver.js')

let tray = null
let blinkInterval = null
let isBlinking = false

// 托盘切换请求队列：串行化点击切换，按奇偶性折叠突发请求
let toggleQueue = null
// 批量动画驱动：批量显示/隐藏所有小部件
let batchAnimationDriver = null
// 已注册的动画控制器列表（用于中断协调）
const registeredAnimationControllers = []

// 托盘点击行为配置键名：是否在点击托盘时显示主界面
const TRAY_CLICK_SHOW_MAIN_KEY = 'tray_click_show_main'
// 默认值：点击托盘时显示主界面
const DEFAULT_TRAY_CLICK_SHOW_MAIN = true

// 外部回调函数引用
let callbacks = {
  showMainWindow: null,
  openSettings: null,
  // 桌面小部件相关回调
  showAllWidgets: null,
  hideAllWidgets: null,
  toggleAllWidgets: null,
  resetAllWidgets: null,    // 重置所有小部件（位置、尺寸、胶囊状态、锁定状态）
  getWidgetStates: null,    // 返回 [{ widgetType, title, isEnabled }]
  toggleWidgetEnabled: null, // (widgetType) => 切换启用状态
  // 桌宠相关回调
  showPet: null,
  hidePet: null,
  togglePet: null,
  isPetEnabled: null         // () => boolean 桌宠是否启用
}

/**
 * 查询"点击托盘时显示主界面"是否启用
 * 从 app_settings 读取，默认 true
 * @returns {boolean}
 */
function isTrayClickShowMain () {
  try {
    const value = appSettingDao.get(TRAY_CLICK_SHOW_MAIN_KEY)
    if (value === null || value === undefined) return DEFAULT_TRAY_CLICK_SHOW_MAIN
    return value !== 'false' && value !== false
  } catch (e) {
    return DEFAULT_TRAY_CLICK_SHOW_MAIN
  }
}

/**
 * 设置"点击托盘时显示主界面"开关
 * @param {boolean} enabled
 */
function setTrayClickShowMain (enabled) {
  try {
    appSettingDao.set(TRAY_CLICK_SHOW_MAIN_KEY, enabled ? 'true' : 'false')
  } catch (e) {
    logger.warn('TrayManager', `持久化托盘点击设置失败: ${e.message}`)
  }
}

/**
 * 构建小部件管理子菜单
 * 每种小部件一个菜单项，前面显示 ✓/✗ 表示启用状态
 * @returns {object[]|null} 子菜单模板，无小部件状态时返回 null
 */
function buildWidgetSubmenu () {
  if (!callbacks.getWidgetStates) return null
  let states = []
  try {
    states = callbacks.getWidgetStates() || []
  } catch (error) {
    logger.warn('TrayManager', `获取小部件状态失败: ${error.message}`)
    return null
  }
  if (states.length === 0) return null

  return states.map(state => ({
    label: `${state.isEnabled ? '✓' : '✗'} ${state.title}`,
    click: () => {
      if (callbacks.toggleWidgetEnabled) {
        callbacks.toggleWidgetEnabled(state.widgetType)
        // 切换后刷新菜单，更新勾选状态
        refreshContextMenu()
      }
    }
  }))
}

/**
 * 构建托盘右键菜单
 * @returns {Menu} Electron Menu 实例
 */
function buildContextMenu () {
  const widgetSubmenu = buildWidgetSubmenu()

  const template = [
    {
      label: '显示主窗口',
      click: () => {
        if (callbacks.showMainWindow) callbacks.showMainWindow()
      }
    },
    { type: 'separator' },
    {
      label: '显示所有小部件',
      click: () => {
        if (callbacks.showAllWidgets) callbacks.showAllWidgets()
      }
    },
    {
      label: '隐藏所有小部件',
      click: () => {
        if (callbacks.hideAllWidgets) callbacks.hideAllWidgets()
      }
    },
    {
      label: '重置所有小部件',
      click: () => {
        if (callbacks.resetAllWidgets) callbacks.resetAllWidgets()
      }
    }
  ]

  // 添加小部件管理子菜单（仅当有小部件状态时）
  if (widgetSubmenu && widgetSubmenu.length > 0) {
    template.push({
      label: '小部件管理',
      submenu: widgetSubmenu
    })
  }


  // 桌宠管理：显示/隐藏切换（放在小部件管理之后、设置之前）
  // 根据桌宠是否启用来决定菜单项标签
  let petEnabled = false
  if (callbacks.isPetEnabled) {
    try {
      petEnabled = !!callbacks.isPetEnabled()
    } catch (e) {
      logger.warn('TrayManager', `查询桌宠启用状态失败: ${e.message}`)
    }
  }
  template.push({ type: 'separator' })
  template.push({
    label: petEnabled ? '隐藏桌宠' : '显示桌宠',
    click: () => {
      if (callbacks.togglePet) {
        try {
          callbacks.togglePet()
          // 切换后刷新菜单，更新标签
          refreshContextMenu()
        } catch (e) {
          logger.warn('TrayManager', `切换桌宠显隐失败: ${e.message}`)
        }
      }
    }
  })

  // 添加"点击托盘显示主界面"开关菜单项
  template.push({
    label: `${isTrayClickShowMain() ? '✓' : '✗'} 点击托盘显示主界面`,
    click: () => {
      const newVal = !isTrayClickShowMain()
      setTrayClickShowMain(newVal)
      // 切换后刷新菜单，更新勾选状态
      refreshContextMenu()
    }
  })

  template.push(
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        if (callbacks.openSettings) callbacks.openSettings()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  )

  return Menu.buildFromTemplate(template)
}

/**
 * 刷新托盘右键菜单（模式切换后调用，更新勾选状态）
 */
function refreshContextMenu () {
  if (tray) {
    tray.setContextMenu(buildContextMenu())
  }
}

/**
 * 初始化系统托盘
 * @param {Object} cbs 回调函数集合
 * @param {Function} cbs.showMainWindow 显示主窗口的回调

 * @param {Function} [cbs.openSettings] 打开设置页面的回调
 * @param {Function} [cbs.showAllWidgets] 显示所有小部件的回调
 * @param {Function} [cbs.hideAllWidgets] 隐藏所有小部件的回调
 * @param {Function} [cbs.toggleAllWidgets] 切换所有小部件显隐的回调
 * @param {Function} [cbs.resetAllWidgets] 重置所有小部件的回调（位置、尺寸、胶囊状态、锁定状态）
 * @param {Function} [cbs.getWidgetStates] 获取小部件状态列表的回调，返回 [{ widgetType, title, isEnabled }]
 * @param {Function} [cbs.toggleWidgetEnabled] 切换小部件启用状态的回调，参数为 widgetType
 * @param {Function} [cbs.showPet] 显示桌宠的回调
 * @param {Function} [cbs.hidePet] 隐藏桌宠的回调
 * @param {Function} [cbs.togglePet] 切换桌宠显隐的回调
 * @param {Function} [cbs.isPetEnabled] 查询桌宠是否启用的回调，返回 boolean

 */
function init (cbs = {}) {
  // 兼容旧调用方式：init(showMainWindow)
  if (typeof cbs === 'function') {
    callbacks.showMainWindow = cbs
  } else {
    callbacks = { ...callbacks, ...cbs }
  }

  // 尝试加载托盘图标，如果不存在则使用默认图标
  const iconPath = path.join(__dirname, '..', '..', 'resources', 'tray-icon.png')
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      throw new Error('图标加载失败')
    }
  } catch (error) {
    logger.warn('TrayManager', `托盘图标加载失败，使用默认图标: ${error.message}`)
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Starst Desk')

  // 设置右键菜单
  tray.setContextMenu(buildContextMenu())

  // 初始化托盘切换请求队列：串行化点击切换，按奇偶性折叠突发请求
  if (!toggleQueue) {
    toggleQueue = trayToggleRequestQueueFactory.createTrayToggleRequestQueue(async (source) => {
      logger.debug('TrayManager', `toggleQueue processing source=${source}`)
      // 取消并恢复所有进行中的动画
      trayAnimationInterruptionCoordinator.cancelAndRestore(
        registeredAnimationControllers,
        (controller) => controller.stopAndRestoreWindowPosition(),
        (controller, error) => logger.warn('TrayManager', `cancel animation failed: ${error && error.message}`)
      )
      // 执行切换
      if (callbacks.toggleAllWidgets) {
        await callbacks.toggleAllWidgets()
      }
    })
  }

  // 初始化批量动画驱动
  if (!batchAnimationDriver) {
    batchAnimationDriver = batchAnimationDriverFactory.createWidgetTrayBatchAnimationDriver(
      (msg) => logger.debug('TrayManager', msg)
    )
  }

  // 点击托盘图标：根据设置决定是否显示主界面，并切换所有小部件显隐
  tray.on('click', () => {
    // 先检查设置：是否同时显示主界面
    if (isTrayClickShowMain() && callbacks.showMainWindow) {
      try {
        callbacks.showMainWindow()
      } catch (e) {
        logger.warn('TrayManager', `显示主窗口失败: ${e.message}`)
      }
    }
    // 通过切换请求队列串行化切换，避免快速点击造成动画积压
    if (toggleQueue) {
      toggleQueue.enqueueAsync('tray-click').catch(error => {
        logger.warn('TrayManager', `enqueue toggle failed: ${error && error.message}`)
      })
    } else if (callbacks.toggleAllWidgets) {
      // 回退：直接切换
      try {
        callbacks.toggleAllWidgets()
      } catch (e) {
        logger.warn('TrayManager', `切换小部件显隐失败: ${e.message}`)
      }
    }
  })

  logger.info('TrayManager', '系统托盘已初始化')
}

/**
 * 开始托盘图标闪烁（用于提醒）
 * 每 500ms 在默认图标与提醒图标间切换
 */
function startBlink () {
  if (isBlinking || !tray) return

  isBlinking = true
  const blinkPath = path.join(__dirname, '..', '..', 'resources', 'tray-icon-alert.png')
  let normalIcon, alertIcon

  try {
    normalIcon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'resources', 'tray-icon.png'))
    alertIcon = nativeImage.createFromPath(blinkPath)
    if (normalIcon.isEmpty()) normalIcon = nativeImage.createEmpty()
    if (alertIcon.isEmpty()) alertIcon = nativeImage.createEmpty()
  } catch {
    normalIcon = nativeImage.createEmpty()
    alertIcon = nativeImage.createEmpty()
  }

  let showingAlert = false
  blinkInterval = setInterval(() => {
    if (!tray) {
      stopBlink()
      return
    }
    showingAlert = !showingAlert
    tray.setImage(showingAlert ? alertIcon : normalIcon)
  }, 500)

  logger.info('TrayManager', '托盘图标开始闪烁')
}

/**
 * 停止托盘图标闪烁，恢复默认图标
 */
function stopBlink () {
  if (!isBlinking) return
  isBlinking = false

  if (blinkInterval) {
    clearInterval(blinkInterval)
    blinkInterval = null
  }

  if (tray) {
    try {
      const iconPath = path.join(__dirname, '..', '..', 'resources', 'tray-icon.png')
      const icon = nativeImage.createFromPath(iconPath)
      tray.setImage(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    } catch {
      tray.setImage(nativeImage.createEmpty())
    }
  }

  logger.info('TrayManager', '托盘图标闪烁已停止')
}

/**
 * 销毁托盘
 */
function destroy () {
  stopBlink()
  // 取消批量动画
  if (batchAnimationDriver) {
    try {
      batchAnimationDriver.cancel()
    } catch (e) {
      logger.warn('TrayManager', `cancel batch animation failed: ${e.message}`)
    }
  }
  if (tray) {
    tray.destroy()
    tray = null
    logger.info('TrayManager', '托盘已销毁')
  }
}

/**
 * 注册动画控制器，便于中断协调器在切换时统一取消
 * @param {Object} controller 动画控制器
 */
function registerAnimationController (controller) {
  if (controller && !registeredAnimationControllers.includes(controller)) {
    registeredAnimationControllers.push(controller)
  }
}

/**
 * 注销动画控制器
 * @param {Object} controller 动画控制器
 */
function unregisterAnimationController (controller) {
  const index = registeredAnimationControllers.indexOf(controller)
  if (index >= 0) {
    registeredAnimationControllers.splice(index, 1)
  }
}

/**
 * 评估托盘切换决策：是否应当隐藏
 * @param {boolean} isRaisedSession 是否处于已抬升会话
 * @param {boolean} hasVisibleWidgets 是否存在可见小部件
 * @param {boolean} isForegroundLocal 是否前台本地
 * @returns {boolean}
 */
function evaluateToggleDecision (isRaisedSession, hasVisibleWidgets, isForegroundLocal) {
  const context = trayToggleDecisionPolicy.createDecisionContext(
    isRaisedSession, hasVisibleWidgets, isForegroundLocal
  )
  return trayToggleDecisionPolicy.shouldHide(context)
}

/**
 * 获取切换队列快照
 * @returns {Object|null}
 */
function getToggleQueueSnapshot () {
  return toggleQueue ? toggleQueue.getSnapshot() : null
}

/**
 * 获取批量动画驱动
 * @returns {Object|null}
 */
function getBatchAnimationDriver () {
  return batchAnimationDriver
}

module.exports = {
  init,
  startBlink,
  stopBlink,
  destroy,
  refreshContextMenu,
  // 托盘点击行为配置
  isTrayClickShowMain,
  setTrayClickShowMain,
  // 托盘动画集成
  registerAnimationController,
  unregisterAnimationController,
  evaluateToggleDecision,
  getToggleQueueSnapshot,
  getBatchAnimationDriver
}
