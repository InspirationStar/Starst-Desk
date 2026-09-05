// ============================================================
// 窗口管理服务
// 创建 BrowserWindow、拦截 close 事件（最小化到托盘）、
// 提供 show/hide/getMainWindow 方法
// 主窗口材质管理：原生 backgroundMaterial（Win11 22H2+）作用于标题栏非客户区
//   与小部件共享同一材质配置（widget_material），切换时主窗口与小部件同步
// ============================================================

const { BrowserWindow, shell, screen } = require('electron')
const os = require('os')
const path = require('path')
const logger = require('./logger.js')
const appSettingDao = require('./../dao/app-setting-dao.js')

let mainWindow = null
// 标记应用是否正在退出
let appWillQuit = false

// ============================================================
// 主窗口尺寸记忆（持久化 bounds：x, y, width, height）
// 启动时从 app_settings 读取上次保存的 bounds，resize/move 后防抖写回
// ============================================================
// 配置键名：存储在 app_settings 表
const MAIN_WINDOW_BOUNDS_KEY = 'main_window_bounds'
// 防抖保存延时（ms）：resize/move 结束后等待该时长再写库，避免频繁 IO
const BOUNDS_PERSIST_DEBOUNCE = 500
// 窗口完全出屏时的回退偏移（相对工作区左上角）
const FALLBACK_OFFSET = 80
// 防抖保存定时器引用
let boundsPersistTimer = null

/**
 * 数值夹取到 [min, max] 区间
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp (v, min, max) {
  return Math.min(Math.max(v, min), max)
}

/**
 * 读取持久化的主窗口 bounds
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
function getSavedBounds () {
  try {
    const bounds = appSettingDao.getJson(MAIN_WINDOW_BOUNDS_KEY, null)
    if (!bounds) return null
    // 基本字段校验
    if (
      typeof bounds.x !== 'number' ||
      typeof bounds.y !== 'number' ||
      typeof bounds.width !== 'number' ||
      typeof bounds.height !== 'number'
    ) {
      return null
    }
    return bounds
  } catch (e) {
    logger.warn('WindowManager', `读取主窗口持久化 bounds 失败: ${e.message}`)
    return null
  }
}

/**
 * 确保主窗口 bounds 在屏幕可见区域内（多显示器场景）
 * 中心点在某显示器工作区内：夹取 x/y 到工作区内
 * 中心点不在任何工作区（窗口完全出屏）：回退到默认尺寸居中
 * @param {{x:number,y:number,width:number,height:number}} bounds
 * @param {number} defaultWidth
 * @param {number} defaultHeight
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function ensureVisibleBounds (bounds, defaultWidth, defaultHeight) {
  try {
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    const centerInView =
      centerX >= workArea.x &&
      centerX <= workArea.x + workArea.width &&
      centerY >= workArea.y &&
      centerY <= workArea.y + workArea.height
    if (centerInView) {
      // 中心点在工作区内：夹取 x/y，保留 width/height
      const x = clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width)
      const y = clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height)
      return { ...bounds, x, y }
    }
    // 窗口完全出屏：回退到当前工作区左上角 + 偏移
    logger.warn('WindowManager', '主窗口持久化位置超出屏幕，回退到默认位置')
    return {
      x: workArea.x + FALLBACK_OFFSET,
      y: workArea.y + FALLBACK_OFFSET,
      width: defaultWidth,
      height: defaultHeight
    }
  } catch (e) {
    logger.warn('WindowManager', `ensureVisibleBounds 失败: ${e.message}`)
    return bounds
  }
}

/**
 * 防抖保存主窗口 bounds 到数据库
 * resize/move 事件高频触发，防抖避免频繁写库
 */
function persistBoundsDebounced () {
  if (boundsPersistTimer) {
    clearTimeout(boundsPersistTimer)
  }
  boundsPersistTimer = setTimeout(() => {
    boundsPersistTimer = null
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return
      // 最大化/全屏状态下不保存当前 bounds（避免把最大化尺寸当作正常尺寸持久化）
      if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return
      const bounds = mainWindow.getBounds()
      appSettingDao.setJson(MAIN_WINDOW_BOUNDS_KEY, bounds)
      logger.debug('WindowManager', `主窗口 bounds 已持久化: (${bounds.x}, ${bounds.y}) ${bounds.width}x${bounds.height}`)
    } catch (e) {
      logger.warn('WindowManager', `持久化主窗口 bounds 失败: ${e.message}`)
    }
  }, BOUNDS_PERSIST_DEBOUNCE)
}

