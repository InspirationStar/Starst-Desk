// ============================================================
// 桌面小部件全局热键管理
// ReservedHotkeyHookService + WinSpaceHotkeyStateMachine
//
// 使用 Electron globalShortcut API 实现全局热键注册：
// - 主热键（默认 Ctrl+Alt+D）：切换所有小部件显隐
// - 搜索热键（默认 Ctrl+Alt+F）：打开全局搜索弹窗
// - 保留热键钩子（Win+Space）：尝试注册系统保留手势
//
// Electron 限制：globalShortcut 是高层 API，无法安装 WH_KEYBOARD_LL
// 低级键盘钩子。Win+Space 等系统保留手势注册可能失败，此时记录错误
// 状态并提示用户。WinSpaceHotkeyStateMachine 作为纯逻辑参考实现保留，
// 用于手势校验和状态查询。
//
// 应用退出时自动注销（will-quit 事件）
// 热键被其他应用占用时提示用户更换
// ============================================================

const { app, globalShortcut, ipcMain } = require('electron')
const logger = require('./logger.js')
const appSettingDao = require('./../dao/app-setting-dao.js')
const widgetWindowManager = require('./widget-window-manager.js')

// ============================================================
// 常量定义
// ============================================================

// app_settings 表中存储热键配置的 key
const MAIN_HOTKEY_SETTING_KEY = 'widget_hotkey'
const MAIN_HOTKEY_ENABLED_KEY = 'widget_hotkey_enabled'
const SEARCH_HOTKEY_SETTING_KEY = 'widget_search_hotkey'
const SEARCH_HOTKEY_ENABLED_KEY = 'widget_search_hotkey_enabled'

// 默认热键
const DEFAULT_MAIN_ACCELERATOR = 'Ctrl+Alt+D'
const DEFAULT_SEARCH_ACCELERATOR = 'Ctrl+Alt+F'

// Win+Space 保留手势的 Electron accelerator 表示
const RESERVED_WIN_SPACE_ACCELERATOR = 'Super+Space'

const MODIFIER_NONE = 0
const MODIFIER_ALT = 1
const MODIFIER_CONTROL = 2
const MODIFIER_SHIFT = 4
const MODIFIER_WINDOWS = 8

const RESERVED_HOOK_DISABLE_ENV = 'DESKBOX_DISABLE_RESERVED_HOTKEY_HOOK'

// ============================================================
// WinSpaceHotkeyStateMachine - Win+Space 状态机
// 纯逻辑实现，不在低级钩子回调中查询异步键盘状态
// ============================================================

/**
 * 保留热键事件处置策略
 * @enum {string}
 */
const RESERVED_DISPOSITION = {
  PASS_THROUGH: 'pass-through',       // 放行，不拦截
  SUPPRESS: 'suppress',               // 抑制，不触发
  TRIGGER_AND_SUPPRESS: 'trigger'     // 触发并抑制
}

/**
 * Win+Space 覆盖的事件驱动状态机
 * 跟踪修饰键按下/释放状态，判断是否为精确的 Win+Space 手势
 */
class WinSpaceHotkeyStateMachine {
  constructor () {
    // 虚拟键码常量
    this.VK_SPACE = 0x20

    this.MOD = {
      NONE: 0,
      LEFT_WIN: 1 << 0,
      RIGHT_WIN: 1 << 1,
      CONTROL: 1 << 2,
      LEFT_CTRL: 1 << 3,
      RIGHT_CTRL: 1 << 4,
      ALT: 1 << 5,
      LEFT_ALT: 1 << 6,
      RIGHT_ALT: 1 << 7,
      SHIFT: 1 << 8,
      LEFT_SHIFT: 1 << 9,
      RIGHT_SHIFT: 1 << 10
    }

    // Windows 修饰键掩码（左 Win | 右 Win）
    this.WINDOWS_MODIFIERS = this.MOD.LEFT_WIN | this.MOD.RIGHT_WIN
    // 非 Windows 修饰键掩码（Ctrl/Alt/Shift 各左右）
    this.NON_WINDOWS_MODIFIERS =
      this.MOD.CONTROL | this.MOD.LEFT_CTRL | this.MOD.RIGHT_CTRL |
      this.MOD.ALT | this.MOD.LEFT_ALT | this.MOD.RIGHT_ALT |
      this.MOD.SHIFT | this.MOD.LEFT_SHIFT | this.MOD.RIGHT_SHIFT

    // 状态
    this._pressedModifiers = this.MOD.NONE
    this._spaceDown = false
    this._suppressSpaceUp = false
  }

