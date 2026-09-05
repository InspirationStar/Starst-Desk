// ============================================================
// 桌宠窗口管理器
// 管理桌宠 BrowserWindow（独立于主窗口和小部件窗口）
// 桌宠是一只抱竹子的卡通熊猫（SVG），常驻桌面，透明置顶窗口
// 与小部件的 Mica 材质窗口不同：桌宠使用 transparent:true 的透明窗口
//   让 SVG 任意形状（圆形/猫形）直接绘制在桌面上，无背景
// 拖拽通过主进程 win.setBounds 控制（避免透明窗口 CSS transform 抖动）
// 位置持久化节流 200ms（参考 widget-window-manager 的拖拽机制）
// 提醒推送：作为第四重通知渠道，向桌宠窗口推送 pet:reminder 事件
//   桌宠暂停提醒时不推送
// ============================================================

const { BrowserWindow, screen, ipcMain } = require('electron')
const path = require('path')
const logger = require('./logger.js')
const appSettingDao = require('./../dao/app-setting-dao.js')

// ============================================================
// 配置键名（存储在 app_settings 表）
// ============================================================
const KEY_ENABLED = 'pet_enabled'                 // 桌宠是否启用，默认 '1'
const KEY_ALWAYS_ON_TOP = 'pet_always_on_top'     // 是否置顶，默认 '1'
const KEY_POSITION_X = 'pet_position_x'           // 窗口 x 坐标
const KEY_POSITION_Y = 'pet_position_y'           // 窗口 y 坐标
const KEY_WIDTH = 'pet_width'                     // 窗口宽度
const KEY_HEIGHT = 'pet_height'                   // 窗口高度
const KEY_REMINDERS_PAUSED = 'pet_reminders_paused' // 提醒是否暂停，默认 '0'
const KEY_CHARACTER = 'pet_character'             // 桌宠形象，默认 'cat'（cat / robot / orb）
const KEY_CHARACTER_SIZE = 'pet_character_size'   // 桌宠角色尺寸，默认 130（60-300）
const KEY_CHAT_PANEL_OPACITY = 'pet_chat_panel_opacity' // AI 对话框透明度，默认 1（0.3-1）
const KEY_KEY_TRACKER_ENABLED = 'pet_key_tracker_enabled' // 键盘连击追踪是否启用，默认 '1'

// 默认尺寸
// 宽度固定 800px：足够容纳最大气泡（780px），拖拽气泡时窗口大小不变
//   旧值 360 会导致气泡被窗口边界裁剪，且拖拽气泡时需 resizeToContent 改变窗口大小
//   现改为 800px：窗口固定，仅调整气泡 max-width，桌宠位置保持不变
// 高度固定 600px：气泡 bottom:184px，上拉最大 20 行 × 18px = 360px + 标题/padding ≈ 394px
//   184 + 394 = 578px，取 600px 留余量，上拉不会越界裁剪
//   透明窗口下多余区域不可见，setIgnoreMouseEvents 让透明区域鼠标穿透，不影响下方应用
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 600


// 节流间隔（毫秒）
const BOUNDS_PERSIST_THROTTLE = 200

// 桌宠窗口实例（单例）
let petWindow = null

// 拖拽状态：{ startX, startY, startBounds }
let dragState = null

// 位置持久化节流定时器
let boundsPersistTimer = null

// 标记应用是否正在退出（退出时跳过 close 拦截）
let appWillQuit = false

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
 * 设置应用即将退出标记
 * @param {boolean} value
 */
function setAppWillQuit (value) {
  appWillQuit = value
}

/**
 * 数值夹取到 [min, max] 区间
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp (value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * 计算默认位置：屏幕右下角附近
 * @returns {{ x: number, y: number }}
 */
function getDefaultPosition () {
  try {
    const workArea = screen.getPrimaryDisplay().workArea
    return {
      x: workArea.x + workArea.width - DEFAULT_WIDTH - 40,
      y: workArea.y + workArea.height - DEFAULT_HEIGHT - 40
    }
  } catch (e) {
    // 查询失败回退到 (100, 100)
    return { x: 100, y: 100 }
  }
}

/**
 * 读取配置值并解析为整数，缺失时使用默认值
 * @param {string} key - 配置键
 * @param {number} defaultVal - 默认值
 * @returns {number}
 */
function getIntSetting (key, defaultVal) {
  try {
    const val = appSettingDao.get(key)
    if (val === null || val === undefined) return defaultVal
    const num = parseInt(val, 10)
    return isNaN(num) ? defaultVal : num
  } catch (e) {
    return defaultVal
  }
}

/**
 * 读取配置值并解析为浮点数，缺失时使用默认值
 * @param {string} key - 配置键
 * @param {number} defaultVal - 默认值
 * @returns {number}
 */
