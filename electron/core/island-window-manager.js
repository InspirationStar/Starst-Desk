// ============================================================
// 灵动岛窗口管理器
// 管理灵动岛 BrowserWindow（独立于主窗口，从屏幕顶部居中向下弹出）
// 作为统一的"应用提醒"渠道，取代应用内弹窗和独立提醒窗口
// 窗口属性：无边框、透明、置顶、不在任务栏显示、不抢夺焦点
// 单例模式：窗口懒加载（init 时不创建，首次 show 时按需创建），默认隐藏
// 自动隐藏：默认 5 秒后自动隐藏，专注模式下持续显示
// 外观配置：缩放/透明度/锚点/偏移/层级/显示时长，存储于 app_settings 表
// ============================================================

const { BrowserWindow, screen, ipcMain } = require('electron')
const path = require('path')
const logger = require('./logger.js')
const appSettingDao = require('./../dao/app-setting-dao.js')

// 灵动岛窗口实例（单例）
let islandWindow = null

// 自动隐藏定时器
let autoHideTimer = null

// 当前是否处于专注模式（专注模式下不自动隐藏）
let focusModeActive = false

// 当前外观配置（从 app_settings 加载，应用启动时初始化）
let currentPreferences = null

// 窗口尺寸（基准值，实际尺寸 = 基准 × 缩放比例）
// 窗口 transparent:true，只有卡片区域可见，高度设大以容纳多卡片堆叠
const WINDOW_WIDTH = 400
const WINDOW_HEIGHT = 600
const MIN_HEIGHT = 140
const MAX_HEIGHT = 600

// 距屏幕顶部边距（像素，作为默认垂直偏移）
const MARGIN_TOP = 8

// 默认自动隐藏时长（毫秒）
const DEFAULT_AUTO_HIDE_MS = 5000

// app_settings 表中存储灵动岛配置的 key
const SETTING_KEY = 'island_preferences'

// 灵动岛外观配置默认值
const DEFAULT_PREFERENCES = {
  islandScale: 1.0,                    // 缩放比例 (0.8-1.5)
  islandOpacity: 1.0,                  // 透明度 (0.5-1.0)
  islandAnchor: 'top_center',          // 锚点位置 (top_center/top_left/top_right)
  islandOffsetX: 0,                    // 水平偏移 (px)
  islandOffsetY: MARGIN_TOP,           // 垂直偏移 (px)
  islandLayer: 'top',                  // 层级 (top/normal)
  islandDuration: DEFAULT_AUTO_HIDE_MS // 自动隐藏时长 (ms)，0=不自动隐藏
}

// ============================================================
// 工具方法
// ============================================================

/**
 * 应用是否处于开发环境
 */
function isDev () {
  return process.env.NODE_ENV === 'development'
}

/**
 * 限制缩放比例在有效范围
 * @param {number} scale
 * @returns {number}
 */
function clampScale (scale) {
  const n = Number(scale)
  if (!Number.isFinite(n)) return 1.0
  return Math.min(1.5, Math.max(0.8, n))
}

/**
 * 限制透明度在有效范围
 * @param {number} opacity
 * @returns {number}
 */
function clampOpacity (opacity) {
  const n = Number(opacity)
  if (!Number.isFinite(n)) return 1.0
  return Math.min(1.0, Math.max(0.5, n))
}

/**
 * 计算窗口位置：根据锚点 + 偏移 + 缩放
 * top_center: 水平居中 + offsetX，垂直距顶部 offsetY
 * top_left:   左侧 + offsetX，垂直距顶部 offsetY
 * top_right:  右侧 - offsetX，垂直距顶部 offsetY
 * @param {Object} [prefs] 外观配置，缺省使用 currentPreferences
 * @returns {{ x: number, y: number }}
 */