// ============================================================
// 材质配置（与 widget-window-manager.js 共享同一 key，确保主窗口与小部件同步）
// ============================================================
// 材质配置键名：存储在 app_settings 表
const MATERIAL_KEY = 'widget_material'
// 默认材质：mica（云母，Win11 标志性材质效果）
const DEFAULT_MATERIAL = 'mica'
// 允许的材质类型（3 种）
// default：不透明背景，无原生材质
// mica：云母，原生 backgroundMaterial='mica' 作用于标题栏
// acrylic：亚克力，原生 backgroundMaterial='acrylic' 作用于标题栏
const VALID_MATERIALS = ['default', 'mica', 'acrylic']
// Windows 11 最小 build 号（22621 = Win11 22H2）
// Electron setBackgroundMaterial 仅支持 Win11 22H2+（见 Electron 文档）
const WIN11_MIN_BUILD = 22621

// 实际生效材质缓存（降级后），由 applyMaterial 更新
let effectiveMaterialCache = null

/**
 * 获取 Windows 系统 build 号
 * 非 Windows 平台返回 0
 * @returns {number}
 */
function getWindowsBuild () {
  if (process.platform !== 'win32') return 0
  // os.release() 在 Windows 上返回形如 "10.0.22621" 的字符串
  const parts = os.release().split('.')
  return parseInt(parts[2] || '0', 10)
}

/**
 * 判断当前是否 Windows 11 22H2+（build >= 22621）
 * Electron setBackgroundMaterial 仅支持 Win11 22H2+
 * @returns {boolean}
 */
function isWin11 () {
  return process.platform === 'win32' && getWindowsBuild() >= WIN11_MIN_BUILD
}

/**
 * 解析材质：校验并回退到默认值
 * @param {string} material - 期望材质 'default' | 'mica' | 'acrylic'
 * @returns {string} 实际生效的材质 'default' | 'mica' | 'acrylic'
 */
function resolveMaterial (material) {
  return VALID_MATERIALS.includes(material) ? material : DEFAULT_MATERIAL
}

/**
 * 获取当前材质配置
 * 从 app_settings 表读取（与小部件共享），默认 'mica'
 * @returns {string} 'default' | 'mica' | 'acrylic'
 */
function getMaterial () {
  try {
    const value = appSettingDao.get(MATERIAL_KEY)
    if (value && VALID_MATERIALS.includes(value)) {
      return value
    }
    return DEFAULT_MATERIAL
  } catch (e) {
    return DEFAULT_MATERIAL
  }
}

/**
 * 应用材质效果到主窗口
 * 原生 backgroundMaterial（Win11 22H2+）作用于标题栏非客户区
 *   主窗口 frame:true，客户区保持不透明 backgroundColor，标题栏呈现材质效果
 *   非 Win11 22H2+ 降级：跳过 setBackgroundMaterial，主窗口保持普通外观
 * @param {BrowserWindow} win
 * @param {string} material - 'default' | 'mica' | 'acrylic'
 */
function applyMaterial (win, material) {
  try {
    if (!win || win.isDestroyed()) return
    const resolved = resolveMaterial(material)

    // Electron 43+ 原生材质：setBackgroundMaterial 支持 'mica' | 'acrylic' | 'tabbed' | 'none' | 'auto'
    // 映射 default → none（不透明），其余直接传递
    // 仅 Win11 22H2+ 调用（Electron 文档：setBackgroundMaterial 仅支持 Win11 22H2+）
    const nativeMaterialMap = { default: 'none', mica: 'mica', acrylic: 'acrylic' }
    const nativeMaterial = nativeMaterialMap[resolved] || 'none'
    if (isWin11()) {
      try {
        if (typeof win.setBackgroundMaterial === 'function') {
          win.setBackgroundMaterial(nativeMaterial)
          logger.info('WindowManager', `主窗口原生材质已设置: setBackgroundMaterial('${nativeMaterial}')`)
        }
      } catch (e) {
        logger.warn('WindowManager', `主窗口 setBackgroundMaterial 失败: ${e.message}`)
      }
    } else {
      logger.info('WindowManager', `非 Win11 22H2+，主窗口跳过原生材质: ${resolved}`)
    }

    effectiveMaterialCache = resolved
    logger.info('WindowManager', `主窗口材质已应用: ${material} -> 实际生效: ${resolved}`)
  } catch (e) {
    logger.warn('WindowManager', `主窗口应用材质 ${material} 失败: ${e.message}`)
  }
}