function getFloatSetting (key, defaultVal) {
  try {
    const val = appSettingDao.get(key)
    if (val === null || val === undefined) return defaultVal
    const num = parseFloat(val)
    return isNaN(num) ? defaultVal : num
  } catch (e) {
    return defaultVal
  }
}

/**
 * 读取配置值并解析为布尔，缺失时使用默认值
 * @param {string} key - 配置键
 * @param {boolean} defaultVal - 默认值
 * @returns {boolean}
 */
function getBoolSetting (key, defaultVal) {
  try {
    const val = appSettingDao.get(key)
    if (val === null || val === undefined) return defaultVal
    return val === '1' || val === 'true'
  } catch (e) {
    return defaultVal
  }
}

/**
 * 读取桌宠形象配置，缺失时默认 'cat'
 * @returns {string} 'cat' | 'robot' | 'orb'
 */
function getCharacterSetting () {
  try {
    const val = appSettingDao.get(KEY_CHARACTER)
    if (val === 'cat' || val === 'robot' || val === 'orb' || val === 'dna') return val
    return 'cat'
  } catch (e) {
    return 'cat'
  }
}

/**
 * 确保窗口位置在屏幕可见区域内（EnsureVisible）
 * 多显示器场景下将窗口中心点夹取到所在显示器工作区内
 * @param {object} bounds - { x, y, width, height }
 * @returns {object} 校验后的 bounds
 */
function ensureVisible (bounds) {
  try {
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const x = clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width)
    const y = clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height)
    return { ...bounds, x, y }
  } catch (e) {
    logger.warn('PetWindowManager', `ensureVisible 失败: ${e.message}`)
    return bounds
  }
}

// 缓存上次推送的 workArea，避免拖拽中重复推送
let lastWorkAreaKey = ''

/**
 * 向渲染进程推送窗口所在显示器的 workArea（多显示器支持）
 * 渲染进程用此计算气泡/面板的屏幕边缘偏移
 * @param {object} bounds - 窗口当前 bounds
 */
function sendWorkArea (bounds) {
  if (!petWindow || petWindow.isDestroyed()) return
  try {
    const display = screen.getDisplayMatching(bounds)
    const wa = display.workArea
    const key = `${wa.x},${wa.y},${wa.width},${wa.height}`
    if (key === lastWorkAreaKey) return
    lastWorkAreaKey = key
    petWindow.webContents.send('pet:work-area', {
      x: wa.x, y: wa.y, width: wa.width, height: wa.height
    })
  } catch (e) {
    // 忽略
  }
}

/**

 * 节流持久化窗口位置到数据库
 * @param {object} bounds - { x, y, width, height }
 */
