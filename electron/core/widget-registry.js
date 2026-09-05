// ============================================================
// 桌面小部件类型注册表
// 集中管理小部件类型的元信息（标题、图标、默认尺寸、最小尺寸）
// 提供 getDefinition / getAllTypes / isValidType / getDefaultBounds / register 方法
// 便于后续扩展新类型（如 weather、stock 等）
// ============================================================

const logger = require('./logger.js')

// ============================================================
// 内置小部件类型定义
// 每个类型包含：title、icon、defaultWidth、defaultHeight、defaultX、defaultY、minWidth、minHeight
// 紧凑模式字段：capsuleMinWidth、capsuleStandardWidth、capsuleSmartWidth、capsuleHeight、capsuleSmartHeight
// 圆角字段：cornerPreference、outerCornerRadius、innerCornerRadius
// 折叠行为：collapseBehavior ('expanded' | 'click' | 'smart')
// ============================================================
const WIDGET_TYPES = {
  note: {
    title: '便签',
    icon: 'EditPen',
    defaultWidth: 280,
    defaultHeight: 360,
    defaultX: 100,
    defaultY: 100,
    minWidth: 200,
    minHeight: 240,
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置：round → 大圆角(外8/内4)
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为：expanded 不折叠 / click 点击切换 / smart 鼠标离开自动折叠
    collapseBehavior: 'click'
  },
  task: {
    title: '任务',
    icon: 'AlarmClock',
    defaultWidth: 280,
    defaultHeight: 400,
    defaultX: 400,
    defaultY: 100,
    minWidth: 200,
    minHeight: 280,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },
  health: {
    title: '健康',
    icon: 'FirstAidKit',
    defaultWidth: 260,
    defaultHeight: 320,
    defaultX: 700,
    defaultY: 100,
    minWidth: 200,
    minHeight: 240,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },
  todo: {
    title: '待办&规划',
    icon: 'List',
    defaultWidth: 300,
    defaultHeight: 400,
    defaultX: 1000,
    defaultY: 100,
    minWidth: 200,
    minHeight: 280,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },
  file: {
    title: '文件',
    icon: 'Folder',
    defaultWidth: 320,
    defaultHeight: 400,
    defaultX: 200,
    defaultY: 200,
    minWidth: 240,
    minHeight: 300,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },

  weather: {
    title: '天气',
    icon: 'Sunny',
    defaultWidth: 280,
    defaultHeight: 380,
    defaultX: 900,
    defaultY: 200,
    minWidth: 240,
    minHeight: 300,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },
  music: {
    title: '音乐',
    icon: 'Headset',
    defaultWidth: 320,
    defaultHeight: 180,
    defaultX: 1200,
    defaultY: 500,
    minWidth: 260,
    minHeight: 140,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },
  'desktop-organizer': {
    title: '桌面整理',
    icon: 'Grid',
    defaultWidth: 360,
    defaultHeight: 440,
    defaultX: 600,
    defaultY: 500,
    minWidth: 280,
    minHeight: 320,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },
  'system-monitor': {
    title: '系统监控',
    icon: 'Monitor',
    defaultWidth: 300,
    defaultHeight: 360,
    defaultX: 300,
    defaultY: 200,
    minWidth: 240,
    minHeight: 280,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },
  tags: {
    title: '标签',
    icon: 'PriceTag',
    defaultWidth: 280,
    defaultHeight: 400,
    defaultX: 1100,
    defaultY: 500,
    minWidth: 200,
    minHeight: 280,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },
  search: {
    title: '搜索',
    icon: 'Search',
    defaultWidth: 360,
    defaultHeight: 480,
    defaultX: 500,
    defaultY: 500,
    minWidth: 240,
    minHeight: 320,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  },
  productivity: {
    title: '生产力',
    icon: 'TrendCharts',
    defaultWidth: 320,
    defaultHeight: 420,
    defaultX: 1300,
    defaultY: 500,
    minWidth: 240,
    minHeight: 300,
    // 紧凑模式尺寸
    capsuleMinWidth: 144,
    capsuleStandardWidth: 248,
    capsuleSmartWidth: 272,
    capsuleHeight: 42,
    capsuleSmartHeight: 52,
    // 圆角配置
    cornerPreference: 'round',
    outerCornerRadius: 8,
    innerCornerRadius: 4,
    // 折叠行为
    collapseBehavior: 'click'
  }
}

