// ============================================================
// 桌面小部件窗口管理器
// 管理多个小部件 BrowserWindow（独立于主窗口的 window-manager.js）
// 复用现有 desktopMode 配置：frame:false、skipTaskbar:true
// 材质方案：Electron 43+ 内置 setBackgroundMaterial 原生支持 Win11 Mica/Acrylic
//   原生 backgroundMaterial 在系统层绘制材质（DWM SystemBackdrop），渲染层 CSS 仅做半透明 tint 叠加
//   3 种材质：default（不透明）/ mica（云母）/ acrylic（亚克力）
//   mica/acrylic 不论窗口是否处于焦点都保持透明效果
//   重要：渲染层不使用 backdrop-filter，避免与原生材质双重模糊冲突
//     Mica 浅色 tint #FFFFFF opacity 0.46 / 深色 tint #202226 opacity 0.46
//     Acrylic 浅色 tint #FFFFFF opacity 0.34 / 深色 tint #202226 opacity 0.42
// 拖拽通过主进程 win.setBounds 控制（避免透明窗口 CSS transform 抖动）
// 位置持久化节流 200ms
// 边缘吸附：委托 widget-snap.js 纯模块计算（屏幕边缘 + 小部件间吸附）

// 多显示器锚定：拖拽结束记录锚点（内存缓存），拓扑变化时恢复
// ============================================================

const { BrowserWindow, screen, ipcMain } = require('electron')
const os = require('os')
const path = require('path')
const logger = require('./logger.js')
const widgetDao = require('./../dao/widget-dao.js')
const widgetRegistry = require('./widget-registry.js')
const appSettingDao = require('./../dao/app-setting-dao.js')
const capsuleArrangementCalculator = require('./../utils/widget-capsule-arrangement-calculator.js')
const capsuleOrderCalculator = require('./../utils/widget-capsule-order-calculator.js')
// 小部件层服务（Z 序管理、空闲策略、临时提升租约）—— 纯逻辑 + Win32 依赖注入
const widgetLayerServiceFactory = require('./../utils/widget-layer-service.js')
// 小部件表面注册表（表面/快照缓存/会话管理）—— 纯逻辑
const widgetSurfaceRegistryFactory = require('./../utils/widget-surface-registry.js')
// Windows 兼容性检测（OS 能力、材质解析、动画策略）—— 纯函数
const windowsCompatibility = require('./../utils/windows-compatibility.js')

// 吸附纯模块（由并行工程师开发，契约：
//   snapToEdges(bounds, { workArea, others, threshold, widgetThreshold })
//   返回吸附后的 bounds）
// 加载失败时降级为不吸附，保证主模块可用
let widgetSnap = null
try {
  widgetSnap = require('../widget-snap.js')
} catch (e) {
  // widget-snap.js 尚未实现或加载失败，吸附功能降级
  logger.warn('WidgetWindowManager', `widget-snap.js 加载失败，吸附功能降级: ${e.message}`)
}

   // 材质配置键名：存储在 app_settings 表
   const MATERIAL_KEY = 'widget_material'
   // 默认材质：mica（云母，Win11 标志性材质效果，开箱即用）
   const DEFAULT_MATERIAL = 'mica'
   // 允许的材质类型（3 种）
   // default：不透明背景，无原生材质
   // mica：云母，原生 backgroundMaterial='mica' + 渲染层半透明 tint 叠加
   // acrylic：亚克力，原生 backgroundMaterial='acrylic' + 渲染层半透明 tint 叠加
   const VALID_MATERIALS = ['default', 'mica', 'acrylic']
   // 材质对应的窗口 backgroundColor（防止内容溢出时显示默认白色）
   // default 材质使用不透明背景色；mica/acrylic 使用透明让原生材质透过
   const MATERIAL_BG_COLOR = {
     default: '#F3F3F3',
     'default-dark': '#1F1F1F',
     mica: '#00000000',
     acrylic: '#00000000'
   }
// Windows 11 最小 build 号（22621 = Win11 22H2）
// Electron setBackgroundMaterial 仅支持 Win11 22H2+（见 Electron 文档）
const WIN11_MIN_BUILD = 22621
const FALLBACK_OFFSET = 32

// 实际生效材质缓存（降级后），由 applyMaterial 更新
let effectiveMaterialCache = null

// 小部件窗口映射表：widgetType -> BrowserWindow
const widgetWindows = new Map()

// 拖拽状态：记录正在拖拽的窗口及起始位置
const dragState = new Map() // widgetType -> { startX, startY, startBounds }

// 位置持久化节流定时器：widgetType -> timer
const boundsPersistTimers = new Map()

// 胶囊展开尺寸缓存：widgetType -> { width, height }
//   折叠为胶囊前记录展开尺寸，展开时用于恢复
const expandedBoundsCache = new Map()

// 胶囊切换中标记：widgetType -> true
//   切换胶囊时短暂设置，期间忽略 resizeToContent 调用，避免 ResizeObserver
//   触发的尺寸自适应把胶囊窗口拉回展开形态的最小尺寸（minHeight 240 等）
//   生命周期：setWidgetCapsule 设置 → 500ms 后自动清除（覆盖 ResizeObserver
//   防抖 100ms + 渲染过渡 167ms + IPC 通信往返 + 余量）
//   注意：之前 300ms 在某些慢机器上不够，ResizeObserver 可能在 capsule-changed
//   事件接收前触发 resizeToContent，导致尺寸抖动（问题 2a）
const capsuleSwitchingFlags = new Map()
// 胶囊切换标记持续时间（毫秒）
//   800ms 覆盖：ResizeObserver 防抖 100ms + 渲染过渡最长 300ms（慢机器）+ IPC 往返 ~100ms + 余量 ~300ms
//   之前 500ms 在慢机器上不够：渲染过渡可能超过 167ms，导致 ResizeObserver 在 capsule-changed
//   事件接收后再次触发 resizeToContent，此时 capsuleSwitchingFlags 已清除，resizeToContent 执行
//   导致窗口尺寸抖动（问题 2a）
const CAPSULE_SWITCHING_GUARD = 800

// will-resize 防重入标志：widgetType -> true
//   snapped=true 时 win.setBounds() 可能触发新的 will-resize 事件，形成循环
//   导致窗口尺寸反复跳跃，表现为"拖动一边另一边也变化"
//   设置标志后，setBounds 触发的 will-resize 直接跳过，避免循环
const resizeReentryFlags = new Map()

// 用户正在 resize 标志：widgetType -> true
//   will-resize 触发时设置，resize 事件结束时清除
//   期间忽略 resizeToContent 调用，避免与用户 resize 冲突
const userResizingFlags = new Map()

// resize 吸附锁定：widgetType -> { axis: 'x'|'y', affectLeft: bool, affectTop: bool, snappedValue: number, originalValue: number, threshold: number }
//   吸附后设置，防止后续 will-resize 重复触发吸附（用户拖拽时系统每次给出原始位置）
//   用户拖拽远离吸附位置超过释放阈值（2倍吸附阈值）时清除锁，恢复自由 resize
const resizeSnapLock = new Map()

// 各窗口最近应用的材质缓存：widgetType -> material
//   避免重复设置相同材质（setBackgroundMaterial 同值重设仍可能触发 DWM 重绘）
//   applyMaterial 中设置，destroyWidgetWindow/destroyAllWidgets 中清理
//   blur 事件已移除（问题 c），此缓存仍保留供 applyMaterial 使用
const lastAppliedMaterial = new Map()

// 多显示器锚点缓存：widgetType -> { anchor, margin, displayId }
// anchor: 'LeftTop' | 'RightTop' | 'LeftBottom' | 'RightBottom'
// margin: { x, y } 相对工作区对应角的边距
const widgetAnchors = new Map()

// ============================================================
// 胶囊栏（多胶囊收纳）状态
// 将多个折叠为胶囊的小部件排列成一条水平/垂直的栏
// barId -> {
//   barId: string,
//   widgetTypes: string[],                  // 栏内小部件类型列表（有序）
//   direction: 'horizontal' | 'vertical',   // 排列方向
//   positionAnchor: string,                 // 锚点角 'LeftTop'|'RightTop'|'LeftBottom'|'RightBottom'
//   spacing: number,                        // 胶囊间距（像素）
//   anchorPoint: { x, y },                  // 锚点（屏幕坐标）
//   workArea: { x, y, width, height }       // 工作区
// }
// ============================================================
const capsuleBars = new Map()
const DEFAULT_CAPSULE_BAR_SPACING = 8

// 节流间隔（毫秒）
const BOUNDS_PERSIST_THROTTLE = 200

// 边缘吸附阈值（像素）：拖拽时距离屏幕边缘小于此值自动对齐
const SNAP_THRESHOLD = 10
// 小部件间吸附阈值（像素）：拖拽时距离其他小部件边缘小于此值自动对齐
const WIDGET_SNAP_THRESHOLD = 8


// 标记应用是否正在退出（退出时跳过 close 拦截）
let appWillQuit = false

// ============================================================
// 新模块集成状态
// widgetLayerService：层服务实例（Z 序管理），需 win32 注入，未注入时为 null
// widgetSurfaceRegistry：表面注册表实例（纯逻辑，可直接创建）
// widgetSwitchGatePool：切换门池实例（纯逻辑，与表面注册表配套）
// windowsCompatInfo：Windows 兼容性检测结果缓存（启动时由 main.js 注入）
// ============================================================
let widgetLayerService = null
let widgetSurfaceRegistry = null
let widgetSwitchGatePool = null
let windowsCompatInfo = null

// 表面 ID 与 widgetType 的映射辅助
//   widgetType 作为 surfaceId，win 作为 host
//   memberIds 初始为 [widgetType]，activeMemberId = widgetType
const surfaceIdByWidgetType = new Map()

// ============================================================
// ============================================================
// 动画开关配置键名：存储在 app_settings 表
const ANIMATION_KEY = 'widget_animation'
// 动画默认开启
const DEFAULT_ANIMATION_ENABLED = true
// 动画时长（毫秒）
const ANIMATION_DURATION = 250
// 动画帧间隔（毫秒，约 60fps）
const ANIMATION_FRAME_INTERVAL = 16
// 收缩目标尺寸（像素）：窗口沿边缘缩回后的最终宽高
const SHRINK_TARGET_SIZE = 40

// 动画状态标记：widgetType -> true（避免重复触发）
const animatingFlags = new Map()
// 动画定时器：widgetType -> timer
const animationTimers = new Map()
// 隐藏前的展开尺寸缓存：widgetType -> { width, height }
//   隐藏动画启动时记录当前尺寸，显示动画结束时用于恢复
const hiddenExpandedBounds = new Map()

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

// ============================================================
// 新模块初始化与生命周期回调
// ============================================================

/**
 * 初始化小部件层服务（Z 序管理）
 * 需注入 win32 接口（FFI 封装），未注入时层服务不可用，相关调用降级为空操作
 * @param {{win32: object, app?: object, getSettings?: function, normalizeWidgetLayerMode?: function}} options
 * @returns {boolean} 是否成功初始化
 */
function initLayerService (options = {}) {
  try {
    if (!options || !options.win32) {
      logger.warn('WidgetWindowManager', 'initLayerService: 未提供 win32 接口，层服务降级为空操作')
      return false
    }
    widgetLayerService = widgetLayerServiceFactory.createWidgetLayerService(options)
    logger.info('WidgetWindowManager', '小部件层服务已初始化')
    return true
  } catch (error) {
    logger.error('WidgetWindowManager', `初始化层服务失败: ${error.message}`)
    widgetLayerService = null
    return false
  }
}

/**
 * 初始化小部件表面注册表与切换门池
 * 纯逻辑模块，无外部依赖，可直接创建
 * @returns {boolean} 是否成功初始化
 */
function initSurfaceRegistry () {
  try {
    if (widgetSurfaceRegistry) return true
    widgetSurfaceRegistry = widgetSurfaceRegistryFactory.createSurfaceRegistry()
    widgetSwitchGatePool = widgetSurfaceRegistryFactory.createSwitchGatePool()
    logger.info('WidgetWindowManager', '小部件表面注册表已初始化')
    return true
  } catch (error) {
    logger.error('WidgetWindowManager', `初始化表面注册表失败: ${error.message}`)
    widgetSurfaceRegistry = null
    widgetSwitchGatePool = null
    return false
  }
}

/**
 * 注入 Windows 兼容性检测结果（由 main.js 启动时调用）
 * @param {object} info - 兼容性信息对象
 */
function setWindowsCompatInfo (info) {
  windowsCompatInfo = info
}

/**
 * 获取 Windows 兼容性检测结果
 * @returns {object|null}
 */
function getWindowsCompatInfo () {
  return windowsCompatInfo
}

/**
 * 注册小部件到表面注册表
 * 在 createWidgetWindow 创建窗口后调用
 * @param {string} widgetType
 * @param {BrowserWindow} win
 */
function registerWidgetSurface (widgetType, win) {
  if (!widgetSurfaceRegistry || !win) return
  try {
    const surfaceId = `surface-${widgetType}`
    const definition = widgetSurfaceRegistryFactory.createSurfaceDefinition(
      surfaceId,
      null,
      [widgetType],
      widgetType
    )
    widgetSurfaceRegistry.registerActive(definition, win)
    surfaceIdByWidgetType.set(widgetType, surfaceId)
    logger.debug('WidgetWindowManager', `小部件 ${widgetType} 已注册到表面 ${surfaceId}`)
  } catch (error) {
    logger.warn('WidgetWindowManager', `注册小部件表面失败 ${widgetType}: ${error.message}`)
  }
}

/**
 * 注销小部件表面
 * 在 destroyWidgetWindow 中调用
 * @param {string} widgetType
 */
function unregisterWidgetSurface (widgetType) {
  if (!widgetSurfaceRegistry) return
  try {
    const surfaceId = surfaceIdByWidgetType.get(widgetType)
    if (surfaceId) {
      widgetSurfaceRegistry.removeSurface(surfaceId)
      surfaceIdByWidgetType.delete(widgetType)
      logger.debug('WidgetWindowManager', `小部件 ${widgetType} 表面已注销`)
    }
  } catch (error) {
    logger.warn('WidgetWindowManager', `注销小部件表面失败 ${widgetType}: ${error.message}`)
  }
}

/**
 * 通知层服务窗口开始拖拽
 * 拖拽开始时调用，可触发临时提升租约
 * @param {string} widgetType
 */
function notifyLayerServiceDragStart (widgetType) {
  if (!widgetLayerService) return
  try {
    const win = widgetWindows.get(widgetType)
    if (!win || win.isDestroyed()) return
    // 获取窗口句柄（Electron BrowserWindow 通过 getNativeWindowHandle 返回 Buffer）
    const handleBuffer = win.getNativeWindowHandle()
    const windowHandle = Number(handleBuffer.readInt32LE(0))
    // 临时提升被拖拽窗口到顶层，避免拖拽时被其他小部件遮挡
    widgetLayerService.bringToFront(windowHandle)
  } catch (error) {
    logger.debug('WidgetWindowManager', `层服务拖拽开始通知失败 ${widgetType}: ${error.message}`)
  }
}

/**
 * 通知层服务窗口拖拽结束
 * 拖拽结束时调用，恢复 Z 序策略
 * @param {string} widgetType
 */
function notifyLayerServiceDragEnd (widgetType) {
  if (!widgetLayerService) return
  try {
    const win = widgetWindows.get(widgetType)
    if (!win || win.isDestroyed()) return
    const handleBuffer = win.getNativeWindowHandle()
    const windowHandle = Number(handleBuffer.readInt32LE(0))
    // 拖拽结束后恢复桌面钉扎层级（如果配置了 DesktopPinned 模式）
    if (widgetLayerService.usesDesktopPinnedMode()) {
      widgetLayerService.moveToDesktopBottom(windowHandle)
    }
  } catch (error) {
    logger.debug('WidgetWindowManager', `层服务拖拽结束通知失败 ${widgetType}: ${error.message}`)
  }
}

/**
 * 处理显示器拓扑变化
 * 由 main.js 的 displayArea-watcher 触发，遍历所有小部件窗口重新校验位置
 */