function persistBoundsThrottled (bounds) {
  // 清除已有定时器
  if (boundsPersistTimer) {
    clearTimeout(boundsPersistTimer)
  }
  // 设置新定时器
  boundsPersistTimer = setTimeout(() => {
    try {
      appSettingDao.set(KEY_POSITION_X, String(bounds.x))
      appSettingDao.set(KEY_POSITION_Y, String(bounds.y))
      appSettingDao.set(KEY_WIDTH, String(bounds.width))
      appSettingDao.set(KEY_HEIGHT, String(bounds.height))
      logger.debug('PetWindowManager', `位置已持久化: (${bounds.x}, ${bounds.y}) ${bounds.width}x${bounds.height}`)
    } catch (error) {
      logger.error('PetWindowManager', `持久化位置失败: ${error.message}`)
    } finally {
      boundsPersistTimer = null
    }
  }, BOUNDS_PERSIST_THROTTLE)
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
// 窗口创建 / 销毁
// ============================================================

/**
 * 创建桌宠窗口
 * 单例：已存在则先销毁旧窗口再创建
 * @returns {BrowserWindow|null}
 */
function createPetWindow () {
  // 已存在则先销毁
  if (petWindow) {
    logger.warn('PetWindowManager', '桌宠窗口已存在，先销毁旧窗口')
    destroyPetWindow()
  }

  // 读取持久化配置，合并默认值
  const defaultPos = getDefaultPosition()
  const savedWidth = getIntSetting(KEY_WIDTH, DEFAULT_WIDTH)
  // 宽度固定 800px（设计约定：足够容纳最大气泡 780px，窗口固定不随内容变化）
  // 忽略数据库中可能残留的旧宽度值（如旧版本 resizeToContent 写入的 1035），
  // 否则 ensureVisible 会因窗口过宽而钳位 x 坐标，导致重启后桌宠位置偏移
  const effectiveWidth = DEFAULT_WIDTH
  let savedX = getIntSetting(KEY_POSITION_X, defaultPos.x)
  // 兼容旧版本：旧窗口宽度 360px，新默认宽度 800px
  // 角色在窗口底部中央，屏幕位置 = savedX + savedWidth/2
  // 升级到新宽度后，要保持角色屏幕位置不变，需调整 x 坐标：
  //   newX = savedX + savedWidth/2 - effectiveWidth/2
  // 仅当旧宽度小于新默认宽度时调整，并持久化新值避免下次重复调整
  if (savedWidth < DEFAULT_WIDTH) {
    savedX = savedX + Math.round((savedWidth - effectiveWidth) / 2)
    try {
      appSettingDao.set(KEY_POSITION_X, String(savedX))
      appSettingDao.set(KEY_WIDTH, String(effectiveWidth))
      logger.info('PetWindowManager', `窗口宽度升级: ${savedWidth} → ${effectiveWidth}，x 调整为 ${savedX}`)
    } catch (e) {
      logger.warn('PetWindowManager', `持久化窗口升级失败: ${e.message}`)
    }
  }
  const bounds = {
    x: savedX,
    y: getIntSetting(KEY_POSITION_Y, defaultPos.y),
    width: effectiveWidth,
    height: Math.max(getIntSetting(KEY_HEIGHT, DEFAULT_HEIGHT), DEFAULT_HEIGHT)
  }

  // 根据角色尺寸确保窗口高度足够容纳气泡 + 角色下方预留空间（翻转时气泡/工具栏显示在角色下方）
  // 窗口高度 = 角色尺寸 + 上方气泡区(468) + 下方预留区(250)
  const charSize = getIntSetting(KEY_CHARACTER_SIZE, 130)
  const requiredHeight = Math.max(bounds.height, charSize + 718)
  if (requiredHeight > bounds.height) {
    // 向下扩展（y 不变），角色屏幕位置基本不变（角色 bottom 从 4 → 250，抵消高度增加）
    bounds.height = requiredHeight
    // 持久化调整后的 height，避免下次启动重复调整
    try {
      appSettingDao.set(KEY_HEIGHT, String(bounds.height))
    } catch (e) {
      logger.warn('PetWindowManager', `持久化高度调整失败: ${e.message}`)
    }
  }

  // 不钳位位置：允许桌宠自由移动到屏幕边缘外，重启恢复上次位置
  // （此前 ensureVisible 会把位置钳回屏幕内，导致重启没到上次位置）
  const safeBounds = bounds

  // 读取置顶配置
  const alwaysOnTop = getBoolSetting(KEY_ALWAYS_ON_TOP, true)

  // 窗口配置：透明置顶窗口
  // 关键：transparent:true 让窗口无背景，SVG 任意形状直接绘制在桌面
  //   不设置 backgroundMaterial（透明窗口不需要 Mica 材质）
  //   hasShadow:false 避免透明窗口出现系统阴影
  const windowConfig = {
    x: safeBounds.x,
    y: safeBounds.y,
    width: safeBounds.width,
    height: safeBounds.height,
    minWidth: DEFAULT_WIDTH,
    minHeight: DEFAULT_HEIGHT,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    alwaysOnTop,
    resizable: false,
    hasShadow: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'resources', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true
    }
  }

  const win = new BrowserWindow(windowConfig)

  // 设置 CSP 策略（含开发模式禁用缓存，已合并到 setupCSP 内部）
  setupCSP(win)

  // 加载入口：开发环境 loadURL，生产 loadFile
  if (isDev()) {
    win.loadURL('http://localhost:5173/pet.html')
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'pet.html'))
  }


  // 拦截 close 事件：非退出时改为 hide
  win.on('close', (event) => {
    if (!appWillQuit) {
      event.preventDefault()
      // 隐藏前持久化当前位置
      try {
        const currentBounds = win.getBounds()
        appSettingDao.set(KEY_POSITION_X, String(currentBounds.x))
        appSettingDao.set(KEY_POSITION_Y, String(currentBounds.y))
        logger.debug('PetWindowManager', `桌宠位置已保存: (${currentBounds.x}, ${currentBounds.y})`)
      } catch (e) {
        logger.warn('PetWindowManager', `持久化桌宠位置失败: ${e.message}`)
      }
      win.hide()
      // 桌宠通过 close 按钮隐藏时，同步停止键盘敲击监听
      //   与 hidePet 行为一致，避免 25ms FFI 轮询在窗口隐藏后空转耗电
      try {
        require('./pet-key-watcher.js').stop()
      } catch (e) { /* 忽略停止失败 */ }
      logger.info('PetWindowManager', '桌宠已隐藏（拦截 close）')
    }
  })

  // 窗口销毁时清理引用
  win.on('closed', () => {
    petWindow = null
  })

  petWindow = win

  // 鼠标穿透：透明区域让鼠标事件穿透到下方应用
  // forward: true 表示 mousemove 仍然转发到渲染进程，用于检测鼠标是否进入交互元素
  // 渲染进程通过 pet:set-ignore-mouse-events 通道动态切换穿透状态
  win.setIgnoreMouseEvents(true, { forward: true })

  // 窗口创建后推送 workArea，供渲染进程初始化边缘检测
  sendWorkArea(safeBounds)

  logger.info('PetWindowManager', '桌宠窗口已创建（鼠标穿透已启用）')
  return win
}