// ============================================================
// 类型查询方法
// ============================================================

/**
 * 获取指定类型的小部件定义
 * @param {string} widgetType - 小部件类型
 * @returns {object|null} 类型定义，不存在返回 null
 */
function getDefinition (widgetType) {
  return WIDGET_TYPES[widgetType] || null
}

/**
 * 获取所有已注册的小部件类型列表
 * @returns {object[]} 类型定义数组，每项包含 type 字段
 */
function getAllTypes () {
  return Object.keys(WIDGET_TYPES).map(type => ({
    type,
    ...WIDGET_TYPES[type]
  }))
}

/**
 * 校验小部件类型是否合法
 * @param {string} widgetType
 * @returns {boolean}
 */
function isValidType (widgetType) {
  return Object.prototype.hasOwnProperty.call(WIDGET_TYPES, widgetType)
}

/**
 * 获取指定类型的默认位置和大小
 * @param {string} widgetType
 * @returns {object|null} { x, y, width, height }，类型不存在返回 null
 */
function getDefaultBounds (widgetType) {
  const def = WIDGET_TYPES[widgetType]
  if (!def) return null
  return {
    x: def.defaultX,
    y: def.defaultY,
    width: def.defaultWidth,
    height: def.defaultHeight
  }
}

/**
 * 计算指定小部件折叠为胶囊形态时的目标 bounds
 * 读取定义的 capsuleStandardWidth 和 capsuleHeight，
 *   保留当前 bounds 的 x/y 位置，仅替换宽高
 * @param {string} widgetType
 * @param {object} currentBounds - 当前 { x, y, width, height }
 * @returns {object|null} 胶囊目标 { x, y, width, height }，类型不存在返回 null
 */
function getCapsuleBounds (widgetType, currentBounds) {
  const def = WIDGET_TYPES[widgetType]
  if (!def) return null
  // 防御性校验 currentBounds
  const x = (currentBounds && typeof currentBounds.x === 'number') ? currentBounds.x : def.defaultX
  const y = (currentBounds && typeof currentBounds.y === 'number') ? currentBounds.y : def.defaultY
  return {
    x,
    y,
    width: def.capsuleStandardWidth,
    height: def.capsuleHeight
  }
}

/**
 * 计算指定小部件在指定内容模式下折叠为胶囊形态时的目标 bounds
 *   - MinimalWidth = 172, SummaryWidth = 248, SmartWidth = 272
 *   - SmartMediaWidth = 320（Music 小部件在 smart 模式下使用更宽尺寸）
 *   - Height = 42, SmartDetailHeight = 52
 * 内容模式对应尺寸：
 *   - 'minimal' → width 172, height 42
 *   - 'summary' → width 248, height 42
 *   - 'smart'   → width 272, height 52（Music 类型 width 320）
 *   - 缺省      → summary 模式
 * 保留当前 bounds 的 x/y 位置，仅替换宽高
 * @param {string} widgetType
 * @param {string} contentMode - 'minimal' | 'summary' | 'smart'
 * @param {object} currentBounds - 当前 { x, y, width, height }
 * @returns {object|null} 胶囊目标 { x, y, width, height }，类型不存在返回 null
 */
function getCapsuleBoundsForMode (widgetType, contentMode, currentBounds) {
  const def = WIDGET_TYPES[widgetType]
  if (!def) return null
  // 防御性校验 currentBounds
  const x = (currentBounds && typeof currentBounds.x === 'number') ? currentBounds.x : def.defaultX
  const y = (currentBounds && typeof currentBounds.y === 'number') ? currentBounds.y : def.defaultY
  //   Music 类型在 smart 模式下使用 SmartMediaWidth=320（C# WidgetKind.Music 分支）
  const isMusic = widgetType === 'music'
  let width, height
  switch (contentMode) {
    case 'minimal':
      width = 172
      height = 42
      break
    case 'smart':
      width = isMusic ? 320 : 272
      height = 52
      break
    case 'summary':
    default:
      // 缺省 → summary 模式
      width = 248
      height = 42
      break
  }
  return { x, y, width, height }
}

