// ============================================================
// 专注护盾（主进程）
// 专注会话期间定时检测前台窗口，若用户切换到非白名单应用，
// 通过灵动岛弹出提醒，引导用户回到专注任务。
// 检测方式：koffi FFI 调用 Win32 API（无 PowerShell 依赖，无外部进程）

// ============================================================

const { execSync } = require('child_process')
const path = require('path')
const logger = require('./logger.js')

// ----------------------------------------------------------
// 默认白名单：系统关键进程（资源管理器/任务管理器/设置等）
// ----------------------------------------------------------
const DEFAULT_ALLOWED_APPS = [
  { name: 'Windows 资源管理器', process: 'explorer.exe', path: '', system: true },
  { name: '任务管理器', process: 'taskmgr.exe', path: '', system: true },
  { name: 'Windows 设置', process: 'systemsettings.exe', path: '', system: true },
  { name: '开始菜单', process: 'startmenuexperiencehost.exe', path: '', system: true },
  { name: 'Windows 搜索', process: 'searchhost.exe', path: '', system: true },
  { name: '输入法与文本服务', process: 'textinputhost.exe', path: '', system: true },
  { name: '桌面窗口管理器', process: 'dwm.exe', path: '', system: true },
  // 其他常见系统进程
  { name: 'Shell 主机', process: 'shellhost.exe', path: '', system: true },
  { name: 'SIH 主机', process: 'sihost.exe', path: '', system: true },
  { name: 'CTF 加载器', process: 'ctfmon.exe', path: '', system: true },
  { name: '应用框架主机', process: 'applicationframehost.exe', path: '', system: true },
  { name: '客户端/服务器运行时', process: 'csrss.exe', path: '', system: true },
  { name: '服务控制管理器', process: 'svchost.exe', path: '', system: true }
]

// ----------------------------------------------------------
// 检测间隔与提醒节流
// ----------------------------------------------------------
const CHECK_INTERVAL_MS = 1200   // 每 1.2 秒检测一次前台窗口
const ALERT_THROTTLE_MS = 10000  // 距上次提醒超过 10 秒才再次提醒

// ----------------------------------------------------------
// 护盾运行状态
// ----------------------------------------------------------
let guardEnabled = false
let allowedApps = new Set()       // 白名单集合（进程名 + 完整路径）
let checkTimer = null             // 检测定时器
let lastAlertTime = 0             // 上次提醒时间戳（毫秒）
let lastHwnd = null               // 上次触发提醒的窗口句柄

// ----------------------------------------------------------
// koffi Win32 API 句柄（懒加载，首次调用时初始化）
// ----------------------------------------------------------
let win32Api = null

/**
 * 初始化 koffi Win32 API 绑定
 * 仅在 Windows 平台首次调用时加载 user32.dll / kernel32.dll
 * @returns {Object|null} API 函数集合，null 表示不可用
 */
function initWin32Api () {
  if (win32Api !== null) return win32Api || null
  if (process.platform !== 'win32') return null

  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')

    win32Api = {
      GetForegroundWindow: user32.func('void *GetForegroundWindow()'),
      GetWindowTextW: user32.func('int GetWindowTextW(void *hWnd, uint16_t *buf, int count)'),
      GetWindowThreadProcessId: user32.func('uint32_t GetWindowThreadProcessId(void *hWnd, uint32_t *outPid)'),
      OpenProcess: kernel32.func('void *OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
      CloseHandle: kernel32.func('bool CloseHandle(void *handle)'),
      // QueryFullProcessImageNameW 只需 PROCESS_QUERY_LIMITED_INFORMATION 权限
      QueryFullProcessImageNameW: kernel32.func('bool QueryFullProcessImageNameW(void *hProcess, uint32_t flags, uint16_t *buf, uint32_t *outLen)')
    }
    logger.info('FocusGuard', 'koffi Win32 API 初始化成功，前台窗口检测将使用 FFI（无 PowerShell）')
  } catch (err) {
    logger.warn('FocusGuard', `koffi 初始化失败: ${err.message}，前台窗口检测不可用`)
    win32Api = false // 标记初始化失败，避免重复尝试
  }

  return win32Api || null
}