/**
 * 销毁桌宠窗口
 */
function destroyPetWindow () {
  if (!petWindow) return
  // 销毁前持久化当前位置和尺寸（修复退出不保存问题）
  try {
    if (!petWindow.isDestroyed()) {
      const currentBounds = petWindow.getBounds()
      appSettingDao.set(KEY_POSITION_X, String(currentBounds.x))
      appSettingDao.set(KEY_POSITION_Y, String(currentBounds.y))
      appSettingDao.set(KEY_WIDTH, String(currentBounds.width))
      appSettingDao.set(KEY_HEIGHT, String(currentBounds.height))
      logger.info('PetWindowManager', `退出时保存桌宠位置: (${currentBounds.x}, ${currentBounds.y})`)
    }
  } catch (e) {
    logger.warn('PetWindowManager', `退出时保存桌宠位置失败: ${e.message}`)
  }
  try {
    if (!petWindow.isDestroyed()) {
      petWindow.destroy()
    }
  } catch (error) {
    logger.error('PetWindowManager', `销毁桌宠窗口失败: ${error.message}`)
  }
  petWindow = null
  // 清理节流定时器
  if (boundsPersistTimer) {
    clearTimeout(boundsPersistTimer)
    boundsPersistTimer = null
  }
  // 清理拖拽状态
  dragState = null
}

// ============================================================
// 显隐控制
// ============================================================

/**
 * 获取桌宠窗口实例
 * @returns {BrowserWindow|null}
 */
function getPetWindow () {
  return petWindow
}

/**
 * 显示桌宠
 */
function showPet () {
  let win = petWindow
  if (!win || win.isDestroyed()) {
    win = createPetWindow()
  }
  if (!win || win.isDestroyed()) return
  try {
    win.show()
    // 桌宠显示时启动键盘敲击监听（延迟 require 避免循环依赖）
    // 仅在键盘追踪启用时启动，避免关闭后仍进行 FFI 调用
    if (getBoolSetting(KEY_KEY_TRACKER_ENABLED, true)) {
      require('./pet-key-watcher.js').start()
    }
    logger.info('PetWindowManager', '桌宠已显示')
  } catch (e) {
    logger.error('PetWindowManager', `显示桌宠失败: ${e.message}`)
  }
}

/**
 * 隐藏桌宠
 */
function hidePet () {
  if (!petWindow || petWindow.isDestroyed()) return
  try {
    // 隐藏前持久化当前位置
    const currentBounds = petWindow.getBounds()
    appSettingDao.set(KEY_POSITION_X, String(currentBounds.x))
    appSettingDao.set(KEY_POSITION_Y, String(currentBounds.y))
    petWindow.hide()
    // 桌宠隐藏时停止键盘敲击监听，避免 25ms FFI 调用空转
    require('./pet-key-watcher.js').stop()
    logger.info('PetWindowManager', '桌宠已隐藏')
  } catch (e) {
    logger.error('PetWindowManager', `隐藏桌宠失败: ${e.message}`)
  }
}

/**
 * 切换桌宠显隐
 */
function togglePet () {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) {
    showPet()
  } else {
    hidePet()
  }
}

// ============================================================
// 置顶 / 尺寸控制
// ============================================================

/**
 * 设置桌宠窗口置顶
 * 持久化到 app_settings（pet_always_on_top）
 * @param {boolean} alwaysOnTop
 */
function setAlwaysOnTop (alwaysOnTop) {
  // 持久化配置
  try {
    appSettingDao.set(KEY_ALWAYS_ON_TOP, alwaysOnTop ? '1' : '0')
  } catch (e) {
    logger.warn('PetWindowManager', `持久化置顶配置失败: ${e.message}`)
  }
  // 应用到窗口
  if (petWindow && !petWindow.isDestroyed()) {
    try {
      petWindow.setAlwaysOnTop(!!alwaysOnTop)
    } catch (e) {
      logger.warn('PetWindowManager', `设置置顶失败: ${e.message}`)
    }
  }
  logger.info('PetWindowManager', `桌宠置顶: ${alwaysOnTop ? '开启' : '关闭'}`)
}

/**
 * 临时设置窗口置顶（不持久化）
 * 用于气泡显示时临时提升图层，气泡消失后恢复
 * @param {boolean} alwaysOnTop
 */
function setTemporaryAlwaysOnTop (alwaysOnTop) {
  if (petWindow && !petWindow.isDestroyed()) {
    try {
      petWindow.setAlwaysOnTop(!!alwaysOnTop)
    } catch (e) {
      logger.warn('PetWindowManager', `临时置顶设置失败: ${e.message}`)
    }
  }
}