function calculatePosition (prefs) {
  const p = prefs || currentPreferences || DEFAULT_PREFERENCES
  const scale = clampScale(p.islandScale)
  const width = Math.round(WINDOW_WIDTH * scale)
  const offsetX = Number.isFinite(p.islandOffsetX) ? p.islandOffsetX : 0
  const offsetY = Number.isFinite(p.islandOffsetY) ? p.islandOffsetY : MARGIN_TOP
  try {
    const workArea = screen.getPrimaryDisplay().workArea
    let x
    switch (p.islandAnchor) {
      case 'top_left':
        x = workArea.x + offsetX
        break
      case 'top_right':
        x = workArea.x + workArea.width - width - offsetX
        break
      case 'top_center':
      default:
        x = workArea.x + Math.round((workArea.width - width) / 2) + offsetX
        break
    }
    const y = workArea.y + offsetY
    return { x, y }
  } catch (e) {
    // 查询失败回退到屏幕顶部居中
    return { x: 100, y: MARGIN_TOP }
  }
}

/**
 * 设置 CSP 策略（复用主窗口逻辑）
 * @param {BrowserWindow} win
 */
function setupCSP (win) {
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    // connect-src：开发环境允许 localhost:*（Vite HMR），生产环境仅允许 'self'
    const connectSrc = isDev()
      ? "'self' http://localhost:*"
      : "'self'"
    const headers = {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "worker-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https://cos-platform-outputs.agnes-ai.cn https://platform-outputs.agnes-ai.space; " +
        "media-src 'self' data: https://cos-platform-outputs.agnes-ai.cn https://platform-outputs.agnes-ai.space; " +
        "connect-src " + connectSrc + " https://cos-platform-outputs.agnes-ai.cn https://platform-outputs.agnes-ai.space; " +
        "font-src 'self' data:;"
      ]
    }
    // 开发模式下禁用缓存，确保每次加载都是最新代码
    if (isDev()) {
      headers['Cache-Control'] = ['no-cache', 'no-store', 'must-revalidate']
      headers['Pragma'] = ['no-cache']
      headers['Expires'] = ['0']
    }
    callback({ responseHeaders: headers })
  })
}

// ============================================================
// 外观配置加载 / 应用
// ============================================================

/**
 * 规范化配置：合并默认值、限制范围、修正类型
 * @param {Object} [prefs]
 * @returns {Object}
 */
function normalizePreferences (prefs) {
  const base = { ...DEFAULT_PREFERENCES }
  if (!prefs || typeof prefs !== 'object') return base
  // 缩放
  base.islandScale = clampScale(prefs.islandScale)
  // 透明度
  base.islandOpacity = clampOpacity(prefs.islandOpacity)
  // 锚点
  const anchor = prefs.islandAnchor
  base.islandAnchor = ['top_center', 'top_left', 'top_right'].includes(anchor)
    ? anchor
    : 'top_center'
  // 偏移
  base.islandOffsetX = Number.isFinite(prefs.islandOffsetX) ? Math.round(prefs.islandOffsetX) : 0
  base.islandOffsetY = Number.isFinite(prefs.islandOffsetY) ? Math.round(prefs.islandOffsetY) : MARGIN_TOP
  // 层级
  base.islandLayer = prefs.islandLayer === 'normal' ? 'normal' : 'top'
  // 显示时长
  const dur = Number(prefs.islandDuration)
  base.islandDuration = Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : DEFAULT_AUTO_HIDE_MS
  return base
}

/**
 * 从 app_settings 表加载灵动岛外观配置
 * 合并默认值，确保所有字段存在且类型合法
 * @returns {Object} 规范化后的配置
 */
function loadPreferences () {
  try {
    const saved = appSettingDao.getJson(SETTING_KEY, null)
    currentPreferences = normalizePreferences(saved)
    logger.info('IslandWindowManager', `已加载灵动岛配置: ${JSON.stringify(currentPreferences)}`)
    return currentPreferences
  } catch (e) {
    logger.error('IslandWindowManager', `加载灵动岛配置失败: ${e.message}`)
    currentPreferences = { ...DEFAULT_PREFERENCES }
    return currentPreferences
  }
}

/**
 * 应用配置到指定窗口
 * - 缩放：调整窗口大小 (WINDOW_WIDTH * scale, WINDOW_HEIGHT * scale)
 * - 透明度：setOpacity
 * - 锚点+偏移：重新计算窗口位置
 * - 层级：setAlwaysOnTop
 * @param {BrowserWindow} win
 * @param {Object} [prefs] 配置，缺省使用 currentPreferences
 */
