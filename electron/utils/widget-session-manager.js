// ============================================================
// 小部件会话管理 + 显示变化监听（纯逻辑 + 平台依赖注入）
//        及 WidgetDisplayChangeWatcher.cs
// 职责：
//   1. WidgetSessionManager：第一代会话协调器，仅记录会话状态
//      窗口 Z 序与动画决策仍由 WidgetManager / windows 拥有
//   2. WidgetDisplayChangeWatcher：监听显示/DPI/任务栏重建消息，
//      触发延迟恢复回调；支持拖拽/缩放期间抑制恢复
// 类型映射：
//   C# enum WidgetSessionState   → JS 字符串常量 WIDGET_SESSION_STATE
//   C# Action<string> _log       → JS (msg) => void
//   C# DispatcherQueueTimer      → JS setTimeout / clearTimeout
//   C# Win32Helper.SetWindowSubclass → 注入的 platform.installSubclass
//   C# IntPtr hWnd               → JS number
// 纯逻辑模块：不直接依赖 Vue/Electron/FFI，平台调用通过 platform 注入
// ============================================================

// ------------------------------------------------------------
// 会话状态枚举（对齐 C# WidgetSessionState）
// ------------------------------------------------------------

const WIDGET_SESSION_STATE = Object.freeze({
  DesktopResting: 'DesktopResting',
  RaisedSession: 'RaisedSession',
  InteractionActive: 'InteractionActive',
  Hidden: 'Hidden'
})

// ------------------------------------------------------------
// WidgetSessionManager：会话管理器
// ------------------------------------------------------------

/**
 * 创建小部件会话管理器
 * 移植自 C# sealed class WidgetSessionManager
 * @param {function(string): void} [logFn] - 日志函数
 * @returns {object} 会话管理器实例
 */
function createWidgetSessionManager (logFn) {
  const log = typeof logFn === 'function' ? logFn : () => {}
  let interactionDepth = 0
  let state = WIDGET_SESSION_STATE.DesktopResting
  let stateBeforeInteraction = WIDGET_SESSION_STATE.DesktopResting

  /**
   * 设置状态（带日志）
   * 移植自 C# SetState
   * @param {string} nextState
   * @param {string} reason
   */
  function setState (nextState, reason) {
    if (state === nextState) {
      log(`[WidgetSession] kept state=${state} reason=${reason} interactions=${interactionDepth}`)
      return
    }
    const previousState = state
    state = nextState
    log(`[WidgetSession] changed ${previousState} -> ${nextState} reason=${reason} interactions=${interactionDepth}`)
  }

  return {
    /**
     * 当前状态
     * 对齐 C# State
     * @returns {string}
     */
    get state () {
      return state
    },

    /**
     * 是否处于提升态
     * 对齐 C# IsRaised
     * @returns {boolean}
     */
    get isRaised () {
      return state === WIDGET_SESSION_STATE.RaisedSession ||
        state === WIDGET_SESSION_STATE.InteractionActive
    },

    /**
     * 是否有进行中的交互
     * 对齐 C# IsInteractionActive
     * @returns {boolean}
     */
    get isInteractionActive () {
      return interactionDepth > 0
    },

    /**
     * 标记为桌面静止
     * 移植自 C# MarkDesktopResting
     * @param {string} reason
     */
    markDesktopResting (reason) {
      interactionDepth = 0
      setState(WIDGET_SESSION_STATE.DesktopResting, reason)
    },

    /**
     * 标记为提升会话
     * 移植自 C# MarkRaisedSession
     * @param {string} reason
     */
    markRaisedSession (reason) {
      if (interactionDepth > 0) {
        setState(WIDGET_SESSION_STATE.InteractionActive, reason)
        return
      }
      setState(WIDGET_SESSION_STATE.RaisedSession, reason)
    },

    /**
     * 标记为隐藏
     * 移植自 C# MarkHidden
     * @param {string} reason
     */
    markHidden (reason) {
      interactionDepth = 0
      setState(WIDGET_SESSION_STATE.Hidden, reason)
    },

    /**
     * 开始交互
     * 移植自 C# BeginInteraction
     * @param {string} reason
     */
    beginInteraction (reason) {
      if (interactionDepth === 0 && state !== WIDGET_SESSION_STATE.InteractionActive) {
        stateBeforeInteraction = state
      }
      interactionDepth++
      setState(WIDGET_SESSION_STATE.InteractionActive, reason)
    },

    /**
     * 结束交互
     * 移植自 C# EndInteraction
     * @param {string} reason
     */
    endInteraction (reason) {
      if (interactionDepth <= 0) {
        log(`[WidgetSession] ignored end reason=${reason} state=${state}`)
        return
      }
      interactionDepth--
      setState(
        interactionDepth > 0 ? WIDGET_SESSION_STATE.InteractionActive : stateBeforeInteraction,
        reason
      )
    }
  }
}