/**
 * 设置键盘连击追踪启用/禁用
 * 持久化到 app_settings，并实时启停 pet-key-watcher
 * @param {boolean} enabled
 */
function setKeyTrackerEnabled (enabled) {
  try {
    appSettingDao.set(KEY_KEY_TRACKER_ENABLED, enabled ? '1' : '0')
  } catch (e) {
    logger.warn('PetWindowManager', `持久化键盘追踪配置失败: ${e.message}`)
  }
  // 实时启停 pet-key-watcher（仅当桌宠窗口可见时）
  try {
    const keyWatcher = require('./pet-key-watcher.js')
    if (enabled) {
      if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
        keyWatcher.start()
      }
    } else {
      keyWatcher.stop()
    }
  } catch (e) {
    logger.warn('PetWindowManager', `启停键盘追踪失败: ${e.message}`)
  }
  logger.info('PetWindowManager', `键盘连击追踪: ${enabled ? '开启' : '关闭'}`)
}

/**
 * 重置桌宠位置到屏幕右下角默认位置
 * 持久化默认坐标并同步应用到当前窗口
 * @returns {{ x: number, y: number }} 重置后的坐标
 */
function resetPosition () {
  const defaultPos = getDefaultPosition()
  // 持久化默认坐标
  try {
    appSettingDao.set(KEY_POSITION_X, String(defaultPos.x))
    appSettingDao.set(KEY_POSITION_Y, String(defaultPos.y))
  } catch (e) {
    logger.warn('PetWindowManager', `持久化重置位置失败: ${e.message}`)
  }
  // 同步应用到窗口
  if (petWindow && !petWindow.isDestroyed()) {
    try {
      const current = petWindow.getBounds()
      petWindow.setBounds({ x: defaultPos.x, y: defaultPos.y, width: current.width, height: current.height })
    } catch (e) {
      logger.warn('PetWindowManager', `应用重置位置失败: ${e.message}`)
    }
  }
  logger.info('PetWindowManager', `桌宠位置已重置: (${defaultPos.x}, ${defaultPos.y})`)
  return defaultPos
}

/**
 * 根据渲染进程测量的内容尺寸自适应调整窗口大小
 * @param {number} width - 内容宽度
 * @param {number} height - 内容高度
 */
function resizeToContent (width, height) {
  // 防御性校验
  if (typeof width !== 'number' || typeof height !== 'number' ||
      !Number.isFinite(width) || !Number.isFinite(height)) {
    logger.warn('PetWindowManager', `resizeToContent 收到非法尺寸: (${width}, ${height})`)
    return
  }

  if (!petWindow || petWindow.isDestroyed()) {
    logger.warn('PetWindowManager', 'resizeToContent 窗口不存在或已销毁')
    return
  }

  try {
    const currentBounds = petWindow.getBounds()
    // 保留 x/y，宽度固定 800px（不接受外部 width，避免窗口过宽导致 ensureVisible 钳位 x）
    const targetBounds = {
      x: currentBounds.x,
      y: currentBounds.y,
      width: DEFAULT_WIDTH,
      height: Math.round(height)
    }
    petWindow.setBounds(targetBounds)
    // 节流持久化
    persistBoundsThrottled(targetBounds)
    logger.debug('PetWindowManager', `桌宠自适应尺寸: ${targetBounds.width}x${targetBounds.height}`)
  } catch (error) {
    logger.error('PetWindowManager', `resizeToContent 失败: ${error.message}`)
  }
}


// ============================================================
// 配置读写
// ============================================================

/**
 * 获取桌宠完整配置
 * @returns {{ enabled: boolean, alwaysOnTop: boolean, x: number, y: number, width: number, height: number, remindersPaused: boolean, character: string }}
 */
function getConfig () {
  const defaultPos = getDefaultPosition()
  return {
    enabled: getBoolSetting(KEY_ENABLED, true),
    alwaysOnTop: getBoolSetting(KEY_ALWAYS_ON_TOP, true),
    x: getIntSetting(KEY_POSITION_X, defaultPos.x),
    y: getIntSetting(KEY_POSITION_Y, defaultPos.y),
    width: getIntSetting(KEY_WIDTH, DEFAULT_WIDTH),
    height: getIntSetting(KEY_HEIGHT, DEFAULT_HEIGHT),
    remindersPaused: getBoolSetting(KEY_REMINDERS_PAUSED, false),
    character: getCharacterSetting(),
    characterSize: getIntSetting(KEY_CHARACTER_SIZE, 130),
    chatPanelOpacity: getFloatSetting(KEY_CHAT_PANEL_OPACITY, 1),
    keyTrackerEnabled: getBoolSetting(KEY_KEY_TRACKER_ENABLED, true)
  }
}

