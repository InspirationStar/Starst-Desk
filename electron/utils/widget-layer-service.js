// ============================================================
// 小部件层服务 + Z 序策略集合（纯逻辑 + Win32 依赖注入）
//        及配套策略：
//          - IdleWidgetZOrderPolicy.cs
//          - WidgetTemporaryRaiseLeasePolicy.cs
//          - WidgetExpandedLayerLeasePolicy.cs
//          - RelativeLayerRestorePolicy.cs
//          - WidgetLayerPointerActivationPolicy（WidgetLayerService.cs 末尾）
// 职责：
//   1. 集中桌面小部件 Z 序操作，避免每种小部件窗口重复 Win32 调用
//   2. 提供空闲/临时提升/展开层/相对层恢复/指针激活的纯策略判定
// 类型映射：
//   C# IntPtr           → JS number（HWND 句柄，0 表示 IntPtr.Zero）
//   C# long Generation  → JS number（安全整数范围足够）
//   C# IReadOnlyList    → JS Array
//   C# lock             → JS 串行调用约定（Node 单线程，临界区由调用方保证）
//   C# Win32Helper      → 注入的 win32 对象（FFI 调用由外部封装）
//   C# App.LogVerbose   → 注入的 logger 函数
// 纯逻辑模块：不直接依赖 Vue/Electron/FFI，所有 Win32 调用通过 win32 注入
// ============================================================

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

// 让 Progman 生成 WorkerW 的消息（对齐 C# SpawnWorkerWMessage = 0x052C）
const SPAWN_WORKER_W_MESSAGE = 0x052C

// 桌面图标层附着记录（对齐 C# DesktopLayerAttachment record）
//   { originalOwner: number }

// 相对层恢复处置枚举（对齐 C# RelativeLayerRestoreDisposition）
const RELATIVE_LAYER_RESTORE_DISPOSITION = Object.freeze({
  DesktopBottom: 'DesktopBottom',
  PreservePeerOrder: 'PreservePeerOrder',
  BehindForeground: 'BehindForeground'
})

// 小部件层模式常量（对齐 C# SettingsService.WidgetLayerModeDesktopPinned）
const WIDGET_LAYER_MODE_DESKTOP_PINNED = 'DesktopPinned'

// ------------------------------------------------------------
// IdleWidgetZOrderPolicy：空闲小部件 Z 序策略（纯函数）
// ------------------------------------------------------------

/**
 * 规范化空闲 Z 序候选列表，返回从高到低的排序
 * 移植自 C# IdleWidgetZOrderPolicy.OrderHighestToLowest
 * 算法：
 *   1. 过滤掉窗口句柄为 0 的候选
 *   2. 按窗口句柄去重（保留首个）
 *   3. 按 displayKey 升序、top 降序、left 降序、stableKey 升序排序
 *   低行保持在上方，避免上方小部件的阴影遮蔽下方小部件顶边
 * @param {Array<{windowHandle: number, displayKey: string, top: number, left: number, stableKey: string}>} candidates
 * @returns {Array} 从高到低排序后的候选列表（新数组）
 */
function orderIdleZOrderHighestToLowest (candidates) {
  if (!Array.isArray(candidates)) return []
  const seen = new Set()
  const filtered = []
  for (const candidate of candidates) {
    if (!candidate || candidate.windowHandle === 0) continue
    if (seen.has(candidate.windowHandle)) continue
    seen.add(candidate.windowHandle)
    filtered.push(candidate)
  }
  // displayKey 升序 → top 降序 → left 降序 → stableKey 升序
  filtered.sort((a, b) => {
    if (a.displayKey < b.displayKey) return -1
    if (a.displayKey > b.displayKey) return 1
    if (a.top !== b.top) return b.top - a.top
    if (a.left !== b.left) return b.left - a.left
    if (a.stableKey < b.stableKey) return -1
    if (a.stableKey > b.stableKey) return 1
    return 0
  })
  return filtered
}

// ------------------------------------------------------------
// WidgetTemporaryRaiseLeasePolicy：临时提升租约策略（纯函数）
// ------------------------------------------------------------

/**
 * 创建一个临时提升租约
 * 对齐 C# readonly record struct WidgetTemporaryRaiseLease
 * @param {number[]|null} windowHandles
 * @param {number} generation
 * @returns {{windowHandles: number[], generation: number}}
 */
function createTemporaryRaiseLease (windowHandles, generation) {
  const handles = Array.isArray(windowHandles) ? windowHandles : []
  return { windowHandles: handles, generation: generation || 0 }
}

/**
 * 租约是否处于活跃状态
 * 对齐 C# WidgetTemporaryRaiseLease.IsActive
 * @param {{windowHandles: number[], generation: number}} lease
 * @returns {boolean}
 */
function isTemporaryRaiseLeaseActive (lease) {
  return lease && lease.windowHandles.length > 0 && lease.generation > 0
}

/**
 * 是否可以恢复桌面层
 * 移植自 C# WidgetTemporaryRaiseLeasePolicy.CanRestoreDesktopLayer
 * @param {boolean} isVisible
 * @param {boolean} isHideAnimationRunning
 * @param {boolean} isClosing
 * @returns {boolean}
 */
function canRestoreDesktopLayer (isVisible, isHideAnimationRunning, isClosing) {
  return isVisible && !isHideAnimationRunning && !isClosing
}

/**
 * 是否应该武装安全恢复
 * 移植自 C# WidgetTemporaryRaiseLeasePolicy.ShouldArmSafetyRestore
 * @param {boolean} isAtDesktopLayer
 * @returns {boolean}
 */
function shouldArmSafetyRestore (isAtDesktopLayer) {
  return !isAtDesktopLayer
}

/**
 * 是否应该推迟安全恢复
 * 移植自 C# WidgetTemporaryRaiseLeasePolicy.ShouldDeferSafetyRestore
 * @param {boolean} isDragging
 * @param {boolean} isResizing
 * @param {boolean} hasBlockingFlyout
 * @param {boolean} isManagerInteractionActive
 * @returns {boolean}
 */
