// ============================================================
// 用户活动检测服务
// 职责：检测空闲状态、统计键鼠活动、识别前台窗口、汇总电脑使用时间
// 数据安全：窗口标题、进程名经 AES-256-GCM 加密后入库
// 依赖：Electron 内置 API + koffi（FFI 调用 Win32 API）+ Node.js 内置模块
// ============================================================

const { powerMonitor, screen } = require('electron')
const { execSync } = require('child_process')
const crypto = require('crypto')
const os = require('os')
const logger = require('./logger.js')
const { getDb } = require('./../dao/database.js')
const dateUtils = require('./../utils/date-utils.js')
const aiAdapterFactory = require('./ai-adapter.js')
const aiConfigDao = require('./../dao/ai-config-dao.js')
const appSettingDao = require('./../dao/app-setting-dao.js')

// ============================================================
// 常量配置
// ============================================================

// 用户空闲超过该阈值视为"离开"（秒）
const IDLE_AWAY_THRESHOLD = 5 * 60
// 用户空闲超过该阈值视为"空闲"（秒）
const IDLE_IDLE_THRESHOLD = 30
// 鼠标采样间隔（毫秒）
const MOUSE_SAMPLE_INTERVAL = 1000
// 活动汇总间隔（毫秒）：每分钟落库一次
const FLUSH_INTERVAL = 60 * 1000
// 前台窗口采样间隔（毫秒）：每 30 秒采样一次
const FOREGROUND_SAMPLE_INTERVAL = 30 * 1000
// 离开状态进入 sleeping 时通知桌宠的最小间隔（毫秒）
const PET_SLEEP_NOTIFY_MIN_INTERVAL = 60 * 1000
// 键盘轮询间隔（毫秒）：50ms = 20Hz，足以捕捉按下沿，与 pet-key-watcher 同源策略
const KEYBOARD_SAMPLE_INTERVAL = 50
// 键盘活跃窗口（毫秒）：最后一次按键后该窗口内视为键盘仍在活动
const KEYBOARD_ACTIVE_WINDOW = 2000
// 修饰键虚拟键码：Ctrl/Ctrl/Shift/Shift/Alt/Alt/Win/Win
const MODIFIER_VK = new Set([0x10, 0x11, 0x12, 0x5B, 0x5C])
// 键盘监听覆盖的虚拟键码范围（字母/数字/空格/回车/退格/Tab/Esc/方向键/修饰键/F1-F12）
const KEYBOARD_VK_CODES = [
  ...range(0x08, 0x0E),   // Backspace/Tab/Clear/Enter
  ...range(0x1B, 0x1B),   // Esc
  0x20,                   // Space
  ...range(0x25, 0x29),   // ←↑→↓/Select
  ...range(0x30, 0x39),   // 0-9
  ...range(0x41, 0x5A),   // A-Z
  ...range(0x70, 0x7B),   // F1-F12
  0x10, 0x11, 0x12, 0x5B, 0x5C // 修饰键
]
// 鼠标按键虚拟键码：左键/右键/中键（用于点击次数统计）
const MOUSE_BUTTON_VK = [0x01, 0x02, 0x04]

// AI 分类持久化键（app_settings 表中的 key）
const APP_CATEGORIES_AI_KEY = 'app_categories_ai'

// ============================================================
// AI 分类持久化读写（app-setting-dao，JSON 对象：{ "进程名": "类别" }）
// 进程名统一以小写、不含 .exe 后缀的形式存储，与 categorizeApp 查询键一致
// ============================================================

/**
 * 读取 AI 应用分类映射
 * @returns {Object<string, string>} 进程名（小写无后缀）→ 类别
 */
function getAiAppCategories () {
  return appSettingDao.getJson(APP_CATEGORIES_AI_KEY, {}) || {}
}

/**
 * 写入 AI 应用分类映射（整体覆盖）
 * @param {Object<string, string>} map 进程名 → 类别
 * @returns {boolean} 是否成功
 */
function updateAiAppCategories (map) {
  return appSettingDao.setJson(APP_CATEGORIES_AI_KEY, map)
}

/**
 * 清除 AI 应用分类持久化，回到硬编码默认分类
 * @returns {boolean} 是否成功
 */
function resetAiAppCategories () {
  return appSettingDao.del(APP_CATEGORIES_AI_KEY)
}

// ============================================================
// 活跃应用分类映射
// 进程名（小写、不含 .exe）匹配到对应类别，未命中视为"其他"
// 用于活动统计页"活跃应用类别"指标，只展示类别 + 时长占比，不展示具体应用名
// ============================================================
const APP_CATEGORIES = {
  // 开发工具
  code: '开发', devenv: '开发', idea: '开发', eclipse: '开发', intellij: '开发',
  webstorm: '开发', pycharm: '开发', goland: '开发', rider: '开发', clion: '开发',
  datagrip: '开发', rubymine: '开发', phpstorm: '开发', vscode: '开发',
  'code.exe': '开发', 'devenv.exe': '开发', cursor: '开发', sublime_text: '开发',
  // 办公
  winword: '办公', excel: '办公', powerpnt: '办公', onenote: '办公', outlook: '办公',
  wps: '办公', et: '办公', wpp: '办公', 'wpsoffice': '办公', 'soffice': '办公',
  'winword.exe': '办公', 'excel.exe': '办公', 'powerpnt.exe': '办公',
  // 浏览器
  chrome: '浏览', msedge: '浏览', firefox: '浏览', safari: '浏览', opera: '浏览',
  brave: '浏览', vivaldi: '浏览', 'chrome.exe': '浏览', 'msedge.exe': '浏览',
  // 社交/通讯
  wechat: '社交', qq: '社交', dingtalk: '社交', feishu: '社交', lark: '社交',
  telegram: '社交', tim: '社交', 'wechat.exe': '社交', 'qq.exe': '社交',
  // 娱乐
  steam: '娱乐', spotify: '娱乐', netease_cloudmusic: '娱乐', cloudmusic: '娱乐',
  qqmusic: '娱乐', kugou: '娱乐', potplayer: '娱乐', vlc: '娱乐',
  'mpc-hc': '娱乐', mpc64: '娱乐', 'bilibili': '娱乐', 'iqiyi': '娱乐',
  // 终端/Shell
  'powershell': '开发', 'pwsh': '开发', 'cmd': '开发', 'windowsterminal': '开发',
  'wt': '开发', 'conhost': '开发', 'git-bash': '开发'
}