/**
 * 获取前台窗口信息
 * 通过 koffi 调用 Win32 API，无需 PowerShell
 * 进程名获取失败时回退到 tasklist（轻量命令行，非 PS）
 * @returns {{hwnd:string, pid:number, title:string, processName:string, processPath:string}|null}
 */
function getForegroundWindowInfo () {
  const api = initWin32Api()
  if (!api) return null

  try {
    const hWnd = api.GetForegroundWindow()
    if (!hWnd) return null

    // 获取窗口标题（UTF-16W）
    const titleBuf = new Uint16Array(512)
    const titleLen = api.GetWindowTextW(hWnd, titleBuf, 512)
    const windowTitle = titleLen > 0
      ? Buffer.from(titleBuf.buffer, 0, titleLen * 2).toString('utf16le')
      : ''

    // 获取进程 ID
    const pidBuf = new Uint32Array(1)
    api.GetWindowThreadProcessId(hWnd, pidBuf)
    const pid = pidBuf[0]
    if (pid === 0) return null

    // 获取进程完整路径：QueryFullProcessImageNameW
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    let processPath = ''
    const hProc = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
    if (hProc) {
      const pathBuf = new Uint16Array(1024)
      const lenBuf = new Uint32Array(1)
      lenBuf[0] = 1024
      const ok = api.QueryFullProcessImageNameW(hProc, 0, pathBuf, lenBuf)
      if (ok && lenBuf[0] > 0) {
        processPath = Buffer.from(pathBuf.buffer, 0, lenBuf[0] * 2).toString('utf16le')
      }
      api.CloseHandle(hProc)
    }

    // 回退：koffi 获取进程路径失败时用 tasklist（轻量命令行工具，非 PowerShell）
    if (!processPath) {
      try {
        const out = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, {
          windowsHide: true,
          timeout: 3000,
          encoding: 'utf8'
        })
        const match = out.match(/^"([^"]+)"/)
        if (match) processPath = match[1]
      } catch (e) { /* 忽略 tasklist 失败 */ }
    }

    const processName = processPath ? path.basename(processPath) : ''
    return {
      hwnd: String(hWnd),
      pid,
      title: windowTitle,
      processName: processName.toLowerCase(),
      processPath: processPath.toLowerCase()
    }
  } catch (err) {
    logger.warn('FocusGuard', `获取前台窗口失败: ${err.message}`)
    return null
  }
}

// ----------------------------------------------------------
// 白名单解析
// ----------------------------------------------------------

/**
 * 规范化进程名/路径：去引号、去空白、转小写
 * @param {string} value
 * @returns {string}
 */
function normalizeProcessValue (value) {
  return String(value || '').trim().replace(/^"|"$/g, '').toLowerCase()
}

/**
 * 从 options 解析白名单集合
 * 支持的 options 字段：guardWhitelist 或 focusGuardWhitelist
 * 每项可以是字符串（进程名）或对象 { process, path }
 * @param {Object} options
 * @returns {Set<string>}
 */
function parseAllowedApps (options) {
  const opts = options || {}
  let apps = null
  if (Array.isArray(opts.guardWhitelist)) {
    apps = opts.guardWhitelist
  } else if (Array.isArray(opts.focusGuardWhitelist)) {
    apps = opts.focusGuardWhitelist
  } else {
    apps = DEFAULT_ALLOWED_APPS
  }

  const set = new Set()
  for (const app of apps) {
    if (typeof app === 'string') {
      const process = normalizeProcessValue(app)
      if (process) set.add(process)
    } else if (app && typeof app === 'object') {
      const process = normalizeProcessValue(app.process)
      const p = normalizeProcessValue(app.path)
      if (process) set.add(process)
      if (p) {
        set.add(p)
        set.add(path.basename(p))
      }
    }
  }
  return set
}

// ----------------------------------------------------------
// 启停护盾
// ----------------------------------------------------------

/**
 * 启动护盾检测
 * @param {Object} [options] - 专注会话选项
 *   - guardWhitelist: Array<{process, path}> 自定义白名单
 *   - focusGuardWhitelist: 同上（兼容字段名）
 */
function startGuard (options = {}) {
  guardEnabled = true
  allowedApps = parseAllowedApps(options)
  lastHwnd = null
  // 启动后 2.5 秒内不触发提醒，避免刚启动时误报
  lastAlertTime = Date.now() + 2500

  if (checkTimer) clearInterval(checkTimer)
  checkTimer = setInterval(checkForegroundWindow, CHECK_INTERVAL_MS)
  logger.info('FocusGuard', `护盾已启动，白名单应用数: ${allowedApps.size}`)
}

