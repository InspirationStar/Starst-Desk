// ============================================================
// 启动前飞行检查（Startup Preflight）
// 职责：在应用启动前检测网络连通性与关键文件完整性，
//       若检测失败则展示独立窗口供用户查看问题并重试。

// ============================================================

const { app, BrowserWindow, ipcMain } = require('electron')
const net = require('net')
const fs = require('fs')
const path = require('path')
const logger = require('./logger.js')

// 网络检测目标列表：任一可达即视为网络可用
const STARTUP_NETWORK_TARGETS = [
  { host: 'www.baidu.com', port: 443 },
  { host: 'www.qq.com', port: 443 },
  { host: 'unpkg.com', port: 443 }
]

// 关键启动文件清单：相对项目根目录的路径与最小字节数
// dist/index.html：渲染进程入口
// dist/assets/js/global-*.js：全局依赖打包产物（Vite 哈希命名，使用通配匹配）
const REQUIRED_FILE_RULES = [
  { relPath: path.join('dist', 'index.html'), minSize: 1024, glob: false },
  { relPath: path.join('dist', 'assets', 'js'), minSize: 0, glob: false, isDir: true },
  { relPath: path.join('dist', 'assets', 'js', 'global-*.js'), minSize: 100_000, glob: true }
]

// 启动检查窗口实例引用
let startupCheckWindow = null
// 检测通过后的回调（由 main.js 注入，用于继续正常启动流程）
let onStartupReadyCallback = null

/**
 * 应用是否处于开发环境
 */