/**
 * 根据进程名匹配应用类别
 * 优先级：AI 分类持久化 > 硬编码 APP_CATEGORIES > 模糊匹配 > "其他"
 * @param {string} processName 进程名（可能含 .exe 后缀、大小写混合）
 * @returns {string} 类别名（开发/办公/浏览/社交/娱乐/其他）
 */
function categorizeApp (processName) {
  if (!processName) return '其他'
  // 去除 .exe 后缀并转小写
  const base = processName.toLowerCase().replace(/\.exe$/, '')
  // 优先查 AI 分类持久化
  const aiCategories = getAiAppCategories()
  if (aiCategories[base]) return aiCategories[base]
  if (aiCategories[processName.toLowerCase()]) return aiCategories[processName.toLowerCase()]
  // 再查默认硬编码分类
  if (APP_CATEGORIES[base]) return APP_CATEGORIES[base]
  if (APP_CATEGORIES[processName.toLowerCase()]) return APP_CATEGORIES[processName.toLowerCase()]
  // 模糊匹配：进程名包含映射表中的关键词
  for (const key of Object.keys(APP_CATEGORIES)) {
    const cleanKey = key.replace(/\.exe$/, '')
    if (base.includes(cleanKey)) return APP_CATEGORIES[key]
  }
  return '其他'
}

/**
 * 生成 [start, end] 闭区间整数数组
 * @param {number} start
 * @param {number} end
 * @returns {number[]}
 */
function range (start, end) {
  const arr = []
  for (let i = start; i <= end; i++) arr.push(i)
  return arr
}

// ============================================================
// 数据加密：AES-256-GCM，密钥从机器 ID 派生
// ============================================================

// 缓存的派生密钥
let derivedKey = null

/**
 * 获取机器标识
 * Windows 下读取注册表 MachineGuid，失败回退到 hostname + platform
 * @returns {string}
 */
function getMachineId () {
  if (process.platform === 'win32') {
    try {
      // 通过 reg query 读取 MachineGuid（不依赖 PowerShell）
      const out = execSync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
        windowsHide: true,
        timeout: 3000,
        encoding: 'utf8'
      })
      const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/)
      if (match && match[1]) return match[1].trim()
    } catch (e) {
      // 读取失败，使用回退方案
      logger.warn('ActivityMonitor', `读取 MachineGuid 失败，使用回退标识: ${e.message}`)
    }
  }
  return `${os.hostname()}-${os.platform()}-${os.arch()}`
}

/**
 * 派生 AES-256 密钥（基于机器 ID + 固定盐值，使用 scrypt）
 * @returns {Buffer} 32 字节密钥
 */
function getDerivedKey () {
  if (derivedKey) return derivedKey
  const machineId = getMachineId()
  // 固定盐值：与机器 ID 共同作为密钥派生输入
  const salt = 'starst-desk-activity-v1-salt'
  derivedKey = crypto.scryptSync(machineId, salt, 32)
  return derivedKey
}

/**
 * 加密字符串，返回 { ciphertext, iv, authTag }（均为 base64）
 * @param {string} plaintext
 * @returns {{ciphertext:string, iv:string, authTag:string}|null}
 */
function encryptField (plaintext) {
  if (!plaintext) return null
  try {
    const key = getDerivedKey()
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64')
    }
  } catch (error) {
    logger.error('ActivityMonitor', `加密失败: ${error.message}`)
    return null
  }
}

/**
 * 解密字符串
 * @param {string} ciphertext base64
 * @param {string} iv base64
 * @param {string} authTag base64
 * @returns {string|null}
 */
function decryptField (ciphertext, iv, authTag) {
  if (!ciphertext || !iv || !authTag) return null
  try {
    const key = getDerivedKey()
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(authTag, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final()
    ])
    return decrypted.toString('utf8')
  } catch (error) {
    logger.error('ActivityMonitor', `解密失败: ${error.message}`)
    return null
  }
}

// ============================================================
// 前台窗口检测（Windows 平台）
// 通过 koffi FFI 调用 Win32 API 获取前台窗口标题与进程名
// 无 PowerShell 依赖，无外部进程，无安全软件拦截风险
// ============================================================

// koffi Win32 API 句柄（懒加载，首次调用时初始化）
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
      QueryFullProcessImageNameW: kernel32.func('bool QueryFullProcessImageNameW(void *hProcess, uint32_t flags, uint16_t *buf, uint32_t *outLen)'),
      // GetAsyncKeyState 用于键盘按下沿检测，高位（bit15）置位表示当前按下
      GetAsyncKeyState: user32.func('int16_t GetAsyncKeyState(int vKey)')
    }
    logger.info('ActivityMonitor', 'koffi Win32 API 初始化成功，前台窗口检测将使用 FFI（无 PowerShell）')
  } catch (err) {
    logger.warn('ActivityMonitor', `koffi 初始化失败: ${err.message}，前台窗口检测不可用`)
    win32Api = false // 标记初始化失败，避免重复尝试
  }

  return win32Api || null
}

/**
 * 获取前台窗口信息
 * 通过 koffi 调用 Win32 API，无需 PowerShell
 * 进程名获取失败时回退到 tasklist（轻量命令行，非 PS）
 * @returns {{processName:string, windowTitle:string}|null}
 */