/**
 * 更新桌宠配置
 * 支持部分字段更新，仅持久化提供的字段，并同步应用到窗口
 * @param {object} data - 待更新字段
 * @param {boolean} [data.enabled] - 是否启用
 * @param {boolean} [data.alwaysOnTop] - 是否置顶
 * @param {number} [data.x] - x 坐标
 * @param {number} [data.y] - y 坐标
 * @param {number} [data.width] - 宽度
 * @param {number} [data.height] - 高度
 * @param {boolean} [data.remindersPaused] - 提醒是否暂停
 */
function updateConfig (data) {
  if (!data || typeof data !== 'object') {
    logger.warn('PetWindowManager', 'updateConfig 收到无效 data')
    return
  }

  // 收集本次变化的字段，函数末尾统一广播给渲染进程
  const changedFields = {}

  try {
    // enabled：仅持久化，不在此处创建/销毁窗口（由调用方决定）
    if (typeof data.enabled === 'boolean') {
      appSettingDao.set(KEY_ENABLED, data.enabled ? '1' : '0')
      changedFields.enabled = data.enabled
    }
    // alwaysOnTop
    if (typeof data.alwaysOnTop === 'boolean') {
      setAlwaysOnTop(data.alwaysOnTop)
      changedFields.alwaysOnTop = data.alwaysOnTop
    }
    // 位置/尺寸
    if (typeof data.x === 'number' && typeof data.y === 'number') {
      appSettingDao.set(KEY_POSITION_X, String(data.x))
      appSettingDao.set(KEY_POSITION_Y, String(data.y))
      // 同步应用到窗口
      if (petWindow && !petWindow.isDestroyed()) {
        const current = petWindow.getBounds()
        petWindow.setBounds({ x: data.x, y: data.y, width: current.width, height: current.height })
      }
      changedFields.x = data.x
      changedFields.y = data.y
    }
    if (typeof data.width === 'number' && typeof data.height === 'number') {
      appSettingDao.set(KEY_WIDTH, String(data.width))
      appSettingDao.set(KEY_HEIGHT, String(data.height))
      if (petWindow && !petWindow.isDestroyed()) {
        const current = petWindow.getBounds()
        petWindow.setBounds({ x: current.x, y: current.y, width: data.width, height: data.height })
      }
      changedFields.width = data.width
      changedFields.height = data.height
    }
    // remindersPaused
    if (typeof data.remindersPaused === 'boolean') {
      setRemindersPaused(data.remindersPaused)
      changedFields.remindersPaused = data.remindersPaused
    }
    // character（桌宠形象：cat / robot / orb / dna）
    if (typeof data.character === 'string' && (data.character === 'cat' || data.character === 'robot' || data.character === 'orb' || data.character === 'dna')) {
      try {
        appSettingDao.set(KEY_CHARACTER, data.character)
        changedFields.character = data.character
        logger.info('PetWindowManager', `桌宠形象已切换为: ${data.character}`)
      } catch (e) {
        logger.warn('PetWindowManager', `持久化桌宠形象失败: ${e.message}`)
      }
    }
    // characterSize（桌宠角色尺寸：60-300）
    if (typeof data.characterSize === 'number' && data.characterSize >= 60 && data.characterSize <= 300) {
      try {
        const newSize = Math.round(data.characterSize)
        appSettingDao.set(KEY_CHARACTER_SIZE, String(newSize))
        changedFields.characterSize = newSize
        logger.info('PetWindowManager', `桌宠角色尺寸已更新为: ${newSize}`)

        // 根据角色尺寸动态调整窗口高度，确保气泡不被裁剪 + 角色下方预留空间
        // 窗口高度 = 角色尺寸 + 上方气泡区(468) + 下方预留区(250) = 角色尺寸 + 718
        if (petWindow && !petWindow.isDestroyed()) {
          const current = petWindow.getBounds()
          const requiredHeight = Math.max(DEFAULT_HEIGHT, newSize + 718)
          if (requiredHeight !== current.height) {
            // 向下扩展（y 不变），角色屏幕位置基本不变
            petWindow.setBounds({
              x: current.x,
              y: current.y,
              width: current.width,
              height: requiredHeight
            })
            // 持久化新高度
            try {
              appSettingDao.set(KEY_HEIGHT, String(requiredHeight))
            } catch (e) { /* 忽略持久化失败 */ }
          }
        }
      } catch (e) {
        logger.warn('PetWindowManager', `持久化桌宠角色尺寸失败: ${e.message}`)
      }
    }
    // chatPanelOpacity（AI 对话框透明度：0.3-1）
    if (typeof data.chatPanelOpacity === 'number' && data.chatPanelOpacity >= 0.3 && data.chatPanelOpacity <= 1) {
      try {
        const opacity = Math.round(data.chatPanelOpacity * 100) / 100
        appSettingDao.set(KEY_CHAT_PANEL_OPACITY, String(opacity))
        changedFields.chatPanelOpacity = opacity
      } catch (e) {
        logger.warn('PetWindowManager', `持久化对话框透明度失败: ${e.message}`)
      }
    }
    // keyTrackerEnabled（键盘连击追踪开关）
    if (typeof data.keyTrackerEnabled === 'boolean') {
      setKeyTrackerEnabled(data.keyTrackerEnabled)
      changedFields.keyTrackerEnabled = data.keyTrackerEnabled
    }

    // 统一广播配置变化事件，通知渲染进程同步更新
    if (Object.keys(changedFields).length > 0 && petWindow && !petWindow.isDestroyed()) {
      try {
        petWindow.webContents.send('pet:config-changed', changedFields)
      } catch (e) { /* 忽略发送失败 */ }
    }
    logger.info('PetWindowManager', '桌宠配置已更新')
  } catch (error) {
    logger.error('PetWindowManager', `updateConfig 失败: ${error.message}`)
  }
}