function applyPreferences (win, prefs) {
  if (!win || win.isDestroyed()) return
  const p = prefs || currentPreferences || DEFAULT_PREFERENCES
  try {
    const scale = clampScale(p.islandScale)
    const width = Math.round(WINDOW_WIDTH * scale)
    const height = Math.round(WINDOW_HEIGHT * scale)
    const position = calculatePosition(p)
    // 调整窗口大小与位置
    win.setBounds({
      x: position.x,
      y: position.y,
      width,
      height
    })
    // 透明度
    win.setOpacity(clampOpacity(p.islandOpacity))
    // 层级
    win.setAlwaysOnTop(p.islandLayer === 'top')
    logger.info('IslandWindowManager', `已应用灵动岛配置: scale=${scale} opacity=${p.islandOpacity} anchor=${p.islandAnchor} layer=${p.islandLayer}`)
  } catch (e) {
    logger.error('IslandWindowManager', `应用灵动岛配置失败: ${e.message}`)
  }
}

/**
 * 更新外观配置并实时应用到当前窗口
 * @param {Object} prefs 新配置（部分字段）
 * @returns {Object} 应用后的完整配置
 */
function updatePreferences (prefs) {
  const merged = normalizePreferences({
    ...(currentPreferences || DEFAULT_PREFERENCES),
    ...(prefs || {})
  })
  currentPreferences = merged
  // 持久化到 app_settings
  try {
    appSettingDao.setJson(SETTING_KEY, merged)
  } catch (e) {
    logger.error('IslandWindowManager', `保存灵动岛配置失败: ${e.message}`)
  }
  // 实时应用到当前窗口
  if (islandWindow && !islandWindow.isDestroyed()) {
    applyPreferences(islandWindow, merged)
  }
  logger.info('IslandWindowManager', `灵动岛配置已更新: ${JSON.stringify(merged)}`)
  return merged
}

/**
 * 获取当前生效的外观配置
 * @returns {Object}
 */
function getPreferences () {
  if (!currentPreferences) {
    loadPreferences()
  }
  return { ...(currentPreferences || DEFAULT_PREFERENCES) }
}

// ============================================================
// 窗口创建 / 销毁
// ============================================================

/**
 * 创建灵动岛窗口
 * 单例：已存在则先销毁旧窗口再创建
 * @returns {BrowserWindow|null}
 */
function createIslandWindow () {
  // 已存在则先销毁
  if (islandWindow) {
    destroyIslandWindow()
  }

  // 确保配置已加载
  if (!currentPreferences) {
    loadPreferences()
  }

  const prefs = currentPreferences
  const scale = clampScale(prefs.islandScale)
  const width = Math.round(WINDOW_WIDTH * scale)
  const height = Math.round(WINDOW_HEIGHT * scale)
  const position = calculatePosition(prefs)

  // 窗口配置：无边框、透明、置顶、不抢夺焦点
  // 关键：focusable: false 避免打断用户操作
  //   transparent: true 让窗口无背景，渲染层 CSS 自绘 Fluent Design 卡片
  //   hasShadow: false 避免透明窗口出现系统阴影（由 CSS 自绘阴影）
  const windowConfig = {
    x: position.x,
    y: position.y,
    width,
    height,
    minWidth: width,
    minHeight: Math.round(MIN_HEIGHT * scale),
    maxWidth: width,
    maxHeight: Math.round(MAX_HEIGHT * scale),
    frame: false,
    transparent: true,
    skipTaskbar: true,
    alwaysOnTop: prefs.islandLayer === 'top',
    resizable: false,
    focusable: false,
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true
    }
  }

  const win = new BrowserWindow(windowConfig)

  // 设置 CSP 策略（含开发模式禁用缓存）
  setupCSP(win)

  // 应用透明度（setOpacity 需创建后单独调用）
  try {
    win.setOpacity(clampOpacity(prefs.islandOpacity))
  } catch (e) {
    logger.warn('IslandWindowManager', `设置透明度失败: ${e.message}`)
  }

  // 加载入口：开发环境 loadURL，生产 loadFile
  if (isDev()) {
    win.loadURL('http://localhost:5173/island.html')
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'island.html'))
  }

  // 窗口销毁时清理引用
  win.on('closed', () => {
    islandWindow = null
  })

  // 初始隐藏：窗口默认不可见，收到 show 事件时才显示
  win.hide()

  islandWindow = win
  logger.info('IslandWindowManager', '灵动岛窗口已创建')
  return win
}