function getForegroundWindow () {
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

    // 获取进程名：QueryFullProcessImageNameW 返回完整路径，取末段作为进程名
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    let processName = ''
    const hProc = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
    if (hProc) {
      const pathBuf = new Uint16Array(1024)
      const lenBuf = new Uint32Array(1)
      lenBuf[0] = 1024
      const ok = api.QueryFullProcessImageNameW(hProc, 0, pathBuf, lenBuf)
      if (ok && lenBuf[0] > 0) {
        const path = Buffer.from(pathBuf.buffer, 0, lenBuf[0] * 2).toString('utf16le')
        processName = path.split('\\').pop()
      }
      api.CloseHandle(hProc)
    }

    // 回退：koffi 获取进程名失败时用 tasklist（轻量命令行工具，非 PowerShell）
    if (!processName) {
      try {
        const out = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, {
          windowsHide: true,
          timeout: 3000,
          encoding: 'utf8'
        })
        const match = out.match(/^"([^"]+)"/)
        if (match) processName = match[1]
      } catch (e) { /* 忽略 tasklist 失败 */ }
    }

    return { processName, windowTitle }
  } catch (err) {
    logger.warn('ActivityMonitor', `获取前台窗口失败: ${err.message}`)
    return null
  }
}

// ============================================================
// 预编译 SQL 语句缓存
// ============================================================
// 预编译 SQL 语句缓存
// ============================================================
const stmts = {}

function getStmt (key, sql) {
  if (!stmts[key]) {
    stmts[key] = getDb().prepare(sql)
  }
  return stmts[key]
}

// ============================================================
// ActivityMonitor 服务类
// ============================================================

class ActivityMonitor {
  constructor () {
    // 是否已启动
    this.started = false

    // 定时器引用
    this.mouseTimer = null
    this.flushTimer = null
    this.foregroundTimer = null
    this.keyboardTimer = null

    // 当前状态
    this.current = {
      isIdle: false,           // 是否空闲（>IDLE_IDLE_THRESHOLD）
      isAway: false,           // 是否离开（>IDLE_AWAY_THRESHOLD）
      isLocked: false,         // 是否锁屏
      idleTime: 0,             // 当前连续空闲秒数
      activeSince: Date.now(), // 当前活跃段开始时间戳
      mouseDistance: 0,        // 本分钟鼠标移动距离
      clickCount: 0,           // 本分钟点击次数（估算）
      activeApp: null,         // 当前前台进程名
      activeWindow: null       // 当前前台窗口标题
    }

    // 上一秒鼠标位置（用于计算移动距离）
    this.lastMousePos = null

    // 键盘采样状态（本分钟累计）
    this.keystrokeCount = 0       // 本分钟按键按下沿次数
    this.hotkeyCount = 0          // 本分钟快捷键使用次数
    this.keyboardActiveMs = 0     // 本分钟键盘活动时长（毫秒）
    this.lastKeyTimestamp = 0     // 最近一次按键按下沿时间戳
    this.prevKeyDown = new Map()  // 上一帧按键按下状态（vk -> boolean）

    // 当前分钟起始时间戳（用于计算 duration）
    this.currentMinuteStart = Date.now()


    // 当前分钟活跃段开始时间
    this.currentActiveSpanStart = null

    // 上次通知桌宠 sleeping 的时间戳（节流）
    this.lastPetSleepNotify = 0

    // powerMonitor 事件解绑函数集合
    this.powerListeners = []
  }

  // ----------------------------------------------------------
  // 启动 / 停止
  // ----------------------------------------------------------