function handleDisplaysChanged () {
  try {
    let restored = 0
    for (const [widgetType, win] of widgetWindows.entries()) {
      if (!win || win.isDestroyed()) continue
      try {
        const currentBounds = win.getBounds()
        const safeBounds = ensureVisible(currentBounds, widgetType)
        // 仅在位置确实越界时才更新，避免不必要的 setBounds
        if (safeBounds.x !== currentBounds.x ||
            safeBounds.y !== currentBounds.y ||
            safeBounds.width !== currentBounds.width ||
            safeBounds.height !== currentBounds.height) {
          win.setBounds(safeBounds)
          persistBoundsThrottled(widgetType, safeBounds)
          restored++
        }
      } catch (e) { /* 单个窗口校验失败不影响其他窗口 */ }
    }
    logger.info('WidgetWindowManager', `显示器拓扑变化处理完成，已恢复 ${restored} 个越界小部件`)
  } catch (error) {
    logger.error('WidgetWindowManager', `处理显示器拓扑变化失败: ${error.message}`)
  }
}

/**
 * 处理应用生命周期恢复
 * 由 main.js 的 app-lifecycle-recovery 触发（唤醒/解锁等），恢复小部件窗口状态
 * @param {string} reasons - 恢复原因（逗号分隔）
 */
function handleLifecycleRecovery (reasons) {
  try {
    let recovered = 0
    for (const [widgetType, win] of widgetWindows.entries()) {
      if (!win || win.isDestroyed()) continue
      try {
        // 重新校验位置（唤醒后显示器可能变化）
        const currentBounds = win.getBounds()
        const safeBounds = ensureVisible(currentBounds, widgetType)
        if (safeBounds.x !== currentBounds.x ||
            safeBounds.y !== currentBounds.y ||
            safeBounds.width !== currentBounds.width ||
            safeBounds.height !== currentBounds.height) {
          win.setBounds(safeBounds)
          persistBoundsThrottled(widgetType, safeBounds)
        }
        // 重新应用材质（唤醒后 DWM 可能重置）
        applyMaterial(win, getMaterial())
        recovered++
      } catch (e) { /* 单个窗口恢复失败不影响其他窗口 */ }
    }
    logger.info('WidgetWindowManager', `生命周期恢复处理完成（原因: ${reasons}），已恢复 ${recovered} 个小部件`)
  } catch (error) {
    logger.error('WidgetWindowManager', `处理生命周期恢复失败: ${error.message}`)
  }
}

/**
 * 销毁新模块集成状态
 * 在 destroyAllWidgets 或应用退出时调用
 */
function destroyIntegrationState () {
  try {
    if (widgetSurfaceRegistry) {
      widgetSurfaceRegistry.clear()
    }
    surfaceIdByWidgetType.clear()
    if (widgetLayerService) {
      // 层服务无显式 dispose，置空即可
      widgetLayerService = null
    }
    logger.info('WidgetWindowManager', '新模块集成状态已清理')
  } catch (error) {
    logger.warn('WidgetWindowManager', `清理集成状态失败: ${error.message}`)
  }
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
 * 获取 Windows 系统 build 号
 * 非 Windows 平台返回 0
 * @returns {number}
 */
function getWindowsBuild () {
  if (process.platform !== 'win32') return 0
  // os.release() 在 Windows 上返回形如 "10.0.22000" 的字符串
  const parts = os.release().split('.')
  return parseInt(parts[2] || '0', 10)
}

/**
 * 判断当前是否 Windows 11（build >= 22000）
 * @returns {boolean}
 */
function isWin11 () {
  return process.platform === 'win32' && getWindowsBuild() >= WIN11_MIN_BUILD
}

// ============================================================
// transparent:true 窗口恢复 WS_THICKFRAME 边缘 resize 的 koffi FFI
// transparent:true 禁用 DWM 系统阴影（解决小部件间阴影 + Mica 失焦变暗）
// 但 Electron 透明窗口移除 WS_THICKFRAME，导致用户无法拖拽边缘调整大小
// 通过 koffi 重新添加 WS_THICKFRAME 样式恢复 resize，同时设置 DWM 禁用阴影
// ============================================================
let thickFrameApi = null

/**
 * 初始化恢复 WS_THICKFRAME 的 koffi Win32 API（懒加载）
 * @returns {Object|null} API 函数集合，null 表示不可用
 */
function initThickFrameApi () {
  if (thickFrameApi !== null) return thickFrameApi || null
  if (process.platform !== 'win32') return null

  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const dwmapi = koffi.load('dwmapi.dll')

    thickFrameApi = {
      GetWindowLongPtrW: user32.func('intptr_t GetWindowLongPtrW(void *hWnd, int nIndex)'),
      SetWindowLongPtrW: user32.func('intptr_t SetWindowLongPtrW(void *hWnd, int nIndex, intptr_t dwNewLong)'),
      SetWindowPos: user32.func('bool SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)'),
      DwmSetWindowAttribute: dwmapi.func('int DwmSetWindowAttribute(void *hWnd, uint32_t attr, void *data, uint32_t size)')
    }
    logger.info('WidgetWindowManager', '恢复 WS_THICKFRAME koffi API 初始化成功')
  } catch (err) {
    logger.warn('WidgetWindowManager', `恢复 WS_THICKFRAME koffi 初始化失败: ${err.message}`)
    thickFrameApi = false
  }

  return thickFrameApi || null
}

/**
 * 恢复透明窗口的 WS_THICKFRAME 样式，使窗口可拖拽边缘 resize
 *   DWMWA_NCRENDERING_POLICY=DWMNCRP_DONOTDRAW 禁用 DWM 阴影
 *   DWMWA_BORDER_COLOR=DWMWA_COLOR_NONE 抑制 DWM 边框（视觉边框由 CSS 绘制，跟随圆角）
 *   DWMWA_WINDOW_CORNER_PREFERENCE=DWMWCP_ROUND 原生圆角（与 CSS border-radius 一致）
 *   DWMWA_USE_IMMERSIVE_DARK_MODE 暗色模式 DWM 适配（Mica 暗色变体）
 * @param {BrowserWindow} win
 */
function restoreThickFrame (win) {
  const api = initThickFrameApi()
  if (!api || !win || win.isDestroyed()) return

  try {
    const hwnd = win.getNativeWindowHandle()

    // Win32 窗口样式常量
    const GWL_STYLE = -16
    const WS_THICKFRAME = 0x00040000
    // SetWindowPos 标志
    const SWP_NOMOVE = 0x0002
    const SWP_NOSIZE = 0x0001
    const SWP_NOZORDER = 0x0004
    const SWP_NOACTIVATE = 0x0010
    const SWP_FRAMECHANGED = 0x0020
    const DWMWA_NCRENDERING_POLICY = 2
    const DWMNCRP_DONOTDRAW = 1
    const DWMWA_USE_IMMERSIVE_DARK_MODE = 20
    const DWMWA_WINDOW_CORNER_PREFERENCE = 33
    const DWMWA_BORDER_COLOR = 34
    // DWM 边框颜色特殊值
    const DWMWA_COLOR_NONE = 0xFFFFFFFE
    // DWM 圆角偏好
    const DWMWCP_ROUND = 2

    // 1. 添加 WS_THICKFRAME 恢复边缘 resize
    const currentStyle = api.GetWindowLongPtrW(hwnd, GWL_STYLE)
    if ((Number(currentStyle) & WS_THICKFRAME) === 0) {
      const newStyle = Number(currentStyle) | WS_THICKFRAME
      api.SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle)
      api.SetWindowPos(hwnd, null, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED)
      logger.info('WidgetWindowManager', 'WS_THICKFRAME 已恢复，窗口可拖拽边缘 resize')
    }

    // 2. 禁用 DWM 非客户区渲染（防止 WS_THICKFRAME 重新引入阴影）
    const policy = new Uint32Array([DWMNCRP_DONOTDRAW])
    api.DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY, policy, 4)

    // 3. 抑制 DWM 边框绘制（视觉边框由 CSS 自绘，与灵动岛设计一致）
    //    DWMWA_COLOR_NONE 让 DWM 不绘制边框，CSS border 跟随 border-radius 圆角
    const borderColor = new Uint32Array([DWMWA_COLOR_NONE >>> 0])
    api.DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, borderColor, 4)

    // 4. 原生窗口圆角（DWMWCP_ROUND，与 CSS --widget-radius-large 8px 一致）
    const cornerPref = new Uint32Array([DWMWCP_ROUND])
    api.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, cornerPref, 4)

    // 5. 暗色模式 DWM 适配（让 Mica/Acrylic 材质应用暗色变体）
    const theme = appSettingDao.get('theme') || 'light'
    const isDark = theme === 'dark'
    const darkMode = new Uint32Array([isDark ? 1 : 0])
    api.DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, darkMode, 4)
  } catch (err) {
    logger.warn('WidgetWindowManager', `恢复 WS_THICKFRAME 失败: ${err.message}`)
  }
}

/**

 * 解析材质：直接返回用户配置材质
 * 材质效果由原生 backgroundMaterial 提供（Win11 22H2+），渲染层 CSS 仅做半透明 tint 叠加
 *   主进程负责调用 setBackgroundMaterial 设置原生材质，并通知渲染层切换材质 class
 *   非 Win11 22H2+ 降级：不调用 setBackgroundMaterial，仅渲染层半透明 tint 模拟
 * @param {string} material - 期望材质 'default' | 'mica' | 'acrylic'
 * @returns {string} 实际生效的材质 'default' | 'mica' | 'acrylic'
 */
function resolveMaterial (material) {
  const target = VALID_MATERIALS.includes(material) ? material : DEFAULT_MATERIAL
  return target // 'default' | 'mica' | 'acrylic'
}

/**
 * 捕获窗口相对工作区的锚点（用于多显示器拓扑变化后恢复位置）
 * 根据窗口中心点在工作区的象限判定锚点角，记录相对该角的边距
 * @param {string} widgetType
 * @param {object} bounds - { x, y, width, height }
 */
function captureAnchor (widgetType, bounds) {
  try {
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    const isLeft = cx < workArea.x + workArea.width / 2
    const isTop = cy < workArea.y + workArea.height / 2
    let anchor
    if (isLeft && isTop) anchor = 'LeftTop'
    else if (!isLeft && isTop) anchor = 'RightTop'
    else if (isLeft && !isTop) anchor = 'LeftBottom'
    else anchor = 'RightBottom'
    const margin = {
      x: isLeft
        ? bounds.x - workArea.x
        : (workArea.x + workArea.width) - (bounds.x + bounds.width),
      y: isTop
        ? bounds.y - workArea.y
        : (workArea.y + workArea.height) - (bounds.y + bounds.height)
    }
    widgetAnchors.set(widgetType, { anchor, margin, displayId: display.id })
  } catch (e) {
    // 忽略锚点捕获失败
  }
}

/**
 * 根据锚点恢复窗口位置（显示器拓扑变化时调用）
 * @param {string} widgetType
 * @param {object} bounds - 当前 bounds（width/height 保留）
 * @returns {object} 恢复后的 bounds；无锚点则返回原 bounds
 */
function restoreFromAnchor (widgetType, bounds) {
  try {
    const anchorInfo = widgetAnchors.get(widgetType)
    if (!anchorInfo) return bounds
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const { anchor, margin } = anchorInfo
    let x = bounds.x
    let y = bounds.y
    if (anchor === 'LeftTop') {
      x = workArea.x + margin.x
      y = workArea.y + margin.y
    } else if (anchor === 'RightTop') {
      x = workArea.x + workArea.width - bounds.width - margin.x
      y = workArea.y + margin.y
    } else if (anchor === 'LeftBottom') {
      x = workArea.x + margin.x
      y = workArea.y + workArea.height - bounds.height - margin.y
    } else { // RightBottom
      x = workArea.x + workArea.width - bounds.width - margin.x
      y = workArea.y + workArea.height - bounds.height - margin.y
    }
    return { ...bounds, x, y }
  } catch (e) {
    return bounds
  }
}

/**
 * 确保窗口位置在屏幕可见区域内（EnsureVisible）
 * 多显示器场景下：
 *   - 窗口中心点在某显示器工作区内：将 x/y 夹取到工作区内，保留 width/height
 *   - 窗口完全出屏（中心点不在任何工作区）：重置到默认位置 + 回退偏移
 * @param {object} bounds - { x, y, width, height }
 * @param {string} widgetType
 * @returns {object} 校验后的 bounds
 */
function ensureVisible (bounds, widgetType) {
  try {
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    // 计算窗口中心点
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2
    // 判断中心点是否在某个显示器工作区内（isWildlyOffscreen 取反）
    const centerInView =
      centerX >= workArea.x &&
      centerX <= workArea.x + workArea.width &&
      centerY >= workArea.y &&
      centerY <= workArea.y + workArea.height
    if (centerInView) {
      // 中心点在工作区内：将 x/y 夹取到工作区内，保留 width/height
      const x = clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width)
      const y = clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height)
      return { ...bounds, x, y }
    }
    // 窗口完全出屏：重置到默认位置（夹取到当前工作区确保可见）
    const defaultBounds = widgetRegistry.getDefaultBounds(widgetType)
    if (defaultBounds) {
      logger.warn('WidgetWindowManager', `小部件 ${widgetType} 位置超出屏幕，重置到默认位置`)
      return {
        ...bounds,
        x: clamp(defaultBounds.x, workArea.x, workArea.x + workArea.width - bounds.width),
        y: clamp(defaultBounds.y, workArea.y, workArea.y + workArea.height - bounds.height)
      }
    }
    // 无默认位置：夹取到当前工作区左上角 + 回退偏移
    return {
      ...bounds,
      x: workArea.x + FALLBACK_OFFSET,
      y: workArea.y + FALLBACK_OFFSET
    }
  } catch (error) {
    logger.warn('WidgetWindowManager', `ensureVisible 失败: ${error.message}`)
    return bounds
  }
}

// 兼容旧调用名（内部仍保留 validateBounds 别名指向 ensureVisible）
const validateBounds = ensureVisible

/**
 * 节流持久化窗口位置到数据库
 * @param {string} widgetType
 * @param {object} bounds - { x, y, width, height }
 */
function persistBoundsThrottled (widgetType, bounds) {
  // 清除已有定时器
  const existingTimer = boundsPersistTimers.get(widgetType)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }
  // 设置新定时器
  const timer = setTimeout(() => {
    try {
      const widget = widgetDao.getByType(widgetType)
      if (widget) {
        widgetDao.updateBounds(widget.id, bounds)
        logger.debug('WidgetWindowManager', `小部件 ${widgetType} 位置已持久化: (${bounds.x}, ${bounds.y}) ${bounds.width}x${bounds.height}`)
      }
    } catch (error) {
      logger.error('WidgetWindowManager', `持久化小部件 ${widgetType} 位置失败: ${error.message}`)
    } finally {
      boundsPersistTimers.delete(widgetType)
    }
  }, BOUNDS_PERSIST_THROTTLE)
  boundsPersistTimers.set(widgetType, timer)
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
 * 创建小部件窗口
 * @param {string} widgetType - 小部件类型
 * @param {object} [options] - 额外选项（覆盖默认配置）
 * @returns {BrowserWindow|null}
 */