/**
 * 停止护盾检测
 */
function stopGuard () {
  guardEnabled = false
  allowedApps = new Set()
  lastHwnd = null
  lastAlertTime = 0
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
  logger.info('FocusGuard', '护盾已停止')
}

/**
 * 护盾是否已启动
 * @returns {boolean}
 */
function isGuardEnabled () {
  return guardEnabled
}

// ----------------------------------------------------------
// 前台窗口检测
// ----------------------------------------------------------

/**
 * 检测前台窗口：若不在白名单中且距上次提醒超过阈值，通过灵动岛发送提醒
 */
function checkForegroundWindow () {
  if (!guardEnabled) return

  const info = getForegroundWindowInfo()
  if (!info) return

  // 自身进程或无标题窗口不检测
  if (info.pid === process.pid || !info.title) return

  // 白名单匹配：进程名或完整路径任一命中即放行
  if (allowedApps.has(info.processName) || allowedApps.has(info.processPath)) return

  // 节流：距上次提醒不足 10 秒则跳过
  const now = Date.now()
  if (now - lastAlertTime < ALERT_THROTTLE_MS) return

  lastHwnd = info.hwnd
  lastAlertTime = now
  notifyGuardAlert(info.title)
}

// ----------------------------------------------------------
// 灵动岛提醒
// ----------------------------------------------------------

/**
 * 通过灵动岛发送护盾提醒
 * @param {string} appTitle - 前台窗口标题
 */
function notifyGuardAlert (appTitle) {
  try {
    const islandWindowManager = require('./island-window-manager.js')
    const safeTitle = String(appTitle || '其他应用').trim().slice(0, 60)
    islandWindowManager.showIsland({
      type: 'guard',
      title: '专注护盾提醒',
      body: `检测到你切到了「${safeTitle}」，先回到当前专注任务`,
      icon: 'Shield',
      duration: 4000
    })
    logger.info('FocusGuard', `已发送护盾提醒: ${safeTitle}`)
  } catch (err) {
    logger.error('FocusGuard', `发送护盾提醒失败: ${err.message}`)
  }
}

// ----------------------------------------------------------
// 已安装应用列表（供白名单配置 UI）
// ----------------------------------------------------------

/**
 * 从 Windows 注册表读取已安装应用列表（Uninstall 键）
 * 使用 reg query 命令读取，避免 native 模块依赖
 * @returns {Array<{name:string, process:string, path:string, system:boolean}>}
 */
function readInstalledAppsFromRegistry () {
  if (process.platform !== 'win32') return []

  const roots = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]

  const apps = []
  for (const root of roots) {
    let subKeys = []
    try {
      const out = execSync(`reg query "${root}"`, {
        windowsHide: true,
        timeout: 5000,
        encoding: 'utf8'
      })
      // 解析 reg query 输出：每行一个子键，格式为完整键路径
      subKeys = out.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && line.startsWith(root + '\\'))
        .map(line => line.slice(root.length + 1))
    } catch (e) {
      continue
    }

    for (const subKey of subKeys) {
      // 安全校验：subKey 来自 reg query 输出解析，仅允许字母数字、空格及常见注册表键名字符
      // 防止注册表键名包含 "、&、| 等特殊字符导致命令注入
      if (!/^[a-zA-Z0-9 _\-.{}\\]+$/.test(subKey)) {
        continue // 跳过包含危险字符的子键
      }
      try {
        const out = execSync(`reg query "${root}\\${subKey}"`, {
          windowsHide: true,
          timeout: 3000,
          encoding: 'utf8'
        })
        const values = parseRegOutput(out)
        // 系统组件跳过
        if (values.SystemComponent === '0x1') continue
        const displayName = (values.DisplayName || '').trim()
        if (!displayName) continue

        // 从 DisplayIcon 或 InstallLocation 提取 exe 路径
        const exePath = extractExePath(values.DisplayIcon || '', values.InstallLocation || '', displayName)
        const processName = exePath ? path.basename(exePath).toLowerCase() : ''
        if (processName) {
          apps.push({
            name: displayName,
            process: processName,
            path: exePath,
            system: false
          })
        }
      } catch (e) {
        // 单个子键读取失败不影响整体
        continue
      }
    }
  }
  return apps
}

