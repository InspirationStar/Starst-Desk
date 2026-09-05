// ============================================================
// Windows 兼容性服务（独立模块）
// 职责：
//   1. 检测当前 Windows 系统 build 号、是否 Win11+
//   2. 检测系统是否支持 Mica / DesktopAcrylic 材质
//   3. 解析小部件材质类型（Win10 自动降级 Mica → Acrylic）
//   4. 为 BrowserWindow 应用安全材质（按能力降级 Mica → Acrylic → Solid）
//   5. 检测系统动画 / 高级效果 / 高对比度，决定是否启用动画
// 依赖：Node.js os + Electron systemPreferences / BrowserWindow.setBackgroundMaterial
// 类型映射：
//   C# Environment.OSVersion.Version.Build → os.release() 第三段
//   C# MicaController.IsSupported()        → Electron 43+ setBackgroundMaterial 仅 Win11 22H2+
//   C# DesktopAcrylicController.IsSupported() → 同上
//   C# UISettings.AnimationsEnabled        → systemPreferences.getAnimationSettings?.()
//   C# AccessibilitySettings.HighContrast  → systemPreferences.isHighContrast?.()
// ============================================================

const os = require('os')
const logger = require('../core/logger.js')

const WINDOWS_11_BUILD = 22000
// Electron setBackgroundMaterial 实际生效要求 Win11 22H2+（build 22621）
// 对齐 widget-window-manager.js 的 WIN11_MIN_BUILD
const WINDOWS_11_22H2_BUILD = 22621

const MATERIAL_TYPE_MICA = 'mica'
const MATERIAL_TYPE_MICA_ALT = 'mica-alt'
const MATERIAL_TYPE_ACRYLIC = 'acrylic'
const MATERIAL_TYPE_ACRYLIC_BASE = 'acrylic-base'
const MATERIAL_TYPE_SOLID = 'solid'

// 已知材质类型集合，用于规范化输入
const KNOWN_MATERIAL_TYPES = new Set([
  MATERIAL_TYPE_MICA,
  MATERIAL_TYPE_MICA_ALT,
  MATERIAL_TYPE_ACRYLIC,
  MATERIAL_TYPE_ACRYLIC_BASE,
  MATERIAL_TYPE_SOLID
])

// ============================================================
// OS build 检测（懒加载，对齐 C# Lazy<int> s_osBuild）
// ============================================================

let osBuildCached = null

/**
 * 获取当前 Windows build 号
 * 移植自 C# WindowsCompatibilityService.GetOsBuild
 * 非 Windows 平台或失败时返回 0（fail-closed，避免误用 Win11-only API）
 * @returns {number}
 */
function getOsBuild () {
  if (osBuildCached !== null) return osBuildCached
  try {
    if (process.platform !== 'win32') {
      osBuildCached = 0
      return 0
    }
    // os.release() 在 Windows 上返回形如 "10.0.22000" 的字符串
    const parts = os.release().split('.')
    osBuildCached = parseInt(parts[2] || '0', 10) || 0
  } catch (err) {
    // 能力检测必须 fail closed：假设 Win11 会在 Win10 上调用不支持的 DWM/backdrop API
    logger.warn('WindowsCompatibility', `获取 OS build 失败: ${err.message}`)
    osBuildCached = 0
  }
  return osBuildCached
}

/**
 * 重置 OS build 缓存（仅供测试使用）
 */
function resetOsBuildCache () {
  osBuildCached = null
}

// ============================================================
// 能力查询
// ============================================================

/**
 * 当前 OS build 号
 * @returns {number}
 */
function osBuild () {
  return getOsBuild()
}

/**
 * 是否 Windows 11 或更高版本
 * 移植自 C# IsWindows11OrLater
 * @returns {boolean}
 */
function isWindows11OrLater () {
  return getOsBuild() >= WINDOWS_11_BUILD
}

/**
 * 是否支持 Win11 DWM 属性
 * 移植自 C# SupportsWin11DwmAttributes
 * @returns {boolean}
 */