function createWidgetWindow (widgetType, options = {}) {
  // 校验类型
  if (!widgetRegistry.isValidType(widgetType)) {
    logger.error('WidgetWindowManager', `创建小部件失败：未知类型 ${widgetType}`)
    return null
  }

  // 已存在则先销毁
  if (widgetWindows.has(widgetType)) {
    logger.warn('WidgetWindowManager', `小部件 ${widgetType} 窗口已存在，先销毁旧窗口`)
    destroyWidgetWindow(widgetType)
  }

  // 读取 DAO 配置，合并默认值
  const def = widgetRegistry.getDefinition(widgetType)
  const widget = widgetDao.getByType(widgetType)
  const bounds = {
    x: widget?.position_x ?? def.defaultX,
    y: widget?.position_y ?? def.defaultY,
    width: widget?.width ?? def.defaultWidth,
    height: widget?.height ?? def.defaultHeight
  }

  // 校验位置是否在屏幕内（EnsureVisible：多显示器 + 中心点夹取 + 出屏回退）
  let safeBounds = ensureVisible(bounds, widgetType)
  // 若有锚点缓存（显示器拓扑变化后恢复），按锚点恢复并再次校验
  if (widgetAnchors.has(widgetType)) {
    safeBounds = ensureVisible(restoreFromAnchor(widgetType, safeBounds), widgetType)
  }

  // DPI 感知：校验 minWidth/minHeight 在当前显示器缩放下是否合理
  // Electron 的 screen API 已返回物理像素，此处仅做合理性校验
  let minWidth = def.minWidth
  let minHeight = def.minHeight
  try {
    const display = screen.getDisplayMatching(safeBounds)
    const scaleFactor = display.scaleFactor || 1
    // 防止最小尺寸在高清缩放下过小（保留至少 100 物理像素）
    if (minWidth * scaleFactor < 100) minWidth = Math.ceil(100 / scaleFactor)
    if (minHeight * scaleFactor < 100) minHeight = Math.ceil(100 / scaleFactor)
  } catch (e) { /* 忽略 DPI 校验失败，使用默认值 */ }

  // 窗口配置（基于 desktopMode 配置扩展）
  // 材质方案：Electron 43+ 内置 backgroundMaterial 原生支持 Win11 Mica/Acrylic
  //   3 种材质：default（不透明）/ mica（云母）/ acrylic（亚克力）
  //   使用 backgroundMaterial 选项在窗口创建时设置原生材质（Win11 22H2+ 生效，低版本自动降级）
  //   渲染层 CSS 仅做半透明 tint 叠加，不使用 backdrop-filter（避免双重模糊）
   const currentMaterial = getMaterial()
   const nativeMaterialMap = { default: 'none', mica: 'mica', acrylic: 'acrylic' }
   // 仅 Win11 22H2+ 设置原生材质；低版本传 'none'（等同不设置），由渲染层 tint 模拟
   const initialMaterial = isWin11() ? (nativeMaterialMap[currentMaterial] || 'none') : 'none'
   // 计算窗口 backgroundColor：default 材质使用不透明背景防止溢出区域显示白色，
   //   mica/acrylic 保持透明让原生材质透过
   // 注意：主进程无 window.matchMedia，auto 主题时默认浅色（渲染进程会根据系统偏好自行处理）
   const theme = appSettingDao.get('theme') || 'light'
   const isDark = theme === 'dark'
   const materialBgColorMap = {
     default: isDark ? '#1F1F1F' : '#F3F3F3',
     mica: '#00000000',
     acrylic: '#00000000'
   }
   const windowConfig = {
     x: safeBounds.x,
     y: safeBounds.y,
     width: safeBounds.width,
     height: safeBounds.height,
     minWidth,
     minHeight,
       frame: false,
       hasShadow: false,
       // transparent:true 禁用 Windows DWM 系统阴影（与桌宠/灵动岛窗口一致）
       // 其他窗口（pet/island/reminder）均设 transparent:true 故无系统阴影
       // 小部件窗口此前未设置，导致聚焦时 DWM 投射阴影到相邻部件
      transparent: true,
       // Electron 43+ 原生材质：backgroundMaterial 选项（Win11 22H2+ 生效，低版本自动降级）
       backgroundMaterial: initialMaterial,
      // 窗口背景色：default 材质不透明防止溢出显示白色，mica/acrylic 透明让原生材质透过
      backgroundColor: materialBgColorMap[currentMaterial] || '#00000000',
     skipTaskbar: true,
    resizable: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'resources', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true
    },
    ...options
  }

  const win = new BrowserWindow(windowConfig)

  // 应用窗口材质效果：调用原生 setBackgroundMaterial + 通知渲染层切换材质 class
  // 原生 backgroundMaterial 提供系统材质，渲染层 CSS 仅做半透明 tint 叠加
  applyMaterial(win, getMaterial())

  // 窗口就绪后再次应用材质：确保原生 setBackgroundMaterial 与渲染层材质 class 都生效
  //   ready-to-show 是较安全的时机（Win11 22H2+ 此时 DWM 已就绪）
  win.once('ready-to-show', () => {
    try {
      if (!win.isDestroyed()) {
        applyMaterial(win, getMaterial())
        // 恢复 WS_THICKFRAME 边缘 resize（transparent:true 移除了该样式）
        restoreThickFrame(win)
        // 多阶段刷新原生材质（仅刷新 setBackgroundMaterial，不重发渲染层 class，避免闪烁）
        //   原值 [80, 240, 580] 三次刷新会重复调用 setBackgroundMaterial 触发 DWM 重绘导致频闪
        //   仅在 80ms 刷新一次即可保证 DWM 稳定
        const refreshDelays = [80]
        for (const delay of refreshDelays) {
          setTimeout(() => {
            try {
              if (win.isDestroyed()) return
              const mat = getMaterial()
              const resolved = resolveMaterial(mat)
              if (resolved !== 'default' && isWin11() && typeof win.setBackgroundMaterial === 'function') {
                const nativeMap = { default: 'none', mica: 'mica', acrylic: 'acrylic' }
                win.setBackgroundMaterial(nativeMap[resolved] || 'none')
              }
            } catch (e) { /* 忽略多阶段刷新失败 */ }
          }, delay)
        }
      }
    } catch (e) { /* 忽略 ready-to-show 应用材质失败 */ }
  })

  // Electron 无此 API，blur 重设 setBackgroundMaterial 反而触发 DWM 重绘导致频闪。
  // 材质已在 ready-to-show 和 applyMaterial 中设置，无需 blur 刷新。
  // 移除 blur 事件处理以消除频闪（问题 c）。

  // 设置 CSP 策略（含开发模式禁用缓存，已合并到 setupCSP 内部）
  setupCSP(win)

  // 加载入口：开发环境 loadURL，生产 loadFile
  const widgetUrl = `widget.html?type=${widgetType}`
  if (isDev()) {
    win.loadURL(`http://localhost:5173/${widgetUrl}`)
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'widget.html'), { query: { type: widgetType } })
  }

  // 绑定 move/resize 事件，节流持久化
  win.on('move', () => {
    if (win && !win.isDestroyed()) {
      const b = win.getBounds()
      persistBoundsThrottled(widgetType, b)
      // 通知渲染进程位置变化（多窗口同步用）
      try {
        win.webContents.send('widget:bounds-changed', { widgetType, bounds: b })
      } catch (e) { /* 忽略发送失败 */ }
    }
  })
  win.on('resize', () => {
    if (win && !win.isDestroyed()) {
      // 清除用户 resize 标志：resize 事件表示 resize 操作已完成
      userResizingFlags.delete(widgetType)
      // 清除吸附锁定：resize 结束后不再保持吸附位置
      resizeSnapLock.delete(widgetType)
      const b = win.getBounds()
      persistBoundsThrottled(widgetType, b)
      try {
        win.webContents.send('widget:bounds-changed', { widgetType, bounds: b })
      } catch (e) { /* 忽略发送失败 */ }
    }
  })
  // resize 时的边缘吸附：拖动窗口边缘调整大小时也与其他小部件/屏幕边缘对齐
  // will-resize 在用户拖动窗口边缘调整尺寸时触发，newBounds 为系统计算的新尺寸
  // 关键：根据 details.edge 判断用户拖动的边，只对该边做尺寸吸附，不改变对面边位置
  //   否则拖动右边缘时左边缘也会被吸附拉走，看起来像"另一侧也被拉伸"
  // 不复用 snapToEdges（它会同时改变 x/y），这里内联实现单边尺寸吸附
  win.on('will-resize', (event, newBounds, details) => {

    if (!win || win.isDestroyed()) return
    // 胶囊切换中或拖拽中不执行 resize 吸附，避免与 setWidgetCapsule/drag 冲突
    if (capsuleSwitchingFlags.get(widgetType)) return
    if (dragState.has(widgetType)) return
    // 防重入：snapped=true 时 setBounds 可能触发新的 will-resize，直接跳过避免循环
    if (resizeReentryFlags.get(widgetType)) return

    // 胶囊形态下不处理 resize 吸附：胶囊尺寸固定，不应被 resize 改变（问题 a）
    try {
      const widgetCfg = widgetDao.getByType(widgetType)
      if (widgetCfg && !!Number(widgetCfg.is_capsule)) return
    } catch (e) { /* 读取失败按展开形态处理 */ }

    // 标记用户正在 resize，期间忽略 resizeToContent（避免 ResizeObserver 触发的尺寸自适应干扰）
    userResizingFlags.set(widgetType, true)

    try {
      // 记算联动用的旧 bounds：系统应用 newBounds 之前 win.getBounds() 返回旧 bounds（问题 b）
      const oldBounds = win.getBounds()
      const edge = (details && details.edge) || ''
      const { x, y, width, height } = newBounds
      let snappedX = x
      let snappedY = y
      let snappedWidth = width
      let snappedHeight = height
      let snapped = false

      // 吸附候选目标：屏幕工作区边缘 + 其他小部件的四个边缘
      const display = screen.getDisplayMatching(newBounds)
      const workArea = display.workArea
      const others = getOtherWidgetBounds(widgetType).map(o => o.bounds)

      // 判断是否需要 X 轴吸附（拖动左/右边缘或角落）
      const affectLeft = edge === 'left' || edge === 'top-left' || edge === 'bottom-left'
      const affectRight = edge === 'right' || edge === 'top-right' || edge === 'bottom-right'
      // 判断是否需要 Y 轴吸附（拖动上/下边缘或角落）
      const affectTop = edge === 'top' || edge === 'top-left' || edge === 'top-right'
      const affectBottom = edge === 'bottom' || edge === 'bottom-left' || edge === 'bottom-right'

      // 吸附锁定检查（防止重复吸附）
      // 用户拖拽边缘时系统每次给出基于鼠标的原始位置，导致每次 will-resize 都触发吸附
      // 锁定后保持吸附位置，直到用户拖拽远离超过释放阈值（2倍吸附阈值）
      let lockedAxis = null
      const lock = resizeSnapLock.get(widgetType)
      if (lock) {
        const currentValue = lock.axis === 'x' ? x : y
        const delta = Math.abs(currentValue - lock.originalValue)
        const releaseThreshold = lock.threshold * 2
        if (delta < releaseThreshold) {
          // 仍在锁定范围内，保持吸附位置
          lockedAxis = lock.axis
          if (lock.axis === 'x') {
            if (lock.affectLeft) {
              const rightEdge = x + width
              snappedX = lock.snappedValue
              snappedWidth = rightEdge - lock.snappedValue
            } else {
              snappedWidth = lock.snappedValue - x
            }
            snapped = true
          } else {
            if (lock.affectTop) {
              const bottomEdge = y + height
              snappedY = lock.snappedValue
              snappedHeight = bottomEdge - lock.snappedValue
            } else {
              snappedHeight = lock.snappedValue - y
            }
            snapped = true
          }
        } else {
          // 超出释放阈值，清除锁
          resizeSnapLock.delete(widgetType)
        }
      }

      // X 轴吸附 - 拖动左边缘：吸附左边缘(x)，保持右边缘不变
      if (affectLeft && lockedAxis !== 'x') {
        const rightEdge = x + width
        const candidates = []
        // 屏幕工作区边缘
        candidates.push({ value: workArea.x, threshold: SNAP_THRESHOLD })
        candidates.push({ value: workArea.x + workArea.width - width, threshold: SNAP_THRESHOLD })
        // 其他小部件边缘
        for (const o of others) {
          candidates.push({ value: o.x, threshold: WIDGET_SNAP_THRESHOLD })            // 左边对齐
          candidates.push({ value: o.x + o.width, threshold: WIDGET_SNAP_THRESHOLD })   // 左边贴合 other 右边
        }
        let best = null
        let bestDelta = Infinity
        for (const c of candidates) {
          const delta = Math.abs(x - c.value)
          if (delta < c.threshold && delta < bestDelta) { bestDelta = delta; best = c.value }
        }
        if (best !== null) {
          snappedX = best
          snappedWidth = rightEdge - best // 保持右边缘不变
          snapped = true
        }
      }
      // X 轴吸附 - 拖动右边缘：吸附右边缘(x+width)，保持左边缘(x)不变
      if (affectRight && lockedAxis !== 'x') {
        const rightEdge = x + width
        const candidates = []
        // 屏幕工作区边缘
        candidates.push({ value: workArea.x + workArea.width, threshold: SNAP_THRESHOLD })
        // 其他小部件边缘
        for (const o of others) {
          candidates.push({ value: o.x, threshold: WIDGET_SNAP_THRESHOLD })            // 右边贴合 other 左边
          candidates.push({ value: o.x + o.width, threshold: WIDGET_SNAP_THRESHOLD })   // 右边对齐
        }
        let best = null
        let bestDelta = Infinity
        for (const c of candidates) {
          const delta = Math.abs(rightEdge - c.value)
          if (delta < c.threshold && delta < bestDelta) { bestDelta = delta; best = c.value }
        }
        if (best !== null) {
          snappedWidth = best - x // 保持左边缘不变
          snapped = true
        }
      }

      // Y 轴吸附 - 拖动上边缘：吸附上边缘(y)，保持下边缘不变
      if (affectTop && lockedAxis !== 'y') {
        const bottomEdge = y + height
        const candidates = []
        // 屏幕工作区边缘
        candidates.push({ value: workArea.y, threshold: SNAP_THRESHOLD })
        candidates.push({ value: workArea.y + workArea.height - height, threshold: SNAP_THRESHOLD })
        // 其他小部件边缘
        for (const o of others) {
          candidates.push({ value: o.y, threshold: WIDGET_SNAP_THRESHOLD })
          candidates.push({ value: o.y + o.height, threshold: WIDGET_SNAP_THRESHOLD })
        }
        let best = null
        let bestDelta = Infinity
        for (const c of candidates) {
          const delta = Math.abs(y - c.value)
          if (delta < c.threshold && delta < bestDelta) { bestDelta = delta; best = c.value }
        }
        if (best !== null) {
          snappedY = best
          snappedHeight = bottomEdge - best // 保持下边缘不变
          snapped = true
        }
      }
      // Y 轴吸附 - 拖动下边缘：吸附下边缘(y+height)，保持上边缘(y)不变
      if (affectBottom && lockedAxis !== 'y') {
        const bottomEdge = y + height
        const candidates = []
        // 屏幕工作区边缘
        candidates.push({ value: workArea.y + workArea.height, threshold: SNAP_THRESHOLD })
        // 其他小部件边缘
        for (const o of others) {
          candidates.push({ value: o.y, threshold: WIDGET_SNAP_THRESHOLD })
          candidates.push({ value: o.y + o.height, threshold: WIDGET_SNAP_THRESHOLD })
        }
        let best = null
        let bestDelta = Infinity
        for (const c of candidates) {
          const delta = Math.abs(bottomEdge - c.value)
          if (delta < c.threshold && delta < bestDelta) { bestDelta = delta; best = c.value }
        }
        if (best !== null) {
          snappedHeight = best - y // 保持上边缘不变
          snapped = true
        }
      }

      // 发生吸附：阻止默认 resize，手动设置吸附后的 bounds
      if (snapped) {
        // 保护（问题 3）：吸附后尺寸若小于窗口最小尺寸，setBounds 会被 setMinimumSize 钳制
        //   场景：拖动边缘吸附时 snappedWidth < minWidth，Electron 可能调整 x/y 维持 minWidth，
        //   导致另一边也移动（表现为"拖动一边另一边也变化"）
        //   处理：展开形态下若吸附后尺寸 < 最小尺寸，放弃吸附，让系统默认 resize 处理；
        //         胶囊形态 setMinimumSize(0,0)，不受此约束，无需检查
        const def = widgetRegistry.getDefinition(widgetType)
        if (def && typeof def.minWidth === 'number' && typeof def.minHeight === 'number') {
          let isCapsule = false
          try {
            const widget = widgetDao.getByType(widgetType)
            isCapsule = !!Number(widget?.is_capsule)
          } catch (e) { /* 读取失败按展开形态处理 */ }
          if (!isCapsule && (snappedWidth < def.minWidth || snappedHeight < def.minHeight)) {
            // 放弃吸附前先执行联动：用 oldBounds 和 newBounds 计算移动量（问题 b）
            //   场景：吸附后尺寸过小放弃吸附，但用户拖动边缘已改变位置，
            //         吸附在该边缘的其他部件仍应跟随移动
            const affectedEdges = []
            if (affectLeft) affectedEdges.push('left')
            if (affectRight) affectedEdges.push('right')
            if (affectTop) affectedEdges.push('top')
            if (affectBottom) affectedEdges.push('bottom')
            syncSnappedWidgets(widgetType,
              oldBounds,
              { x, y, width, height },
              affectedEdges)
            snapped = false
            logger.debug('WidgetWindowManager', `will-resize 放弃吸附: 吸附后尺寸 ` +
              `(${snappedWidth}x${snappedHeight}) < 最小尺寸 (${def.minWidth}x${def.minHeight}), edge=${edge}`)
          }
        }

        if (snapped) {
          // 保护（问题 2b）：吸附后 snappedWidth/snappedHeight 可能为负数或过小值
          //   场景：拖动左边缘吸附时 snappedWidth = rightEdge - best，若 best > rightEdge 则为负
          //   场景：拖动上边缘吸附时 snappedHeight = bottomEdge - best，若 best > bottomEdge 则为负
          //   负数或过小尺寸会导致窗口另一侧诡异拉长（win.setBounds 接受负数但行为未定义）
          //   最小宽度 50px / 最小高度 30px，避免退化尺寸
          //   关键修复：钳制尺寸时必须同步调整对面边位置，保持对面边不变
          //     否则拖动左边缘时 snappedWidth 被钳制为 50，但 snappedX 仍是 best，
          //     右边缘变成 best+50 而非 rightEdge，表现为"另一边也变化"
          if (snappedWidth < 50) {
            if (affectLeft) {
              // 拖动左边缘：保持右边缘不变，调整 snappedX
              const rightEdge = x + width
              snappedWidth = 50
              snappedX = rightEdge - 50
            } else {
              // 拖动右边缘：保持左边缘不变，仅钳制宽度
              snappedWidth = 50
            }
          }
          if (snappedHeight < 30) {
            if (affectTop) {
              // 拖动上边缘：保持下边缘不变，调整 snappedY
              const bottomEdge = y + height
              snappedHeight = 30
              snappedY = bottomEdge - 30
            } else {
              // 拖动下边缘：保持上边缘不变，仅钳制高度
              snappedHeight = 30
            }
          }
          // 防重入：设置标志后 setBounds，避免触发的 will-resize 形成循环
          resizeReentryFlags.set(widgetType, true)
          event.preventDefault()
          win.setBounds({ x: snappedX, y: snappedY, width: snappedWidth, height: snappedHeight })
          // 同步清除标志（setBounds 同步完成后即可清除，后续 will-resize 是新的用户操作）
          resizeReentryFlags.delete(widgetType)
          // 设置吸附锁定（非锁定触发的吸附），防止后续 will-resize 重复吸附
          if (lockedAxis === null) {
            if (affectLeft && snappedX !== x) {
              resizeSnapLock.set(widgetType, { axis: 'x', affectLeft: true, affectTop: false, snappedValue: snappedX, originalValue: x, threshold: SNAP_THRESHOLD })
            } else if (affectRight && (snappedX + snappedWidth) !== (x + width)) {
              resizeSnapLock.set(widgetType, { axis: 'x', affectLeft: false, affectTop: false, snappedValue: snappedX + snappedWidth, originalValue: x + width, threshold: SNAP_THRESHOLD })
            } else if (affectTop && snappedY !== y) {
              resizeSnapLock.set(widgetType, { axis: 'y', affectLeft: false, affectTop: true, snappedValue: snappedY, originalValue: y, threshold: SNAP_THRESHOLD })
            } else if (affectBottom && (snappedY + snappedHeight) !== (y + height)) {
              resizeSnapLock.set(widgetType, { axis: 'y', affectLeft: false, affectTop: false, snappedValue: snappedY + snappedHeight, originalValue: y + height, threshold: SNAP_THRESHOLD })
            }
          }
          logger.debug('WidgetWindowManager', `will-resize 吸附: edge=${edge}, ` +
            `原 bounds=(${x},${y},${width},${height}), ` +
            `吸附后=(${snappedX},${snappedY},${snappedWidth},${snappedHeight})`)
          // 吸附联动（问题 b）：同步移动吸附在当前部件边缘的其他部件
          //   例如：部件 A 右边缘吸附部件 B 左边缘，用户拖动 A 右边缘扩大 → B 应同步向右移动
          //   oldBounds 为 resize 前窗口实际 bounds，newBounds 为吸附后 bounds，delta 驱动联动
          const affectedEdges = []
          if (affectLeft) affectedEdges.push('left')
          if (affectRight) affectedEdges.push('right')
          if (affectTop) affectedEdges.push('top')
          if (affectBottom) affectedEdges.push('bottom')
          syncSnappedWidgets(widgetType,
            oldBounds,
            { x: snappedX, y: snappedY, width: snappedWidth, height: snappedHeight },
            affectedEdges)
        }
      }
      // 非吸附情况下的联动（问题 b）：用户 resize 改变部件边缘位置时，
      //   吸附在该边缘的其他部件也应跟随移动，保持吸附关系
      //   场景：部件 A 右边缘吸附部件 B 左边缘（未触发吸附，仅是边缘对齐），
      //         用户拖动 A 右边缘扩大 → B 应同步向右移动
      if (!snapped) {
        const affectedEdges = []
        if (affectLeft) affectedEdges.push('left')
        if (affectRight) affectedEdges.push('right')
        if (affectTop) affectedEdges.push('top')
        if (affectBottom) affectedEdges.push('bottom')
        syncSnappedWidgets(widgetType,
          oldBounds,
          { x: newBounds.x, y: newBounds.y, width: newBounds.width, height: newBounds.height },
          affectedEdges)
      }
    } catch (e) { /* 吸附失败不影响默认 resize */ }
  })

  // 拦截 close 事件：非退出时改为 hide
  win.on('close', (event) => {
    if (!appWillQuit) {
      event.preventDefault()
      win.hide()
      // 同步显隐状态到数据库
      try {
        widgetDao.setVisible(widgetType, false)
      } catch (e) { /* 忽略 */ }
      logger.info('WidgetWindowManager', `小部件 ${widgetType} 已隐藏（拦截 close）`)
    }
  })

  // 窗口销毁时清理映射
  win.on('closed', () => {
    widgetWindows.delete(widgetType)
  })

  widgetWindows.set(widgetType, win)
  // 应用位置锁/大小锁/置顶（读取持久化字段）
  try {
    applyLocksToWindow(widgetType)
  } catch (e) { /* 应用锁失败不影响窗口创建 */ }
  // 注册到表面注册表（表面管理）
  registerWidgetSurface(widgetType, win)
  logger.info('WidgetWindowManager', `小部件 ${widgetType} 窗口已创建`)
  return win
}