/**
 * 解析 reg query 输出为键值对象
 * 输入示例：
 *   "DisplayName"    REG_SZ    "Google Chrome"
 *   "SystemComponent"    REG_DWORD    0x0
 * @param {string} output
 * @returns {Object<string,string>}
 */
function parseRegOutput (output) {
  const result = {}
  const lines = output.split(/\r?\n/)
  for (const line of lines) {
    // 匹配 "KeyName"    REG_TYPE    value
    const match = line.match(/^\s*"([^"]+)"\s+REG_\S+\s+(.*)$/)
    if (match) {
      let value = match[2].trim()
      // 去除包裹引号
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1)
      }
      result[match[1]] = value
    }
  }
  return result
}

/**
 * 从 DisplayIcon / InstallLocation 提取 exe 完整路径
 * @param {string} displayIcon
 * @param {string} installLocation
 * @param {string} displayName
 * @returns {string}
 */
function extractExePath (displayIcon, installLocation, displayName) {
  // 优先从 DisplayIcon 提取
  let text = String(displayIcon || '').trim()
  if (text) {
    if (text.startsWith('"')) {
      const end = text.indexOf('"', 1)
      if (end > 1) text = text.slice(1, end)
    } else {
      text = text.split(',')[0].trim()
      const exeIndex = text.toLowerCase().indexOf('.exe')
      if (exeIndex !== -1) text = text.slice(0, exeIndex + 4)
    }
    text = text.trim().replace(/^"|"$/g, '')
    if (text.toLowerCase().endsWith('.exe')) {
      try {
        // 展开环境变量
        text = text.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '')
      } catch (e) { /* 忽略 */ }
      if (text.toLowerCase().endsWith('.exe')) return text
    }
  }

  // 回退：从 InstallLocation 查找与 displayName 匹配的 exe
  const folder = String(installLocation || '').trim().replace(/^"|"$/g, '')
  if (!folder) return ''
  // 安全修复：改用 fs.readdirSync 替代 dir 命令，避免 folder 含 "、% 等特殊字符导致命令注入
  try {
    const fs = require('fs')
    const entries = fs.readdirSync(folder)
    const exes = entries.filter(f => f.toLowerCase().endsWith('.exe'))
    if (exes.length === 0) return ''
    // 优先选择与 displayName 同名的 exe
    const wanted = String(displayName || '').toLowerCase().replace(/\s+/g, '')
    let bestMatch = ''
    let bestScore = 1
    for (const exe of exes) {
      const exeKey = exe.toLowerCase().replace(/\.exe$/, '').replace(/\s+/g, '')
      const score = wanted && (exeKey.includes(wanted) || wanted.includes(exeKey)) ? 0 : 1
      if (score < bestScore || (score === bestScore && !bestMatch)) {
        bestScore = score
        bestMatch = path.join(folder, exe)
      }
    }
    return bestMatch
  } catch (e) {
    // 目录不存在或无法读取，返回空字符串
    return ''
  }
}

/**
 * 获取已安装应用列表（默认白名单 + 注册表已安装应用），去重后返回
 * 系统应用在前，用户应用按名称排序
 * @returns {Array<{name:string, process:string, path:string, system:boolean}>}
 */
function getInstalledApps () {
  const seen = new Set()
  const merged = []
  const allApps = [...DEFAULT_ALLOWED_APPS, ...readInstalledAppsFromRegistry()]
  for (const app of allApps) {
    const process = normalizeProcessValue(app.process)
    const p = normalizeProcessValue(app.path)
    const key = p || process
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push({
      name: String(app.name || process),
      process,
      path: String(app.path || ''),
      system: !!app.system
    })
  }
  const systemApps = merged.filter(app => app.system)
  const userApps = merged
    .filter(app => !app.system)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return [...systemApps, ...userApps]
}

module.exports = {
  startGuard,
  stopGuard,
  isGuardEnabled,
  checkForegroundWindow,
  getInstalledApps,
  // 暴露默认白名单供外部读取
  getDefaultAllowedApps: () => DEFAULT_ALLOWED_APPS
}