// ------------------------------------------------------------
// WidgetDisplayChangeWatcher：显示变化监听器
// ------------------------------------------------------------

// Windows 消息常量（对齐 C# WidgetDisplayChangeWatcher）
const WM_DISPLAY_CHANGE = 0x007E
const WM_SETTING_CHANGE = 0x001A
const WM_DPI_CHANGED = 0x02E0
const WM_NC_DESTROY = 0x0082
const SPI_SET_WORK_AREA = 0x002F

// 恢复延迟（对齐 C# RestoreDelay = 280ms）
const RESTORE_DELAY_MS = 280

// 桌面 Shell 相关 SettingChange 区域关键字（对齐 C# IsRelevantSettingChange）
const RELEVANT_SETTING_CHANGE_KEYWORDS = [
  'Display',
  'Monitor',
  'WorkArea',
  'Taskbar',
  'Tray',
  'StuckRects',
  'ShellState',
  'AppBar'
]

/**
 * 判断 SettingChange 消息是否与桌面/任务栏相关
 * 移植自 C# IsRelevantSettingChange
 * @param {number} wParam - SPI 参数
 * @param {string|null} area - lParam 解析出的字符串
 * @returns {boolean}
 */
function isRelevantSettingChange (wParam, area) {
  if (wParam === SPI_SET_WORK_AREA) return true
  if (typeof area !== 'string' || area.length === 0 || area.trim().length === 0) {
    return false
  }
  for (const keyword of RELEVANT_SETTING_CHANGE_KEYWORDS) {
    if (area.toLowerCase().includes(keyword.toLowerCase())) return true
  }
  return false
}

/**
 * 创建显示变化监听器
 * 移植自 C# sealed class WidgetDisplayChangeWatcher
 * @param {object} options
 * @param {number} options.windowHandle - 被监听的窗口句柄
 * @param {function(): void} options.displayChangeAction - 显示变化回调
 * @param {function(string): void} [options.logFn] - 日志函数
 * @param {object} options.platform - 平台接口
 * @param {function(number, function, object): boolean} options.platform.installSubclass
 *   (hWnd, proc, refData) => installed
 * @param {function(number, function, object): void} options.platform.removeSubclass
 * @param {function(number, number, number, number, object): number} options.platform.defSubclassProc
 *   (hWnd, msg, wParam, lParam, refData) => result
 * @param {function(string): number} [options.platform.registerWindowMessage]
 * @param {function(number): string|null} [options.platform.ptrToStringUni] - lParam → string
 * @param {function(): void} [options.onInvalidateDesktopIconViewCache] - 失效桌面图标视图缓存
 * @param {number} [options.restoreDelayMs=280] - 恢复延迟
 * @returns {object} 监听器实例
 */