/**
 * 动态切换主窗口材质
 * 持久化配置（与小部件共享）并应用到主窗口
 * @param {string} material - 'default' | 'mica' | 'acrylic'
 */
function setMaterial (material) {
  if (!VALID_MATERIALS.includes(material)) {
    logger.warn('WindowManager', `未知材质类型: ${material}，忽略`)
    return
  }
  // 持久化配置（与小部件共享同一 key）
  try {
    appSettingDao.set(MATERIAL_KEY, material)
  } catch (e) {
    logger.warn('WindowManager', `持久化材质配置失败: ${e.message}`)
  }
  // 应用到主窗口
  if (mainWindow && !mainWindow.isDestroyed()) {
    applyMaterial(mainWindow, material)
  }
  logger.info('WindowManager', `已切换主窗口材质为: ${material}`)
}

/**
 * 获取当前实际生效的材质（降级后）
 * @returns {string} 'default' | 'mica' | 'acrylic'
 */
function getEffectiveMaterial () {
  if (effectiveMaterialCache) return effectiveMaterialCache
  return resolveMaterial(getMaterial())
}

/**
 * 创建主窗口
 * 窗口配置：1200×800，最小 900×600
 * 关闭 close 事件改为 hide()（最小化到托盘）而非 quit
 * 主窗口材质：原生 backgroundMaterial 作用于标题栏（Win11 22H2+），客户区保持不透明
 * 主窗口尺寸记忆：启动时从 app_settings 读取上次保存的 bounds，resize/move 后防抖写回
 * @param {Object} options 窗口选项
 */