function shouldDeferSafetyRestore (isDragging, isResizing, hasBlockingFlyout, isManagerInteractionActive) {
  return isDragging || isResizing || hasBlockingFlyout || isManagerInteractionActive
}

/**
 * 获取下一个代际值（绕回 1 防止 long.MaxValue 溢出）
 * 对齐 C# generation == long.MaxValue ? 1 : generation + 1
 * @param {number} generation
 * @returns {number}
 */
function nextLeaseGeneration (generation) {
  // JS Number.MAX_SAFE_INTEGER 充当 C# long.MaxValue 的对应物
  if (generation >= Number.MAX_SAFE_INTEGER) return 1
  return generation + 1
}

/**
 * 获取临时提升租约（合并当前租约与新窗口句柄）
 * 移植自 C# WidgetTemporaryRaiseLeasePolicy.Acquire
 * @param {{windowHandles: number[], generation: number}} current
 * @param {Iterable<number>} windowHandles
 * @returns {{windowHandles: number[], generation: number}}
 */
function acquireTemporaryRaiseLease (current, windowHandles) {
  const base = current || createTemporaryRaiseLease(null, 0)
  const merged = new Set(base.windowHandles)
  for (const handle of windowHandles || []) {
    if (handle !== 0) merged.add(handle)
  }
  const handles = Array.from(merged)
  if (handles.length === 0) return base
  return createTemporaryRaiseLease(handles, nextLeaseGeneration(base.generation))
}

/**
 * 当前租约是否拥有指定代际
 * 移植自 C# WidgetTemporaryRaiseLeasePolicy.OwnsGeneration
 * @param {{windowHandles: number[], generation: number}} current
 * @param {number} generation
 * @returns {boolean}
 */
function ownsTemporaryRaiseLeaseGeneration (current, generation) {
  return isTemporaryRaiseLeaseActive(current) && current.generation === generation
}

/**
 * 释放临时提升租约
 * 移植自 C# WidgetTemporaryRaiseLeasePolicy.Release
 * @param {{windowHandles: number[], generation: number}} current
 * @param {number} generation
 * @returns {{windowHandles: number[], generation: number}}
 */
function releaseTemporaryRaiseLease (current, generation) {
  if (ownsTemporaryRaiseLeaseGeneration(current, generation)) {
    return createTemporaryRaiseLease([], current.generation)
  }
  return current
}

/**
 * 从租约中遗忘指定窗口句柄
 * 移植自 C# WidgetTemporaryRaiseLeasePolicy.Forget
 * @param {{windowHandles: number[], generation: number}} current
 * @param {number} windowHandle
 * @returns {{windowHandles: number[], generation: number}}
 */
function forgetTemporaryRaiseLeaseWindow (current, windowHandle) {
  if (!isTemporaryRaiseLeaseActive(current) || windowHandle === 0) return current
  const remaining = current.windowHandles.filter(handle => handle !== windowHandle)
  return createTemporaryRaiseLease(remaining, current.generation)
}

// ------------------------------------------------------------
// WidgetExpandedLayerLeasePolicy：展开层租约策略（纯函数）
// ------------------------------------------------------------

/**
 * 创建一个展开层租约
 * 对齐 C# readonly record struct WidgetExpandedLayerLease
 * @param {number} windowHandle
 * @param {number} generation
 * @returns {{windowHandle: number, generation: number}}
 */
function createExpandedLayerLease (windowHandle, generation) {
  return { windowHandle: windowHandle || 0, generation: generation || 0 }
}

/**
 * 展开层租约是否活跃
 * 对齐 C# WidgetExpandedLayerLease.IsActive
 * @param {{windowHandle: number, generation: number}} lease
 * @returns {boolean}
 */
function isExpandedLayerLeaseActive (lease) {
  return !!lease && lease.windowHandle !== 0 && lease.generation > 0
}

/**
 * 获取展开层租约
 * 移植自 C# WidgetExpandedLayerLeasePolicy.Acquire
 * @param {{windowHandle: number, generation: number}} current
 * @param {number} windowHandle
 * @returns {{windowHandle: number, generation: number}}
 */
function acquireExpandedLayerLease (current, windowHandle) {
  const base = current || createExpandedLayerLease(0, 0)
  if (windowHandle === 0) return base
  return createExpandedLayerLease(windowHandle, nextLeaseGeneration(base.generation))
}

/**
 * 当前租约是否拥有指定窗口与代际
 * 移植自 C# WidgetExpandedLayerLeasePolicy.Owns
 * @param {{windowHandle: number, generation: number}} current
 * @param {number} windowHandle
 * @param {number} generation
 * @returns {boolean}
 */
function ownsExpandedLayerLease (current, windowHandle, generation) {
  return isExpandedLayerLeaseActive(current) &&
    current.windowHandle === windowHandle &&
    current.generation === generation
}

/**
 * 释放展开层租约
 * 移植自 C# WidgetExpandedLayerLeasePolicy.Release
 * @param {{windowHandle: number, generation: number}} current
 * @param {number} windowHandle
 * @param {number} generation
 * @returns {{windowHandle: number, generation: number}}
 */
function releaseExpandedLayerLease (current, windowHandle, generation) {
  if (ownsExpandedLayerLease(current, windowHandle, generation)) {
    return createExpandedLayerLease(0, current.generation)
  }
  return current
}

// ------------------------------------------------------------
// RelativeLayerRestorePolicy：相对层恢复策略（纯函数）
// ------------------------------------------------------------

/**
 * 是否应该附着到桌面
 * 移植自 C# RelativeLayerRestorePolicy.ShouldAttachToDesktop
 * @param {boolean} usesDesktopPinnedMode
 * @param {boolean} keepVisibleOnShowDesktop
 * @returns {boolean}
 */
function shouldAttachToDesktop (usesDesktopPinnedMode, keepVisibleOnShowDesktop) {
  return usesDesktopPinnedMode || keepVisibleOnShowDesktop
}

/**
 * 决定相对层恢复处置
 * 移植自 C# RelativeLayerRestorePolicy.Decide
 * @param {boolean} hasForeground
 * @param {boolean} foregroundIsDesktopShell
 * @param {boolean} foregroundIsSelf
 * @returns {string} RELATIVE_LAYER_RESTORE_DISPOSITION 之一
 */