function createDisplayChangeWatcher (options) {
  const opts = options || {}
  const windowHandle = opts.windowHandle
  const displayChangeAction = opts.displayChangeAction
  const platform = opts.platform
  const log = typeof opts.logFn === 'function' ? opts.logFn : () => {}
  const onInvalidateCache = typeof opts.onInvalidateDesktopIconViewCache === 'function'
    ? opts.onInvalidateDesktopIconViewCache
    : () => {}
  const restoreDelayMs = opts.restoreDelayMs > 0 ? opts.restoreDelayMs : RESTORE_DELAY_MS

  if (!windowHandle || typeof windowHandle !== 'number') {
    throw new Error('createDisplayChangeWatcher: windowHandle 必须是数字')
  }
  if (typeof displayChangeAction !== 'function') {
    throw new Error('createDisplayChangeWatcher: displayChangeAction 必须是函数')
  }
  if (!platform || typeof platform.installSubclass !== 'function') {
    throw new Error('createDisplayChangeWatcher: platform.installSubclass 必须注入')
  }

  // TaskbarCreated 消息号（对齐 C# s_taskbarCreatedMessage）
  const taskbarCreatedMessage = typeof platform.registerWindowMessage === 'function'
    ? platform.registerWindowMessage('TaskbarCreated')
    : 0

  let isDisposed = false
  let isSuppressed = false
  let restoreTimer = null

  /**
   * 窗口子类化过程
   * 移植自 C# WindowSubclassProc
   * @param {number} hWnd
   * @param {number} message
   * @param {number} wParam
   * @param {number} lParam
   * @param {object} refData
   * @returns {number}
   */
  function windowSubclassProc (hWnd, message, wParam, lParam, refData) {
    if (message === WM_DISPLAY_CHANGE || message === WM_DPI_CHANGED ||
        message === taskbarCreatedMessage ||
        (message === WM_SETTING_CHANGE && isRelevantSettingChangeWParam(wParam, lParam))) {
      onInvalidateCache()
      if (!isSuppressed) {
        queueRestore()
      }
      // 抑制期间：用户的最终拖拽/缩放边界仍为权威
    } else if (message === WM_NC_DESTROY) {
      dispose()
    }
    return platform.defSubclassProc(hWnd, message, wParam, lParam, refData)
  }

  /**
   * 解析 wParam / lParam 并判断是否相关
   * @param {number} wParam
   * @param {number} lParam
   * @returns {boolean}
   */
  function isRelevantSettingChangeWParam (wParam, lParam) {
    let area = null
    if (lParam !== 0 && typeof platform.ptrToStringUni === 'function') {
      area = platform.ptrToStringUni(lParam)
    }
    return isRelevantSettingChange(wParam, area)
  }

  /**
   * 排队恢复
   * 移植自 C# QueueRestore / ScheduleRestore
   */
  function queueRestore () {
    if (isDisposed) return
    if (restoreTimer !== null) {
      clearTimeout(restoreTimer)
    }
    restoreTimer = setTimeout(() => {
      restoreTimer = null
      if (isDisposed) return
      try {
        displayChangeAction()
      } catch (err) {
        log(`[WidgetDisplayChangeWatcher] Display change callback failed: ${err}`)
      }
    }, restoreDelayMs)
  }

  /**
   * 释放监听器
   * 移植自 C# Dispose
   */
  function dispose () {
    if (isDisposed) return
    isDisposed = true
    if (restoreTimer !== null) {
      clearTimeout(restoreTimer)
      restoreTimer = null
    }
    removeSubclass()
  }

  /**
   * 移除子类化
   * 移植自 C# RemoveSubclass
   */
  function removeSubclass () {
    if (!isSubclassInstalled) return
    if (typeof platform.removeSubclass === 'function') {
      platform.removeSubclass(windowHandle, windowSubclassProc)
    }
    isSubclassInstalled = false
  }

  // 安装子类化
  let isSubclassInstalled = !!platform.installSubclass(
    windowHandle,
    windowSubclassProc,
    null
  )

  return {
    /**
     * 抑制恢复（拖拽/缩放期间）
     * 移植自 C# SuppressRestore
     */
    suppressRestore () {
      isSuppressed = true
    },

    /**
     * 恢复恢复（拖拽/缩放结束后）
     * 移植自 C# ResumeRestore
     * 注意：抑制期间排队的恢复会被丢弃，而非触发；
     *       拖拽/缩放结束处理已把配置更新为当前物理位置
     */
    resumeRestore () {
      if (!isSuppressed) return
      isSuppressed = false
    },

    /**
     * 释放
     */
    dispose,

    /**
     * 是否已释放
     * @returns {boolean}
     */
    get isDisposed () {
      return isDisposed
    },

    /**
     * 是否处于抑制态
     * @returns {boolean}
     */
    get isSuppressed () {
      return isSuppressed
    },

    /**
     * 子类化是否已安装
     * @returns {boolean}
     */
    get isSubclassInstalled () {
      return isSubclassInstalled
    }
  }
}

// ------------------------------------------------------------
// 模块导出
// ------------------------------------------------------------

module.exports = {
  // 会话管理器
  createWidgetSessionManager,
  // 显示变化监听器
  createDisplayChangeWatcher,
  isRelevantSettingChange,
  // 常量
  WIDGET_SESSION_STATE,
  WM_DISPLAY_CHANGE,
  WM_SETTING_CHANGE,
  WM_DPI_CHANGED,
  WM_NC_DESTROY,
  SPI_SET_WORK_AREA,
  RESTORE_DELAY_MS,
  RELEVANT_SETTING_CHANGE_KEYWORDS
}