  /**
   * 处理键盘事件
   * @param {number} virtualKey - 虚拟键码
   * @param {boolean} isKeyDown - 是否按下
   * @returns {string} RESERVED_DISPOSITION 中的值
   */
  process (virtualKey, isKeyDown) {
    const modifier = this._tryGetModifier(virtualKey)
    if (modifier !== this.MOD.NONE) {
      if (isKeyDown) {
        this._pressedModifiers |= modifier
      } else {
        this._pressedModifiers &= ~modifier
      }
      return RESERVED_DISPOSITION.PASS_THROUGH
    }

    if (virtualKey !== this.VK_SPACE) {
      return RESERVED_DISPOSITION.PASS_THROUGH
    }

    if (isKeyDown) {
      if (this._spaceDown) {
        return this._suppressSpaceUp
          ? RESERVED_DISPOSITION.SUPPRESS
          : RESERVED_DISPOSITION.PASS_THROUGH
      }

      this._spaceDown = true
      const exactWinSpace =
        (this._pressedModifiers & this.WINDOWS_MODIFIERS) !== 0 &&
        (this._pressedModifiers & this.NON_WINDOWS_MODIFIERS) === 0
      if (!exactWinSpace) {
        return RESERVED_DISPOSITION.PASS_THROUGH
      }

      this._suppressSpaceUp = true
      return RESERVED_DISPOSITION.TRIGGER_AND_SUPPRESS
    }

    // Space 键释放
    this._spaceDown = false
    if (!this._suppressSpaceUp) {
      return RESERVED_DISPOSITION.PASS_THROUGH
    }

    this._suppressSpaceUp = false
    return RESERVED_DISPOSITION.SUPPRESS
  }

  /**
   * 取消抑制状态（钩子失败时回退）
   */
  cancelSuppression () {
    this._suppressSpaceUp = false
  }

  /**
   * 重置状态机
   */
  reset () {
    this._pressedModifiers = this.MOD.NONE
    this._spaceDown = false
    this._suppressSpaceUp = false
  }

  /**
   * 尝试获取修饰键标志
   * @param {number} virtualKey - 虚拟键码
   * @returns {number} 修饰键位标志，非修饰键返回 NONE
   */
  _tryGetModifier (virtualKey) {
    switch (virtualKey) {
      case 0x5B: return this.MOD.LEFT_WIN
      case 0x5C: return this.MOD.RIGHT_WIN
      case 0x11: return this.MOD.CONTROL
      case 0xA2: return this.MOD.LEFT_CTRL
      case 0xA3: return this.MOD.RIGHT_CTRL
      case 0x12: return this.MOD.ALT
      case 0xA4: return this.MOD.LEFT_ALT
      case 0xA5: return this.MOD.RIGHT_ALT
      case 0x10: return this.MOD.SHIFT
      case 0xA0: return this.MOD.LEFT_SHIFT
      case 0xA1: return this.MOD.RIGHT_SHIFT
      default: return this.MOD.NONE
    }
  }
}

// ============================================================
// 状态变量
// ============================================================

let mainAccelerator = null           // 当前已注册的 accelerator
let mainEnabled = true               // 是否启用
let mainRegistered = false           // 是否已注册成功
let mainUsesReservedHook = false     // 是否使用保留热键钩子（Win+Space）
let mainLastError = null             // 最后错误信息

let searchAccelerator = null
let searchEnabled = true
let searchRegistered = false
let searchInvoking = false           // 防重入标志

let reservedHookActive = false
let reservedHookLastError = null
let reservedHookTriggerCount = 0
let reservedHookPostFailureCount = 0
let reservedHookInputFailureCount = 0

// Win+Space 状态机实例
const winSpaceStateMachine = new WinSpaceHotkeyStateMachine()

let receivedCount = 0
let invocationCount = 0
let dispatchFailureCount = 0

// 是否已初始化
let initialized = false

// ============================================================
// ============================================================

/**
 * 解析 Electron accelerator 为修饰键位标志 + 主键
 * @param {string} accelerator - Electron accelerator 字符串（如 'Ctrl+Alt+D'）
 * @returns {{ modifiers: number, key: string }} 解析结果
 */
function parseAccelerator (accelerator) {
  if (!accelerator || typeof accelerator !== 'string') {
    return { modifiers: MODIFIER_NONE, key: '' }
  }

  const parts = accelerator.split('+').map(p => p.trim())
  let modifiers = MODIFIER_NONE
  let key = ''

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const lower = part.toLowerCase()

    if (i < parts.length - 1) {
      // 修饰键部分
      if (lower === 'ctrl' || lower === 'control') {
        modifiers |= MODIFIER_CONTROL
      } else if (lower === 'alt' || lower === 'option') {
        modifiers |= MODIFIER_ALT
      } else if (lower === 'shift') {
        modifiers |= MODIFIER_SHIFT
      } else if (lower === 'meta' || lower === 'super' ||
                 lower === 'command' || lower === 'cmd') {
        modifiers |= MODIFIER_WINDOWS
      }
    } else {
      // 主键部分
      key = part
    }
  }

  return { modifiers, key }
}