/**
 * 销毁小部件窗口
 * @param {string} widgetType
 */
function destroyWidgetWindow (widgetType) {
  const win = widgetWindows.get(widgetType)
  if (!win) return
  try {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  } catch (error) {
    logger.error('WidgetWindowManager', `销毁小部件 ${widgetType} 失败: ${error.message}`)
  }
  widgetWindows.delete(widgetType)
  // 清理节流定时器
  const timer = boundsPersistTimers.get(widgetType)
  if (timer) {
    clearTimeout(timer)
    boundsPersistTimers.delete(widgetType)
  }

  // 清理显隐动画定时器与标记（避免窗口销毁后 setInterval 空转）
  const animTimer = animationTimers.get(widgetType)
  if (animTimer) {
    clearInterval(animTimer)
    animationTimers.delete(widgetType)
  }
  animatingFlags.delete(widgetType)
  // 清理隐藏前展开尺寸缓存
  hiddenExpandedBounds.delete(widgetType)
  // 清理材质缓存（问题 c）
  lastAppliedMaterial.delete(widgetType)
  // 清理多显示器锚点缓存
  widgetAnchors.delete(widgetType)
  // 清理胶囊切换中标记
  capsuleSwitchingFlags.delete(widgetType)
  // 清理胶囊展开尺寸缓存
  expandedBoundsCache.delete(widgetType)
  // 清理 will-resize 防重入标志
  resizeReentryFlags.delete(widgetType)
  // 清理用户正在 resize 标志
  userResizingFlags.delete(widgetType)
  // 清理 resize 吸附锁定
  resizeSnapLock.delete(widgetType)
  // 从表面注册表注销
  unregisterWidgetSurface(widgetType)
}

// ============================================================
// 显隐控制
// ============================================================

/**
 * 查询动画开关是否启用
 * 从 app_settings 表读取 'widget_animation'，默认启用
 * @returns {boolean}
 */
function getAnimationEnabled () {
  try {
    const value = appSettingDao.get(ANIMATION_KEY)
    if (value === null || value === undefined) return DEFAULT_ANIMATION_ENABLED
    return value === 'true' || value === true
  } catch (e) {
    return DEFAULT_ANIMATION_ENABLED
  }
}

/**
 * 设置动画开关并持久化
 * @param {boolean} enabled
 */
function setAnimationEnabled (enabled) {
  try {
    appSettingDao.set(ANIMATION_KEY, enabled ? 'true' : 'false')
  } catch (e) {
    logger.warn('WidgetWindowManager', `持久化动画开关失败: ${e.message}`)
  }
}

/**
 * easeOutCubic 缓动函数
 * @param {number} t - 进度 [0, 1]
 * @returns {number} 缓动后的进度
 */
function easeOutCubic (t) {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * 根据窗口中心点在 workArea 的位置确定收缩锚点（最近边缘）
 * @param {object} bounds - { x, y, width, height }
 * @param {object} workArea - 显示器工作区 { x, y, width, height }
 * @returns {'left'|'right'|'top'|'bottom'} 收缩边缘方向
 */
function determineShrinkEdge (bounds, workArea) {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  // 中心点到各边缘的距离
  const distLeft = cx - workArea.x
  const distRight = (workArea.x + workArea.width) - cx
  const distTop = cy - workArea.y
  const distBottom = (workArea.y + workArea.height) - cy
  // 取最近边缘
  const minDist = Math.min(distLeft, distRight, distTop, distBottom)
  if (minDist === distLeft) return 'left'
  if (minDist === distRight) return 'right'
  if (minDist === distTop) return 'top'
  return 'bottom'
}

/**
 * 计算沿指定边缘收缩到目标尺寸的最终 bounds
 * @param {object} bounds - 当前 { x, y, width, height }
 * @param {'left'|'right'|'top'|'bottom'} edge - 收缩边缘
 * @param {number} targetSize - 收缩目标尺寸（像素）
 * @returns {object} 收缩后的 { x, y, width, height }
 */
function computeShrunkBounds (bounds, edge, targetSize) {
  const { x, y, width, height } = bounds
  switch (edge) {
    case 'left':
      // 向左边缘缩：x 不变，width 收缩到 targetSize
      return { x, y, width: targetSize, height }
    case 'right':
      // 向右边缘缩：右边界贴齐，width 收缩到 targetSize
      return { x: x + width - targetSize, y, width: targetSize, height }
    case 'top':
      // 向上边缘缩：y 不变，height 收缩到 targetSize
      return { x, y, width, height: targetSize }
    case 'bottom':
      // 向下边缘缩：下边界贴齐，height 收缩到 targetSize
      return { x, y: y + height - targetSize, width, height: targetSize }
    default:
      return bounds
  }
}

/**
 * 沿边缘缩回隐藏动画
 * 读取当前 bounds 和所在显示器 workArea，根据窗口中心点象限确定收缩锚点，
 *   沿选定边缘逐帧缩回（easeOutCubic 缓动），结束后 win.hide()
 * 动画期间设置 animating 标记避免重复触发；每帧检查 win.isDestroyed() 安全退出
 * @param {string} widgetType
 */
function animateHideWidget (widgetType) {
  const win = widgetWindows.get(widgetType)
  if (!win || win.isDestroyed()) return
  // 已在动画中：忽略重复触发
  if (animatingFlags.get(widgetType)) return
  // 窗口已不可见：直接返回
  if (!win.isVisible()) return

  // 动画开关关闭：直接隐藏
  if (!getAnimationEnabled()) {
    win.hide()
    try {
      widgetDao.setVisible(widgetType, false)
    } catch (e) { /* 忽略 */ }
    return
  }

  let startBounds
  let edge
  let targetBounds
  try {
    startBounds = win.getBounds()
    // 缓存展开尺寸，供显示动画恢复
    hiddenExpandedBounds.set(widgetType, {
      width: startBounds.width,
      height: startBounds.height,
      x: startBounds.x,
      y: startBounds.y
    })
    const display = screen.getDisplayMatching(startBounds)
    edge = determineShrinkEdge(startBounds, display.workArea)
    targetBounds = computeShrunkBounds(startBounds, edge, SHRINK_TARGET_SIZE)
  } catch (e) {
    // 计算失败：直接隐藏
    win.hide()
    try {
      widgetDao.setVisible(widgetType, false)
    } catch (e2) { /* 忽略 */ }
    return
  }

  animatingFlags.set(widgetType, true)
  const startTime = Date.now()

  const timer = setInterval(() => {
    try {
      // 窗口被销毁：安全退出
      if (win.isDestroyed()) {
        clearInterval(timer)
        animationTimers.delete(widgetType)
        animatingFlags.delete(widgetType)
        return
      }
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1)
      const eased = easeOutCubic(progress)
      // 插值 bounds
      const currentBounds = {
        x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * eased),
        y: Math.round(startBounds.y + (targetBounds.y - startBounds.y) * eased),
        width: Math.round(startBounds.width + (targetBounds.width - startBounds.width) * eased),
        height: Math.round(startBounds.height + (targetBounds.height - startBounds.height) * eased)
      }
      win.setBounds(currentBounds)
      // 动画结束
      if (progress >= 1) {
        clearInterval(timer)
        animationTimers.delete(widgetType)
        animatingFlags.delete(widgetType)
        if (!win.isDestroyed()) {
          win.hide()
          try {
            widgetDao.setVisible(widgetType, false)
          } catch (e) { /* 忽略 */ }
          logger.info('WidgetWindowManager', `小部件 ${widgetType} 已隐藏（边缘缩回动画完成）`)
        }
      }
    } catch (e) {
      // 异常：清理并隐藏
      clearInterval(timer)
      animationTimers.delete(widgetType)
      animatingFlags.delete(widgetType)
      try {
        if (!win.isDestroyed()) win.hide()
      } catch (e2) { /* 忽略 */ }
    }
  }, ANIMATION_FRAME_INTERVAL)
  animationTimers.set(widgetType, timer)
}

/**
 * 从收缩状态展开显示动画
 * 先 win.show()，再从收缩 bounds（40px 贴边）逐帧展开到持久化 bounds
 *   （从缓存或 DAO 读取 width/height）
 * @param {string} widgetType
 */
function animateShowWidget (widgetType) {
  let win = widgetWindows.get(widgetType)
  if (!win || win.isDestroyed()) {
    win = createWidgetWindow(widgetType)
  }
  if (!win || win.isDestroyed()) return
  // 已在动画中：忽略重复触发
  if (animatingFlags.get(widgetType)) {
    // 仍在动画中但窗口可能已隐藏：确保可见
    try { win.show() } catch (e) { /* 忽略 */ }
    return
  }

  // 动画开关关闭：直接显示
  if (!getAnimationEnabled()) {
    win.show()
    try {
      widgetDao.setVisible(widgetType, true)
    } catch (e) { /* 忽略 */ }
    return
  }

  let startBounds
  let targetBounds
  try {
    // 起始 bounds：当前窗口 bounds（可能是收缩状态）
    startBounds = win.getBounds()
    // 目标 bounds：优先用缓存，否则从 DAO 读取
    const cached = hiddenExpandedBounds.get(widgetType)
    if (cached && typeof cached.width === 'number' && typeof cached.height === 'number') {
      targetBounds = {
        x: cached.x !== undefined ? cached.x : startBounds.x,
        y: cached.y !== undefined ? cached.y : startBounds.y,
        width: cached.width,
        height: cached.height
      }
    } else {
      const def = widgetRegistry.getDefinition(widgetType)
      const widget = widgetDao.getByType(widgetType)
      targetBounds = {
        x: startBounds.x,
        y: startBounds.y,
        width: widget?.width ?? def?.defaultWidth ?? startBounds.width,
        height: widget?.height ?? def?.defaultHeight ?? startBounds.height
      }
    }
  } catch (e) {
    // 计算失败：直接显示
    try { win.show() } catch (e2) { /* 忽略 */ }
    try {
      widgetDao.setVisible(widgetType, true)
    } catch (e2) { /* 忽略 */ }
    return
  }

  // 先显示窗口
  try { win.show() } catch (e) { /* 忽略 */ }

  animatingFlags.set(widgetType, true)
  const startTime = Date.now()

  const timer = setInterval(() => {
    try {
      // 窗口被销毁：安全退出
      if (win.isDestroyed()) {
        clearInterval(timer)
        animationTimers.delete(widgetType)
        animatingFlags.delete(widgetType)
        return
      }
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1)
      const eased = easeOutCubic(progress)
      // 插值 bounds
      const currentBounds = {
        x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * eased),
        y: Math.round(startBounds.y + (targetBounds.y - startBounds.y) * eased),
        width: Math.round(startBounds.width + (targetBounds.width - startBounds.width) * eased),
        height: Math.round(startBounds.height + (targetBounds.height - startBounds.height) * eased)
      }
      win.setBounds(currentBounds)
      // 动画结束
      if (progress >= 1) {
        clearInterval(timer)
        animationTimers.delete(widgetType)
        animatingFlags.delete(widgetType)
        try {
          widgetDao.setVisible(widgetType, true)
        } catch (e) { /* 忽略 */ }
        // 清理展开尺寸缓存
        hiddenExpandedBounds.delete(widgetType)
        logger.info('WidgetWindowManager', `小部件 ${widgetType} 已显示（边缘展开动画完成）`)
      }
    } catch (e) {
      // 异常：清理
      clearInterval(timer)
      animationTimers.delete(widgetType)
      animatingFlags.delete(widgetType)
    }
  }, ANIMATION_FRAME_INTERVAL)
  animationTimers.set(widgetType, timer)
}

