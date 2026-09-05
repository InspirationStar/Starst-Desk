// ============================================================
// 提醒窗口管理器
// 管理独立的提醒弹窗窗口（独立于主窗口，从屏幕顶部弹出）
// ============================================================

const { BrowserWindow, screen } = require('electron')
const path = require('path')
const logger = require('./logger.js')

// 提醒窗口实例（单例）
let reminderWindow = null

// 窗口尺寸
const WINDOW_WIDTH = 380
const WINDOW_HEIGHT = 200

// 边距
const MARGIN_TOP = 20
const MARGIN_RIGHT = 20

/**
 * 应用是否处于开发环境
 */
function isDev () {
  return process.env.NODE_ENV === 'development'
}

/**
 * 计算窗口位置：屏幕顶部居中
 * @returns {{ x: number, y: number }}
 */
function calculatePosition () {
  try {
    const workArea = screen.getPrimaryDisplay().workArea
    const x = workArea.x + workArea.width - WINDOW_WIDTH - MARGIN_RIGHT
    const y = workArea.y + MARGIN_TOP
    return { x, y }
  } catch (e) {
    // 查询失败回退到右上角
    return { x: 100, y: 20 }
  }
}

/**
 * 创建提醒窗口
 * @returns {BrowserWindow|null}
 */
function createReminderWindow () {
  // 已存在则先销毁
  if (reminderWindow) {
    destroyReminderWindow()
  }

  const position = calculatePosition()

  // 窗口配置：无边框、透明、置顶
  const windowConfig = {
    x: position.x,
    y: position.y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_WIDTH,
    minHeight: WINDOW_HEIGHT,
    maxWidth: WINDOW_WIDTH,
    maxHeight: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: true,
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

  // 设置 CSP 策略 + 开发模式禁用缓存
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
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

  // 加载入口
  if (isDev()) {
    win.loadURL('http://localhost:5173/reminder.html')
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'reminder.html'))
  }

  // 窗口销毁时清理引用
  win.on('closed', () => {
    reminderWindow = null
  })

  reminderWindow = win
  logger.info('ReminderWindowManager', '提醒窗口已创建')
  return win
}

/**
 * 销毁提醒窗口
 */
function destroyReminderWindow () {
  if (!reminderWindow) return
  try {
    if (!reminderWindow.isDestroyed()) {
      reminderWindow.destroy()
    }
  } catch (error) {
    logger.error('ReminderWindowManager', `销毁提醒窗口失败: ${error.message}`)
  }
  reminderWindow = null
}

/**
 * 显示提醒窗口
 */
function showReminderWindow () {
  let win = reminderWindow
  if (!win || win.isDestroyed()) {
    win = createReminderWindow()
  }
  if (!win || win.isDestroyed()) return
  try {
    win.show()
    logger.info('ReminderWindowManager', '提醒窗口已显示')
  } catch (e) {
    logger.error('ReminderWindowManager', `显示提醒窗口失败: ${e.message}`)
  }
}

/**
 * 隐藏提醒窗口
 */
function hideReminderWindow () {
  if (!reminderWindow || reminderWindow.isDestroyed()) return
  try {
    reminderWindow.hide()
    logger.info('ReminderWindowManager', '提醒窗口已隐藏')
  } catch (e) {
    logger.error('ReminderWindowManager', `隐藏提醒窗口失败: ${e.message}`)
  }
}

/**
 * 向提醒窗口推送提醒
 * @param {Object} payload - 提醒数据 { type, title, body, source }
 */
function sendReminder (payload) {
  if (!reminderWindow || reminderWindow.isDestroyed()) {
    showReminderWindow()
  }
  if (!reminderWindow || reminderWindow.isDestroyed()) return
  try {
    // 窗口刚创建时 loadURL/loadFile 异步未完成，渲染进程尚未注册 'reminder:popup' 监听器
    // 此时直接 send 会丢消息。等 did-finish-load 后再发送，确保监听器已就绪
    const doSend = () => {
      if (!reminderWindow || reminderWindow.isDestroyed()) return
      reminderWindow.webContents.send('reminder:popup', payload)
      logger.info('ReminderWindowManager', `已向提醒窗口推送: ${payload.title}`)
    }
    if (reminderWindow.webContents.isLoading()) {
      reminderWindow.webContents.once('did-finish-load', doSend)
    } else {
      doSend()
    }
  } catch (e) {
    logger.error('ReminderWindowManager', `推送提醒失败: ${e.message}`)
  }
}

/**
 * 获取提醒窗口实例
 * @returns {BrowserWindow|null}
 */
function getReminderWindow () {
  return reminderWindow
}

module.exports = {
  createReminderWindow,
  destroyReminderWindow,
  showReminderWindow,
  hideReminderWindow,
  sendReminder,
  getReminderWindow
}