/**
 * 校验 Electron accelerator 格式是否合法
 * 简单校验：非空字符串，包含至少一个修饰键（Ctrl/Control/Alt/Shift/Meta/Super/Command/Option）
 * @param {string} accelerator
 * @returns {boolean}
 */
function isValidAccelerator (accelerator) {
  if (!accelerator || typeof accelerator !== 'string') return false
  const modifiers = ['ctrl', 'control', 'alt', 'shift', 'meta', 'super', 'command', 'option', 'cmd']
  const lower = accelerator.toLowerCase()
  return modifiers.some(m => lower.includes(m))
}

/**
 * 判断是否为保留系统手势（Win+Space）
 * @param {string} accelerator
 * @returns {boolean}
 */
function isReservedSystemGesture (accelerator) {
  if (!accelerator) return false
  const parsed = parseAccelerator(accelerator)
  const lowerKey = parsed.key.toLowerCase()
  return parsed.modifiers === MODIFIER_WINDOWS && lowerKey === 'space'
}

/**
 * 判断是否为风险手势
 * 风险手势包括：Win+Space（系统保留）、无修饰键（仅主键）、
 * F1/F2/F5/F11/F12（浏览器/系统常用功能键）
 * @param {string} accelerator
 * @returns {boolean}
 */
function isRiskyGesture (accelerator) {
  if (!accelerator) return false
  if (isReservedSystemGesture(accelerator)) return true

  const parsed = parseAccelerator(accelerator)
  if (parsed.modifiers === MODIFIER_NONE) return true

  const lowerKey = parsed.key.toLowerCase()
  const riskyKeys = ['f1', 'f2', 'f5', 'f11', 'f12']
  return riskyKeys.includes(lowerKey)
}

/**
 * 判断是否包含 Win 修饰键
 * @param {string} accelerator
 * @returns {boolean}
 */
function hasWinModifier (accelerator) {
  if (!accelerator) return false
  const parsed = parseAccelerator(accelerator)
  return (parsed.modifiers & MODIFIER_WINDOWS) !== 0
}

/**
 * 判断保留热键钩子是否被环境变量禁用
 * @returns {boolean}
 */
function isReservedHookDisabledByEnvironment () {
  const value = process.env[RESERVED_HOOK_DISABLE_ENV]
  return value === '1' || value === 'true'
}

/**
 * 格式化手势为可读文本
 * @param {string} accelerator
 * @returns {string}
 */
function formatGesture (accelerator) {
  if (!accelerator) return '未设置'
  return accelerator
}

// ============================================================
// ============================================================

/**
 * 注册主全局热键
 * @param {string} accelerator - Electron accelerator 字符串（如 'Ctrl+Alt+D'）
 * @returns {{ ok: boolean, error?: string }} 注册结果
 */
function register (accelerator) {
  if (!isValidAccelerator(accelerator)) {
    logger.warn('WidgetHotkey', `热键格式不合法: ${accelerator}`)
    return { ok: false, error: '热键格式不合法，需包含至少一个修饰键' }
  }

  // 先注销当前热键
  if (mainAccelerator) {
    unregister()
  }

  // 判断是否为保留系统手势（Win+Space）
  if (isReservedSystemGesture(accelerator)) {
    if (isReservedHookDisabledByEnvironment()) {
      logger.warn('WidgetHotkey', '保留热键钩子被环境变量禁用')
      mainLastError = '保留热键钩子被环境变量禁用'
      return { ok: false, error: mainLastError }
    }

    // 尝试通过 globalShortcut 注册 Win+Space（可能被系统占用）
    return registerReservedGesture(accelerator)
  }

  // 普通热键注册
  try {
    const success = globalShortcut.register(accelerator, () => {
      handleMainHotkeyTriggered('registered', true)
    })

    if (!success) {
      // register 返回 false 表示热键被其他应用占用
      logger.warn('WidgetHotkey', `热键 ${accelerator} 注册失败，可能被其他应用占用`)
      mainLastError = `热键 ${accelerator} 已被其他应用占用，请更换热键`
      return { ok: false, error: mainLastError }
    }

    mainAccelerator = accelerator
    mainRegistered = true
    mainUsesReservedHook = false
    mainLastError = null
    logger.info('WidgetHotkey', `全局热键已注册: ${accelerator}`)
    return { ok: true }
  } catch (error) {
    logger.error('WidgetHotkey', `注册热键 ${accelerator} 异常: ${error.message}`)
    mainLastError = error.message
    return { ok: false, error: error.message }
  }
}