/**
 * 显示单个小部件
 * @param {string} widgetType
 */
function showWidget (widgetType) {
  animateShowWidget(widgetType)
}

/**
 * 隐藏单个小部件
 * @param {string} widgetType
 */
function hideWidget (widgetType) {
  animateHideWidget(widgetType)
}

/**
 * 显示所有小部件
 */
function showAllWidgets () {
  for (const widgetType of widgetWindows.keys()) {
    showWidget(widgetType)
  }
  // 同时为 DAO 中已启用但未创建窗口的小部件创建窗口
  try {
    const widgets = widgetDao.list()
    for (const w of widgets) {
      // 跳过 quick-capture（已合并为 note/随记便笺，不再创建独立窗口）
      if (w.widget_type === 'quick-capture') continue
      if (w.is_enabled && !widgetWindows.has(w.widget_type)) {
        showWidget(w.widget_type)
      }
    }
  } catch (error) {
    logger.error('WidgetWindowManager', `showAllWidgets 失败: ${error.message}`)
  }
}

/**
 * 隐藏所有小部件
 */
function hideAllWidgets () {
  for (const widgetType of widgetWindows.keys()) {
    hideWidget(widgetType)
  }
}

/**
 * 重置所有小部件（位置、尺寸、胶囊状态、锁定状态）
 * 修复（问题 e）：遍历所有已创建的小部件窗口，对每个执行重置操作
 *   - 重置位置和尺寸到默认值（调用 resetPosition，自动处理胶囊/展开形态）
 *   - 重置胶囊状态：全部展开（is_capsule=false）
 *   - 重置锁定状态：全部解锁（position_lock=false, size_lock=false, always_on_top=false）
 *   - 通过 IPC 广播 widget:reset-all 事件，让前端更新 UI 状态
 */
function resetAllWidgets () {
  const resetTypes = []
  for (const widgetType of widgetWindows.keys()) {
    const win = widgetWindows.get(widgetType)
    if (!win || win.isDestroyed()) continue
    try {
      // 1. 重置锁定状态：全部解锁（position_lock=0, size_lock=0, always_on_top=0）
      const widget = widgetDao.getByType(widgetType)
      if (widget) {
        widgetDao.update(widget.id, {
          position_lock: 0,
          size_lock: 0,
          always_on_top: 0,
          is_capsule: 0  // 全部展开
        })
      }
      // 2. 清理胶囊展开尺寸缓存（重置后不再需要）
      expandedBoundsCache.delete(widgetType)
      // 3. 重置位置和尺寸（resetPosition 会读取最新的 is_capsule=false，按展开形态重置）
      resetPosition(widgetType)
      // 4. 应用锁字段到窗口（解锁后窗口可移动/缩放/非置顶）
      applyLocksToWindow(widgetType)
      // 5. 通知渲染进程更新胶囊状态（全部展开）
      try {
        win.webContents.send('widget:capsule-changed', { widgetType, isCapsule: false })
      } catch (e) { /* 忽略发送失败 */ }
      resetTypes.push(widgetType)
    } catch (e) {
      logger.error('WidgetWindowManager', `resetAllWidgets 重置 ${widgetType} 失败: ${e.message}`)
    }
  }
  // 通过 IPC 广播 widget:reset-all 事件，让前端更新 UI 状态
  //   前端收到后可刷新小部件列表、重置胶囊切换按钮状态等
  for (const widgetType of resetTypes) {
    const win = widgetWindows.get(widgetType)
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('widget:reset-all', { widgetType, resetTypes })
      } catch (e) { /* 忽略发送失败 */ }
    }
  }
  // 同时向主窗口广播（用于设置页等 UI 更新）
  try {
    const { BrowserWindow } = require('electron')
    for (const [type, win] of BrowserWindow.getAllWindows().entries()) {
      if (win && !win.isDestroyed() && win.webContents) {
        try {
          win.webContents.send('widget:reset-all', { resetTypes })
        } catch (e) { /* 忽略发送失败 */ }
      }
    }
  } catch (e) { /* 忽略广播失败 */ }
  logger.info('WidgetWindowManager', `resetAllWidgets 已重置 ${resetTypes.length} 个小部件: ${resetTypes.join(', ')}`)
}

/**
 * 切换所有小部件显隐（全局热键触发）
 * 如果有任意一个可见，则全部隐藏；否则全部显示
 */
function toggleAllWidgets () {
  let anyVisible = false
  for (const win of widgetWindows.values()) {
    if (win && !win.isDestroyed() && win.isVisible()) {
      anyVisible = true
      break
    }
  }
  if (anyVisible) {
    hideAllWidgets()
  } else {
    showAllWidgets()
  }
  logger.info('WidgetWindowManager', `toggleAllWidgets: ${anyVisible ? '隐藏全部' : '显示全部'}`)
}

// ============================================================
// 位置 / 胶囊控制
// ============================================================

/**
 * 获取小部件窗口实例
 * @param {string} widgetType
 * @returns {BrowserWindow|null}
 */
function getWidgetWindow (widgetType) {
  return widgetWindows.get(widgetType) || null
}

/**
 * 更新小部件位置/大小并持久化
 * @param {string} widgetType
 * @param {object} bounds - { x, y, width, height }
 */
function updateWidgetBounds (widgetType, bounds) {
  const win = widgetWindows.get(widgetType)
  if (win && !win.isDestroyed()) {
    win.setBounds(bounds)
  }
  // 立即持久化（外部主动调用时不节流）
  try {
    const widget = widgetDao.getByType(widgetType)
    if (widget) {
      widgetDao.updateBounds(widget.id, bounds)
    }
  } catch (error) {
    logger.error('WidgetWindowManager', `updateWidgetBounds(${widgetType}) 持久化失败: ${error.message}`)
  }
}

/**
 * 切换胶囊状态
 * 调整窗口大小（胶囊形态缩小，展开形态恢复），并通知渲染进程
 * 胶囊尺寸由 widgetRegistry.getCapsuleBounds 计算（capsuleStandardWidth x capsuleHeight）
 * 折叠前缓存展开尺寸，展开时从缓存恢复
 * @param {string} widgetType
 * @param {boolean} isCapsule
 */
function setWidgetCapsule (widgetType, isCapsule) {
  const win = widgetWindows.get(widgetType)
  // 持久化胶囊状态
  try {
    widgetDao.setCapsule(widgetType, isCapsule)
  } catch (error) {
    logger.error('WidgetWindowManager', `setWidgetCapsule(${widgetType}) 持久化失败: ${error.message}`)
  }
  // 设置胶囊切换中标记：期间忽略 resizeToContent 调用
  //   避免 ResizeObserver 触发的尺寸自适应用展开形态 minHeight 把胶囊拉回大尺寸
  capsuleSwitchingFlags.set(widgetType, true)
  // 设置 will-resize 防重入标志：setBounds 可能触发 will-resize，需跳过避免吸附干扰
  resizeReentryFlags.set(widgetType, true)
  // 调整窗口尺寸
  if (win && !win.isDestroyed()) {
    try {
      const currentBounds = win.getBounds()
      if (isCapsule) {
        // 折叠：先缓存当前展开尺寸（width/height），再收缩到胶囊尺寸
        expandedBoundsCache.set(widgetType, {
          width: currentBounds.width,
          height: currentBounds.height
        })
        // 读取 contentMode，使用 getCapsuleBoundsForMode 返回正确尺寸
        let contentMode = 'summary'
        try {
          const widgetCfg = widgetDao.getByType(widgetType)
          if (widgetCfg?.compact_content_mode) {
            contentMode = widgetCfg.compact_content_mode
          }
        } catch (e) { /* 读取失败使用默认 summary */ }
        const targetBounds = widgetRegistry.getCapsuleBoundsForMode(widgetType, contentMode, currentBounds)
        if (targetBounds) {
          // 折叠为胶囊：临时取消最小尺寸限制，避免 minHeight 钳制导致窗口无法缩小到胶囊高度
          //   胶囊尺寸（如 248×42）远小于各类型 minWidth/minHeight（如 note 200×240）
          win.setMinimumSize(0, 0)
          // 胶囊形态下禁止 resize：胶囊尺寸应保持固定，不应允许用户拖拽边缘改变
          //   contentMode 决定（minimal 172/summary 248/smart 272），用户不应通过 resize 改变
          //   展开时会恢复 setResizable(true)
          win.setResizable(false)
          win.setBounds(targetBounds)
          persistBoundsThrottled(widgetType, targetBounds)
          logger.debug('WidgetWindowManager', `setWidgetCapsule 折叠 ${widgetType}: ` +
            `目标=(${targetBounds.x},${targetBounds.y},${targetBounds.width},${targetBounds.height})`)
          // 关键时序修复（问题 2a）：setBounds 后立即发送 capsule-changed 事件，
          //   确保渲染进程在 ResizeObserver 防抖回调触发前收到事件并更新 isCapsule 状态，
          //   避免 ResizeObserver 触发 resizeToContent 时窗口仍处于展开态导致尺寸抖动
          try {
            win.webContents.send('widget:capsule-changed', { widgetType, isCapsule })
          } catch (e) {
            logger.warn('WidgetWindowManager', `setWidgetCapsule(${widgetType}) 发送 capsule-changed 失败: ${e.message}`)
          }
        }
      } else {
        // 展开：从缓存读取展开尺寸恢复
        //   修复（问题 a）：使用 getExpandedBoundsForCapsule 根据屏幕位置自动判定展开方向，
        //   并按方向调整 x/y 锚点（如窗口在屏幕下半部 → 向上展开，y 上移保持底部锚点）
        //   之前直接用 currentBounds.x/y，导致展开后窗口位置可能超出屏幕或与胶囊位置错位
        const expanded = expandedBoundsCache.get(widgetType)
        if (expanded && typeof expanded.width === 'number' && typeof expanded.height === 'number') {
          // 计算屏幕工作区用于展开方向判定
          let workArea
          try {
            const display = screen.getDisplayMatching(currentBounds)
            workArea = display.workArea
          } catch (e) {
            workArea = screen.getPrimaryDisplay().workArea
          }
          // 使用 getExpandedBoundsForCapsule 计算展开后位置（根据方向调整 x/y）
          const targetBounds = widgetRegistry.getExpandedBoundsForCapsule(
            widgetType, currentBounds, workArea, expanded)
          if (targetBounds) {
            // 展开：恢复该类型的最小尺寸限制，从 widgetRegistry 读取 minWidth/minHeight
            //   胶囊折叠时已 setMinimumSize(0,0)，展开后需还原以维持正常交互约束
            //   同时确保 resize 时窗口有最小尺寸限制（问题 2b）
            const def = widgetRegistry.getDefinition(widgetType)
            if (def && typeof def.minWidth === 'number' && typeof def.minHeight === 'number') {
              win.setMinimumSize(def.minWidth, def.minHeight)
            }
            // 展开后恢复可 resize（胶囊形态可能已 setResizable(false)）
            win.setResizable(true)
            win.setBounds(targetBounds)
            persistBoundsThrottled(widgetType, targetBounds)
            expandedBoundsCache.delete(widgetType)
            logger.debug('WidgetWindowManager', `setWidgetCapsule 展开 ${widgetType}: ` +
              `目标=(${targetBounds.x},${targetBounds.y},${targetBounds.width},${targetBounds.height})`)
            // 关键时序修复（问题 2a）：setBounds 后立即发送 capsule-changed 事件
            try {
              win.webContents.send('widget:capsule-changed', { widgetType, isCapsule })
            } catch (e) {
              logger.warn('WidgetWindowManager', `setWidgetCapsule(${widgetType}) 发送 capsule-changed 失败: ${e.message}`)
            }
          }
        }
      }
    } catch (e) {
      logger.warn('WidgetWindowManager', `setWidgetCapsule(${widgetType}) 调整尺寸失败: ${e.message}`)
      // 即使调整尺寸失败也通知渲染进程，避免渲染进程状态与主进程不一致
      try {
        win.webContents.send('widget:capsule-changed', { widgetType, isCapsule })
      } catch (sendErr) { /* 忽略发送失败 */ }
    }
  }
  // 立即清除 will-resize 防重入标志（setBounds 已同步完成）
  resizeReentryFlags.delete(widgetType)
  // 延迟清除胶囊切换中标记：覆盖 ResizeObserver 防抖 100ms + 渲染过渡最长 300ms + IPC 往返 + 余量
  setTimeout(() => {
    capsuleSwitchingFlags.delete(widgetType)
  }, CAPSULE_SWITCHING_GUARD)
  logger.info('WidgetWindowManager', `小部件 ${widgetType} 胶囊状态: ${isCapsule ? '折叠' : '展开'} (guard=${CAPSULE_SWITCHING_GUARD}ms)`)
}

/**
 * 设置胶囊状态（公开 API，供 IPC 调用）
 * 与 setWidgetCapsule 功能相同，作为对外统一接口
 * @param {string} widgetType
 * @param {boolean} isCapsule
 */
function setCapsule (widgetType, isCapsule) {
  setWidgetCapsule(widgetType, isCapsule)
}

// ============================================================
// 位置锁 / 大小锁 / 置顶 / 重置位置
// ============================================================

/**
 * 读取小部件锁字段并应用到窗口
 * @param {string} widgetType
 */
function applyLocksToWindow (widgetType) {
  const win = widgetWindows.get(widgetType)
  if (!win || win.isDestroyed()) return
  try {
    const widget = widgetDao.getByType(widgetType)
    if (!widget) return
    // 位置锁：锁定后禁止移动（窗口拖动由主进程 drag 通道控制，需同步标记）
    const positionLocked = !!Number(widget.position_lock)
    win.setMovable(!positionLocked)
    // 大小锁：锁定后禁止缩放
    const sizeLocked = !!Number(widget.size_lock)
    win.setResizable(!sizeLocked)
    // 置顶
    const alwaysOnTop = !!Number(widget.always_on_top)
    win.setAlwaysOnTop(alwaysOnTop)
    // 通知渲染进程更新按钮状态
    try {
      win.webContents.send('widget:locks-changed', {
        widgetType,
        positionLock: positionLocked,
        sizeLock: sizeLocked,
        alwaysOnTop
      })
    } catch (e) {
      // 不再静默吞错：记录发送失败原因，便于排查渲染进程未收到事件的问题
      logger.warn('WidgetWindowManager', `applyLocksToWindow(${widgetType}) 发送 widget:locks-changed 失败: ${e.message}`)
    }
  } catch (e) {
    logger.warn('WidgetWindowManager', `applyLocksToWindow(${widgetType}) 失败: ${e.message}`)
  }
}

/**
 * 切换位置锁
 * @param {string} widgetType
 */