function decideRelativeLayerRestore (hasForeground, foregroundIsDesktopShell, foregroundIsSelf, foregroundIsSelfApp) {
  if (!hasForeground || foregroundIsDesktopShell) {
    return RELATIVE_LAYER_RESTORE_DISPOSITION.DesktopBottom
  }
  if (foregroundIsSelf || foregroundIsSelfApp) {
    return RELATIVE_LAYER_RESTORE_DISPOSITION.PreservePeerOrder
  }
  return RELATIVE_LAYER_RESTORE_DISPOSITION.BehindForeground
}

// ------------------------------------------------------------
// WidgetLayerPointerActivationPolicy：指针激活策略（纯函数）
// ------------------------------------------------------------

/**
 * 是否应该抑制指针激活
 * 移植自 C# WidgetLayerPointerActivationPolicy.ShouldSuppress
 * 桌面钉扎模式下，存在前台且前台非桌面 Shell、非小部件时，抑制激活
 * @param {boolean} usesDesktopPinnedMode
 * @param {boolean} hasForegroundWindow
 * @param {boolean} foregroundIsDesktopShell
 * @param {boolean} foregroundIsWidget
 * @returns {boolean}
 */
function shouldSuppressPointerActivation (usesDesktopPinnedMode, hasForegroundWindow, foregroundIsDesktopShell, foregroundIsWidget) {
  return usesDesktopPinnedMode &&
    hasForegroundWindow &&
    !foregroundIsDesktopShell &&
    !foregroundIsWidget
}

// ------------------------------------------------------------
// WidgetLayerService：层服务核心（依赖注入工厂）
// ------------------------------------------------------------

/**
 * 创建小部件层服务实例
 * 移植自 C# static class WidgetLayerService
 * 由于 Node 单线程，C# 的 lock 在 JS 中无需等价物；保留 _desktopLayerLock 字段仅作语义标注
 * @param {object} options
 * @param {object} options.win32 - Win32Helper 等价接口（FFI 封装）
 * @param {function} [options.getSettings] - 返回当前设置（widgetLayerMode、keepWidgetsVisibleOnShowDesktop）
 * @param {function} [options.normalizeWidgetLayerMode] - 规范化层模式字符串
 * @returns {object} 层服务实例
 */