// ============================================================
// 提醒推送
// ============================================================

/**
 * 查询桌宠提醒是否处于暂停状态
 * @returns {boolean}
 */
function isRemindersPaused () {
  return getBoolSetting(KEY_REMINDERS_PAUSED, false)
}

/**
 * 设置桌宠提醒暂停/恢复
 * 持久化到 app_settings（pet_reminders_paused）
 * 向桌宠窗口广播 pet:reminders-paused-changed 事件
 * @param {boolean} paused
 */
function setRemindersPaused (paused) {
  try {
    appSettingDao.set(KEY_REMINDERS_PAUSED, paused ? '1' : '0')
  } catch (e) {
    logger.warn('PetWindowManager', `持久化提醒暂停状态失败: ${e.message}`)
  }
  // 联动健康提醒调度器：暂停时停止所有健康提醒触发，恢复时重新计时
  // 延迟 require 避免循环依赖（pet-window-manager → health-scheduler → notification-service → pet-window-manager）
  try {
    const healthScheduler = require('./../modules/health-scheduler.js')
    if (paused) {
      healthScheduler.pauseAll()
    } else {
      healthScheduler.resumeAll()
    }
  } catch (e) {
    logger.warn('PetWindowManager', `联动健康调度器暂停/恢复失败: ${e.message}`)
  }
  // 广播状态变更事件
  if (petWindow && !petWindow.isDestroyed()) {
    try {
      petWindow.webContents.send('pet:reminders-paused-changed', { paused: !!paused })
    } catch (e) { /* 忽略发送失败 */ }
  }
  logger.info('PetWindowManager', `桌宠提醒: ${paused ? '已暂停' : '已恢复'}`)
}

/**
 * 向桌宠窗口推送提醒事件
 * 桌宠暂停提醒时跳过推送
 * @param {string} type - 提醒类型（note/task/health/ai）
 * @param {string} title - 提醒标题
 * @param {string} body - 提醒内容
 * @param {object} [source] - 来源标识 { module, id }
 */
function sendReminder (type, title, body, source) {
  // 桌宠未启用或窗口不存在：跳过
  if (!petWindow || petWindow.isDestroyed()) return
  // 桌宠暂停提醒：跳过
  if (isRemindersPaused()) {
    logger.debug('PetWindowManager', '桌宠提醒已暂停，跳过推送')
    return
  }
  try {
    const id = (source && source.id) || `pet-reminder-${Date.now()}`
    petWindow.webContents.send('pet:reminder', { id, type, title, body, source, timestamp: Date.now() })
    logger.debug('PetWindowManager', `已向桌宠推送提醒: [${type}] ${title}`)
  } catch (e) {
    logger.warn('PetWindowManager', `推送桌宠提醒失败: ${e.message}`)
  }
}

/**
 * 向桌宠窗口推送自定义事件（通用方法）
 * 用于跨窗口通信：主界面 AI 对话等场景向桌宠窗口同步状态
 * 桌宠未启用或窗口不存在时跳过
 * @param {string} eventName 事件名（需在 preload.js 白名单中注册）
 * @param {object} payload 事件数据
 */
function sendToPetWindow (eventName, payload) {
  if (!petWindow || petWindow.isDestroyed()) return
  try {
    petWindow.webContents.send(eventName, payload)
  } catch (e) {
    logger.warn('PetWindowManager', `向桌宠推送事件 ${eventName} 失败: ${e.message}`)
  }
}

// ============================================================
// 拖拽控制（主进程接管，避免透明窗口抖动）
// ============================================================

/**
 * 初始化拖拽 IPC 监听
 * 渲染进程 mousedown 时通过 pet:drag:start 通知主进程接管
 * 主进程通过 win.setBounds 控制窗口移动，mouseup 时结束
 * 拖拽结束时持久化最终位置
 */