  /**
   * 防御性：确保键盘统计列存在
   * 迁移 021 可能因前置迁移失败而未执行，此处启动时自动补全列
   */
  ensureKeyboardStatsColumns () {
    try {
      const db = getDb()
      const checkAndAdd = (table, column, definition) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
        if (!cols.includes(column)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
          logger.info('ActivityMonitor', `防御性补全列: ${table}.${column}`)
        }
      }
      checkAndAdd('activity_log', 'hotkey_count', 'INTEGER DEFAULT 0')
      checkAndAdd('activity_log', 'keyboard_active_ms', 'INTEGER DEFAULT 0')
      checkAndAdd('daily_activity_summary', 'total_hotkeys', 'INTEGER DEFAULT 0')
      checkAndAdd('daily_activity_summary', 'total_keyboard_active_seconds', 'INTEGER DEFAULT 0')
    } catch (err) {
      logger.warn('ActivityMonitor', `键盘统计列检查失败（不影响鼠标统计）: ${err.message}`)
    }
  }

  /**
   * 启动监控
   */
  start () {
    if (this.started) {
      logger.warn('ActivityMonitor', '监控已在运行，跳过启动')
      return
    }
    // 防御性：确保键盘统计列存在（迁移 021 可能因前置迁移失败而未执行）
    this.ensureKeyboardStatsColumns()
    this.started = true
    this.currentMinuteStart = Date.now()
    this.current.activeSince = Date.now()

    // 鼠标采样：每秒一次
    this.mouseTimer = setInterval(() => this.sampleMouse(), MOUSE_SAMPLE_INTERVAL)
    // 活动汇总：每分钟一次
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL)
    // 前台窗口采样：每 30 秒一次
    this.foregroundTimer = setInterval(() => this.sampleForeground(), FOREGROUND_SAMPLE_INTERVAL)
    // 键盘采样：每 50ms 一次（按下沿检测 + 活动时长累加）
    this.keyboardTimer = setInterval(() => this.sampleKeyboard(), KEYBOARD_SAMPLE_INTERVAL)

    // 子需求7：不立即触发前台窗口采样，避免应用启动时立即调用 Win32 API
    // 首次采样将在 FOREGROUND_SAMPLE_INTERVAL（30 秒）后执行
    // this.sampleForeground()  // 已移除：避免启动时 PS 闪烁
    // 立即触发一次空闲检测（基于 powerMonitor.getSystemIdleTime，不依赖 PS）
    this.detectIdle()

    // 注册 powerMonitor 事件
    this.registerPowerListeners()

    logger.info('ActivityMonitor', '活动监控已启动（前台窗口采样延迟 30 秒后开始，避免启动时 PS 调用）')
  }

  /**
   * 停止监控
   */
  stop () {
    if (!this.started) return
    this.started = false

    if (this.mouseTimer) clearInterval(this.mouseTimer)
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.foregroundTimer) clearInterval(this.foregroundTimer)
    if (this.keyboardTimer) clearInterval(this.keyboardTimer)
    this.mouseTimer = null
    this.flushTimer = null
    this.foregroundTimer = null
    this.keyboardTimer = null

    this.unregisterPowerListeners()

    // 落库最后一段数据
    try {
      this.flush()
    } catch (e) {
      logger.warn('ActivityMonitor', `停止时落库失败: ${e.message}`)
    }

    logger.info('ActivityMonitor', '活动监控已停止')
  }

  // ----------------------------------------------------------
  // powerMonitor 事件
  // ----------------------------------------------------------

  registerPowerListeners () {
    const onSuspend = () => {
      logger.info('ActivityMonitor', '系统挂起，标记为离开')
      this.current.isLocked = false
      this.current.isAway = true
      this.flush()
    }
    const onResume = () => {
      logger.info('ActivityMonitor', '系统恢复，重置状态')
      this.current.isAway = false
      this.current.isLocked = false
      this.current.activeSince = Date.now()
      this.currentMinuteStart = Date.now()
    }
    const onLock = () => {
      logger.info('ActivityMonitor', '系统锁屏')
      this.current.isLocked = true
      this.flush()
    }
    const onUnlock = () => {
      logger.info('ActivityMonitor', '系统解锁')
      this.current.isLocked = false
      this.current.activeSince = Date.now()
      this.currentMinuteStart = Date.now()
    }

    powerMonitor.on('suspend', onSuspend)
    powerMonitor.on('resume', onResume)
    powerMonitor.on('lock-screen', onLock)
    powerMonitor.on('unlock-screen', onUnlock)

    this.powerListeners = [
      ['suspend', onSuspend],
      ['resume', onResume],
      ['lock-screen', onLock],
      ['unlock-screen', onUnlock]
    ]
  }

  unregisterPowerListeners () {
    for (const [evt, fn] of this.powerListeners) {
      try {
        powerMonitor.off(evt, fn)
      } catch (e) { /* 忽略 */ }
    }
    this.powerListeners = []
  }

  // ----------------------------------------------------------
  // 键盘采样
  // ----------------------------------------------------------

  /**
   * 每 50ms 轮询键盘按下状态，检测按下沿并累计：
   *   - keystrokeCount：按键按下沿次数
   *   - hotkeyCount：快捷键次数（非修饰键按下沿时任意修饰键处于按下状态）
   *   - keyboardActiveMs：键盘活动时长（毫秒），按键活跃窗口内累加
   * 数据安全：仅统计次数与时长，不记录具体按键字符，符合去敏感化要求
   */
  sampleKeyboard () {
    try {
      // 离开/锁屏状态下不统计键盘
      if (this.current.isAway || this.current.isLocked) {
        this.prevKeyDown.clear()
        return
      }

      const api = win32Api
      if (!api || !api.GetAsyncKeyState) return

      const now = Date.now()


      // 检测各键按下沿
      for (const vk of KEYBOARD_VK_CODES) {
        const down = (api.GetAsyncKeyState(vk) & 0x8000) !== 0
        const wasDown = this.prevKeyDown.get(vk) === true
        if (down && !wasDown) {
          // 按下沿：累计按键次数
          this.keystrokeCount++
          this.lastKeyTimestamp = now

          // 按键视为活跃，标记活跃段
          this.markActive()
        }
        this.prevKeyDown.set(vk, down)
      }

      // 检测鼠标按键按下沿（左键/右键/中键），累计点击次数
      for (const vk of MOUSE_BUTTON_VK) {
        const down = (api.GetAsyncKeyState(vk) & 0x8000) !== 0
        const wasDown = this.prevKeyDown.get(vk) === true
        if (down && !wasDown) {
          this.current.clickCount++
          this.markActive()
        }
        this.prevKeyDown.set(vk, down)
      }


    } catch (error) {
      logger.warn('ActivityMonitor', `键盘采样失败: ${error.message}`)
    }
  }

  // ----------------------------------------------------------
  // 鼠标采样
  // ----------------------------------------------------------

  /**
   * 每秒采样鼠标位置，计算移动距离
   * 同时检测空闲状态：若 idleTime > 0 视为无活动
   */
  sampleMouse () {
    try {
      // 先检测空闲时间
      this.detectIdle()

      // 离开/锁屏状态下不统计鼠标
      if (this.current.isAway || this.current.isLocked) {
        this.lastMousePos = null
        return
      }

      // 空闲状态下重置 lastMousePos，避免恢复后误算距离
      if (this.current.isIdle) {
        this.lastMousePos = null
        return
      }

      const pos = screen.getCursorScreenPoint()
      if (this.lastMousePos) {
        const dx = pos.x - this.lastMousePos.x
        const dy = pos.y - this.lastMousePos.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        // 仅当距离 > 1 像素时累计（过滤抖动）
        if (dist > 1) {

          // 鼠标移动视为活跃，标记活跃段
          this.markActive()
        }
      }
      this.lastMousePos = { x: pos.x, y: pos.y }
    } catch (error) {
      logger.warn('ActivityMonitor', `鼠标采样失败: ${error.message}`)
    }
  }

  /**
   * 检测空闲状态（基于 powerMonitor.getSystemIdleTime）
   */
  detectIdle () {
    try {
      const idleSeconds = powerMonitor.getSystemIdleTime()
      this.current.idleTime = idleSeconds

      const wasAway = this.current.isAway
      const wasIdle = this.current.isIdle

      this.current.isAway = idleSeconds >= IDLE_AWAY_THRESHOLD
      this.current.isIdle = idleSeconds >= IDLE_IDLE_THRESHOLD && !this.current.isAway

      // 进入离开状态时通知桌宠进入 sleeping
      if (!wasAway && this.current.isAway) {
        this.notifyPetSleeping(true)
      } else if (wasAway && !this.current.isAway) {
        // 离开恢复活跃
        this.notifyPetSleeping(false)
        this.current.activeSince = Date.now()
      }

      // 空闲状态变化时记录日志
      if (wasIdle !== this.current.isIdle) {
        logger.debug('ActivityMonitor', `空闲状态变化: ${this.current.isIdle ? '空闲' : '活跃'} (idle=${idleSeconds}s)`)
      }
    } catch (error) {
      logger.warn('ActivityMonitor', `空闲检测失败: ${error.message}`)
    }
  }

  /**
   * 标记当前为活跃段
   */
  markActive () {
    if (this.currentActiveSpanStart === null) {
      this.currentActiveSpanStart = Date.now()
    }
  }

  /**
   * 通知桌宠进入/退出 sleeping 状态
   * 通过 pet:reminder 事件推送（type=activity）
   * 节流：PET_SLEEP_NOTIFY_MIN_INTERVAL 内不重复通知
   */
  notifyPetSleeping (sleeping) {
    const now = Date.now()
    if (now - this.lastPetSleepNotify < PET_SLEEP_NOTIFY_MIN_INTERVAL) return
    this.lastPetSleepNotify = now

    try {
      // 延迟加载 pet-window-manager，避免循环依赖
      const petWindowManager = require('./pet-window-manager.js')
      if (sleeping) {
        petWindowManager.sendReminder('activity', '我去休息一下', '检测到你已离开，桌宠进入休眠状态', { module: 'activity' })
      }
    } catch (e) {
      // 桌宠未启用或加载失败，忽略
    }
  }

  // ----------------------------------------------------------
  // 前台窗口采样
  // ----------------------------------------------------------

  /**
   * 采样当前前台窗口信息
   */
  sampleForeground () {
    const info = getForegroundWindow()
    if (info) {
      this.current.activeApp = info.processName
      this.current.activeWindow = info.windowTitle
    }
  }

  // ----------------------------------------------------------
  // 数据落库
  // ----------------------------------------------------------

  /**
   * 每分钟汇总一次，写入 activity_log 表，并更新 daily_activity_summary
   */
  flush () {
    if (!this.started) return

    try {
      const now = Date.now()
      const durationSeconds = Math.round((now - this.currentMinuteStart) / 1000)
      if (durationSeconds <= 0) {
        this.currentMinuteStart = now
        return
      }

      // 判定本分钟的活动类型
      let activityType = 'active'
      if (this.current.isLocked) {
        activityType = 'locked'
      } else if (this.current.isAway) {
        activityType = 'away'
      } else if (this.current.isIdle) {
        activityType = 'idle'
      }

      // 加密敏感字段
      let activeAppEnc = null
      let activeWindowEnc = null
      let iv = null
      let authTag = null
      if (activityType === 'active' && (this.current.activeApp || this.current.activeWindow)) {
        // 将进程名与窗口标题合并加密（同一 IV / AuthTag）
        const combined = JSON.stringify({
          app: this.current.activeApp || '',
          win: this.current.activeWindow || ''
        })
        const enc = encryptField(combined)
        if (enc) {
          activeAppEnc = enc.ciphertext
          iv = enc.iv
          authTag = enc.authTag
          // active_window_encrypted 字段存合并密文的引用标记，便于查询时解密
          // 这里把密文存 active_app_encrypted，active_window_encrypted 留空
          // 解密时通过 active_app_encrypted + iv + auth_tag 还原 { app, win }
        }
      }

      const recordedAt = dateUtils.nowISO()

      // 写入 activity_log
      // 省略 click_count/keystroke_count/active_window_encrypted：getActivityLog 从未被前端调用，这些字段不被任何查询读取
      // clickCount/keystrokeCount 内存值仍传入 updateDailySummary 累加 total_clicks/total_keystrokes
      getStmt('insertLog', `
        INSERT INTO activity_log (
          recorded_at, activity_type, duration_seconds,
          active_app_encrypted, iv, auth_tag
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        recordedAt,
        activityType,
        durationSeconds,
        activeAppEnc,
        iv,
        authTag
      )

      // 跨天保护：日期变化时重置活跃段起点，避免新一天 longest 被跨天累计高估
      const summaryDate = recordedAt.slice(0, 10)
      if (this.currentSummaryDate && this.currentSummaryDate !== summaryDate) {
        this.currentActiveSpanStart = null
      }
      this.currentSummaryDate = summaryDate

      // 计算本分钟活跃段长度
      let activeSpanSeconds = 0
      if (activityType === 'active') {
        if (this.currentActiveSpanStart !== null) {
          activeSpanSeconds = Math.round((now - this.currentActiveSpanStart) / 1000)
        } else {
          // 本分钟有鼠标活动但未记录起始（边界情况），按 duration 计
          activeSpanSeconds = durationSeconds
        }
      }

      // 更新每日汇总
      // 省略 mouseDistance/hotkeyCount/keyboardActiveMs：前端无任何使用，不再记录
      this.updateDailySummary(summaryDate, {
        activityType,
        durationSeconds,
        clickCount: this.current.clickCount,
        keystrokeCount: this.keystrokeCount,
        activeSpanSeconds,
        isBreak: activityType === 'away' || activityType === 'locked'
      })

      // 重置本分钟累计
      this.current.mouseDistance = 0
      this.current.clickCount = 0
      this.keystrokeCount = 0
      this.hotkeyCount = 0
      this.keyboardActiveMs = 0
      this.currentMinuteStart = now
      // 活跃段跨分钟累计：仅在本分钟非活跃时清空起点，活跃时保持不变
      if (activityType !== 'active') {
        this.currentActiveSpanStart = null
      }
    } catch (error) {
      logger.error('ActivityMonitor', `落库失败: ${error.message}`)
    }
  }

  /**
   * 更新每日汇总表
   * @param {string} date YYYY-MM-DD
   * @param {object} stats
   */
  updateDailySummary (date, stats) {
    try {
      // 先读取现有记录
      const existing = getStmt('getSummary', `
        SELECT * FROM daily_activity_summary WHERE date = ?
      `).get(date)

      if (!existing) {
        // 新建记录
        // 省略 total_idle_seconds/total_mouse_distance/total_hotkeys/total_keyboard_active_seconds：前端无使用
        getStmt('insertSummary', `
          INSERT INTO daily_activity_summary (
            date, total_active_seconds,
            total_clicks, total_keystrokes,
            longest_continuous_active, break_count
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          date,
          stats.activityType === 'active' ? stats.durationSeconds : 0,
          stats.clickCount,
          stats.keystrokeCount,
          stats.activeSpanSeconds,
          stats.isBreak ? 1 : 0
        )
      } else {
        // 累加更新
        const newActive = existing.total_active_seconds + (stats.activityType === 'active' ? stats.durationSeconds : 0)
        const newClicks = existing.total_clicks + stats.clickCount
        const newKeystrokes = (existing.total_keystrokes || 0) + stats.keystrokeCount
        const newBreaks = existing.break_count + (stats.isBreak ? 1 : 0)
        const newLongest = Math.max(existing.longest_continuous_active, stats.activeSpanSeconds)

        getStmt('updateSummary', `
          UPDATE daily_activity_summary SET
            total_active_seconds = ?,
            total_clicks = ?,
            total_keystrokes = ?,
            longest_continuous_active = ?,
            break_count = ?
          WHERE date = ?
        `).run(newActive, newClicks, newKeystrokes, newLongest, newBreaks, date)
      }
    } catch (error) {
      logger.error('ActivityMonitor', `更新每日汇总失败: ${error.message}`)
    }
  }

  // ----------------------------------------------------------
  // 查询接口
  // ----------------------------------------------------------

  /**
   * 获取今日统计
   * @returns {object}
   */
  getTodayStats () {
    const today = dateUtils.today()
    return this.getStatsByDate(today)
  }

  /**
   * 获取指定日期统计
   * @param {string} date YYYY-MM-DD
   * @returns {object|null}
   */
  getStatsByDate (date) {
    try {
      const row = getStmt('getSummary', `SELECT * FROM daily_activity_summary WHERE date = ?`).get(date)
      if (!row) {
        return {
          date,
          totalActiveSeconds: 0,
          totalClicks: 0,
          totalKeystrokes: 0,
          longestContinuousActive: 0,
          breakCount: 0
        }
      }
      return {
        date: row.date,
        totalActiveSeconds: row.total_active_seconds,
        totalClicks: row.total_clicks,
        totalKeystrokes: row.total_keystrokes,
        longestContinuousActive: row.longest_continuous_active,
        breakCount: row.break_count
      }
    } catch (error) {
      logger.error('ActivityMonitor', `getStatsByDate 失败: ${error.message}`)
      return null
    }
  }

  /**

   * 获取最近 N 天汇总
   * @param {number} days 天数，默认 7；传 0 或负数表示不限制（返回全部）
   * @returns {Array}
   */
  getRecentSummary (days = 7) {
    try {
      // days <= 0 时不限制返回数量（LIMIT -1 表示全部）
      const limit = days > 0 ? days : -1
      const rows = getStmt('getRecentSummary', `
        SELECT * FROM daily_activity_summary
        ORDER BY date DESC
        LIMIT ?
      `).all(limit)
      return rows.map(row => ({
        date: row.date,
        totalActiveSeconds: row.total_active_seconds,
        totalClicks: row.total_clicks,
        totalKeystrokes: row.total_keystrokes,
        longestContinuousActive: row.longest_continuous_active,
        breakCount: row.break_count
      })).reverse() // 升序返回，便于图表展示
    } catch (error) {
      logger.error('ActivityMonitor', `getRecentSummary 失败: ${error.message}`)
      return []
    }
  }

  /**
   * 获取某天使用最多的应用 Top N
   * 通过解密 activity_log 中的 active_app 字段并按进程名聚合
   * @param {number} limit 默认 5；传 0 或负数表示不限制（返回全部）
   * @param {string|null} date YYYY-MM-DD，默认今日（向后兼容）
   * @returns {Array<{app:string, totalSeconds:number}>}
   */
  getTopApps (limit = 5, date = null) {
    try {
      const targetDate = date || dateUtils.today()
      const startISO = `${targetDate} 00:00:00`
      const endISO = `${targetDate} 23:59:59`
      const rows = getStmt('getTodayLogs', `
        SELECT * FROM activity_log
        WHERE recorded_at BETWEEN ? AND ?
          AND activity_type = 'active'
          AND active_app_encrypted IS NOT NULL
        ORDER BY recorded_at ASC
      `).all(startISO, endISO)

      // 解密并聚合
      const appMap = new Map()
      for (const row of rows) {
        if (!row.active_app_encrypted || !row.iv || !row.auth_tag) continue
        const combined = decryptField(row.active_app_encrypted, row.iv, row.auth_tag)
        if (!combined) continue
        let app = null
        try {
          const parsed = JSON.parse(combined)
          app = parsed.app
        } catch (e) { continue }
        if (!app) continue
        appMap.set(app, (appMap.get(app) || 0) + row.duration_seconds)
      }

      const sorted = Array.from(appMap.entries())
        .map(([app, totalSeconds]) => ({
          app,
          totalSeconds,
          category: categorizeApp(app)
        }))
        .sort((a, b) => b.totalSeconds - a.totalSeconds)
      return limit > 0 ? sorted.slice(0, limit) : sorted
    } catch (error) {
      logger.error('ActivityMonitor', `getTopApps 失败: ${error.message}`)
      return []
    }
  }

  /**
   * 获取指定日期的时间段分布（上午/下午/晚上/深夜活跃时长）
   * 上午 6-12，下午 12-18，晚上 18-24，深夜 0-6
   * 只统计 activity_type === 'active' 的记录
   * @param {string} date YYYY-MM-DD，默认今日
   * @returns {{morning:number, afternoon:number, evening:number, night:number}} 各时段活跃秒数
   */
  getTimeDistribution (date) {
    try {
      const target = date || dateUtils.today()
      const startISO = `${target} 00:00:00`
      const endISO = `${target} 23:59:59`
      // 用 strftime 提取小时数分组求和，避免在 JS 侧循环
      const rows = getStmt('getTimeDistribution', `
        SELECT CAST(strftime('%H', recorded_at) AS INTEGER) AS hour,
               SUM(duration_seconds) AS total
        FROM activity_log
        WHERE recorded_at BETWEEN ? AND ?
          AND activity_type = 'active'
        GROUP BY hour
      `).all(startISO, endISO)

      const result = { morning: 0, afternoon: 0, evening: 0, night: 0 }
      for (const row of rows) {
        const h = row.hour
        const total = row.total || 0
        if (h >= 6 && h < 12) result.morning += total
        else if (h >= 12 && h < 18) result.afternoon += total
        else if (h >= 18 && h < 24) result.evening += total
        else result.night += total
      }
      return result
    } catch (error) {
      logger.error('ActivityMonitor', `getTimeDistribution 失败: ${error.message}`)
      return { morning: 0, afternoon: 0, evening: 0, night: 0 }
    }
  }

  /**
   * 获取指定日期的连续活跃段数
   * 统计 active → 非 active 的转换次数 + 1（如果最后一段是 active）
   * 反映工作碎片化程度，段数越多表示切换越频繁
   * @param {string} date YYYY-MM-DD，默认今日
   * @returns {number} 活跃段数量
   */
  getActiveSegments (date) {
    try {
      const target = date || dateUtils.today()
      const startISO = `${target} 00:00:00`
      const endISO = `${target} 23:59:59`
      // 按时间顺序取出每条记录的 activity_type
      const rows = getStmt('getActiveSegments', `
        SELECT activity_type FROM activity_log
        WHERE recorded_at BETWEEN ? AND ?
        ORDER BY recorded_at ASC
      `).all(startISO, endISO)

      if (rows.length === 0) return 0

      let segments = 0
      let prevActive = false
      for (const row of rows) {
        const isActive = row.activity_type === 'active'
        // 进入新的 active 段（前一段非 active 或首段为 active）
        if (isActive && !prevActive) segments++
        prevActive = isActive
      }
      return segments
    } catch (error) {
      logger.error('ActivityMonitor', `getActiveSegments 失败: ${error.message}`)
      return 0
    }
  }

  /**
   * 获取某天使用应用按类别聚合的时长统计
   * 用于活动统计页"活跃应用类别"指标，只显示类别 + 时长，不显示具体应用名
   * @param {string|null} date YYYY-MM-DD，默认今日（向后兼容）
   * @returns {Array<{category:string, totalSeconds:number}>} 按时长降序
   */
  getAppCategories (date = null) {
    try {
      const apps = this.getTopApps(0, date)
      const categoryMap = new Map()
      for (const item of apps) {
        const cat = item.category || '其他'
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + item.totalSeconds)
      }
      return Array.from(categoryMap.entries())
        .map(([category, totalSeconds]) => ({ category, totalSeconds }))
        .sort((a, b) => b.totalSeconds - a.totalSeconds)
    } catch (error) {
      logger.error('ActivityMonitor', `getAppCategories 失败: ${error.message}`)
      return []
    }
  }

  /**
   * 获取今日被分类为"其他"的未分类活跃应用进程名列表
   * 用于 AI 分类：只发送进程名（脱敏，不含路径/窗口标题），让 AI 归类
   * @returns {string[]} 进程名列表（已去重，保留原始大小写）
   */
  getUncategorizedApps () {
    try {
      const apps = this.getTopApps(0)
      const result = []
      const seen = new Set()
      for (const item of apps) {
        if (!item.app) continue
        if (item.category !== '其他') continue
        // 去重键用小写无后缀形式，避免 Code.exe / code / CODE 重复
        const key = item.app.toLowerCase().replace(/\.exe$/, '')
        if (seen.has(key)) continue
        seen.add(key)
        result.push(item.app)
      }
      return result
    } catch (error) {
      logger.error('ActivityMonitor', `getUncategorizedApps 失败: ${error.message}`)
      return []
    }
  }

  /**
   * 调用 AI 对未分类应用进行归类，并持久化分类结果
   * 脱敏：只发送进程名，不发送路径/窗口标题
   * 容错：AI 返回非 JSON / 网络失败时抛错，由前端 ElMessage 提示
   * @returns {Promise<{ categorized: Object<string,string>, total: number, message?: string }>}
   */
  async aiCategorizeApps () {
    // 1. 获取未分类应用
    const uncategorized = this.getUncategorizedApps()
    if (uncategorized.length === 0) {
      return { categorized: {}, total: Object.keys(getAiAppCategories()).length, message: '没有未分类的应用' }
    }

    // 2. 获取当前活动的 AI 模型配置
    const config = aiConfigDao.findActive()
    if (!config) {
      throw new Error('未配置可用的 AI 模型，请先在设置中添加并激活一个模型')
    }

    // 3. 构造 prompt（脱敏：只发进程名，不发路径/窗口标题）
    //    提供类别说明 + few-shot 示例 + 已分类参考，提高分类准确率
    const systemPrompt = `你是一个桌面应用分类助手。请将给定的 Windows 应用进程名归类到最合适的类别中。

可选类别及说明：
- 开发：编程 IDE、编辑器、终端、版本控制工具（如 code、idea、git、powershell）
- 办公：文档编辑、表格、演示、邮件、笔记（如 winword、excel、wps、outlook）
- 浏览：网页浏览器（如 chrome、msedge、firefox）
- 社交：即时通讯、聊天、会议（如 wechat、qq、dingtalk、feishu）
- 娱乐：游戏、音乐、视频播放器（如 steam、spotify、potplayer、vlc）
- 设计：图像/视频编辑、UI 设计、建模（如 photoshop、illustrator、blender、figma）
- 学习：在线课程、阅读、知识管理（如 notion、obsidian、anki）
- 系统：系统工具、设置、文件管理（如 explorer、taskmgr、regedit）
- 工具：下载器、压缩、截图、其他实用工具（如 7z、snipaste、everything）
- 其他：无法归入以上类别的应用

示例：
输入：photoshop.exe, notion, snipaste, explorer
输出：{"photoshop": "设计", "notion": "学习", "snipaste": "工具", "explorer": "系统"}

要求：
1. 以纯 JSON 格式返回，格式为 {"进程名": "类别"}
2. 进程名键统一用小写、去掉 .exe 后缀
3. 不要包含 markdown 标记、注释或其他文字`
    const userPrompt = `请分类以下 ${uncategorized.length} 个应用进程名：\n${uncategorized.map(n => `- ${n}`).join('\n')}`

    // 4. 非流式调用 AI
    //    adapter.chat() 返回 { content, thinking, toolCalls } 对象，需提取 content
    const adapter = aiAdapterFactory.createAdapter(config)
    const chatResult = await adapter.chat(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      { temperature: 0.3, max_tokens: 2048 }
    )
    const response = (chatResult && typeof chatResult === 'object' && chatResult.content)
      ? chatResult.content
      : (typeof chatResult === 'string' ? chatResult : '')

    // 5. 解析 JSON（容错：去除 markdown 标记、提取首个 JSON 对象片段）
    if (!response) {
      throw new Error('AI 返回内容为空，无法解析分类结果')
    }
    const jsonStr = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const match = jsonStr.match(/\{[\s\S]*\}/)
    let categorized
    try {
      categorized = JSON.parse(match ? match[0] : jsonStr)
    } catch (e) {
      throw new Error(`AI 返回内容不是合法 JSON：${e.message}`)
    }
    if (!categorized || typeof categorized !== 'object' || Array.isArray(categorized)) {
      throw new Error('AI 返回的 JSON 不是对象格式')
    }

    // 6. 规范化键名（小写、去 .exe 后缀）并合并持久化（保留已有 AI 分类，追加新分类）
    const existing = getAiAppCategories()
    const merged = { ...existing }
    for (const [name, category] of Object.entries(categorized)) {
      if (!name || !category || typeof category !== 'string') continue
      const key = name.toLowerCase().replace(/\.exe$/, '')
      merged[key] = category
    }
    updateAiAppCategories(merged)

    logger.info('ActivityMonitor', `AI 分类完成，新增 ${Object.keys(categorized).length} 个，累计 ${Object.keys(merged).length} 个`)
    return { categorized, total: Object.keys(merged).length }
  }

  /**
   * 清除 AI 应用分类持久化，恢复硬编码默认分类
   * @returns {boolean}
   */
  resetAiAppCategories () {
    return resetAiAppCategories()
  }

  /**
   * 获取完整分类配置信息（AI分类 + 今日活跃应用分类情况）
   * 用于分类管理界面展示
   * @returns {{ aiCategories: Object, apps: Array<{app:string, category:string, totalSeconds:number}> }}
   */
  getAppCategoryConfig () {
    try {
      const aiCategories = getAiAppCategories()
      const apps = this.getTopApps(0).map(item => ({
        app: item.app,
        category: item.category,
        totalSeconds: item.totalSeconds
      }))
      return { aiCategories, apps }
    } catch (error) {
      logger.error('ActivityMonitor', `getAppCategoryConfig 失败: ${error.message}`)
      return { aiCategories: {}, apps: [] }
    }
  }

  /**
   * 手动修改单个应用分类，持久化到 AI 分类
   * @param {string} appName 进程名
   * @param {string} category 类别名
   * @returns {boolean}
   */
  updateAppCategory (appName, category) {
    try {
      if (!appName || !category) return false
      const key = appName.toLowerCase().replace(/\.exe$/, '')
      const existing = getAiAppCategories()
      existing[key] = category
      return updateAiAppCategories(existing)
    } catch (error) {
      logger.error('ActivityMonitor', `updateAppCategory 失败: ${error.message}`)
      return false
    }
  }

  /**
   * 获取当前活动状态
   * @returns {object}
   */
  getCurrentStatus () {
    const now = Date.now()
    const continuousActiveSeconds = this.currentActiveSpanStart
      ? Math.round((now - this.currentActiveSpanStart) / 1000)
      : 0
    // 键盘是否处于活跃窗口内（最近 KEYBOARD_ACTIVE_WINDOW 有按键）
    const keyboardActive = this.lastKeyTimestamp > 0 &&
      (now - this.lastKeyTimestamp) < KEYBOARD_ACTIVE_WINDOW
    return {
      isIdle: this.current.isIdle,
      isAway: this.current.isAway,
      isLocked: this.current.isLocked,
      idleTime: this.current.idleTime,
      activeApp: this.current.activeApp,
      activeAppCategory: categorizeApp(this.current.activeApp),
      activeWindow: this.current.activeWindow,
      mouseDistance: this.current.mouseDistance,
      continuousActiveSeconds,
      keyboardActive
    }
  }

  /**
   * 清空指定日期范围的活动数据
   * @param {string} startDate - 起始日期 YYYY-MM-DD
   * @param {string} endDate - 结束日期 YYYY-MM-DD
   */
  clearData (startDate, endDate) {
    try {
      const db = getDb()
      if (startDate && endDate) {
        db.prepare('DELETE FROM activity_log WHERE date(recorded_at) >= ? AND date(recorded_at) <= ?').run(startDate, endDate)
        db.prepare('DELETE FROM daily_activity_summary WHERE date >= ? AND date <= ?').run(startDate, endDate)
      } else {
        db.prepare('DELETE FROM activity_log').run()
        db.prepare('DELETE FROM daily_activity_summary').run()
      }
      logger.info('ActivityMonitor', `已清空活动数据: ${startDate || '全部'} ~ ${endDate || '全部'}`)
      return true
    } catch (error) {
      logger.error('ActivityMonitor', `清空活动数据失败: ${error.message}`)
      return false
    }
  }
}

// 导出单例
const activityMonitor = new ActivityMonitor()

module.exports = activityMonitor