function supportsWin11DwmAttributes () {
  return isWindows11OrLater()
}

/**
 * 是否支持原生窗口圆角
 * 移植自 C# SupportsNativeWindowCorners
 * @returns {boolean}
 */
function supportsNativeWindowCorners () {
  return isWindows11OrLater()
}

/**
 * 是否支持 Mica 材质
 * 移植自 C# SupportsMica
 * Electron 43+ setBackgroundMaterial 仅在 Win11 22H2+ 真正生效，故采用更严格的 22H2 阈值
 * @returns {boolean}
 */
function supportsMica () {
  return getOsBuild() >= WINDOWS_11_22H2_BUILD
}

/**
 * 是否支持 Desktop Acrylic 材质
 * 移植自 C# SupportsDesktopAcrylic
 * 同样要求 Win11 22H2+ 才通过 setBackgroundMaterial 生效
 * @returns {boolean}
 */
function supportsDesktopAcrylic () {
  return getOsBuild() >= WINDOWS_11_22H2_BUILD
}

/**
 * 是否使用旧版窗口亚克力（Win10 回退路径）
 * 移植自 C# UsesLegacyWindowAcrylic
 * @returns {boolean}
 */
function usesLegacyWindowAcrylic () {
  return !isWindows11OrLater()
}

// ============================================================
// 材质解析
// ============================================================

/**
 * 判断材质是否为 Mica 系列
 * 对齐 C# SettingsService.IsMicaMaterial
 * @param {string} materialType
 * @returns {boolean}
 */
function isMicaMaterial (materialType) {
  return materialType === MATERIAL_TYPE_MICA ||
    materialType === MATERIAL_TYPE_MICA_ALT
}

/**
 * 规范化材质类型
 * 未知值回退为 Acrylic，对齐 C# ResolveWidgetMaterialTypeForBuild 中的 switch 表达式
 * @param {string|null|undefined} materialType
 * @returns {string}
 */
function normalizeMaterialType (materialType) {
  return (typeof materialType === 'string' && KNOWN_MATERIAL_TYPES.has(materialType))
    ? materialType
    : MATERIAL_TYPE_ACRYLIC
}

/**
 * 解析小部件材质类型
 * 移植自 C# ResolveWidgetMaterialType / ResolveWidgetMaterialTypeForBuild
 * 算法：
 *   1. 规范化输入（未知 → Acrylic）
 *   2. Win10 上若请求 Mica 系列 → 降级为 Acrylic
 *   3. 其他保持不变
 * @param {string|null|undefined} requestedMaterialType - 用户请求的材质
 * @returns {string} 实际生效的材质
 */
function resolveWidgetMaterialType (requestedMaterialType) {
  return resolveWidgetMaterialTypeForBuild(requestedMaterialType, getOsBuild())
}

/**
 * 按指定 build 解析材质类型（导出便于单元测试）
 * 移植自 C# ResolveWidgetMaterialTypeForBuild
 * @param {string|null|undefined} requestedMaterialType
 * @param {number} build - Windows build 号
 * @returns {string}
 */
function resolveWidgetMaterialTypeForBuild (requestedMaterialType, build) {
  const normalized = normalizeMaterialType(requestedMaterialType)
  if (build < WINDOWS_11_BUILD && isMicaMaterial(normalized)) {
    return MATERIAL_TYPE_ACRYLIC
  }
  return normalized
}

// ============================================================
// 安全材质应用
// ============================================================

/**
 * 为 Electron BrowserWindow 应用安全材质
 * 移植自 C# ApplySafeBackdrop
 * 算法：
 *   1. preferMica 且支持 Mica → setBackgroundMaterial('mica')，返回 'Mica'
 *   2. 否则支持 Acrylic → setBackgroundMaterial('acrylic')，返回 'Acrylic'
 *   3. 否则 setBackgroundMaterial('none')，返回 'Solid'
 * @param {object} window - Electron BrowserWindow 实例
 * @param {boolean} [preferMica=true] - 是否优先 Mica
 * @returns {string} 实际生效的材质名 'Mica' | 'Acrylic' | 'Solid'
 */