function initDragIpc () {
  // pet:drag:start - 开始拖拽
  ipcMain.on('pet:drag:start', (event, data) => {
    // 防御性校验
    if (!data || typeof data !== 'object') {
      logger.warn('PetWindowManager', 'pet:drag:start 收到无效 data 格式')
      return
    }
    const { startX, startY } = data
    if (typeof startX !== 'number' || typeof startY !== 'number' ||
        !Number.isFinite(startX) || !Number.isFinite(startY)) {
      logger.warn('PetWindowManager', `pet:drag:start 收到非法坐标: (${startX}, ${startY})`)
      return
    }
    if (!petWindow || petWindow.isDestroyed()) return

    const startBounds = petWindow.getBounds()
    dragState = { startX, startY, startBounds }
    logger.debug('PetWindowManager', `桌宠开始拖拽: (${startX}, ${startY})`)
  })

  // pet:drag:move - 拖拽移动
  ipcMain.on('pet:drag:move', (event, data) => {
    if (!data || typeof data !== 'object') {
      logger.warn('PetWindowManager', 'pet:drag:move 收到无效 data 格式')
      return
    }
    const { x, y } = data
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      logger.warn('PetWindowManager', `pet:drag:move 收到非法坐标: (${x}, ${y})`)
      return
    }
    if (!dragState || !petWindow || petWindow.isDestroyed()) return

    const newBounds = {
      x: dragState.startBounds.x + (x - dragState.startX),
      y: dragState.startBounds.y + (y - dragState.startY),
      width: dragState.startBounds.width,
      height: dragState.startBounds.height
    }
    // 不钳位桌宠位置，允许自由移动到屏幕任意位置（包括边缘外）
    // 气泡/面板的边缘检测在渲染进程中通过 horizontalOffset/panelTransform 处理
    petWindow.setBounds(newBounds)
    // 推送窗口所在显示器 workArea，供渲染进程做多显示器边缘检测
    sendWorkArea(newBounds)
  })

  // pet:drag:end - 拖拽结束
  ipcMain.on('pet:drag:end', (event, data) => {
    if (!dragState || !petWindow || petWindow.isDestroyed()) {
      dragState = null
      return
    }
    // 立即持久化最终位置
    try {
      const finalBounds = petWindow.getBounds()
      appSettingDao.set(KEY_POSITION_X, String(finalBounds.x))
      appSettingDao.set(KEY_POSITION_Y, String(finalBounds.y))
      appSettingDao.set(KEY_WIDTH, String(finalBounds.width))
      appSettingDao.set(KEY_HEIGHT, String(finalBounds.height))
    } catch (error) {
      logger.error('PetWindowManager', `拖拽结束持久化失败: ${error.message}`)
    }
    dragState = null
    logger.debug('PetWindowManager', '桌宠拖拽结束')
  })

  // pet:set-ignore-mouse-events - 渲染进程控制鼠标穿透
  // ignore=true: 透明区域鼠标穿透到下方应用（forward: true 保留 mousemove 转发）
  // ignore=false: 窗口恢复鼠标响应（用户可点击角色/工具栏/气泡）
  ipcMain.on('pet:set-ignore-mouse-events', (event, data) => {
    if (!petWindow || petWindow.isDestroyed()) return
    try {
      const ignore = !!(data && data.ignore)
      if (ignore) {
        petWindow.setIgnoreMouseEvents(true, { forward: true })
      } else {
        petWindow.setIgnoreMouseEvents(false)
      }
    } catch (e) {
      logger.warn('PetWindowManager', `设置鼠标穿透失败: ${e.message}`)
    }
  })
}

// ============================================================
// 初始化 / 销毁
// ============================================================

/**
 * 应用启动时初始化桌宠
 * 读取 pet_enabled，启用则创建窗口并注册拖拽 IPC
 */
function init () {
  try {
    // 初始化拖拽 IPC 监听
    initDragIpc()

    const enabled = getBoolSetting(KEY_ENABLED, true)
    if (enabled) {
      createPetWindow()
      logger.info('PetWindowManager', '桌宠已启用')
    } else {
      logger.info('PetWindowManager', '桌宠未启用，跳过窗口创建')
    }
  } catch (error) {
    logger.error('PetWindowManager', `init 失败: ${error.message}`)
  }
}

/**
 * 销毁桌宠窗口（退出时调用）
 */
function destroy () {
  destroyPetWindow()
  logger.info('PetWindowManager', '桌宠窗口已销毁')
}

module.exports = {
  init,
  getPetWindow,
  createPetWindow,
  destroyPetWindow,
  showPet,
  hidePet,
  togglePet,
  setAlwaysOnTop,
  setTemporaryAlwaysOnTop,
  setKeyTrackerEnabled,
  resizeToContent,

  resetPosition,
  getConfig,
  updateConfig,
  sendReminder,
  sendToPetWindow,
  isRemindersPaused,
  setRemindersPaused,
  setAppWillQuit
}