/**
 * 注册保留系统手势（Win+Space）
 * 由于 Electron 无法安装 WH_KEYBOARD_LL 低级钩子，使用 globalShortcut 尝试注册
 * @param {string} accelerator
 * @returns {{ ok: boolean, error?: string }}
 */
function registerReservedGesture (accelerator) {
  try {
    const success = globalShortcut.register(accelerator, () => {
      handleMainHotkeyTriggered('reserved-hook', false)
    })

    if (!success) {
      logger.warn('WidgetHotkey', `保留手势 ${accelerator} 注册失败，系统可能已占用`)
      mainLastError = `保留手势 ${accelerator} 已被系统占用（通常用于切换输入法）`
      reservedHookActive = false
      reservedHookLastError = mainLastError
      return { ok: false, error: mainLastError }
    }

    mainAccelerator = accelerator
    mainRegistered = true
    mainUsesReservedHook = true
    reservedHookActive = true
    reservedHookLastError = null
    mainLastError = null
    logger.info('WidgetHotkey', `保留手势已注册: ${accelerator} (mode=globalShortcut)`)
    return { ok: true }
  } catch (error) {
    logger.error('WidgetHotkey', `注册保留手势 ${accelerator} 异常: ${error.message}`)
    mainLastError = error.message
    reservedHookLastError = error.message
    return { ok: false, error: error.message }
  }
}

/**
 * 注销当前主全局热键
 */
function unregister () {
  if (mainUsesReservedHook || reservedHookActive) {
    // 注销保留热键钩子
    if (mainAccelerator) {
      try {
        globalShortcut.unregister(mainAccelerator)
        logger.info('WidgetHotkey', `保留热键已注销: ${mainAccelerator}`)
      } catch (error) {
        logger.error('WidgetHotkey', `注销保留热键失败: ${error.message}`)
      }
    }
    reservedHookActive = false
    winSpaceStateMachine.reset()
  } else if (mainRegistered && mainAccelerator) {
    try {
      globalShortcut.unregister(mainAccelerator)
      logger.info('WidgetHotkey', `全局热键已注销: ${mainAccelerator}`)
    } catch (error) {
      logger.error('WidgetHotkey', `注销热键失败: ${error.message}`)
    }
  }

  mainAccelerator = null
  mainRegistered = false
  mainUsesReservedHook = false
}

/**
 * 主热键触发处理
 * @param {string} source - 触发来源（'registered' | 'reserved-hook'）
 * @param {boolean} releaseStandardModifiers - 是否释放标准修饰键（RDP 场景防卡键）
 */
function handleMainHotkeyTriggered (source, releaseStandardModifiers) {
  receivedCount++
  logger.debug('WidgetHotkey',
    `Received id=${receivedCount} source=${source} gesture=${mainAccelerator}`)

  // 触发回调
  invocationCount++
  logger.info('WidgetHotkey',
    `Triggered id=${invocationCount} source=${source} gesture=${mainAccelerator}`)
  try {
    widgetWindowManager.toggleAllWidgets()
  } catch (error) {
    dispatchFailureCount++
    logger.error('WidgetHotkey', `热键回调执行失败: ${error.message}`)
  }
}

// ============================================================
// 主热键配置读写
// ============================================================

/**
 * 获取当前主热键 accelerator
 * @returns {string|null}
 */
function getAccelerator () {
  return mainAccelerator
}

/**
 * 切换主热键：先注销旧热键，再注册新热键，持久化到 app_settings
 * @param {string} accelerator
 * @returns {{ ok: boolean, error?: string }}
 */
function setAccelerator (accelerator) {
  const result = register(accelerator)
  if (result.ok) {
    // 持久化到 app_settings
    try {
      appSettingDao.set(MAIN_HOTKEY_SETTING_KEY, accelerator)
      logger.info('WidgetHotkey', `热键已持久化: ${accelerator}`)
    } catch (error) {
      logger.error('WidgetHotkey', `持久化热键失败: ${error.message}`)
      // 持久化失败不影响热键生效，但提示用户
      return { ok: true, error: '热键已生效但持久化失败，重启后可能恢复为默认值' }
    }
  }
  return result
}

/**
 * 获取主热键启用状态
 * @returns {boolean}
 */
function getMainEnabled () {
  return mainEnabled
}