function createMainWindow (options = {}) {
  const {
    width: defaultWidth = 1200,
    height: defaultHeight = 800,
    minWidth = 900,
    minHeight = 600
  } = options

  // 读取持久化 bounds，校验可见性后用作初始窗口位置和尺寸
  let initialWidth = defaultWidth
  let initialHeight = defaultHeight
  let initialX = undefined
  let initialY = undefined
  const savedBounds = getSavedBounds()
  if (savedBounds) {
    // 尺寸不得小于最小限制
    const safeBounds = ensureVisibleBounds(
      {
        x: savedBounds.x,
        y: savedBounds.y,
        width: Math.max(savedBounds.width, minWidth),
        height: Math.max(savedBounds.height, minHeight)
      },
      defaultWidth,
      defaultHeight
    )
    initialX = safeBounds.x
    initialY = safeBounds.y
    initialWidth = safeBounds.width
    initialHeight = safeBounds.height
    logger.info('WindowManager', `恢复主窗口 bounds: (${initialX}, ${initialY}) ${initialWidth}x${initialHeight}`)
  }

  // 公共 webPreferences 配置
  const webPreferences = {
    preload: path.join(__dirname, '..', 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    enableRemoteModule: false,
    sandbox: true
  }

  // 主窗口材质：原生 backgroundMaterial 作用于标题栏非客户区（Win11 22H2+）
  // 客户区保持不透明 backgroundColor，呈现 Win11 主流应用外观（标题栏材质 + 内容区纯色）
  const currentMaterial = getMaterial()
  const nativeMaterialMap = { default: 'none', mica: 'mica', acrylic: 'acrylic' }
  // 仅 Win11 22H2+ 设置原生材质；低版本传 'none'（等同不设置）
  const initialMaterial = isWin11() ? (nativeMaterialMap[currentMaterial] || 'none') : 'none'

  // 普通窗口配置
  const windowConfig = {
    width: initialWidth,
    height: initialHeight,
    minWidth,
    minHeight,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#f5f7fa',
    // Electron 43+ 原生材质：backgroundMaterial 选项（Win11 22H2+ 生效，低版本自动降级）
    backgroundMaterial: initialMaterial,
    icon: path.join(__dirname, '..', '..', 'resources', 'icon.ico'),
    webPreferences
  }
  // 仅当有恢复的 x/y 时才设置初始位置，否则让系统自动居中
  if (initialX !== undefined && initialY !== undefined) {
    windowConfig.x = initialX
    windowConfig.y = initialY
  }

  mainWindow = new BrowserWindow(windowConfig)

  // 窗口就绪后再次应用材质：确保 setBackgroundMaterial 生效（Win11 22H2+ 此时 DWM 已就绪）
  mainWindow.once('ready-to-show', () => {
    try {
      if (!mainWindow.isDestroyed()) {
        applyMaterial(mainWindow, getMaterial())
      }
    } catch (e) { /* 忽略 ready-to-show 应用材质失败 */ }
  })

  // 设置 CSP 策略：禁止加载外部脚本
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "worker-src 'self' blob:; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; " +
          "connect-src 'self' http://localhost:*; " +
          "font-src 'self' data:;"
        ]
      }
    })
  })

  // 根据环境加载不同入口
  const isDev = process.env.NODE_ENV === 'development'

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })

    // 开发模式下禁用缓存，确保每次加载都是最新代码
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Cache-Control': ['no-cache', 'no-store', 'must-revalidate'],
          'Pragma': ['no-cache'],
        }
      })
    })

    // 监听导航事件，开发模式下强制刷新以获取最新代码
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith('http://localhost:5173')) {
        event.preventDefault()
        mainWindow.webContents.reload()
      }
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
  }

  // 重启后默认显示第一个标签页（清除可能记住的 hash）
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript('if (location.hash && location.hash !== "#/") location.hash = ""').catch(() => {})
  })

  // 拦截外部链接：用系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 主窗口尺寸记忆：监听 resize/move 事件，防抖保存 bounds 到数据库
  // 最大化/全屏状态由 persistBoundsDebounced 内部跳过保存
  mainWindow.on('resize', persistBoundsDebounced)
  mainWindow.on('move', persistBoundsDebounced)

  // 窗口关闭时最小化到托盘，而非退出应用
  mainWindow.on('close', (event) => {
    if (!appWillQuit) {
      event.preventDefault()
      mainWindow.hide()
      logger.info('WindowManager', '窗口已最小化到托盘')
    }
  })

  // 窗口关闭事件清空引用
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  logger.info('WindowManager', '主窗口已创建')
  return mainWindow
}

/**
 * 显示主窗口
 */
function showMainWindow () {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
    logger.info('WindowManager', '主窗口已显示')
  }
}

/**
 * 隐藏主窗口
 */
function hideMainWindow () {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
    logger.info('WindowManager', '主窗口已隐藏')
  }
}

/**
 * 获取主窗口实例
 * @returns {BrowserWindow|null}
 */
function getMainWindow () {
  return mainWindow
}

/**
 * 标记应用即将退出（跳过 close 拦截）
 * 退出前立即 flush 保存主窗口 bounds，避免防抖定时器未触发导致最后一次尺寸丢失
 */
function setAppWillQuit (value) {
  appWillQuit = value
  if (value) {
    // 清除防抖定时器，立即同步保存一次
    if (boundsPersistTimer) {
      clearTimeout(boundsPersistTimer)
      boundsPersistTimer = null
    }
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
          const bounds = mainWindow.getBounds()
          appSettingDao.setJson(MAIN_WINDOW_BOUNDS_KEY, bounds)
          logger.debug('WindowManager', `退出时保存主窗口 bounds: (${bounds.x}, ${bounds.y}) ${bounds.width}x${bounds.height}`)
        }
      }
    } catch (e) {
      logger.warn('WindowManager', `退出时保存主窗口 bounds 失败: ${e.message}`)
    }
  }
}

module.exports = {
  createMainWindow,
  showMainWindow,
  hideMainWindow,
  getMainWindow,
  setAppWillQuit,
  // 主窗口材质控制（与小部件共享配置）
  getMaterial,
  setMaterial,
  applyMaterial,
  getEffectiveMaterial
}