/**
 * 销毁灵动岛窗口
 */
function destroyIslandWindow () {
  if (!islandWindow) return
  // 清理自动隐藏定时器
  if (autoHideTimer) {
    clearTimeout(autoHideTimer)
    autoHideTimer = null
  }
  try {
    if (!islandWindow.isDestroyed()) {
      islandWindow.destroy()
    }
  } catch (error) {
    logger.error('IslandWindowManager', `销毁灵动岛窗口失败: ${error.message}`)
  }
  islandWindow = null
}

// ============================================================
// 显隐控制
// ============================================================

/**
 * 获取灵动岛窗口实例
 * @returns {BrowserWindow|null}
 */
function getIslandWindow () {
  return islandWindow
}

/**
 * 显示灵动岛窗口
 */
function showIslandWindow () {
  let win = islandWindow
  if (!win || win.isDestroyed()) {
    win = createIslandWindow()
  }
  if (!win || win.isDestroyed()) return
  try {
    // 显示前确保当前配置已应用
    applyPreferences(win)
    // 使用 showInactive 确保窗口显示但不抢夺焦点
    // focusable: false 的窗口在某些 Windows 版本上 win.show() 可能不生效
    win.showInactive()
    logger.info('IslandWindowManager', '灵动岛窗口已显示')
  } catch (e) {
    logger.error('IslandWindowManager', `显示灵动岛窗口失败: ${e.message}`)
  }
}

/**
 * 隐藏灵动岛窗口
 */
function hideIslandWindow () {
  if (!islandWindow || islandWindow.isDestroyed()) return
  try {
    islandWindow.hide()
    logger.info('IslandWindowManager', '灵动岛窗口已隐藏')
  } catch (e) {
    logger.error('IslandWindowManager', `隐藏灵动岛窗口失败: ${e.message}`)
  }
}

/**
 * 清除自动隐藏定时器
 */
function clearAutoHideTimer () {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer)
    autoHideTimer = null
  }
}

// 看门狗超时（毫秒）：5 分钟，仅在渲染进程崩溃时兜底
// 正常情况下由渲染进程队列清空后主动发 island:hide 隐藏窗口
const AUTO_HIDE_WATCHDOG_MS = 5 * 60 * 1000

/**
 * 设置看门狗定时器（安全网，防止渲染进程崩溃导致窗口永久可见）
 * 每次推送新通知时重置，正常情况下由渲染进程队列清空后主动发 island:hide 隐藏
 */
function scheduleAutoHideWatchdog () {
  clearAutoHideTimer()
  if (focusModeActive) return
  autoHideTimer = setTimeout(() => {
    hideIsland()
    autoHideTimer = null
  }, AUTO_HIDE_WATCHDOG_MS)
}

// ============================================================
// 业务接口
// ============================================================

/**
 * 向灵动岛推送通知
 * 窗口刚创建时 loadURL/loadFile 异步未完成，渲染进程尚未注册监听器
 * 此时直接 send 会丢消息。等 did-finish-load 后再发送，确保监听器已就绪
 * @param {Object} payload - 通知数据 { type, title, body, icon, duration, action }
 */
function showIsland (payload) {
  if (!islandWindow || islandWindow.isDestroyed()) {
    createIslandWindow()
  }
  if (!islandWindow || islandWindow.isDestroyed()) return
  try {
    const doSend = () => {
      if (!islandWindow || islandWindow.isDestroyed()) return
      islandWindow.webContents.send('island:show', payload)
      logger.info('IslandWindowManager', `已向灵动岛推送: ${payload?.title || ''}`)
    }
    if (islandWindow.webContents.isLoading()) {
      islandWindow.webContents.once('did-finish-load', doSend)
    } else {
      doSend()
    }
    // 显示窗口并设置看门狗兜底
    showIslandWindow()
    // 看门狗定时器：防止渲染进程崩溃导致窗口永久可见
    // 正常情况下由渲染进程队列清空后主动发 island:hide 隐藏
    scheduleAutoHideWatchdog()
  } catch (e) {
    logger.error('IslandWindowManager', `推送灵动岛通知失败: ${e.message}`)
  }
}