function applySafeBackdrop (window, preferMica = true) {
  if (!window || typeof window.setBackgroundMaterial !== 'function') {
    return 'Solid'
  }

  try {
    if (preferMica && supportsMica()) {
      window.setBackgroundMaterial('mica')
      return 'Mica'
    }
    if (supportsDesktopAcrylic()) {
      window.setBackgroundMaterial('acrylic')
      return 'Acrylic'
    }
  } catch (err) {
    logger.warn('WindowsCompatibility', `System material unavailable: ${err.message}`)
  }

  // 回退：清除系统材质，使用纯色 XAML 表面
  try {
    window.setBackgroundMaterial('none')
  } catch {
    // 旧版 Electron 无此 API，忽略
  }
  return 'Solid'
}

// ============================================================
// UI 设置查询（动画 / 高对比度）
// ============================================================

/**
 * 安全获取 electron.systemPreferences API
 * @returns {object|null}
 */
function getSystemPreferences () {
  try {
    return require('electron').systemPreferences || null
  } catch {
    return null
  }
}

/**
 * 系统动画是否启用
 * 移植自 C# AreAnimationsEnabled
 * Electron systemPreferences 无直接等价 API，默认 true（与 C# fallback 一致）
 * @returns {boolean}
 */
function areAnimationsEnabled () {
  // Electron 暂无等价查询，按 C# fallback=true
  return true
}

/**
 * 系统高级效果是否启用
 * 移植自 C# AreAdvancedEffectsEnabled
 * 反射 UISettings.AdvancedEffectsEnabled，Electron 无等价 API，默认 true
 * @returns {boolean}
 */
function areAdvancedEffectsEnabled () {
  return true
}

/**
 * 是否高对比度模式
 * 移植自 C# IsHighContrast
 * Electron systemPreferences.isHighContrast 在 Windows 上可用
 * @returns {boolean}
 */
function isHighContrast () {
  const prefs = getSystemPreferences()
  if (!prefs || typeof prefs.isHighContrast !== 'function') {
    return false
  }
  try {
    return !!prefs.isHighContrast()
  } catch {
    return false
  }
}

/**
 * 是否应当启用动画
 * 移植自 C# ShouldAnimate / ResolveShouldAnimate
 * 算法：animationsEnabled && advancedEffectsEnabled && !highContrast
 * @returns {boolean}
 */
function shouldAnimate () {
  return resolveShouldAnimate(areAnimationsEnabled(), areAdvancedEffectsEnabled(), isHighContrast())
}

/**
 * 按给定输入计算是否应当启用动画（导出便于单元测试）
 * 移植自 C# ResolveShouldAnimate
 * @param {boolean} animationsEnabled
 * @param {boolean} advancedEffectsEnabled
 * @param {boolean} highContrast
 * @returns {boolean}
 */
function resolveShouldAnimate (animationsEnabled, advancedEffectsEnabled, highContrast) {
  return animationsEnabled && advancedEffectsEnabled && !highContrast
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
  // OS 能力
  osBuild,
  getOsBuild,
  resetOsBuildCache,
  isWindows11OrLater,
  supportsWin11DwmAttributes,
  supportsNativeWindowCorners,
  supportsMica,
  supportsDesktopAcrylic,
  usesLegacyWindowAcrylic,
  // 材质解析
  isMicaMaterial,
  normalizeMaterialType,
  resolveWidgetMaterialType,
  resolveWidgetMaterialTypeForBuild,
  applySafeBackdrop,
  // UI 设置
  areAnimationsEnabled,
  areAdvancedEffectsEnabled,
  isHighContrast,
  shouldAnimate,
  resolveShouldAnimate,
  // 常量
  WINDOWS_11_BUILD,
  WINDOWS_11_22H2_BUILD,
  MATERIAL_TYPE_MICA,
  MATERIAL_TYPE_MICA_ALT,
  MATERIAL_TYPE_ACRYLIC,
  MATERIAL_TYPE_ACRYLIC_BASE,
  MATERIAL_TYPE_SOLID
}