/**
 * 设置主热键启用/禁用
 * @param {boolean} enabled
 * @returns {{ ok: boolean, error?: string }}
 */
function setMainEnabled (enabled) {
  if (mainEnabled === enabled) {
    return { ok: true }
  }

  mainEnabled = enabled
  try {
    appSettingDao.set(MAIN_HOTKEY_ENABLED_KEY, enabled ? '1' : '0')
  } catch (error) {
    logger.error('WidgetHotkey', `持久化热键启用状态失败: ${error.message}`)
  }

  if (enabled) {
    // 启用：重新注册
    return refreshMainRegistration()
  } else {
    // 禁用：注销当前热键
    unregister()
    return { ok: true }
  }
}

/**
 * 刷新主热键注册
 * @returns {{ ok: boolean, error?: string }}
 */
function refreshMainRegistration () {
  unregister()
  mainLastError = null

  if (!mainEnabled) {
    logger.info('WidgetHotkey', 'RefreshRegistration skipped: disabled')
    return { ok: true }
  }

  // 从 app_settings 读取热键配置
  let accelerator = null
  try {
    accelerator = appSettingDao.get(MAIN_HOTKEY_SETTING_KEY) || DEFAULT_MAIN_ACCELERATOR
  } catch (error) {
    logger.warn('WidgetHotkey', `读取热键配置失败，使用默认值: ${error.message}`)
    accelerator = DEFAULT_MAIN_ACCELERATOR
  }

  if (!isValidAccelerator(accelerator)) {
    logger.warn('WidgetHotkey', `RefreshRegistration skipped: invalid gesture ${accelerator}`)
    mainLastError = '热键格式不合法'
    return { ok: false, error: mainLastError }
  }

  return register(accelerator)
}

/**
 * 重置主热键为默认值
 * @returns {{ ok: boolean, error?: string }}
 */
function resetToDefault () {
  return setAccelerator(DEFAULT_MAIN_ACCELERATOR)
}

// ============================================================
// ============================================================

/**
 * 注册搜索全局热键
 * @param {string} accelerator
 * @returns {{ ok: boolean, error?: string }}
 */
function registerSearchHotkey (accelerator) {
  if (!isValidAccelerator(accelerator)) {
    logger.warn('WidgetHotkey', `搜索热键格式不合法: ${accelerator}`)
    return { ok: false, error: '搜索热键格式不合法，需包含至少一个修饰键' }
  }

  if (hasWinModifier(accelerator)) {
    logger.warn('WidgetHotkey', `搜索热键不允许使用 Win 修饰键: ${accelerator}`)
    return { ok: false, error: '搜索热键不支持 Win 修饰键，请使用 Ctrl/Alt/Shift 组合' }
  }

  // 先注销当前搜索热键
  if (searchAccelerator) {
    unregisterSearchHotkey()
  }

  try {
    const success = globalShortcut.register(accelerator, () => {
      handleSearchHotkeyTriggered()
    })

    if (!success) {
      logger.warn('WidgetHotkey', `搜索热键 ${accelerator} 注册失败，可能被其他应用占用`)
      return { ok: false, error: `搜索热键 ${accelerator} 已被其他应用占用，请更换热键` }
    }

    searchAccelerator = accelerator
    searchRegistered = true
    logger.info('WidgetHotkey', `搜索热键已注册: ${accelerator}`)
    return { ok: true }
  } catch (error) {
    logger.error('WidgetHotkey', `注册搜索热键 ${accelerator} 异常: ${error.message}`)
    return { ok: false, error: error.message }
  }
}

/**
 * 注销搜索热键
 */
function unregisterSearchHotkey () {
  if (searchRegistered && searchAccelerator) {
    try {
      globalShortcut.unregister(searchAccelerator)
      logger.info('WidgetHotkey', `搜索热键已注销: ${searchAccelerator}`)
    } catch (error) {
      logger.error('WidgetHotkey', `注销搜索热键失败: ${error.message}`)
    }
  }
  searchAccelerator = null
  searchRegistered = false
}

/**
 * 搜索热键触发处理
 * 防重入：_isInvoking 标志
 */
function handleSearchHotkeyTriggered () {
  if (searchInvoking) {
    return
  }

  searchInvoking = true
  logger.info('WidgetHotkey', '搜索热键触发')
  try {
    triggerSearchPopup()
  } catch (error) {
    logger.error('WidgetHotkey', `搜索热键回调执行失败: ${error.message}`)
  } finally {
    searchInvoking = false
  }
}

/**
 * 触发搜索弹窗
 * 通过主窗口导航到 /search 路由
 */