/**
 * 隐藏灵动岛通知
 * 向渲染进程发送 island:hide 事件，并隐藏窗口
 */
function hideIsland () {
  clearAutoHideTimer()
  if (!islandWindow || islandWindow.isDestroyed()) return
  try {
    if (!islandWindow.webContents.isLoading()) {
      islandWindow.webContents.send('island:hide')
    }
  } catch (e) {
    logger.warn('IslandWindowManager', `发送隐藏事件失败: ${e.message}`)
  }
  hideIslandWindow()
}

/**
 * 更新专注模式状态
 * 专注模式下灵动岛不自动隐藏，持续显示计时器
 * @param {Object} state - 专注状态 { active, taskName, remainingMs, totalMs }
 */
function updateFocusState (state) {
  if (!state || typeof state !== 'object') return
  // 更新专注模式标记
  focusModeActive = !!state.active

  if (!islandWindow || islandWindow.isDestroyed()) {
    // 首次进入专注模式时创建窗口
    if (focusModeActive) {
      createIslandWindow()
    } else {
      return
    }
  }
  if (!islandWindow || islandWindow.isDestroyed()) return

  try {
    const doSend = () => {
      if (!islandWindow || islandWindow.isDestroyed()) return
      islandWindow.webContents.send('island:focus-update', state)
    }
    if (islandWindow.webContents.isLoading()) {
      islandWindow.webContents.once('did-finish-load', doSend)
    } else {
      doSend()
    }

    // 专注模式激活时显示窗口并取消自动隐藏
    if (focusModeActive) {
      showIslandWindow()
      clearAutoHideTimer()
    } else {
      // 退出专注模式时隐藏窗口
      hideIslandWindow()
    }
  } catch (e) {
    logger.error('IslandWindowManager', `更新专注状态失败: ${e.message}`)
  }
}

/**
 * 初始化灵动岛窗口
 * 仅加载配置与注册 IPC 通道，窗口懒加载（首次 show 时按需创建）
 *   优化：用户未使用灵动岛期间，省去一个隐藏 BrowserWindow + 渲染进程的常驻内存
 *   安全性：showIsland / updateFocusState 已含 `if (!islandWindow) createIslandWindow()` 兜底
 *           其余接口（hideIsland / updatePreferences / getPreferences 等）均处理 null
 */
function init () {
  try {
    // 先加载保存的外观配置
    loadPreferences()
    // 注册 IPC 通道（由主进程显式调用 init 时注册，避免模块加载时自动注册）
    registerIpcChannels()
    logger.info('IslandWindowManager', '灵动岛已初始化（窗口懒加载，按需创建）')
  } catch (error) {
    logger.error('IslandWindowManager', `灵动岛初始化失败: ${error.message}`)
  }
}

/**
 * 设置应用即将退出标记
 * 当前灵动岛窗口使用 destroy 而非 hide 拦截，无需此标记
 * 保留接口以便未来扩展
 */
function setAppWillQuit () {
  // 当前无 close 拦截，无需处理
}

// ============================================================
// IPC 通道注册
// ============================================================

/**
 * 注册灵动岛相关 IPC 通道
 * - island:update-preferences：实时更新外观配置
 * - island:get-preferences：获取当前外观配置
 */
function registerIpcChannels () {
  // 实时更新灵动岛外观配置
  ipcMain.handle('island:update-preferences', async (event, data) => {
    try {
      const updated = updatePreferences(data || {})
      return { ok: true, data: updated }
    } catch (error) {
      logger.error('IslandWindowManager', `island:update-preferences 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 获取当前灵动岛外观配置
  ipcMain.handle('island:get-preferences', async (event, data) => {
    try {
      const prefs = getPreferences()
      return { ok: true, data: prefs }
    } catch (error) {
      logger.error('IslandWindowManager', `island:get-preferences 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  logger.info('IslandWindowManager', '灵动岛 IPC 通道已注册')
}


module.exports = {
  init,
  createIslandWindow,
  destroyIslandWindow,
  showIslandWindow,
  hideIslandWindow,
  showIsland,
  hideIsland,
  updateFocusState,
  getIslandWindow,
  setAppWillQuit,
  loadPreferences,
  applyPreferences,
  updatePreferences,
  getPreferences
}