/**
 * 根据当前窗口位置和屏幕尺寸计算最佳展开方向
 * 比较窗口中心相对于屏幕中心的偏移，选择偏移更大的轴作为展开轴：
 *   - 垂直偏移更大：窗口在屏幕上半部 → 向下展开 / 下半部 → 向上展开
 *   - 水平偏移更大：窗口在屏幕左半部 → 向右展开 / 右半部 → 向左展开
 * @param {object} currentBounds - 当前窗口 { x, y, width, height }
 * @param {object} screenBounds - 屏幕 { width, height }（或 { x, y, width, height }）
 * @returns {string} 展开方向 'down' | 'up' | 'right' | 'left'，缺省 'down'
 */
function getExpansionDirection (currentBounds, screenBounds) {
  // 防御性校验
  if (!currentBounds || typeof currentBounds.x !== 'number' || typeof currentBounds.y !== 'number') {
    return 'down'
  }
  if (!screenBounds || typeof screenBounds.width !== 'number' || typeof screenBounds.height !== 'number') {
    return 'down'
  }

  // 窗口中心点
  const winCenterX = currentBounds.x + (currentBounds.width || 0) / 2
  const winCenterY = currentBounds.y + (currentBounds.height || 0) / 2

  // 屏幕中心点（screenBounds 可能含 x/y 偏移，如多显示器场景）
  const screenOffsetX = (typeof screenBounds.x === 'number') ? screenBounds.x : 0
  const screenOffsetY = (typeof screenBounds.y === 'number') ? screenBounds.y : 0
  const screenCenterX = screenOffsetX + screenBounds.width / 2
  const screenCenterY = screenOffsetY + screenBounds.height / 2

  // 窗口中心相对屏幕中心的偏移
  const deltaX = winCenterX - screenCenterX
  const deltaY = winCenterY - screenCenterY

  // 选择偏移更大的轴作为展开轴，避免窗口展开后超出屏幕
  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    // 垂直轴：上半部 → 向下展开，下半部 → 向上展开
    return deltaY < 0 ? 'down' : 'up'
  }
  // 水平轴：左半部 → 向右展开，右半部 → 向左展开
  return deltaX < 0 ? 'right' : 'left'
}

/**
 * 根据展开方向计算展开后的窗口 bounds
 * 展开后窗口尺寸为类型定义的 defaultWidth × defaultHeight，
 *   位置根据展开方向调整以保持锚点：
 *   - 'down'：y 不变，向下扩展高度（顶部锚点不变）
 *   - 'up'：y = y + capsuleHeight - defaultHeight，向上扩展高度（底部锚点不变）
 *   - 'right'：x 不变，向右扩展宽度（左侧锚点不变）
 *   - 'left'：x = x + capsuleWidth - defaultWidth，向左扩展宽度（右侧锚点不变）
 * @param {string} widgetType - 小部件类型
 * @param {string} direction - 展开方向 'down' | 'up' | 'right' | 'left'
 * @param {object} currentBounds - 当前 { x, y, width, height }（通常为胶囊形态 bounds）
 * @returns {object|null} 展开后 { x, y, width, height }，类型不存在返回 null
 */