function isDev () {
  return process.env.NODE_ENV === 'development'
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

/**
 * 尝试建立 TCP 连接到指定 host:port，超时则失败
 * @param {string} host 目标主机
 * @param {number} port 目标端口
 * @param {number} timeout 超时毫秒
 * @returns {Promise<boolean>} 是否可达
 */
function probeTcpConnect (host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch (_) { /* 忽略销毁异常 */ }
      resolve(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

/**
 * 检查网络连通性：依次尝试 STARTUP_NETWORK_TARGETS 中的目标，
 * 任一可达即视为通过；全部失败时返回拼接的错误明细。
 * @param {number} timeout 单次连接超时毫秒，默认 2500
 * @returns {Promise<{ok: boolean, detail: string}>>}
 */
async function checkNetworkAvailable (timeout = 2500) {
  const failures = []
  for (const { host, port } of STARTUP_NETWORK_TARGETS) {
    const ok = await probeTcpConnect(host, port, timeout)
    if (ok) {
      return { ok: true, detail: '' }
    }
    failures.push(`${host}:${port} 连接超时或被拒绝`)
  }
  return { ok: false, detail: failures.join('\n') }
}

/**
 * 在目录中匹配 glob 简易模式（仅支持末段含 *），返回首个匹配文件路径
 * @param {string} dir 目录绝对路径
 * @param {string} pattern 文件名模式，如 'global-*.js'
 * @returns {string|null} 匹配到的文件绝对路径
 */
function matchGlobFile (dir, pattern) {
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch (_) {
    return null
  }
  const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
  for (const name of entries) {
    if (regex.test(name)) {
      return path.join(dir, name)
    }
  }
  return null
}

/**
 * 检查关键文件完整性：遍历 REQUIRED_FILE_RULES 验证存在性与大小
 * @returns {string[]} 错误信息列表，空数组表示全部通过
 */
function checkRequiredFiles () {
  const projectRoot = path.join(__dirname, '..', '..')
  const missing = []

  for (const rule of REQUIRED_FILE_RULES) {
    const absPath = path.join(projectRoot, rule.relPath)
    try {
      if (rule.glob) {
        // glob 模式：在所在目录中匹配
        const dir = path.dirname(absPath)
        const pattern = path.basename(absPath)
        const matched = matchGlobFile(dir, pattern)
        if (!matched) {
          missing.push(`${rule.relPath} 不存在`)
          continue
        }
        const size = fs.statSync(matched).size
        if (size < rule.minSize) {
          missing.push(`${rule.relPath} 文件异常，大小只有 ${size} 字节`)
        }
        continue
      }

      if (rule.isDir) {
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
          missing.push(`${rule.relPath} 目录不存在`)
        }
        continue
      }

      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        missing.push(`${rule.relPath} 不存在`)
        continue
      }
      const size = fs.statSync(absPath).size
      if (size < rule.minSize) {
        missing.push(`${rule.relPath} 文件异常，大小只有 ${size} 字节`)
      }
    } catch (error) {
      missing.push(`${rule.relPath} 无法读取：${error.message}`)
    }
  }
  return missing
}

/**
 * 启动前飞行检查主入口：网络连通性 + 关键文件完整性
 * @returns {Promise<string[]>} 错误信息列表，空数组表示全部通过
 */
async function runStartupPreflight () {
  const errors = []

  // 1. 网络连通性
  try {
    const { ok, detail } = await checkNetworkAvailable()
    if (!ok) {
      errors.push(
        '网络连接不可用，软件启动被拦截。\n' +
        '请先连接网络，或检查防火墙/代理是否阻止本软件访问网络。\n' +
        detail
      )
    }
  } catch (error) {
    errors.push(`网络检测异常：${error.message}`)
  }

  // 2. 关键文件完整性
  try {
    const fileErrors = checkRequiredFiles()
    if (fileErrors.length > 0) {
      errors.push('软件关键文件缺失或损坏：\n' + fileErrors.join('\n'))
    }
  } catch (error) {
    errors.push(`文件检测异常：${error.message}`)
  }

  return errors
}

/**
 * 注册启动检查窗口所需的 IPC 通道
 * - startup-check:retry：渲染进程请求重新检测
 * - startup-check:exit：渲染进程请求退出应用
 */
function registerStartupCheckIpc () {
  if (registerStartupCheckIpc._registered) return
  registerStartupCheckIpc._registered = true

  ipcMain.handle('startup-check:retry', async () => {
    try {
      const errors = await runStartupPreflight()
      if (errors.length === 0) {
        // 检测通过：销毁检查窗口并触发回调继续启动
        closeStartupCheckWindow()
        if (typeof onStartupReadyCallback === 'function') {
          const cb = onStartupReadyCallback
          onStartupReadyCallback = null
          cb()
        }
        return { ok: true, errors: [] }
      }
      // 仍有错误：推送给渲染进程刷新展示
      sendErrorsToView(errors)
      return { ok: false, errors }
    } catch (error) {
      logger.error('StartupCheck', `重新检测失败: ${error.message}`)
      return { ok: false, errors: [error.message] }
    }
  })

  ipcMain.on('startup-check:exit', () => {
    logger.info('StartupCheck', '用户选择退出应用')
    app.quit()
  })
}

/**
 * 向启动检查窗口推送错误列表
 * @param {string[]} errors
 */
function sendErrorsToView (errors) {
  if (startupCheckWindow && !startupCheckWindow.isDestroyed()) {
    startupCheckWindow.webContents.send('startup-check:errors', { errors })
  }
}

/**
 * 关闭并销毁启动检查窗口
 */
function closeStartupCheckWindow () {
  if (startupCheckWindow && !startupCheckWindow.isDestroyed()) {
    startupCheckWindow.destroy()
  }
  startupCheckWindow = null
}

/**
 * 创建启动检查失败窗口
 * @param {string[]} errors 错误列表
 * @param {Function} onReady 检测通过后的回调（继续正常启动）
 */
function createStartupCheckWindow (errors, onReady) {
  registerStartupCheckIpc()
  onStartupReadyCallback = onReady

  const preloadPath = path.join(__dirname, '..', 'preload.js')
  startupCheckWindow = new BrowserWindow({
    width: 880,
    height: 620,
    minWidth: 760,
    minHeight: 520,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#1C1B1F',
    resizable: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  // 窗口就绪后推送错误列表
  startupCheckWindow.once('ready-to-show', () => {
    sendErrorsToView(errors)
  })

  // 设置 CSP 策略
  setupCSP(startupCheckWindow)

  // 根据环境加载渲染入口
  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    // 开发模式：通过路由 hash 进入启动检查页
    startupCheckWindow.loadURL('http://localhost:5173/#/startup-check')
    startupCheckWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    startupCheckWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'), { hash: '/startup-check' })
  }

  startupCheckWindow.on('closed', () => {
    startupCheckWindow = null
  })

  logger.info('StartupCheck', `启动检查窗口已创建，发现 ${errors.length} 个问题`)
}

module.exports = {
  checkNetworkAvailable,
  checkRequiredFiles,
  runStartupPreflight,
  createStartupCheckWindow,
  closeStartupCheckWindow,
  registerStartupCheckIpc
}