function triggerSearchPopup () {
  try {
    // 延迟加载 window-manager 避免循环依赖
    const windowManager = require('./window-manager.js')
    const win = windowManager.getMainWindow()
    if (!win || win.isDestroyed()) {
      // 主窗口不存在则先创建
      windowManager.showMainWindow()
      const newWin = windowManager.getMainWindow()
      if (newWin && !newWin.isDestroyed()) {
        newWin.webContents.send('app:navigate', { path: '/search' })
      }
      return
    }
    // 显示主窗口并导航到搜索页
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('app:navigate', { path: '/search' })
  } catch (error) {
    logger.error('WidgetHotkey', `打开搜索弹窗失败: ${error.message}`)
  }
}

// ============================================================
// 搜索热键配置读写
// ============================================================

/**
 * 获取当前搜索热键 accelerator
 * @returns {string|null}
 */
function getSearchAccelerator () {
  return searchAccelerator
}

/**
 * 切换搜索热键：先注销旧热键，再注册新热键，持久化到 app_settings
 * @param {string} accelerator
 * @returns {{ ok: boolean, error?: string }}
 */
function setSearchAccelerator (accelerator) {
  const result = registerSearchHotkey(accelerator)
  if (result.ok) {
    try {
      appSettingDao.set(SEARCH_HOTKEY_SETTING_KEY, accelerator)
      logger.info('WidgetHotkey', `搜索热键已持久化: ${accelerator}`)
    } catch (error) {
      logger.error('WidgetHotkey', `持久化搜索热键失败: ${error.message}`)
      return { ok: true, error: '搜索热键已生效但持久化失败，重启后可能恢复为默认值' }
    }
  }
  return result
}

/**
 * 获取搜索热键启用状态
 * @returns {boolean}
 */
function getSearchEnabled () {
  return searchEnabled
}

/**
 * 设置搜索热键启用/禁用
 * @param {boolean} enabled
 * @returns {{ ok: boolean, error?: string }}
 */
function setSearchEnabled (enabled) {
  if (searchEnabled === enabled) {
    return { ok: true }
  }

  searchEnabled = enabled
  try {
    appSettingDao.set(SEARCH_HOTKEY_ENABLED_KEY, enabled ? '1' : '0')
  } catch (error) {
    logger.error('WidgetHotkey', `持久化搜索热键启用状态失败: ${error.message}`)
  }

  if (enabled) {
    return refreshSearchRegistration()
  } else {
    unregisterSearchHotkey()
    return { ok: true }
  }
}

/**
 * 刷新搜索热键注册
 * @returns {{ ok: boolean, error?: string }}
 */
function refreshSearchRegistration () {
  unregisterSearchHotkey()

  if (!searchEnabled) {
    return { ok: true }
  }

  let accelerator = null
  try {
    accelerator = appSettingDao.get(SEARCH_HOTKEY_SETTING_KEY) || DEFAULT_SEARCH_ACCELERATOR
  } catch (error) {
    logger.warn('WidgetHotkey', `读取搜索热键配置失败，使用默认值: ${error.message}`)
    accelerator = DEFAULT_SEARCH_ACCELERATOR
  }

  if (hasWinModifier(accelerator) || !isValidAccelerator(accelerator)) {
    logger.warn('WidgetHotkey', `搜索热键配置无效: ${accelerator}`)
    return { ok: false, error: '搜索热键配置无效' }
  }

  return registerSearchHotkey(accelerator)
}

// ============================================================
// ============================================================

/**
 * 获取完整热键状态
 * @returns {object}
 */
function getStatus () {
  return {
    // 主热键状态
    main: {
      accelerator: mainAccelerator,
      enabled: mainEnabled,
      isRegistered: mainRegistered && (!mainUsesReservedHook || reservedHookActive),
      usesReservedHook: mainUsesReservedHook && mainRegistered,
      lastError: mainLastError,
      defaultAccelerator: DEFAULT_MAIN_ACCELERATOR
    },
    // 搜索热键状态
    search: {
      accelerator: searchAccelerator,
      enabled: searchEnabled,
      isRegistered: searchRegistered,
      defaultAccelerator: DEFAULT_SEARCH_ACCELERATOR
    },
    // 保留热键钩子状态
    reservedHook: {
      active: reservedHookActive,
      lastError: reservedHookLastError,
      triggerCount: reservedHookTriggerCount,
      postFailureCount: reservedHookPostFailureCount,
      inputFailureCount: reservedHookInputFailureCount,
      disabledByEnv: isReservedHookDisabledByEnvironment()
    },
    // 统计计数
    stats: {
      receivedCount,
      invocationCount,
      dispatchFailureCount
    }
  }
}

/**
 * 校验手势并返回详细信息
 * @param {string} accelerator
 * @returns {object}
 */