function togglePositionLock (widgetType) {
  try {
    const widget = widgetDao.getByType(widgetType)
    if (!widget) return
    const next = Number(widget.position_lock) ? 0 : 1
    widgetDao.update(widget.id, { position_lock: next })
    applyLocksToWindow(widgetType)
    logger.info('WidgetWindowManager', `小部件 ${widgetType} 位置锁: ${next ? '锁定' : '解锁'}`)
  } catch (e) {
    logger.error('WidgetWindowManager', `togglePositionLock(${widgetType}) 失败: ${e.message}`)
  }
}

/**
 * 切换大小锁
 * @param {string} widgetType
 */
function toggleSizeLock (widgetType) {
  try {
    const widget = widgetDao.getByType(widgetType)
    if (!widget) {
      logger.warn('WidgetWindowManager', `toggleSizeLock(${widgetType}) 未找到小部件记录`)
      return
    }
    const next = Number(widget.size_lock) ? 0 : 1
    logger.info('WidgetWindowManager', `toggleSizeLock(${widgetType}) 当前 size_lock=${widget.size_lock}, 目标=${next}`)
    const updated = widgetDao.update(widget.id, { size_lock: next })
    logger.info('WidgetWindowManager', `toggleSizeLock(${widgetType}) 更新后 size_lock=${updated?.size_lock}`)
    applyLocksToWindow(widgetType)
    logger.info('WidgetWindowManager', `小部件 ${widgetType} 大小锁: ${next ? '锁定' : '解锁'}`)
  } catch (e) {
    logger.error('WidgetWindowManager', `toggleSizeLock(${widgetType}) 失败: ${e.message}`)
  }
}

/**
 * 修复（问题 d）：胶囊状态下重置应保持胶囊尺寸，否则会变成展开尺寸但 is_capsule=true，
 *   导致窗口内容为空面板（胶囊形态显示展开尺寸的内容区域，但胶囊内容未渲染）
 *   - 胶囊状态：重置到胶囊默认尺寸（getCapsuleBoundsForMode），保持 is_capsule=true
 *   - 展开状态：重置到展开默认尺寸（defaultWidth × defaultHeight）
 * @param {string} widgetType
 */
function resetPosition (widgetType) {
  const win = widgetWindows.get(widgetType)
  try {
    const def = widgetRegistry.getDefinition(widgetType)
    if (!def) return
    // 读取当前胶囊状态与内容模式
    let isCapsule = false
    let contentMode = 'summary'
    try {
      const widget = widgetDao.getByType(widgetType)
      isCapsule = !!Number(widget?.is_capsule)
      if (widget?.compact_content_mode) {
        contentMode = widget.compact_content_mode
      }
    } catch (e) { /* 读取失败按展开形态处理 */ }

    let defaultBounds
    if (isCapsule) {
      // 胶囊状态：重置到胶囊默认尺寸，保持 is_capsule=true
      //   使用 getCapsuleBoundsForMode 根据 contentMode 计算胶囊尺寸
      //   位置使用类型默认 x/y
      const capsuleBounds = widgetRegistry.getCapsuleBoundsForMode(widgetType, contentMode, {
        x: def.defaultX,
        y: def.defaultY
      })
      if (capsuleBounds) {
        defaultBounds = capsuleBounds
      } else {
        // 回退：使用 capsuleStandardWidth × capsuleHeight
        defaultBounds = {
          x: def.defaultX,
          y: def.defaultY,
          width: def.capsuleStandardWidth || 248,
          height: def.capsuleHeight || 42
        }
      }
    } else {
      // 展开状态：重置到展开默认尺寸
      defaultBounds = {
        x: def.defaultX,
        y: def.defaultY,
        width: def.defaultWidth,
        height: def.defaultHeight
      }
    }

    if (win && !win.isDestroyed()) {
      // 胶囊形态下临时取消最小尺寸限制，避免 minHeight 钳制
      if (isCapsule) {
        win.setMinimumSize(0, 0)
        win.setResizable(false)
      } else {
        // 展开形态恢复最小尺寸限制
        if (typeof def.minWidth === 'number' && typeof def.minHeight === 'number') {
          win.setMinimumSize(def.minWidth, def.minHeight)
        }
        win.setResizable(true)
      }
      win.setBounds(defaultBounds)
      // 通知渲染进程更新状态（确保胶囊形态显示胶囊内容，展开形态显示完整内容）
      try {
        win.webContents.send('widget:capsule-changed', { widgetType, isCapsule })
      } catch (e) { /* 忽略发送失败 */ }
    }
    // 持久化（保持 is_capsule 状态不变，仅重置位置和尺寸）
    try {
      const widget = widgetDao.getByType(widgetType)
      if (widget) {
        widgetDao.update(widget.id, {
          position_x: defaultBounds.x,
          position_y: defaultBounds.y,
          width: defaultBounds.width,
          height: defaultBounds.height
        })
      }
    } catch (e) { /* 持久化失败忽略 */ }
    logger.info('WidgetWindowManager', `小部件 ${widgetType} 重置位置: ` +
      `${defaultBounds.x},${defaultBounds.y} ${isCapsule ? '(胶囊)' : '(展开)'}`)
  } catch (e) {
    logger.error('WidgetWindowManager', `resetPosition(${widgetType}) 失败: ${e.message}`)
  }
}

/**
 * 切换置顶
 * @param {string} widgetType
 */
function toggleAlwaysOnTop (widgetType) {
  try {
    const widget = widgetDao.getByType(widgetType)
    if (!widget) {
      logger.warn('WidgetWindowManager', `toggleAlwaysOnTop(${widgetType}) 未找到小部件记录`)
      return
    }
    const next = Number(widget.always_on_top) ? 0 : 1
    logger.info('WidgetWindowManager', `toggleAlwaysOnTop(${widgetType}) 当前 always_on_top=${widget.always_on_top}, 目标=${next}`)
    const updated = widgetDao.update(widget.id, { always_on_top: next })
    logger.info('WidgetWindowManager', `toggleAlwaysOnTop(${widgetType}) 更新后 always_on_top=${updated?.always_on_top}`)
    applyLocksToWindow(widgetType)
    logger.info('WidgetWindowManager', `小部件 ${widgetType} 置顶: ${next ? '开启' : '关闭'}`)
  } catch (e) {
    logger.error('WidgetWindowManager', `toggleAlwaysOnTop(${widgetType}) 失败: ${e.message}`)
  }
}

/**
 * 根据渲染进程测量的内容尺寸自适应调整窗口大小
 * 用于动态内容（如便签内容变化）时窗口尺寸跟随适配
 * @param {string} widgetType
 * @param {object} contentSize - { width, height } 渲染进程测量的内容尺寸
 */
function resizeToContent (widgetType, contentSize) {
  // 防御性校验
  if (!widgetType || typeof widgetType !== 'string') {
    logger.warn('WidgetWindowManager', `resizeToContent 收到非法 widgetType: ${widgetType}`)
    return
  }
  if (!contentSize || typeof contentSize !== 'object') {
    logger.warn('WidgetWindowManager', `resizeToContent(${widgetType}) 收到无效 contentSize`)
    return
  }
  const { width: contentWidth, height: contentHeight } = contentSize
  if (typeof contentWidth !== 'number' || typeof contentHeight !== 'number' ||
      !Number.isFinite(contentWidth) || !Number.isFinite(contentHeight)) {
    logger.warn('WidgetWindowManager', `resizeToContent(${widgetType}) 收到非法尺寸: (${contentWidth}, ${contentHeight})`)
    return
  }

  const win = widgetWindows.get(widgetType)
  if (!win || win.isDestroyed()) {
    logger.warn('WidgetWindowManager', `resizeToContent(${widgetType}) 窗口不存在或已销毁`)
    return
  }

  // 胶囊切换中：忽略 ResizeObserver 触发的尺寸自适应
  //   避免切换过程中用展开形态 minHeight 把胶囊窗口拉回大尺寸
  if (capsuleSwitchingFlags.get(widgetType)) {
    logger.debug('WidgetWindowManager', `resizeToContent(${widgetType}) 胶囊切换中，忽略`)
    return
  }

  // 拖拽中：忽略 ResizeObserver 触发的尺寸自适应
  //   拖拽时 win.setBounds 移动窗口可能触发 ResizeObserver，若不忽略会导致
  //   resizeToContent → setBounds → ResizeObserver → resizeToContent 循环，
  //   窗口尺寸持续增长（如 595→596→600→604），表现为"点击小部件窗口尺寸小扩张"
  if (dragState.has(widgetType)) {
    return
  }

  // 用户正在 resize：忽略 ResizeObserver 触发的尺寸自适应
  //   用户拖动窗口边缘调整尺寸时，ResizeObserver 会触发 resizeToContent，
  //   resizeToContent 根据内容尺寸设置 width/height，会改变用户没有拖动的维度
  //   （如拖动右边缘时 height 也被改变），表现为"其他没被拉伸的尺寸也有变化"
  if (userResizingFlags.get(widgetType)) {
    return
  }

  try {
    const def = widgetRegistry.getDefinition(widgetType)
    const currentBounds = win.getBounds()
    // 读取当前胶囊状态：胶囊形态下使用胶囊尺寸约束，避免展开形态 minHeight 把胶囊拉大
    let isCapsule = false
    try {
      const widget = widgetDao.getByType(widgetType)
      isCapsule = !!Number(widget?.is_capsule)
    } catch (e) { /* 读取失败按展开形态处理 */ }
    // 最小尺寸约束：
    //   展开形态：minWidth/minHeight（如 note 200×240）
    //   胶囊形态：capsuleMinWidth/capsuleHeight（如 note 144×42），保证胶囊不被拉大
    const minWidth = isCapsule
      ? (def?.capsuleMinWidth ?? 144)
      : (def?.minWidth ?? 160)
    const minHeight = isCapsule
      ? (def?.capsuleHeight ?? 42)
      : (def?.minHeight ?? 120)
    // 计算窗口尺寸：取内容尺寸与最小尺寸的较大值
    let windowWidth = Math.max(contentWidth, minWidth)
    let windowHeight = Math.max(contentHeight, minHeight)
    // 胶囊形态下夹取上限：不超过胶囊标准宽度/智能高度，避免内容溢出撑大胶囊
    if (isCapsule) {
      const capsuleMaxWidth = def?.capsuleSmartWidth ?? 272
      const capsuleMaxHeight = def?.capsuleSmartHeight ?? 52
      windowWidth = Math.min(windowWidth, capsuleMaxWidth)
      windowHeight = Math.min(windowHeight, capsuleMaxHeight)
    }
    // 夹取上限：不超过当前显示器 workArea 宽度，高度不超过 workArea 高度的 80%
    try {
      const display = screen.getDisplayMatching(currentBounds)
      const workArea = display.workArea
      windowWidth = Math.min(windowWidth, workArea.width)
      windowHeight = Math.min(windowHeight, Math.floor(workArea.height * 0.8))
    } catch (e) { /* 忽略显示器查询失败，使用计算值 */ }

    // 保留 x/y，仅调整宽高
    const targetBounds = {
      x: currentBounds.x,
      y: currentBounds.y,
      width: Math.round(windowWidth),
      height: Math.round(windowHeight)
    }
    win.setBounds(targetBounds)
    // 节流持久化
    persistBoundsThrottled(widgetType, targetBounds)
    logger.debug('WidgetWindowManager', `小部件 ${widgetType} 自适应尺寸: ${targetBounds.width}x${targetBounds.height}${isCapsule ? ' (胶囊)' : ''}`)
  } catch (error) {
    logger.error('WidgetWindowManager', `resizeToContent(${widgetType}) 失败: ${error.message}`)
  }
}

// ============================================================
// 拖拽控制（主进程接管，避免透明窗口抖动）
// ============================================================

/**
 * 获取所有其他小部件的 bounds（排除指定类型）
 * 用于小部件间吸附对齐
 * @param {string} excludeType - 排除的小部件类型（通常是当前正在拖拽的）
 * @returns {Array<{widgetType, bounds}>}
 */
function getOtherWidgetBounds (excludeType) {
  const result = []
  for (const [widgetType, win] of widgetWindows) {
    if (widgetType === excludeType) continue
    if (win && !win.isDestroyed() && win.isVisible()) {
      try {
        result.push({
          widgetType,
          bounds: win.getBounds()
        })
      } catch (e) { /* 忽略已销毁窗口 */ }
    }
  }
  return result
}

/**
 * 查找吸附在指定小部件指定边缘的其他小部件
 * 用于 will-resize 联动：当用户 resize 改变某部件边缘位置时，
 *   同步移动吸附在该边缘的其他部件，保持吸附关系
 * @param {string} widgetType - 当前 resize 的小部件类型
 * @param {object} currentBounds - 当前小部件的 bounds { x, y, width, height }
 * @param {string[]} edges - 受影响的边缘数组，元素为 'left'|'right'|'top'|'bottom'
 * @param {number} [threshold] - 吸附判定阈值（像素），默认 WIDGET_SNAP_THRESHOLD
 * @returns {Array<{widgetType, bounds, snapEdge}>} 需要联动的部件列表
 *   snapEdge: 'left'|'right'|'top'|'bottom' 表示该部件吸附在 currentBounds 的哪个边缘
 */
function getSnappedWidgets (widgetType, currentBounds, edges, threshold) {
  if (!currentBounds || !Array.isArray(edges) || edges.length === 0) return []
  const snapThreshold = (typeof threshold === 'number' && threshold > 0) ? threshold : WIDGET_SNAP_THRESHOLD
  const result = []
  // 当前小部件的四个边缘
  const myLeft = currentBounds.x
  const myRight = currentBounds.x + currentBounds.width
  const myTop = currentBounds.y
  const myBottom = currentBounds.y + currentBounds.height

  for (const [otherType, win] of widgetWindows) {
    if (otherType === widgetType) continue
    if (!win || win.isDestroyed() || !win.isVisible()) continue
    try {
      const otherBounds = win.getBounds()
      const otherLeft = otherBounds.x
      const otherRight = otherBounds.x + otherBounds.width
      const otherTop = otherBounds.y
      const otherBottom = otherBounds.y + otherBounds.height

      // 检查每个受影响的边缘
      // 当前部件右边缘被拖动 → 检查其他部件左边缘是否吸附在当前右边缘
      if (edges.includes('right')) {
        if (Math.abs(otherLeft - myRight) < snapThreshold) {
          // 仅当 y 区间有重叠时才算吸附（避免远处部件被误判）
          if (otherBottom > myTop && otherTop < myBottom) {
            result.push({ widgetType: otherType, bounds: otherBounds, snapEdge: 'right' })
            continue
          }
        }
      }
      // 当前部件左边缘被拖动 → 检查其他部件右边缘是否吸附在当前左边缘
      if (edges.includes('left')) {
        if (Math.abs(otherRight - myLeft) < snapThreshold) {
          if (otherBottom > myTop && otherTop < myBottom) {
            result.push({ widgetType: otherType, bounds: otherBounds, snapEdge: 'left' })
            continue
          }
        }
      }
      // 当前部件下边缘被拖动 → 检查其他部件上边缘是否吸附在当前下边缘
      if (edges.includes('bottom')) {
        if (Math.abs(otherTop - myBottom) < snapThreshold) {
          if (otherRight > myLeft && otherLeft < myRight) {
            result.push({ widgetType: otherType, bounds: otherBounds, snapEdge: 'bottom' })
            continue
          }
        }
      }
      // 当前部件上边缘被拖动 → 检查其他部件下边缘是否吸附在当前上边缘
      if (edges.includes('top')) {
        if (Math.abs(otherBottom - myTop) < snapThreshold) {
          if (otherRight > myLeft && otherLeft < myRight) {
            result.push({ widgetType: otherType, bounds: otherBounds, snapEdge: 'top' })
            continue
          }
        }
      }
    } catch (e) { /* 忽略已销毁窗口 */ }
  }
  return result
}

/**
 * 同步联动吸附在当前部件边缘的其他部件
 * 当当前部件 resize 导致边缘移动时，同步移动吸附在该边缘的部件
 * @param {string} widgetType - 当前 resize 的小部件类型
 * @param {object} oldBounds - resize 前的 bounds
 * @param {object} newBounds - resize 后的 bounds
 * @param {string[]} affectedEdges - 受影响的边缘数组 'left'|'right'|'top'|'bottom'
 */