function getExpandedBounds (widgetType, direction, currentBounds) {
  const def = WIDGET_TYPES[widgetType]
  if (!def) return null

  // 防御性校验 currentBounds
  const x = (currentBounds && typeof currentBounds.x === 'number') ? currentBounds.x : def.defaultX
  const y = (currentBounds && typeof currentBounds.y === 'number') ? currentBounds.y : def.defaultY
  const currentWidth = (currentBounds && typeof currentBounds.width === 'number') ? currentBounds.width : def.capsuleStandardWidth
  const currentHeight = (currentBounds && typeof currentBounds.height === 'number') ? currentBounds.height : def.capsuleHeight

  const defaultWidth = def.defaultWidth
  const defaultHeight = def.defaultHeight

  // 根据展开方向计算展开后位置
  switch (direction) {
    case 'up':
      // 向上展开：底部锚点不变，y 上移
      return {
        x,
        y: y + currentHeight - defaultHeight,
        width: defaultWidth,
        height: defaultHeight
      }
    case 'right':
      // 向右展开：左侧锚点不变，x 不变
      return {
        x,
        y,
        width: defaultWidth,
        height: defaultHeight
      }
    case 'left':
      // 向左展开：右侧锚点不变，x 左移
      return {
        x: x + currentWidth - defaultWidth,
        y,
        width: defaultWidth,
        height: defaultHeight
      }
    case 'down':
    default:
      // 向下展开：顶部锚点不变，y 不变
      return {
        x,
        y,
        width: defaultWidth,
        height: defaultHeight
      }
  }
}

/**
 * 根据胶囊当前 bounds 与屏幕工作区自动判定展开方向并计算展开后 bounds
 * 组合 getExpansionDirection + getExpandedBounds，供 setWidgetCapsule 展开时使用
 * 当展开尺寸缓存中存有用户上次的展开尺寸时，优先使用缓存的 width/height
 *   （保留用户自定义尺寸），仅由方向决定 x/y 锚点
 * @param {string} widgetType
 * @param {object} currentBounds - 胶囊形态 { x, y, width, height }
 * @param {object} workArea - 屏幕工作区 { x, y, width, height }
 * @param {{width: number, height: number}} [expandedSize] - 缓存的展开尺寸（可选）
 * @returns {object|null} 展开后 { x, y, width, height }，类型不存在返回 null
 */
function getExpandedBoundsForCapsule (widgetType, currentBounds, workArea, expandedSize) {
  const def = WIDGET_TYPES[widgetType]
  if (!def) return null
  // 计算展开方向
  const direction = getExpansionDirection(currentBounds, workArea)
  // 优先使用缓存的展开尺寸，缺省回退到类型默认尺寸
  const targetWidth = (expandedSize && typeof expandedSize.width === 'number' && expandedSize.width > 0)
    ? expandedSize.width
    : def.defaultWidth
  const targetHeight = (expandedSize && typeof expandedSize.height === 'number' && expandedSize.height > 0)
    ? expandedSize.height
    : def.defaultHeight
  // 复用 getExpandedBounds 计算锚点位置，但替换 width/height 为目标尺寸
  const bounds = getExpandedBounds(widgetType, direction, currentBounds)
  if (!bounds) return null
  return {
    x: bounds.x,
    y: bounds.y,
    width: targetWidth,
    height: targetHeight
  }
}

/**
 * 动态注册新的小部件类型（扩展用）
 * @param {string} type - 类型标识
 * @param {object} definition - 类型定义
 * @returns {boolean} 是否注册成功
 */
function register (type, definition) {
  if (!type || typeof type !== 'string') {
    logger.warn('WidgetRegistry', `register() 失败：类型标识无效`)
    return false
  }
  if (WIDGET_TYPES[type]) {
    logger.warn('WidgetRegistry', `register() 失败：类型 ${type} 已存在`)
    return false
  }
  // 校验必填字段
  const required = ['title', 'icon', 'defaultWidth', 'defaultHeight']
  for (const field of required) {
    if (definition[field] === undefined) {
      logger.warn('WidgetRegistry', `register() 失败：缺少必填字段 ${field}`)
      return false
    }
  }
  WIDGET_TYPES[type] = {
    defaultX: 100,
    defaultY: 100,
    minWidth: 200,
    minHeight: 200,
    ...definition
  }
  logger.info('WidgetRegistry', `已注册小部件类型: ${type}`)
  return true
}

module.exports = {
  getDefinition,
  getAllTypes,
  isValidType,
  getDefaultBounds,
  getCapsuleBounds,
  getCapsuleBoundsForMode,
  getExpansionDirection,
  getExpandedBounds,
  getExpandedBoundsForCapsule,
  register,
  WIDGET_TYPES
}