function validateGesture (accelerator) {
  return {
    accelerator,
    valid: isValidAccelerator(accelerator),
    reserved: isReservedSystemGesture(accelerator),
    risky: isRiskyGesture(accelerator),
    hasWinModifier: hasWinModifier(accelerator),
    formatted: formatGesture(accelerator)
  }
}

// ============================================================
// IPC 通道注册（在 widget-hotkey.js 内直接注册，避免修改 widget-channels.js）
// ============================================================

/**
 * 注册热键相关 IPC 通道
 * 现有 widget:hotkey:get / widget:hotkey:set 已在 widget-channels.js 中注册，
 * 此处注册新增的通道
 */
function registerIpcChannels () {
  // widget:hotkey:status - 获取完整热键状态
  ipcMain.handle('widget:hotkey:status', async () => {
    try {
      return { ok: true, data: getStatus() }
    } catch (error) {
      logger.error('WidgetHotkey', `widget:hotkey:status 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // widget:hotkey:enabled:get - 获取主热键启用状态
  ipcMain.handle('widget:hotkey:enabled:get', async () => {
    try {
      return { ok: true, data: { enabled: getMainEnabled() } }
    } catch (error) {
      logger.error('WidgetHotkey', `widget:hotkey:enabled:get 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // widget:hotkey:enabled:set - 设置主热键启用/禁用
  ipcMain.handle('widget:hotkey:enabled:set', async (event, data) => {
    try {
      const result = setMainEnabled(!!data.enabled)
      if (!result.ok) {
        return { ok: false, error: { code: 'HOTKEY_ERROR', message: result.error } }
      }
      return { ok: true, data: { enabled: !!data.enabled } }
    } catch (error) {
      logger.error('WidgetHotkey', `widget:hotkey:enabled:set 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // widget:hotkey:reset - 重置主热键为默认值
  ipcMain.handle('widget:hotkey:reset', async () => {
    try {
      const result = resetToDefault()
      if (!result.ok) {
        return { ok: false, error: { code: 'HOTKEY_CONFLICT', message: result.error } }
      }
      return { ok: true, data: { accelerator: DEFAULT_MAIN_ACCELERATOR } }
    } catch (error) {
      logger.error('WidgetHotkey', `widget:hotkey:reset 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // widget:hotkey:gesture:validate - 校验手势
  ipcMain.handle('widget:hotkey:gesture:validate', async (event, data) => {
    try {
      return { ok: true, data: validateGesture(data.accelerator) }
    } catch (error) {
      logger.error('WidgetHotkey', `widget:hotkey:gesture:validate 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // widget:search-hotkey:get - 获取搜索热键
  ipcMain.handle('widget:search-hotkey:get', async () => {
    try {
      return { ok: true, data: { accelerator: getSearchAccelerator() } }
    } catch (error) {
      logger.error('WidgetHotkey', `widget:search-hotkey:get 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // widget:search-hotkey:set - 设置搜索热键
  ipcMain.handle('widget:search-hotkey:set', async (event, data) => {
    try {
      const result = setSearchAccelerator(data.accelerator)
      if (!result.ok) {
        return { ok: false, error: { code: 'HOTKEY_CONFLICT', message: result.error } }
      }
      return { ok: true, data: { accelerator: data.accelerator } }
    } catch (error) {
      logger.error('WidgetHotkey', `widget:search-hotkey:set 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // widget:search-hotkey:enabled:get - 获取搜索热键启用状态
  ipcMain.handle('widget:search-hotkey:enabled:get', async () => {
    try {
      return { ok: true, data: { enabled: getSearchEnabled() } }
    } catch (error) {
      logger.error('WidgetHotkey', `widget:search-hotkey:enabled:get 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // widget:search-hotkey:enabled:set - 设置搜索热键启用/禁用
  ipcMain.handle('widget:search-hotkey:enabled:set', async (event, data) => {
    try {
      const result = setSearchEnabled(!!data.enabled)
      if (!result.ok) {
        return { ok: false, error: { code: 'HOTKEY_ERROR', message: result.error } }
      }
      return { ok: true, data: { enabled: !!data.enabled } }
    } catch (error) {
      logger.error('WidgetHotkey', `widget:search-hotkey:enabled:set 失败: ${error.message}`)
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  logger.info('WidgetHotkey', 'IPC 通道已注册')
}

// ============================================================
// 初始化 / 清理
// ============================================================

/**
 * 初始化全局热键
 * 从 app_settings 读取热键配置，未配置则使用默认值
 * 同时初始化主热键和搜索热键
 * @param {string} [defaultAccelerator] - 默认主热键（未配置时使用）
 * @returns {{ ok: boolean, error?: string }}
 */
function init (defaultAccelerator) {
  if (initialized) {
    logger.warn('WidgetHotkey', '已初始化，跳过重复调用')
    return { ok: true }
  }
  initialized = true

  // 读取主热键启用状态
  try {
    const savedEnabled = appSettingDao.get(MAIN_HOTKEY_ENABLED_KEY)
    if (savedEnabled !== null) {
      mainEnabled = savedEnabled === '1' || savedEnabled === 'true'
    } else {
      appSettingDao.set(MAIN_HOTKEY_ENABLED_KEY, '1')
    }
  } catch (error) {
    logger.warn('WidgetHotkey', `读取主热键启用状态失败，使用默认值: ${error.message}`)
  }

  // 读取搜索热键启用状态
  try {
    const savedSearchEnabled = appSettingDao.get(SEARCH_HOTKEY_ENABLED_KEY)
    if (savedSearchEnabled !== null) {
      searchEnabled = savedSearchEnabled === '1' || savedSearchEnabled === 'true'
    } else {
      appSettingDao.set(SEARCH_HOTKEY_ENABLED_KEY, '1')
    }
  } catch (error) {
    logger.warn('WidgetHotkey', `读取搜索热键启用状态失败，使用默认值: ${error.message}`)
  }

  // 应用退出时自动注销
  app.on('will-quit', () => {
    unregister()
    unregisterSearchHotkey()
    logger.info('WidgetHotkey', '应用退出，热键已注销')
  })

  // 注册 IPC 通道
  registerIpcChannels()

  // 初始化主热键
  let mainResult = { ok: true }
  if (mainEnabled) {
    let accelerator = defaultAccelerator || DEFAULT_MAIN_ACCELERATOR
    try {
      const saved = appSettingDao.get(MAIN_HOTKEY_SETTING_KEY)
      if (saved) {
        accelerator = saved
      } else {
        // 未配置则写入默认值
        appSettingDao.set(MAIN_HOTKEY_SETTING_KEY, accelerator)
      }
    } catch (error) {
      logger.warn('WidgetHotkey', `读取主热键配置失败，使用默认值: ${error.message}`)
    }

    mainResult = register(accelerator)
    if (!mainResult.ok) {
      logger.warn('WidgetHotkey', `初始主热键注册失败: ${mainResult.error}`)
    }
  }

  // 初始化搜索热键
  let searchResult = { ok: true }
  if (searchEnabled) {
    let searchAcc = DEFAULT_SEARCH_ACCELERATOR
    try {
      const savedSearch = appSettingDao.get(SEARCH_HOTKEY_SETTING_KEY)
      if (savedSearch) {
        searchAcc = savedSearch
      } else {
        appSettingDao.set(SEARCH_HOTKEY_SETTING_KEY, searchAcc)
      }
    } catch (error) {
      logger.warn('WidgetHotkey', `读取搜索热键配置失败，使用默认值: ${error.message}`)
    }

    searchResult = registerSearchHotkey(searchAcc)
    if (!searchResult.ok) {
      logger.warn('WidgetHotkey', `初始搜索热键注册失败: ${searchResult.error}`)
    }
  }

  return mainResult
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
  // 初始化
  init,
  // 主热键（保持向后兼容，widget-channels.js 已使用）
  register,
  unregister,
  setAccelerator,
  getAccelerator,
  isValidAccelerator,
  // 主热键扩展
  getMainEnabled,
  setMainEnabled,
  resetToDefault,
  refreshMainRegistration,
  // 搜索热键
  registerSearchHotkey,
  unregisterSearchHotkey,
  getSearchAccelerator,
  setSearchAccelerator,
  getSearchEnabled,
  setSearchEnabled,
  refreshSearchRegistration,
  // 手势校验
  isReservedSystemGesture,
  isRiskyGesture,
  hasWinModifier,
  formatGesture,
  validateGesture,
  // 状态查询
  getStatus,
  // 常量
  DEFAULT_ACCELERATOR: DEFAULT_MAIN_ACCELERATOR,
  DEFAULT_MAIN_ACCELERATOR,
  DEFAULT_SEARCH_ACCELERATOR,
  RESERVED_WIN_SPACE_ACCELERATOR,
  // 修饰键位标志
  MODIFIER_NONE,
  MODIFIER_ALT,
  MODIFIER_CONTROL,
  MODIFIER_SHIFT,
  MODIFIER_WINDOWS,
  // 状态机（导出用于测试和外部查询）
  WinSpaceHotkeyStateMachine,
  RESERVED_DISPOSITION
}