function createWidgetLayerService (options) {
  const win32 = options && options.win32
  if (!win32) {
    throw new Error('createWidgetLayerService: win32 接口必须注入')
  }
  const app = (options && options.app) || {}
  const getSettings = (options && options.getSettings) || (() => ({}))
  const normalizeWidgetLayerMode = (options && options.normalizeWidgetLayerMode) ||
    ((mode) => (typeof mode === 'string' ? mode : ''))

  // 日志辅助（对齐 App.LogVerbose / App.Log）
  const logVerbose = typeof app.logVerbose === 'function'
    ? app.logVerbose
    : () => {}
  const log = typeof app.log === 'function' ? app.log : () => {}
  const isWidgetWindow = typeof app.isWidgetWindow === 'function'
    ? app.isWidgetWindow
    : () => false
  const isWidgetWindow = typeof app.isWidgetWindow === 'function'
    ? app.isWidgetWindow
    : () => false

  // 桌面图标层附着表：windowHandle -> { originalOwner: number }
  const desktopLayerAttachments = new Map()
  // 缓存的桌面图标视图 HWND
  let cachedDesktopIconView = 0

  // ----------------------------------------------------------
  // 设置访问辅助
  // ----------------------------------------------------------

  /**
   * 是否使用桌面钉扎模式
   * 移植自 C# WidgetLayerService.UsesDesktopPinnedMode
   * @returns {boolean}
   */
  function usesDesktopPinnedMode () {
    const settings = getSettings() || {}
    const mode = normalizeWidgetLayerMode(settings.widgetLayerMode)
    return mode === WIDGET_LAYER_MODE_DESKTOP_PINNED
  }

  /**
   * 是否应该把静止窗口附着到桌面
   * 移植自 C# ShouldAttachRestingWindowToDesktop
   * @returns {boolean}
   */
  function shouldAttachRestingWindowToDesktop () {
    const settings = getSettings() || {}
    const keepVisible = settings.keepWidgetsVisibleOnShowDesktop !== false
    return shouldAttachToDesktop(usesDesktopPinnedMode(), keepVisible)
  }

  // ----------------------------------------------------------
  // 桌面图标层查找
  // ----------------------------------------------------------

  /**
   * 在指定窗口下查找 SHELLDLL_DefView 子窗口
   * 移植自 C# FindDesktopIconViewChild
   * @param {number} windowHandle
   * @returns {number} 子窗口句柄；未找到返回 0
   */
  function findDesktopIconViewChild (windowHandle) {
    return win32.findWindowEx(windowHandle, 0, 'SHELLDLL_DefView', null)
  }

  /**
   * 查找桌面图标视图窗口
   * 移植自 C# FindDesktopIconView
   * 算法：
   *   1. 命中缓存且窗口仍有效则直接返回
   *   2. 枚举所有顶层窗口，查找已托管 SHELLDLL_DefView 的 WorkerW
   *   3. 若未找到，向 Progman 发送 0x052C 生成 WorkerW
   *   4. 再次枚举查找
   * @returns {number} 桌面图标视图句柄；未找到返回 0
   */
  function findDesktopIconView () {
    if (cachedDesktopIconView !== 0 && win32.isWindow(cachedDesktopIconView)) {
      return cachedDesktopIconView
    }

    // 1. 枚举查找已存在的 DefView
    let existingDefView = 0
    win32.enumWindows((hWnd) => {
      const defView = findDesktopIconViewChild(hWnd)
      if (defView !== 0) {
        existingDefView = defView
        return false // 停止枚举
      }
      return true
    })
    if (existingDefView !== 0) {
      cachedDesktopIconView = existingDefView
      return cachedDesktopIconView
    }

    // 2. 向 Progman 发送 0x052C 生成 WorkerW
    const progman = win32.findWindow('Progman', null)
    if (progman !== 0) {
      win32.sendMessageTimeout(progman, SPAWN_WORKER_W_MESSAGE, 0, 0, win32.SMTO_NORMAL, 1000)
      const progmanDefView = findDesktopIconViewChild(progman)
      if (progmanDefView !== 0) {
        cachedDesktopIconView = progmanDefView
        return cachedDesktopIconView
      }
    }

    // 3. 再次枚举查找
    let workerDefView = 0
    win32.enumWindows((hWnd) => {
      const defView = findDesktopIconViewChild(hWnd)
      if (defView !== 0) {
        workerDefView = defView
        return false
      }
      return true
    })
    cachedDesktopIconView = workerDefView
    return cachedDesktopIconView
  }

  /**
   * 判断窗口是否属于桌面 Shell（Progman / WorkerW / SHELLDLL_DefView 链）
   * 移植自 C# IsDesktopShellWindow
   * @param {number} windowHandle
   * @returns {boolean}
   */
  function isDesktopShellWindow (windowHandle) {
    let current = windowHandle
    while (current !== 0) {
      const className = win32.getClassName(current)
      if (className === 'Progman' ||
          className === 'WorkerW' ||
          className === 'SHELLDLL_DefView') {
        return true
      }
      current = win32.getParent(current)
    }
    return false
  }

  /**
   * 获取前台窗口的根属主
   * 移植自 C# GetForegroundRoot
   * @param {number} foreground
   * @returns {number}
   */
  function getForegroundRoot (foreground) {
    const foregroundRoot = win32.getAncestor(foreground, win32.GA_ROOTOWNER)
    return foregroundRoot === 0 ? foreground : foregroundRoot
  }

  // ----------------------------------------------------------
  // 桌面图标层附着 / 分离
  // ----------------------------------------------------------

  /**
   * 恢复窗口原始属主
   * 移植自 C# RestoreOriginalOwner
   * @param {number} windowHandle
   */
  function restoreOriginalOwner (windowHandle) {
    const attachment = desktopLayerAttachments.get(windowHandle)
    if (!attachment) return

    win32.setWindowLongPtr(windowHandle, win32.GWLP_HWNDPARENT, attachment.originalOwner)
    win32.setWindowPos(
      windowHandle,
      win32.HWND_NOTOPMOST,
      0, 0, 0, 0,
      win32.SWP_NOMOVE | win32.SWP_NOSIZE | win32.SWP_NOACTIVATE
    )
    desktopLayerAttachments.delete(windowHandle)
    logVerbose(`[WidgetLayer] DesktopPinned owner detached hwnd=0x${windowHandle.toString(16)}`)
  }

  /**
   * 把窗口附着到桌面图标层
   * 移植自 C# TryAttachToDesktopIconLayer
   * @param {number} windowHandle
   * @param {boolean} [placeAtBottom=true] - 是否同时置于底部
   * @returns {boolean} 是否成功附着
   */
  function tryAttachToDesktopIconLayer (windowHandle, placeAtBottom = true) {
    if (windowHandle === 0 || !win32.isWindow(windowHandle)) return false

    const desktopIconView = findDesktopIconView()
    if (desktopIconView === 0) {
      log('[WidgetLayer] DesktopPinned attach skipped: desktop icon view not found')
      return false
    }

    if (!desktopLayerAttachments.has(windowHandle)) {
      desktopLayerAttachments.set(windowHandle, {
        originalOwner: win32.getWindowLongPtr(windowHandle, win32.GWLP_HWNDPARENT)
      })
    }

    if (win32.getWindowLongPtr(windowHandle, win32.GWLP_HWNDPARENT) !== desktopIconView) {
      win32.setLastError(0)
      win32.setWindowLongPtr(windowHandle, win32.GWLP_HWNDPARENT, desktopIconView)
    }

    const actualOwner = win32.getWindowLongPtr(windowHandle, win32.GWLP_HWNDPARENT)
    if (actualOwner !== desktopIconView) {
      const error = win32.getLastWin32Error()
      log(`[WidgetLayer] DesktopPinned owner attach failed hwnd=0x${windowHandle.toString(16)} defView=0x${desktopIconView.toString(16)} actual=0x${actualOwner.toString(16)} error=${error}`)
      restoreOriginalOwner(windowHandle)
      cachedDesktopIconView = 0
      return false
    }

    win32.clearWindowTopMost(windowHandle)
    if (placeAtBottom) {
      win32.setWindowPos(
        windowHandle,
        win32.HWND_BOTTOM,
        0, 0, 0, 0,
        win32.SWP_NOMOVE | win32.SWP_NOSIZE | win32.SWP_NOACTIVATE | win32.SWP_SHOWWINDOW
      )
    }

    logVerbose(`[WidgetLayer] Desktop owner attached hwnd=0x${windowHandle.toString(16)} defView=0x${desktopIconView.toString(16)} bottom=${placeAtBottom}`)
    return true
  }

  /**
   * 若窗口已附着到桌面图标层，则分离并恢复原始属主
   * 移植自 C# DetachFromDesktopIconLayerIfNeeded
   * @param {number} windowHandle
   */
  function detachFromDesktopIconLayerIfNeeded (windowHandle) {
    if (desktopLayerAttachments.has(windowHandle)) {
      restoreOriginalOwner(windowHandle)
    }
  }

  /**
   * 动态模式下的桌面底部归位
   * 移植自 C# MoveToDynamicDesktopBottom
   * @param {number} windowHandle
   */
  function moveToDynamicDesktopBottom (windowHandle) {
    // 优先附着到桌面图标层，防止 Win+D 隐藏窗口，同时保留可交互提升的动态行为
    if (tryAttachToDesktopIconLayer(windowHandle)) return
    // 兜底：分离后用 NOTOPMOST
    detachFromDesktopIconLayerIfNeeded(windowHandle)
    win32.clearWindowTopMost(windowHandle)
    win32.setWindowToBottom(windowHandle)
  }

  /**
   * 不改变 Z 序层级地把静止窗口附着到桌面
   * 移植自 C# TryAttachRestingWindowWithoutChangingLevel
   * @param {number} windowHandle
   * @returns {boolean}
   */
  function tryAttachRestingWindowWithoutChangingLevel (windowHandle) {
    return shouldAttachRestingWindowToDesktop() &&
      tryAttachToDesktopIconLayer(windowHandle, false)
  }

  /**
   * 为相对放置准备静止窗口
   * 移植自 C# PrepareRestingWindowForRelativePlacement
   * @param {number} windowHandle
   * @returns {boolean} 是否成功附着到桌面
   */
  function prepareRestingWindowForRelativePlacement (windowHandle) {
    const attachedToDesktop = tryAttachRestingWindowWithoutChangingLevel(windowHandle)
    if (!attachedToDesktop) {
      detachFromDesktopIconLayerIfNeeded(windowHandle)
    }
    if (win32.isWindowTopMost(windowHandle)) {
      win32.clearWindowTopMost(windowHandle)
    }
    return attachedToDesktop
  }

  // ----------------------------------------------------------
  // WS_EX_NOACTIVATE 风格管理
  // ----------------------------------------------------------

  /**
   * 判断窗口是否带 WS_EX_NOACTIVATE 扩展风格
   * 移植自 C# IsWindowNoActivate
   * @param {number} windowHandle
   * @returns {boolean}
   */
  function isWindowNoActivate (windowHandle) {
    return windowHandle !== 0 &&
      (win32.getWindowLong(windowHandle, win32.GWL_EXSTYLE) & win32.WS_EX_NOACTIVATE) !== 0
  }

  /**
   * 设置 / 清除窗口的 WS_EX_NOACTIVATE 扩展风格
   * 移植自 C# SetWindowNoActivate
   * @param {number} windowHandle
   * @param {boolean} enabled
   */
  function setWindowNoActivate (windowHandle, enabled) {
    if (windowHandle === 0 || !win32.isWindow(windowHandle)) return

    const extendedStyle = win32.getWindowLong(windowHandle, win32.GWL_EXSTYLE)
    const updatedStyle = enabled
      ? extendedStyle | win32.WS_EX_NOACTIVATE
      : extendedStyle & ~win32.WS_EX_NOACTIVATE
    if (updatedStyle === extendedStyle) return

    win32.setWindowLong(windowHandle, win32.GWL_EXSTYLE, updatedStyle)
    win32.setWindowPos(
      windowHandle,
      0,
      0, 0, 0, 0,
      win32.SWP_NOMOVE | win32.SWP_NOSIZE | win32.SWP_NOZORDER | win32.SWP_NOACTIVATE | win32.SWP_FRAMECHANGED
    )
    logVerbose(`[WidgetLayer] no-activate style hwnd=0x${windowHandle.toString(16)} enabled=${enabled}`)
  }

  /**
   * 按当前模式应用桌面钉扎激活风格
   * 移植自 C# ApplyDesktopPinnedActivationStyle
   * @param {number} windowHandle
   */
  function applyDesktopPinnedActivationStyle (windowHandle) {
    setWindowNoActivate(windowHandle, usesDesktopPinnedMode())
  }

  // ----------------------------------------------------------
  // 对等窗口排序
  // ----------------------------------------------------------

  /**
   * 在所有顶层窗口中找到属于 handles 集合的最高位窗口
   * 移植自 C# FindHighestPeer
   * @param {number[]} handles
   * @returns {number}
   */
  function findHighestPeer (handles) {
    const peers = new Set(handles)
    let current = win32.getWindow(handles[0], win32.GW_HWNDFIRST)
    while (current !== 0) {
      if (peers.has(current)) return current
      current = win32.getWindow(current, win32.GW_HWNDNEXT)
    }
    return handles.length > 0 ? handles[0] : 0
  }

  /**
   * 应用从高到低的窗口顺序（带边界）
   * 移植自 C# ApplyWindowOrderHighestToLowest
   * 优先使用 BeginDeferWindowPos / DeferWindowPos / EndDeferWindowPos 批量设置；
   * 失败则回退到逐个 SetWindowPos
   * @param {number[]} handles
   * @param {number} boundary
   * @param {string} reason
   * @returns {boolean}
   */
  function applyWindowOrderHighestToLowest (handles, boundary, reason) {
    if (handles.length === 0) return true

    let insertAfter = boundary
    const flags = win32.SWP_NOMOVE | win32.SWP_NOSIZE | win32.SWP_NOACTIVATE | win32.SWP_NOOWNERZORDER

    // 1. 尝试批量 DeferWindowPos
    if (typeof win32.beginDeferWindowPos === 'function') {
      let deferred = win32.beginDeferWindowPos(handles.length)
      if (deferred !== 0) {
        for (const handle of handles) {
          deferred = win32.deferWindowPos(deferred, handle, insertAfter, 0, 0, 0, 0, flags)
          if (deferred === 0) break
          insertAfter = handle
        }
        if (deferred !== 0 && win32.endDeferWindowPos(deferred)) {
          logVerbose(`[ZOrder] Window order applied reason=${reason} count=${handles.length} boundary=0x${boundary.toString(16)} highest=0x${handles[0].toString(16)}`)
          return true
        }
      }
    }

    // 2. 回退到逐个 SetWindowPos
    insertAfter = boundary
    let succeeded = true
    for (const handle of handles) {
      succeeded = win32.setWindowPos(handle, insertAfter, 0, 0, 0, 0, flags) && succeeded
      insertAfter = handle
    }
    logVerbose(`[ZOrder] Window order fallback reason=${reason} count=${handles.length} boundary=0x${boundary.toString(16)} highest=0x${handles[0].toString(16)} succeeded=${succeeded}`)
    return succeeded
  }

  /**
   * 应用对等窗口顺序（不激活、不移动、不调整大小）
   * 移植自 C# ApplyPeerOrderHighestToLowest
   * @param {number[]} windowHandles
   * @returns {boolean}
   */
  function applyPeerOrderHighestToLowest (windowHandles) {
    const handles = dedupeValidHandles(windowHandles)
    if (handles.length < 2) return true

    const currentHighest = findHighestPeer(handles)
    const boundary = currentHighest === 0
      ? 0
      : win32.getWindow(currentHighest, win32.GW_HWNDPREV)
    return applyWindowOrderHighestToLowest(
      handles,
      boundary === 0 ? win32.HWND_TOP : boundary,
      'idle-peer-order'
    )
  }

  /**
   * 判断指定窗口是否为对等集合中的最高位
   * 移植自 C# IsHighestPeer
   * @param {number} windowHandle
   * @param {number[]} peerWindowHandles
   * @returns {boolean}
   */
  function isHighestPeer (windowHandle, peerWindowHandles) {
    if (windowHandle === 0 || !win32.isWindow(windowHandle)) return false

    const peers = new Set()
    for (const handle of peerWindowHandles) {
      if (handle !== 0 && handle !== windowHandle) peers.add(handle)
    }
    let current = win32.getWindow(windowHandle, win32.GW_HWNDPREV)
    while (current !== 0) {
      if (peers.has(current)) return false
      current = win32.getWindow(current, win32.GW_HWNDPREV)
    }
    return true
  }

  // ----------------------------------------------------------
  // 句柄列表整理
  // ----------------------------------------------------------

  /**
   * 去重并过滤掉无效窗口句柄
   * 移植自 C# handles.Where(IsWindow).Distinct().ToList()
   * @param {number[]} windowHandles
   * @returns {number[]}
   */
  function dedupeValidHandles (windowHandles) {
    const seen = new Set()
    const result = []
    for (const handle of windowHandles || []) {
      if (handle !== 0 && win32.isWindow(handle) && !seen.has(handle)) {
        seen.add(handle)
        result.push(handle)
      }
    }
    return result
  }

  // ----------------------------------------------------------
  // 公共层操作
  // ----------------------------------------------------------

  /**
   * 把窗口移到桌面底部
   * 移植自 C# MoveToDesktopBottom
   * @param {number} windowHandle
   */
  function moveToDesktopBottom (windowHandle) {
    applyDesktopPinnedActivationStyle(windowHandle)

    // 桌面钉扎模式始终驻留 Explorer 内；动态模式仅在用户希望小部件在 Win+D 后幸存时使用同属主
    if (shouldAttachRestingWindowToDesktop() &&
        tryAttachToDesktopIconLayer(windowHandle)) {
      return
    }

    detachFromDesktopIconLayerIfNeeded(windowHandle)
    win32.clearWindowTopMost(windowHandle)
    win32.setWindowToBottom(windowHandle)
  }

  /**
   * 清除 TOPMOST 同时保留前台
   * 移植自 C# ClearTopMostPreservingForeground
   * @param {number} windowHandle
   * @returns {number} 当时的前台窗口句柄
   */
  function clearTopMostPreservingForeground (windowHandle) {
    applyDesktopPinnedActivationStyle(windowHandle)

    if (usesDesktopPinnedMode()) {
      if (!tryAttachToDesktopIconLayer(windowHandle)) {
        moveToDynamicDesktopBottom(windowHandle)
      }
      return win32.getForegroundWindow()
    }

    const foreground = win32.getForegroundWindow()
    const foregroundRoot = getForegroundRoot(foreground)
    const hasForeground = foregroundRoot !== 0 && win32.isWindow(foregroundRoot)
    const disposition = decideRelativeLayerRestore(
      hasForeground,
      hasForeground && isDesktopShellWindow(foregroundRoot),
      foregroundRoot === windowHandle,
      hasForeground && isWidgetWindow(foregroundRoot)
    )

    switch (disposition) {
      case RELATIVE_LAYER_RESTORE_DISPOSITION.DesktopBottom:
        moveToDesktopBottom(windowHandle)
        break
      case RELATIVE_LAYER_RESTORE_DISPOSITION.PreservePeerOrder:
        if (!tryAttachRestingWindowWithoutChangingLevel(windowHandle)) {
          detachFromDesktopIconLayerIfNeeded(windowHandle)
          win32.clearWindowTopMost(windowHandle)
        }
        break
      case RELATIVE_LAYER_RESTORE_DISPOSITION.BehindForeground:
        tryPlaceDynamicWindowBehindForeground(windowHandle, foregroundRoot, 'restore')
        break
    }

    logVerbose(`[ZOrder] Relative restore widget=0x${windowHandle.toString(16)} foreground=0x${foregroundRoot.toString(16)} disposition=${disposition}`)
    return foreground
  }

  /**
   * 把动态层小部件放到前台窗口之后
   * 移植自 C# TryPlaceDynamicWindowBehindForeground
   * @param {number} windowHandle
   * @param {number} foregroundRoot
   * @param {string} reason
   * @returns {boolean}
   */
  function tryPlaceDynamicWindowBehindForeground (windowHandle, foregroundRoot, reason) {
    const attachedToDesktop = prepareRestingWindowForRelativePlacement(windowHandle)

    // 若前台已是 TOPMOST，HWND_TOP 即可把本非 TOPMOST 小部件放到普通带首位；
    // 否则插入到前台之后，保持该应用仍可见地位于展开小部件之上
    const insertAfter = win32.isWindowTopMost(foregroundRoot)
      ? win32.HWND_TOP
      : foregroundRoot
    const moved = win32.setWindowPos(
      windowHandle,
      insertAfter,
      0, 0, 0, 0,
      win32.SWP_NOMOVE | win32.SWP_NOSIZE | win32.SWP_NOACTIVATE | win32.SWP_NOOWNERZORDER | win32.SWP_SHOWWINDOW
    )
    logVerbose(`[ZOrder] Place behind foreground reason=${reason} widget=0x${windowHandle.toString(16)} foreground=0x${foregroundRoot.toString(16)} desktopAttached=${attachedToDesktop} moved=${moved}`)
    return moved
  }

  /**
   * 以一个 Z 序单元恢复被提升的小部件组
   * 移植自 C# RestoreGroupPreservingForeground
   * @param {number[]} windowHandles
   * @param {string} reason
   * @returns {boolean}
   */
  function restoreGroupPreservingForeground (windowHandles, reason) {
    const handles = dedupeValidHandles(windowHandles)
    if (handles.length === 0) return true

    if (usesDesktopPinnedMode()) {
      for (const handle of handles) moveToDesktopBottom(handle)
      const pinnedApplied = applyPeerOrderHighestToLowest(handles)
      logVerbose(`[ZOrder] Group restore reason=${reason} mode=DesktopPinned count=${handles.length} applied=${pinnedApplied}`)
      return pinnedApplied
    }

    const foreground = win32.getForegroundWindow()
    const foregroundRoot = getForegroundRoot(foreground)
    const hasForeground = foregroundRoot !== 0 && win32.isWindow(foregroundRoot)
    const disposition = decideRelativeLayerRestore(
      hasForeground,
      hasForeground && isDesktopShellWindow(foregroundRoot),
      handles.includes(foregroundRoot),
      hasForeground && isWidgetWindow(foregroundRoot)
    )

    let applied
    switch (disposition) {
      case RELATIVE_LAYER_RESTORE_DISPOSITION.DesktopBottom:
        for (const handle of handles) moveToDesktopBottom(handle)
        applied = applyPeerOrderHighestToLowest(handles)
        break
      case RELATIVE_LAYER_RESTORE_DISPOSITION.PreservePeerOrder:
        for (const handle of handles) prepareRestingWindowForRelativePlacement(handle)
        applied = applyPeerOrderHighestToLowest(handles)
        break
      case RELATIVE_LAYER_RESTORE_DISPOSITION.BehindForeground:
        for (const handle of handles) prepareRestingWindowForRelativePlacement(handle)
        const boundary = win32.isWindowTopMost(foregroundRoot)
          ? win32.HWND_TOP
          : foregroundRoot
        applied = applyWindowOrderHighestToLowest(handles, boundary, `group-restore-${reason}`)
        break
      default:
        applied = false
        break
    }

    logVerbose(`[ZOrder] Group restore reason=${reason} count=${handles.length} foreground=0x${foregroundRoot.toString(16)} disposition=${disposition} applied=${applied}`)
    return applied
  }

  /**
   * 清除 TOPMOST
   * 移植自 C# ClearTopMost
   * @param {number} windowHandle
   */
  function clearTopMost (windowHandle) {
    applyDesktopPinnedActivationStyle(windowHandle)

    if (usesDesktopPinnedMode()) {
      if (!tryAttachToDesktopIconLayer(windowHandle)) {
        moveToDynamicDesktopBottom(windowHandle)
      }
      return
    }

    moveToDesktopBottom(windowHandle)
  }

  /**
   * 保持临时 TOPMOST
   * 移植自 C# HoldTemporaryTopMost
   * @param {number} windowHandle
   */
  function holdTemporaryTopMost (windowHandle) {
    applyDesktopPinnedActivationStyle(windowHandle)

    if (usesDesktopPinnedMode()) {
      if (!tryAttachToDesktopIconLayer(windowHandle)) {
        moveToDynamicDesktopBottom(windowHandle)
      }
      return
    }

    detachFromDesktopIconLayerIfNeeded(windowHandle)
    win32.bringWindowTemporarilyToFront(windowHandle)
  }

  /**
   * 把窗口置顶
   * 移植自 C# BringToFront
   * @param {number} windowHandle
   */
  function bringToFront (windowHandle) {
    applyDesktopPinnedActivationStyle(windowHandle)

    if (usesDesktopPinnedMode()) {
      if (!tryAttachToDesktopIconLayer(windowHandle)) {
        moveToDynamicDesktopBottom(windowHandle)
      }
      return
    }

    detachFromDesktopIconLayerIfNeeded(windowHandle)
    win32.bringWindowToFront(windowHandle)
  }

  /**
   * 把小部件抬到对等小部件之上但不激活
   * 移植自 C# BringAbovePeerWidgets
   * @param {number} windowHandle
   */
  function bringAbovePeerWidgets (windowHandle) {
    if (usesDesktopPinnedMode()) {
      if (tryAttachToDesktopIconLayer(windowHandle)) {
        win32.setWindowPos(
          windowHandle,
          win32.HWND_TOP,
          0, 0, 0, 0,
          win32.SWP_NOMOVE | win32.SWP_NOSIZE | win32.SWP_NOACTIVATE | win32.SWP_NOOWNERZORDER | win32.SWP_SHOWWINDOW
        )
      }
      return
    }

    detachFromDesktopIconLayerIfNeeded(windowHandle)
    win32.bringWindowTemporarilyToFront(windowHandle)
  }

  /**
   * 仅在 Explorer 桌面属主组内抬升小部件
   * 移植自 C# TryBringAbovePeerWidgetsAtDesktopLayer
   * @param {number} windowHandle
   * @returns {boolean}
   */
  function tryBringAbovePeerWidgetsAtDesktopLayer (windowHandle) {
    if (!shouldAttachRestingWindowToDesktop() ||
        !tryAttachToDesktopIconLayer(windowHandle, false)) {
      return false
    }

    return win32.setWindowPos(
      windowHandle,
      win32.HWND_TOP,
      0, 0, 0, 0,
      win32.SWP_NOMOVE | win32.SWP_NOSIZE | win32.SWP_NOACTIVATE | win32.SWP_NOOWNERZORDER | win32.SWP_SHOWWINDOW
    )
  }

  /**
   * 把动态层小部件抬到对等小部件之上，但不超过当前前台应用
   * 移植自 C# TryBringAbovePeerWidgetsBehindForeground
   * @param {number} windowHandle
   * @returns {boolean}
   */
  function tryBringAbovePeerWidgetsBehindForeground (windowHandle) {
    if (usesDesktopPinnedMode() ||
        windowHandle === 0 ||
        !win32.isWindow(windowHandle)) {
      return false
    }

    const foregroundRoot = getForegroundRoot(win32.getForegroundWindow())

    if (foregroundRoot === 0 ||
        foregroundRoot === windowHandle ||
        !win32.isWindow(foregroundRoot) ||
        isWidgetWindow(foregroundRoot) ||
        isDesktopShellWindow(foregroundRoot)) {
      return false
    }

    return tryPlaceDynamicWindowBehindForeground(windowHandle, foregroundRoot, 'peer-raise')
  }

  /**
   * 应用并验证展开胶囊的显式对等顺序
   * 移植自 C# EnsurePeerOrderHighestToLowest
   * @param {number[]} windowHandles
   * @returns {boolean}
   */
  function ensurePeerOrderHighestToLowest (windowHandles) {
    const handles = dedupeValidHandles(windowHandles)
    if (handles.length < 2) return handles.length === 1

    const activeWindow = handles[0]
    applyPeerOrderHighestToLowest(handles)
    if (isHighestPeer(activeWindow, handles)) return true

    const raised = tryBringAbovePeerWidgetsAtDesktopLayer(activeWindow) ||
      tryBringAbovePeerWidgetsBehindForeground(activeWindow)
    if (!raised) bringAbovePeerWidgets(activeWindow)

    const reapplied = applyPeerOrderHighestToLowest(handles)
    const verified = isHighestPeer(activeWindow, handles)
    logVerbose(`[ZOrder] Expanded peer order fallback active=0x${activeWindow.toString(16)} raised=${raised} reapplied=${reapplied} verified=${verified}`)
    return verified
  }

  /**
   * 把一组窗口临时置前
   * 移植自 C# BringGroupTemporarilyToFront
   * @param {number[]} windowHandles
   * @param {number} activeWindowHandle
   */
  function bringGroupTemporarilyToFront (windowHandles, activeWindowHandle) {
    if (usesDesktopPinnedMode()) return

    const handles = dedupeValidHandles(windowHandles)
    if (handles.length === 0) return

    for (const handle of handles) {
      detachFromDesktopIconLayerIfNeeded(handle)
      win32.setWindowTopMost(handle)
    }

    for (const handle of handles) {
      if (handle !== activeWindowHandle) {
        win32.clearWindowTopMost(handle)
      }
    }

    const activeHandle = handles.includes(activeWindowHandle)
      ? activeWindowHandle
      : handles[handles.length - 1]
    win32.clearWindowTopMost(activeHandle)
    win32.bringWindowToFront(activeHandle)
    win32.setForegroundWindow(activeHandle)
  }

  /**
   * 释放窗口（分离桌面图标层）
   * 移植自 C# ReleaseWindow
   * @param {number} windowHandle
   */
  function releaseWindow (windowHandle) {
    detachFromDesktopIconLayerIfNeeded(windowHandle)
  }

  /**
   * 失效桌面图标视图缓存
   * 移植自 C# InvalidateDesktopIconViewCache
   */
  function invalidateDesktopIconViewCache () {
    cachedDesktopIconView = 0
  }

  /**
   * 判断指针按下是否应保留当前前台活动
   * 移植自 C# ShouldSuppressPointerActivation
   * @param {number} windowHandle
   * @returns {boolean}
   */
  function shouldSuppressPointerActivation (windowHandle) {
    const foregroundRoot = getForegroundRoot(win32.getForegroundWindow())
    const hasForeground = foregroundRoot !== 0 && win32.isWindow(foregroundRoot)
    const foregroundIsWidget = foregroundRoot === windowHandle ||
      isWidgetWindow(foregroundRoot)

    return shouldSuppressPointerActivationPolicy(
      usesDesktopPinnedMode(),
      hasForeground,
      hasForeground && isDesktopShellWindow(foregroundRoot),
      foregroundIsWidget
    )
  }

  /**
   * 允许桌面钉扎小部件激活的判定
   * 移植自 C# TryAllowDesktopPinnedPointerActivation
   * @param {number} windowHandle
   * @returns {boolean}
   */
  function tryAllowDesktopPinnedPointerActivation (windowHandle) {
    if (!usesDesktopPinnedMode()) {
      setWindowNoActivate(windowHandle, false)
      return true
    }

    if (shouldSuppressPointerActivation(windowHandle)) {
      setWindowNoActivate(windowHandle, true)
      return false
    }

    setWindowNoActivate(windowHandle, false)
    return true
  }

  return {
    // 公共层操作
    moveToDesktopBottom,
    clearTopMostPreservingForeground,
    restoreGroupPreservingForeground,
    clearTopMost,
    holdTemporaryTopMost,
    bringToFront,
    bringAbovePeerWidgets,
    tryBringAbovePeerWidgetsAtDesktopLayer,
    tryBringAbovePeerWidgetsBehindForeground,
    ensurePeerOrderHighestToLowest,
    isHighestPeer,
    bringGroupTemporarilyToFront,
    applyPeerOrderHighestToLowest,
    releaseWindow,
    invalidateDesktopIconViewCache,
    shouldSuppressPointerActivation,
    tryAllowDesktopPinnedPointerActivation,
    isWindowNoActivate,
    // 模式查询
    usesDesktopPinnedMode,
    // 内部方法导出便于单元测试
    findDesktopIconView,
    isDesktopShellWindow,
    getForegroundRoot,
    dedupeValidHandles
  }
}