function syncSnappedWidgets (widgetType, oldBounds, newBounds, affectedEdges) {
  if (!oldBounds || !newBounds || !Array.isArray(affectedEdges) || affectedEdges.length === 0) return
  // 找出吸附在受影响边缘的部件
  const snappedWidgets = getSnappedWidgets(widgetType, oldBounds, affectedEdges)
  if (snappedWidgets.length === 0) return

  for (const item of snappedWidgets) {
    const win = widgetWindows.get(item.widgetType)
    if (!win || win.isDestroyed()) continue
    try {
      const otherBounds = item.bounds
      let targetBounds = { ...otherBounds }
      let moved = false

      // 根据吸附边缘计算同步移动量
      switch (item.snapEdge) {
        case 'right': {
          // 其他部件左边缘吸附在当前右边缘 → 同步移动 x
          const oldMyRight = oldBounds.x + oldBounds.width
          const newMyRight = newBounds.x + newBounds.width
          const deltaX = newMyRight - oldMyRight
          if (deltaX !== 0) {
            targetBounds.x = otherBounds.x + deltaX
            moved = true
          }
          break
        }
        case 'left': {
          // 其他部件右边缘吸附在当前左边缘 → 同步移动 x
          const deltaX = newBounds.x - oldBounds.x
          if (deltaX !== 0) {
            targetBounds.x = otherBounds.x + deltaX
            moved = true
          }
          break
        }
        case 'bottom': {
          // 其他部件上边缘吸附在当前下边缘 → 同步移动 y
          const oldMyBottom = oldBounds.y + oldBounds.height
          const newMyBottom = newBounds.y + newBounds.height
          const deltaY = newMyBottom - oldMyBottom
          if (deltaY !== 0) {
            targetBounds.y = otherBounds.y + deltaY
            moved = true
          }
          break
        }
        case 'top': {
          // 其他部件下边缘吸附在当前上边缘 → 同步移动 y
          const deltaY = newBounds.y - oldBounds.y
          if (deltaY !== 0) {
            targetBounds.y = otherBounds.y + deltaY
            moved = true
          }
          break
        }
      }

      if (moved) {
        win.setBounds(targetBounds)
        persistBoundsThrottled(item.widgetType, targetBounds)
        logger.debug('WidgetWindowManager', `syncSnappedWidgets: ${item.widgetType} ` +
          `跟随 ${widgetType} ${item.snapEdge} 边缘联动 → x=${targetBounds.x}, y=${targetBounds.y}`)
      }
    } catch (e) { /* 忽略联动失败 */ }
  }
}

/**
 * 获取所有可见小部件窗口的 bounds
 * 用于分组拖放命中测试等场景，返回所有当前可见的小部件窗口位置信息
 * @returns {Array<{widgetType: string, bounds: {x: number, y: number, width: number, height: number}}>}
 */
function getAllWidgetBounds () {
  const result = []
  for (const [widgetType, win] of widgetWindows) {
    if (win && !win.isDestroyed() && win.isVisible()) {
      try {
        result.push({
          widgetType,
          bounds: win.getBounds()
        })
      } catch (e) { /* 忽略已销毁窗口 */ }
    }
  }
  return result
}

/**
 * 吸附到屏幕边缘 + 其他小部件边缘
 * 委托 widget-snap.js 纯模块计算最优吸附候选：
 *   snapToEdges(bounds, { workArea, others, threshold, widgetThreshold })
 *   返回吸附后的 bounds
 * 本函数在拿到吸附后 bounds 的同时，推断吸附发生的边和目标，用于渲染层引导线
 * @param {object} bounds - 当前窗口的 { x, y, width, height }
 * @param {string} [widgetType] - 当前小部件类型（排除自身，可选）
 * @returns {object} { bounds, edges, target }
 *   - bounds: 吸附后的 { x, y, width, height }
 *   - edges: 吸附发生的边数组，元素为 'left'|'right'|'top'|'bottom'，空数组表示未吸附
 *   - target: 吸附目标 'screen' 或其他小部件 widgetType，未吸附时为 null
 */
function snapToEdges (bounds, widgetType) {
  try {
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const others = getOtherWidgetBounds(widgetType)

    let snapped
    if (widgetSnap && typeof widgetSnap.snapToEdges === 'function') {
      // 调用纯模块计算吸附（契约：返回吸附后 bounds）
      snapped = widgetSnap.snapToEdges(bounds, {
        workArea,
        others: others.map(o => o.bounds),
        threshold: SNAP_THRESHOLD,
        widgetThreshold: WIDGET_SNAP_THRESHOLD
      })
    } else {
      // widget-snap.js 不可用：降级为不吸附
      snapped = bounds
    }

    // 推断吸附信息（边 + 目标），用于渲染层显示高亮引导线
    const edges = []
    let target = null
    const moved = snapped.x !== bounds.x || snapped.y !== bounds.y
    if (moved) {
      // 检查屏幕边缘吸附
      if (snapped.x === workArea.x) {
        edges.push('left')
        target = 'screen'
      }
      if (snapped.x + snapped.width === workArea.x + workArea.width) {
        edges.push('right')
        target = 'screen'
      }
      if (snapped.y === workArea.y) {
        edges.push('top')
        target = 'screen'
      }
      if (snapped.y + snapped.height === workArea.y + workArea.height) {
        edges.push('bottom')
        target = 'screen'
      }
      // 若未匹配屏幕边缘，检查是否吸附到其他小部件
      if (edges.length === 0) {
        for (const other of others) {
          const ob = other.bounds
          // 左边贴合其他窗口右边 / 左边对齐
          if (snapped.x === ob.x + ob.width || snapped.x === ob.x) {
            edges.push('left')
            target = other.widgetType
          }
          // 右边贴合其他窗口左边 / 右边对齐
          if (snapped.x + snapped.width === ob.x ||
              snapped.x + snapped.width === ob.x + ob.width) {
            edges.push('right')
            target = other.widgetType
          }
          // 上边贴合其他窗口下边 / 上边对齐
          if (snapped.y === ob.y + ob.height || snapped.y === ob.y) {
            edges.push('top')
            target = other.widgetType
          }
          // 下边贴合其他窗口上边 / 下边对齐
          if (snapped.y + snapped.height === ob.y ||
              snapped.y + snapped.height === ob.y + ob.height) {
            edges.push('bottom')
            target = other.widgetType
          }
          if (edges.length > 0) break
        }
      }
    }

    return { bounds: snapped, edges, target }
  } catch (error) {
    logger.warn('WidgetWindowManager', `snapToEdges 失败: ${error.message}`)
    return { bounds, edges: [], target: null }
  }
}

/**
 * 初始化拖拽 IPC 监听
 * 渲染进程 mousedown 时通过 widget:drag:start 通知主进程接管
 * 主进程通过 win.setBounds 控制窗口移动，mouseup 时结束
 * 拖拽过程中调用 snapToEdges 实现屏幕边缘吸附 + 小部件间吸附对齐
 * 吸附发生时向渲染进程推送 widget:snap-guide 事件，用于显示高亮引导线
 * 拖拽结束时捕获多显示器锚点，用于拓扑变化后恢复位置
 */
function initDragIpc () {
  ipcMain.on('widget:drag:start', (event, data) => {
    // 防御性校验：data 必须为对象，widgetType 必须为合法类型，坐标必须为数字
    if (!data || typeof data !== 'object') {
      logger.warn('WidgetWindowManager', 'widget:drag:start 收到无效 data 格式')
      return
    }
    const { widgetType, startX, startY } = data
    if (!widgetRegistry.isValidType(widgetType)) {
      logger.warn('WidgetWindowManager', `widget:drag:start 收到非法 widgetType: ${widgetType}`)
      return
    }
    if (typeof startX !== 'number' || typeof startY !== 'number' || !Number.isFinite(startX) || !Number.isFinite(startY)) {
      logger.warn('WidgetWindowManager', `widget:drag:start 收到非法坐标: (${startX}, ${startY})`)
      return
    }
    const win = widgetWindows.get(widgetType)
    if (!win || win.isDestroyed()) return

    const startBounds = win.getBounds()
    dragState.set(widgetType, { startX, startY, startBounds })
    // 通知层服务拖拽开始（临时提升 Z 序）
    notifyLayerServiceDragStart(widgetType)
    logger.debug('WidgetWindowManager', `小部件 ${widgetType} 开始拖拽: (${startX}, ${startY})`)
  })

  ipcMain.on('widget:drag:move', (event, data) => {
    // 防御性校验：data 必须为对象，widgetType 必须为合法类型，坐标必须为数字
    if (!data || typeof data !== 'object') {
      logger.warn('WidgetWindowManager', 'widget:drag:move 收到无效 data 格式')
      return
    }
    const { widgetType, x, y } = data
    if (!widgetRegistry.isValidType(widgetType)) {
      logger.warn('WidgetWindowManager', `widget:drag:move 收到非法 widgetType: ${widgetType}`)
      return
    }
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      logger.warn('WidgetWindowManager', `widget:drag:move 收到非法坐标: (${x}, ${y})`)
      return
    }
    const state = dragState.get(widgetType)
    const win = widgetWindows.get(widgetType)
    if (!state || !win || win.isDestroyed()) return

    const dx = x - state.startX
    const dy = y - state.startY
    const newBounds = {
      x: state.startBounds.x + dx,
      y: state.startBounds.y + dy,
      width: state.startBounds.width,
      height: state.startBounds.height
    }
    // 边缘吸附：委托 widget-snap.js 计算最优候选
    const snapResult = snapToEdges(newBounds, widgetType)
    win.setBounds(snapResult.bounds)
    // 推送吸附引导事件：吸附发生时显示高亮引导线，未发生时清除引导
    try {
      if (snapResult.edges.length > 0) {
        win.webContents.send('widget:snap-guide', {
          widgetType,
          edges: snapResult.edges,
          target: snapResult.target
        })
      } else {
        win.webContents.send('widget:snap-guide', { widgetType, edges: [] })
      }
    } catch (e) { /* 忽略发送失败 */ }
  })

  ipcMain.on('widget:drag:end', (event, data) => {
    // 防御性校验：data 必须为对象，widgetType 必须为合法类型
    if (!data || typeof data !== 'object') {
      logger.warn('WidgetWindowManager', 'widget:drag:end 收到无效 data 格式')
      return
    }
    const { widgetType } = data
    if (!widgetRegistry.isValidType(widgetType)) {
      logger.warn('WidgetWindowManager', `widget:drag:end 收到非法 widgetType: ${widgetType}`)
      return
    }
    const state = dragState.get(widgetType)
    const win = widgetWindows.get(widgetType)
    if (state && win && !win.isDestroyed()) {
      // 拖拽结束时再次吸附（确保最终位置对齐边缘和其他小部件）
      const snapResult = snapToEdges(win.getBounds(), widgetType)
      win.setBounds(snapResult.bounds)
      // 清除吸附引导
      try {
        win.webContents.send('widget:snap-guide', { widgetType, edges: [] })
      } catch (e) { /* 忽略 */ }
      // 立即持久化最终位置
      const finalBounds = snapResult.bounds
      try {
        const widget = widgetDao.getByType(widgetType)
        if (widget) {
          widgetDao.updateBounds(widget.id, finalBounds)
        }
      } catch (error) {
        logger.error('WidgetWindowManager', `拖拽结束持久化失败: ${error.message}`)
      }
      // 捕获多显示器锚点（内存缓存，用于拓扑变化后恢复）
      captureAnchor(widgetType, finalBounds)
    }
    dragState.delete(widgetType)
    // 通知层服务拖拽结束（恢复 Z 序策略）
    notifyLayerServiceDragEnd(widgetType)
    logger.debug('WidgetWindowManager', `小部件 ${widgetType} 拖拽结束`)
  })
}

// ============================================================
// 批量初始化 / 销毁
// ============================================================

/**
 * 启动时初始化所有启用的小部件
 * 从 DAO 读取所有 is_enabled = 1 的小部件，批量创建窗口
 */
function initAllWidgets () {
  try {
    // 初始化拖拽 IPC 监听
    initDragIpc()

    const widgets = widgetDao.list()
    let created = 0
    for (const w of widgets) {
      // 跳过 quick-capture（已合并为 note/随记便笺，不再创建独立窗口）
      if (w.widget_type === 'quick-capture') continue
      if (w.is_enabled) {
        // 单个小部件恢复失败不影响其他小部件初始化
        try {
          const win = createWidgetWindow(w.widget_type)
          if (win) {
            created++
            // 恢复胶囊状态：createWidgetWindow 已恢复位置/大小/锁定状态，
            //   此处补充胶囊形态恢复（折叠为胶囊尺寸）
            //   collapse_behavior 由渲染进程通过 IPC 读取配置处理（已有逻辑）
            if (Number(w.is_capsule) === 1) {
              try {
                setWidgetCapsule(w.widget_type, true)
              } catch (capsuleErr) {
                // 胶囊恢复失败不影响窗口可用性，记录后继续
                logger.warn('WidgetWindowManager',
                  `initAllWidgets 恢复胶囊状态失败 (${w.widget_type}): ${capsuleErr.message}`)
              }
            }
            // 不可见的不显示
            if (!w.is_visible) {
              win.hide()
            }
          }
        } catch (widgetErr) {
          // 单个小部件创建/恢复失败：记录错误，继续初始化其他小部件
          logger.error('WidgetWindowManager',
            `initAllWidgets 初始化小部件 ${w.widget_type} 失败: ${widgetErr.message}`)
        }
      }
    }
    logger.info('WidgetWindowManager', `初始化完成，已创建 ${created} 个小部件窗口`)
  } catch (error) {
    logger.error('WidgetWindowManager', `initAllWidgets 失败: ${error.message}`)
  }
}

/**
 * 退出时销毁所有小部件窗口
 */
function destroyAllWidgets () {
  for (const widgetType of Array.from(widgetWindows.keys())) {
    destroyWidgetWindow(widgetType)
  }
  // 清理所有节流定时器
  for (const timer of boundsPersistTimers.values()) {
    clearTimeout(timer)
  }
  boundsPersistTimers.clear()
  // 清理拖拽状态
  dragState.clear()
  // 清理多显示器锚点缓存
  widgetAnchors.clear()
  // 清理胶囊切换中标记与展开尺寸缓存
  capsuleSwitchingFlags.clear()
  expandedBoundsCache.clear()
  // 清理材质缓存（问题 c）
  lastAppliedMaterial.clear()
  // 清理显隐动画定时器与标记（确保退出时所有 setInterval 已停止）
  for (const timer of animationTimers.values()) clearInterval(timer)
  animationTimers.clear()
  animatingFlags.clear()
  hiddenExpandedBounds.clear()
  // 清理 resize 相关残留状态
  resizeReentryFlags.clear()
  userResizingFlags.clear()
  resizeSnapLock.clear()
  // 清理胶囊栏配置
  capsuleBars.clear()
  // 清理新模块集成状态（表面注册表/层服务）
  destroyIntegrationState()

  logger.info('WidgetWindowManager', '所有小部件窗口已销毁')
}

// ============================================================
// 窗口材质管理（default / mica / acrylic）
// 原生 backgroundMaterial（Win11 22H2+）提供系统材质，渲染层 CSS 半透明 tint 叠加
// ============================================================

/**
 * 获取当前材质配置
 * 从 app_settings 表读取，默认 'mica'
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
 * 应用材质效果到单个窗口
 * 原生 backgroundMaterial（Win11 22H2+）提供系统材质，渲染层 CSS 仅做半透明 tint 叠加
 *   3 种材质：default（不透明）/ mica（云母）/ acrylic（亚克力）
 *   非 Win11 22H2+ 降级：跳过 setBackgroundMaterial，仅渲染层半透明 tint 模拟
 * 应用后向该窗口渲染进程推送 widget:material-changed 事件
 * @param {BrowserWindow} win
 * @param {string} material - 'default' | 'mica' | 'acrylic'
 */
