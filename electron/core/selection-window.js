// ============================================================
// Selection Window Manager
// 管理全屏透明选区窗口（无标题栏、无边框、覆盖整个屏幕）
// 用户在此窗口上拖拽框选，确认后返回坐标
// 绕开 desktopCapturer.getSources 的 1.7s 延迟
// ============================================================

const { BrowserWindow, screen, ipcMain } = require('electron')
const path = require('path')
const logger = require('./logger.js')

let selectionWin = null
let mainWindowRef = null  // 缓存主窗口引用，避免 find 时找不到

/**
 * 设置主窗口引用（在 whenReady 里调用）
 */
function setMainWindow (win) {
  mainWindowRef = win
}

/**
 * 计算所有显示器的合并边界（覆盖全部屏幕）
 */
function getScreenBounds () {
  const displays = screen.getAllDisplays()
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const d of displays) {
    const b = d.bounds
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 创建全屏选区窗口
 * 使用 Win32 layered window 实现视觉透明（鼠标事件正常捕获）
 */
function createSelectionWindow () {
  if (selectionWin && !selectionWin.isDestroyed()) {
    return selectionWin
  }

  const bounds = getScreenBounds()
  logger.info('SelectionWindow', `创建选区窗口: ${bounds.width}x${bounds.height} @(${bounds.x},${bounds.y})`)

  selectionWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,           // 必须为 true 才能实现视觉透明
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    // 关键：接受鼠标事件，不穿透
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: false
    }
  })

  selectionWin.loadFile(path.join(__dirname, '..', '..', 'resources', 'selection.html'))
  if (process.env.NODE_ENV === 'development') {
    selectionWin.webContents.openDevTools({ mode: 'detach' })
  }

  selectionWin.once('ready-to-show', () => {
    if (!selectionWin.isDestroyed()) selectionWin.show()
  })

  selectionWin.on('closed', () => {
    logger.info('SelectionWindow', '选区窗口已关闭')
    selectionWin = null
  })

  return selectionWin
}

/**
 * 注册选区窗口相关的 IPC 通道
 */
function registerSelectionChannels () {
  // 打开选区窗口
  ipcMain.handle('selection:open', async () => {
    try {
      const win = createSelectionWindow()
      await new Promise((resolve, reject) => {
        if (win.isVisible()) return resolve()
        const timer = setTimeout(() => reject(new Error('selection window timeout')), 5000)
        win.once('show', () => { clearTimeout(timer); resolve() })
        win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
      })
      logger.info('SelectionWindow', '选区窗口已显示')
      return { ok: true }
    } catch (err) {
      logger.error('SelectionWindow', `打开选区窗口失败: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  // 用户确认选区
  ipcMain.on('selection:confirm', (event, data) => {
    logger.info('SelectionWindow', `用户确认选区: ${JSON.stringify(data)}`)
    const selWin = BrowserWindow.fromWebContents(event.sender)
    if (selWin) selWin.close()
    // 直接发送回主窗口（缓存引用，不遍历）
    const mainWin = mainWindowRef
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('selection:result', data)
    } else {
      logger.error('SelectionWindow', '主窗口不可用，无法发送 selection:result')
    }
  })

  // 用户取消
  ipcMain.on('selection:cancel', (event) => {
    logger.info('SelectionWindow', '用户取消截图')
    const selWin = BrowserWindow.fromWebContents(event.sender)
    if (selWin) selWin.close()
    const mainWin = mainWindowRef
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('selection:cancelled', null)
    }
  })
}

/**
 * 销毁选区窗口
 */
function destroySelectionWindow () {
  if (selectionWin && !selectionWin.isDestroyed()) {
    selectionWin.close()
  }
  selectionWin = null
}

module.exports = {
  createSelectionWindow,
  registerSelectionChannels,
  destroySelectionWindow,
  setMainWindow,
  getScreenBounds
}