// 别名：策略函数别名，避免与工厂实例方法同名
const shouldSuppressPointerActivationPolicy = shouldSuppressPointerActivation

// ------------------------------------------------------------
// 模块导出
// ------------------------------------------------------------

module.exports = {
  // 层服务工厂
  createWidgetLayerService,
  // 空闲 Z 序策略
  orderIdleZOrderHighestToLowest,
  // 临时提升租约策略
  createTemporaryRaiseLease,
  isTemporaryRaiseLeaseActive,
  canRestoreDesktopLayer,
  shouldArmSafetyRestore,
  shouldDeferSafetyRestore,
  acquireTemporaryRaiseLease,
  ownsTemporaryRaiseLeaseGeneration,
  releaseTemporaryRaiseLease,
  forgetTemporaryRaiseLeaseWindow,
  // 展开层租约策略
  createExpandedLayerLease,
  isExpandedLayerLeaseActive,
  acquireExpandedLayerLease,
  ownsExpandedLayerLease,
  releaseExpandedLayerLease,
  // 相对层恢复策略
  shouldAttachToDesktop,
  decideRelativeLayerRestore,
  // 指针激活策略
  shouldSuppressPointerActivation,
  // 常量
  RELATIVE_LAYER_RESTORE_DISPOSITION,
  WIDGET_LAYER_MODE_DESKTOP_PINNED,
  SPAWN_WORKER_W_MESSAGE,
  // 代际工具
  nextLeaseGeneration
}