function applyMaterial (win, material) {
  try {
    if (!win || win.isDestroyed()) return
    // 解析材质
    const resolved = resolveMaterial(material)

    // Electron 43+ 原生材质：setBackgroundMaterial 支持 'mica' | 'acrylic' | 'tabbed' | 'none' | 'auto'
    // 映射 default → none（不透明），其余直接传递
    // 仅 Win11 22H2+ 调用（Electron 文档：setBackgroundMaterial 仅支持 Win11 22H2+）
    // 低版本降级：跳过原生材质，由渲染层半透明 tint 模拟
    const nativeMaterialMap = { default: 'none', mica: 'mica', acrylic: 'acrylic' }
    const nativeMaterial = nativeMaterialMap[resolved] || 'none'
    if (isWin11()) {
      try {
        if (typeof win.setBackgroundMaterial === 'function') {
          win.setBackgroundMaterial(nativeMaterial)
          logger.info('WidgetWindowManager', `原生材质已设置: setBackgroundMaterial('${nativeMaterial}')`)
          // 更新材质缓存：记录该窗口最近应用的材质
          //   供 blur 事件防抖检查使用，避免同值重设导致频闪（问题 c）
          for (const [type, w] of widgetWindows) {
            if (w === win) {
              lastAppliedMaterial.set(type, resolved)
              break
            }
          }
        }
      } catch (e) {
        logger.warn('WidgetWindowManager', `setBackgroundMaterial 失败: ${e.message}`)
      }
    } else {
      logger.info('WidgetWindowManager', `非 Win11 22H2+，跳过原生材质，由渲染层 tint 模拟: ${resolved}`)
    }

    // 缓存实际生效材质
    effectiveMaterialCache = resolved
    logger.info('WidgetWindowManager', `材质已应用: ${material} -> 实际生效: ${resolved}`)

    // 更新窗口 backgroundColor：default 材质不透明防止溢出显示白色，mica/acrylic 透明
    try {
      const theme = appSettingDao.get('theme') || 'light'
      const isDark = theme === 'dark'
      const bgColors = {
        default: isDark ? '#1F1F1F' : '#F3F3F3',
        mica: '#00000000',
        acrylic: '#00000000'
      }
      win.setBackgroundColor(bgColors[resolved] || '#00000000')
    } catch (e) { /* 忽略 backgroundColor 更新失败 */ }

    // 向该窗口渲染进程推送材质变更事件
    // 通过 widgetWindows 反查 widgetType
    let widgetType = null
    for (const [type, w] of widgetWindows) {
      if (w === win) {
        widgetType = type
        break
      }
    }
    if (widgetType) {
      try {
        win.webContents.send('widget:material-changed', { widgetType, material: resolved })
      } catch (e) { /* 忽略发送失败 */ }
    }
  } catch (e) {
    // 降级：忽略材质应用失败
    logger.warn('WidgetWindowManager', `应用材质 ${material} 失败: ${e.message}`)
  }
}

/**
 * 动态切换所有小部件的材质
 * 持久化配置并应用到所有已创建的小部件窗口
 * 应用后向每个窗口渲染进程推送 widget:material-changed 事件
 * @param {string} material - 'default' | 'mica' | 'acrylic'
 */
function setMaterial (material) {
  // 校验材质类型
  if (!VALID_MATERIALS.includes(material)) {
    logger.warn('WidgetWindowManager', `未知材质类型: ${material}，忽略`)
    return
  }
  // 持久化配置
  try {
    appSettingDao.set(MATERIAL_KEY, material)
  } catch (e) {
    logger.warn('WidgetWindowManager', `持久化材质配置失败: ${e.message}`)
  }
  // 应用到所有已创建的小部件窗口（applyMaterial 内部已推送 widget:material-changed 事件）
  for (const [widgetType, win] of widgetWindows) {
    if (win && !win.isDestroyed()) {
      applyMaterial(win, material)
    }
  }
  logger.info('WidgetWindowManager', `已切换所有小部件材质为: ${material}`)
}

/**
 * 获取当前实际生效的材质（降级后）
 * 返回 applyMaterial 最近一次应用后的实际材质；未应用过则返回降级解析结果
 * @returns {string} 'default' | 'mica' | 'acrylic'
 */
function getEffectiveMaterial () {
  if (effectiveMaterialCache) return effectiveMaterialCache
  return resolveMaterial(getMaterial())
}

/**
 * 获取所有已创建小部件窗口的类型列表
 * 用于向所有小部件窗口广播事件（如强调色变化）
 * @returns {string[]}
 */
function getWidgetWindowTypes () {
  return Array.from(widgetWindows.keys())
}

// ============================================================
// 胶囊栏（多胶囊收纳）管理
// 将多个折叠为胶囊的小部件排列成一条水平/垂直的栏
// 复用 arrangement-calculator 计算位置，order-calculator 处理拖拽排序
// 不影响现有的单胶囊功能（setWidgetCapsule 等）
// ============================================================

/**
 * 根据锚点在工作区的象限判定位置锚点角
 * 参考 captureAnchor 的象限判定逻辑
 * @param {{x: number, y: number}} anchorPoint - 锚点
 * @param {{x: number, y: number, width: number, height: number}} workArea - 工作区
 * @returns {string} 'LeftTop' | 'RightTop' | 'LeftBottom' | 'RightBottom'
 */
function resolvePositionAnchor (anchorPoint, workArea) {
  const isLeft = anchorPoint.x < workArea.x + workArea.width / 2
  const isTop = anchorPoint.y < workArea.y + workArea.height / 2
  if (isLeft && isTop) return 'LeftTop'
  if (!isLeft && isTop) return 'RightTop'
  if (isLeft && !isTop) return 'LeftBottom'
  return 'RightBottom'
}

/**
 * 获取指定小部件的胶囊尺寸（用于排列计算）
 * 优先使用 widgetRegistry 定义的胶囊尺寸，回退到默认尺寸
 * @param {string} widgetType
 * @returns {{width: number, height: number}}
 */
function getCapsuleSize (widgetType) {
  const def = widgetRegistry.getDefinition(widgetType)
  if (def) {
    return {
      width: def.capsuleStandardWidth || 248,
      height: def.capsuleHeight || 42
    }
  }
  return { width: 248, height: 42 }
}

/**
 * 创建胶囊栏：将多个小部件收纳为一条水平/垂直的胶囊栏
 * 算法：
 *   1. 校验 widgetTypes 都是合法类型
 *   2. 确定锚点：取第一个已存在窗口的位置，或工作区左上角
 *   3. 确定工作区：锚点所在显示器
 *   4. 确定 positionAnchor：根据锚点在工作区象限判断（或使用传入值）
 *   5. 存储胶囊栏配置
 *   6. 调用 arrangeCapsuleBar 计算并应用位置
 * @param {string[]} widgetTypes - 栏内小部件类型列表（有序）
 * @param {string} direction - 'horizontal' | 'vertical'
 * @param {object} [options] - 可选配置
 *   - barId: string 自定义栏 ID（默认自动生成）
 *   - positionAnchor: string 锚点角（默认根据象限自动判定）
 *   - spacing: number 胶囊间距（默认 8）
 *   - anchorPoint: { x, y } 锚点（默认取第一个窗口位置）
 * @returns {string|null} 栏 ID；失败返回 null
 */
function createCapsuleBar (widgetTypes, direction, options = {}) {
  // 校验入参
  if (!Array.isArray(widgetTypes) || widgetTypes.length === 0) {
    logger.warn('WidgetWindowManager', 'createCapsuleBar 失败：widgetTypes 为空')
    return null
  }
  if (direction !== 'horizontal' && direction !== 'vertical') {
    logger.warn('WidgetWindowManager', `createCapsuleBar 失败：非法方向 ${direction}`)
    return null
  }
  // 校验每个类型合法
  for (const type of widgetTypes) {
    if (!widgetRegistry.isValidType(type)) {
      logger.warn('WidgetWindowManager', `createCapsuleBar 失败：未知小部件类型 ${type}`)
      return null
    }
  }

  // 生成或使用传入的 barId
  const barId = options.barId || `bar-${widgetTypes.join('-')}-${Date.now()}`
  // 间距
  const spacing = typeof options.spacing === 'number' && options.spacing >= 0
    ? options.spacing
    : DEFAULT_CAPSULE_BAR_SPACING

  // 确定锚点：优先使用传入值，否则取第一个已存在窗口的位置
  let anchorPoint = options.anchorPoint
  if (!anchorPoint) {
    const firstWin = widgetWindows.get(widgetTypes[0])
    if (firstWin && !firstWin.isDestroyed()) {
      const b = firstWin.getBounds()
      anchorPoint = { x: b.x, y: b.y }
    } else {
      // 窗口未创建：使用默认位置
      const def = widgetRegistry.getDefinition(widgetTypes[0])
      anchorPoint = { x: def?.defaultX || 100, y: def?.defaultY || 100 }
    }
  }

  // 确定工作区：锚点所在显示器
  let workArea
  try {
    const display = screen.getDisplayMatching({ x: anchorPoint.x, y: anchorPoint.y, width: 1, height: 1 })
    workArea = display.workArea
  } catch (e) {
    // 回退到主显示器
    workArea = screen.getPrimaryDisplay().workArea
  }

  // 确定位置锚点角：优先使用传入值，否则根据象限判定
  const positionAnchor = options.positionAnchor || resolvePositionAnchor(anchorPoint, workArea)

  // 存储胶囊栏配置
  const barConfig = {
    barId,
    widgetTypes: widgetTypes.slice(),
    direction,
    positionAnchor,
    spacing,
    anchorPoint: { ...anchorPoint },
    workArea: { ...workArea }
  }
  capsuleBars.set(barId, barConfig)

  // 立即排列
  arrangeCapsuleBar(barId)
  logger.info('WidgetWindowManager', `胶囊栏 ${barId} 已创建：${widgetTypes.length} 个胶囊，方向 ${direction}`)
  return barId
}

/**
 * 排列胶囊栏：调用 arrangement-calculator 计算每个胶囊的目标位置并应用
 * 算法：
 *   1. 读取胶囊栏配置
 *   2. 为每个 widgetType 构建 arrangement item { id, width, height }
 *   3. 调用 capsuleArrangementCalculator.calculate 计算位置
 *   4. 对每个 widgetType，应用计算出的 bounds 到窗口（若窗口存在）
 *   5. 持久化位置
 * @param {string} barId - 栏 ID
 * @returns {boolean} 是否成功
 */
function arrangeCapsuleBar (barId) {
  const config = capsuleBars.get(barId)
  if (!config) {
    logger.warn('WidgetWindowManager', `arrangeCapsuleBar 失败：未知栏 ID ${barId}`)
    return false
  }

  // 构建 arrangement items
  const items = config.widgetTypes.map(type => {
    const size = getCapsuleSize(type)
    return { id: type, width: size.width, height: size.height }
  })

  // 调用排列计算器
  const results = capsuleArrangementCalculator.calculate(
    items,
    config.workArea,
    config.anchorPoint,
    config.positionAnchor,
    config.direction,
    config.spacing
  )

  // 应用位置到每个窗口
  for (const type of config.widgetTypes) {
    const bounds = results[type]
    if (!bounds) continue
    const win = widgetWindows.get(type)
    if (win && !win.isDestroyed()) {
      try {
        win.setBounds(bounds)
        // 持久化位置
        persistBoundsThrottled(type, bounds)
      } catch (e) {
        logger.warn('WidgetWindowManager', `arrangeCapsuleBar 应用位置到 ${type} 失败: ${e.message}`)
      }
    }
  }

  logger.debug('WidgetWindowManager', `胶囊栏 ${barId} 已排列`)
  return true
}

/**
 * 重排胶囊栏：更新栏内小部件顺序并重新排列
 * 算法：
 *   1. 读取胶囊栏配置
 *   2. 调用 order-calculator.mergeGroupOrder 合并新顺序到全局（若有全局排序）
 *   3. 更新配置中的 widgetTypes 顺序
 *   4. 调用 arrangeCapsuleBar 重新排列
 * @param {string} barId - 栏 ID
 * @param {string[]} newOrder - 新的 widgetType 顺序
 * @returns {boolean} 是否成功
 */
function reorderCapsuleBar (barId, newOrder) {
  const config = capsuleBars.get(barId)
  if (!config) {
    logger.warn('WidgetWindowManager', `reorderCapsuleBar 失败：未知栏 ID ${barId}`)
    return false
  }
  if (!Array.isArray(newOrder) || newOrder.length !== config.widgetTypes.length) {
    logger.warn('WidgetWindowManager', `reorderCapsuleBar 失败：新顺序长度不匹配`)
    return false
  }
  // 校验新顺序包含的元素与原顺序一致
  const oldSet = new Set(config.widgetTypes)
  const newSet = new Set(newOrder)
  if (oldSet.size !== newSet.size || !newOrder.every(t => oldSet.has(t))) {
    logger.warn('WidgetWindowManager', `reorderCapsuleBar 失败：新顺序元素与原顺序不一致`)
    return false
  }

  // 更新配置顺序
  config.widgetTypes = newOrder.slice()
  capsuleBars.set(barId, config)

  // 重新排列
  arrangeCapsuleBar(barId)
  logger.info('WidgetWindowManager', `胶囊栏 ${barId} 已重排：${newOrder.join(', ')}`)
  return true
}

/**
 * 拖拽时将胶囊移动到最近槽位并重排
 * 封装 capsuleOrderCalculator.moveToNearestSlot，计算新顺序后调用 reorderCapsuleBar
 * @param {string} barId - 栏 ID
 * @param {string} activeType - 正在拖拽的小部件类型
 * @param {{x: number, y: number, width: number, height: number}} proposedBounds - 拖拽提议的新位置
 * @returns {string[]|null} 新的顺序；失败返回 null
 */
function moveCapsuleToNearestSlot (barId, activeType, proposedBounds) {
  const config = capsuleBars.get(barId)
  if (!config) return null

  // 构建槽位 bounds：当前每个胶囊的实际位置
  const slotBounds = []
  for (const type of config.widgetTypes) {
    const win = widgetWindows.get(type)
    if (win && !win.isDestroyed()) {
      slotBounds.push(win.getBounds())
    } else {
      // 窗口不存在：用胶囊尺寸占位
      const size = getCapsuleSize(type)
      slotBounds.push({ x: 0, y: 0, width: size.width, height: size.height })
    }
  }

  // 调用排序计算器
  const newOrder = capsuleOrderCalculator.moveToNearestSlot(
    config.widgetTypes,
    slotBounds,
    activeType,
    proposedBounds,
    config.direction
  )

  // 应用重排
  reorderCapsuleBar(barId, newOrder)
  return newOrder
}

/**
 * 销毁胶囊栏：从内存中移除配置（不影响小部件窗口本身）
 * @param {string} barId - 栏 ID
 */
function destroyCapsuleBar (barId) {
  if (capsuleBars.delete(barId)) {
    logger.info('WidgetWindowManager', `胶囊栏 ${barId} 已销毁`)
  }
}

/**
 * 获取胶囊栏配置
 * @param {string} barId - 栏 ID
 * @returns {object|null}
 */
function getCapsuleBar (barId) {
  return capsuleBars.get(barId) || null
}

/**
 * 获取所有胶囊栏 ID 列表
 * @returns {string[]}
 */
function getCapsuleBarIds () {
  return Array.from(capsuleBars.keys())
}

module.exports = {
  createWidgetWindow,
  destroyWidgetWindow,
  showWidget,
  hideWidget,
  showAllWidgets,
  hideAllWidgets,
  toggleAllWidgets,
  resetAllWidgets,
  getWidgetWindow,
  getWidgetWindowTypes,
  updateWidgetBounds,
  getAllWidgetBounds,
  setWidgetCapsule,
  setCapsule,
  togglePositionLock,
  toggleSizeLock,
  resetPosition,
  toggleAlwaysOnTop,
  resizeToContent,
  initAllWidgets,
  destroyAllWidgets,
  setAppWillQuit,
  // 窗口材质控制
  getMaterial,
  setMaterial,
  applyMaterial,
  getEffectiveMaterial,
  // 隐藏/显示动画控制
  animateHideWidget,
  animateShowWidget,
  getAnimationEnabled,
  setAnimationEnabled,
  // 胶囊栏（多胶囊收纳）管理
  createCapsuleBar,
  arrangeCapsuleBar,
  reorderCapsuleBar,
  moveCapsuleToNearestSlot,
  destroyCapsuleBar,
  getCapsuleBar,
  getCapsuleBarIds,
  // 新模块集成接口
  initLayerService,
  initSurfaceRegistry,
  setWindowsCompatInfo,
  getWindowsCompatInfo,
  handleDisplaysChanged,
  handleLifecycleRecovery
}