// ============================================================
// 胶囊栏排列计算器（纯逻辑）
// 职责：根据胶囊列表、工作区、锚点、方向、间距，计算每个胶囊的目标位置
// 纯逻辑模块，不依赖 Vue/Electron，可独立单元测试
// 类型映射：
//   C# RectInt32  → JS { x, y, width, height }
//   C# PointInt32 → JS { x, y }
//   C# Math.Clamp(val, min, max) → Math.max(min, Math.min(max, val))
//   C# int / int（整数除法） → Math.floor(a / b)
// ============================================================

const HORIZONTAL_MINIMUM_WIDTH = 96
const VERTICAL_MINIMUM_HEIGHT = 36

const POSITION_ANCHOR_RIGHT_TOP = 'RightTop'
const POSITION_ANCHOR_RIGHT_BOTTOM = 'RightBottom'
const POSITION_ANCHOR_LEFT_BOTTOM = 'LeftBottom'

const DIRECTION_VERTICAL = 'Vertical'

/**
 * 数值夹取到 [min, max] 区间
 * 对齐 C# Math.Clamp(val, min, max)
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
 * 规范化胶囊栏方向
 * 对齐 C# SettingsService.NormalizeWidgetCapsuleBarDirection：
 *   "Horizontal" → "Horizontal"，"Vertical" → "Vertical"，其他 → "Auto"
 * @param {string|null|undefined} value
 * @returns {string} 规范化后的方向
 */
function normalizeDirection (value) {
  if (typeof value !== 'string') return 'Auto'
  if (value.toLowerCase() === 'horizontal') return 'Horizontal'
  if (value.toLowerCase() === 'vertical') return DIRECTION_VERTICAL
  return 'Auto'
}

/**
 * 计算胶囊栏中每个胶囊的目标位置
 * 主入口，移植自 C# WidgetCapsuleArrangementCalculator.Calculate
 * @param {Array<{id: string, width: number, height: number}>} items - 胶囊列表
 * @param {{x: number, y: number, width: number, height: number}} workArea - 工作区
 * @param {{x: number, y: number}} anchorPoint - 锚点
 * @param {string} positionAnchor - 'LeftTop' | 'RightTop' | 'LeftBottom' | 'RightBottom'
 * @param {string} direction - 'horizontal' | 'vertical'（不区分大小写）
 * @param {number} spacing - 胶囊间距
 * @returns {Object<string, {x: number, y: number, width: number, height: number}>} id -> bounds 映射
 */
function calculate (items, workArea, anchorPoint, positionAnchor, direction, spacing) {
  const results = {}
  // 空列表或工作区无效：返回空结果
  if (!Array.isArray(items) || items.length === 0 ||
    !workArea || workArea.width <= 0 || workArea.height <= 0) {
    return results
  }

  // 规范化方向：仅垂直方向走单列排列，其他（含 Auto/Horizontal）走单行排列
  const vertical = normalizeDirection(direction) === DIRECTION_VERTICAL
  // 锚点是否在右侧（RightTop / RightBottom）
  const anchorRight = positionAnchor === POSITION_ANCHOR_RIGHT_TOP ||
    positionAnchor === POSITION_ANCHOR_RIGHT_BOTTOM
  // 锚点是否在底部（LeftBottom / RightBottom）
  const anchorBottom = positionAnchor === POSITION_ANCHOR_LEFT_BOTTOM ||
    positionAnchor === POSITION_ANCHOR_RIGHT_BOTTOM
  const workRight = workArea.x + workArea.width
  const workBottom = workArea.y + workArea.height
  // 锚点夹取到工作区内，避免起算点出屏
  const safeAnchor = {
    x: clamp(anchorPoint.x, workArea.x, workRight),
    y: clamp(anchorPoint.y, workArea.y, workBottom)
  }

  if (vertical) {
    arrangeVerticalSingleColumn(
      items,
      workArea,
      safeAnchor,
      anchorRight,
      anchorBottom,
      spacing,
      results
    )
  } else {
    arrangeHorizontalSingleRow(
      items,
      workArea,
      safeAnchor,
      anchorRight,
      anchorBottom,
      spacing,
      results
    )
  }

  // 整组钳制到工作区内（防止锚点偏移导致溢出）
  clampGroupIntoWorkArea(results, workArea)
  return results
}

/**
 * 水平单行排列
 * 移植自 C# ArrangeHorizontalSingleRow
 * @param {Array} items - 胶囊列表
 * @param {object} workArea - 工作区
 * @param {{x: number, y: number}} anchorPoint - 已夹取的安全锚点
 * @param {boolean} anchorRight - 是否右锚
 * @param {boolean} anchorBottom - 是否下锚
 * @param {number} spacing - 胶囊间距
 * @param {object} results - 输出：id -> bounds 映射
 */
function arrangeHorizontalSingleRow (items, workArea, anchorPoint, anchorRight, anchorBottom, spacing, results) {
  // 公共高度：取工作区高度与最大胶囊高度的最小值
  const commonHeight = Math.min(
    workArea.height,
    items.reduce((max, item) => Math.max(max, Math.max(1, item.height)), 1)
  )
  // 拟合每个胶囊宽度到工作区宽度
  const { safeSpacing, sizes: widths } = fitPrimarySizes(
    items.map(item => item.width),
    workArea.width,
    spacing,
    HORIZONTAL_MINIMUM_WIDTH
  )
  let cursorX = anchorPoint.x

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const width = widths[index]
    const x = anchorRight ? cursorX - width : cursorX
    const y = anchorBottom ? anchorPoint.y - commonHeight : anchorPoint.y
    results[item.id] = { x, y, width, height: commonHeight }
    // 右锚时游标向左推进，左锚时游标向右推进
    cursorX = anchorRight
      ? x - safeSpacing
      : x + width + safeSpacing
  }
}

/**
 * 垂直单列排列
 * 移植自 C# ArrangeVerticalSingleColumn
 * @param {Array} items - 胶囊列表
 * @param {object} workArea - 工作区
 * @param {{x: number, y: number}} anchorPoint - 已夹取的安全锚点
 * @param {boolean} anchorRight - 是否右锚
 * @param {boolean} anchorBottom - 是否下锚
 * @param {number} spacing - 胶囊间距
 * @param {object} results - 输出：id -> bounds 映射
 */
function arrangeVerticalSingleColumn (items, workArea, anchorPoint, anchorRight, anchorBottom, spacing, results) {
  // 公共宽度：取工作区宽度与最大胶囊宽度的最小值
  const commonWidth = Math.min(
    workArea.width,
    items.reduce((max, item) => Math.max(max, Math.max(1, item.width)), 1)
  )
  // 拟合每个胶囊高度到工作区高度
  const { safeSpacing, sizes: heights } = fitPrimarySizes(
    items.map(item => item.height),
    workArea.height,
    spacing,
    VERTICAL_MINIMUM_HEIGHT
  )
  let cursorY = anchorPoint.y

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const height = heights[index]
    const x = anchorRight ? anchorPoint.x - commonWidth : anchorPoint.x
    const y = anchorBottom ? cursorY - height : cursorY
    results[item.id] = { x, y, width: commonWidth, height }
    // 下锚时游标向上推进，上锚时游标向下推进
    cursorY = anchorBottom
      ? y - safeSpacing
      : y + height + safeSpacing
  }
}

/**
 * 拟合主轴尺寸到可用长度
 * 移植自 C# FitPrimarySizes
 * 算法：
 *   1. 间距夹取到合理范围（不超过可用长度均分上限）
 *   2. 若原始尺寸总和不超过可用空间，直接返回
 *   3. 否则按比例缩放，并保证每个尺寸不小于 effectiveMinimum
 *   4. 缩放后若有溢出，从末尾向前递减直到无溢出
 *   5. 缩放后若有剩余，从前向后递增分配完
 * @param {number[]} requestedSizes - 请求的尺寸列表
 * @param {number} availableLength - 可用长度
 * @param {number} requestedSpacing - 请求的间距
 * @param {number} preferredMinimum - 期望最小尺寸
 * @returns {{safeSpacing: number, sizes: number[]}} 实际间距与尺寸列表
 */
function fitPrimarySizes (requestedSizes, availableLength, requestedSpacing, preferredMinimum) {
  const count = requestedSizes.length
  const safeAvailable = Math.max(1, availableLength)
  let safeSpacing = Math.max(0, requestedSpacing)
  // 间距不超过可用长度均分上限（避免间距过大导致胶囊重叠或负宽度）
  if (count > 1) {
    // C# 整数除法：safeAvailable / (count - 1)
    safeSpacing = Math.min(safeSpacing, Math.floor(safeAvailable / (count - 1)))
  }

  // 每个尺寸至少为 1
  const sizes = requestedSizes.map(size => Math.max(1, size))
  // 扣除间距后的可用空间
  const availableForItems = Math.max(1, safeAvailable - safeSpacing * Math.max(0, count - 1))
  const sum = sizes.reduce((acc, v) => acc + v, 0)
  if (sum <= availableForItems) {
    return { safeSpacing, sizes }
  }

  // 按比例缩放：effectiveMinimum 不超过 availableForItems / count（保证总和不超过可用空间）
  // C# 整数除法：availableForItems / count
  const effectiveMinimum = Math.min(
    preferredMinimum,
    Math.max(1, Math.floor(availableForItems / count))
  )
  const scale = availableForItems / Math.max(1, sum)
  for (let index = 0; index < sizes.length; index++) {
    // C# (int)Math.Floor(sizes[index] * scale)
    sizes[index] = Math.max(effectiveMinimum, Math.floor(sizes[index] * scale))
  }

  // 缩放后可能仍有溢出（effectiveMinimum 兜底导致）：从末尾向前递减
  let excess = sizes.reduce((acc, v) => acc + v, 0) - availableForItems
  while (excess > 0) {
    let reduced = false
    for (let index = sizes.length - 1; index >= 0 && excess > 0; index--) {
      if (sizes[index] <= 1) continue
      sizes[index]--
      excess--
      reduced = true
    }
    if (!reduced) break
  }

  // 缩放后可能有剩余（向下取整导致）：从前向后递增分配完
  let remaining = availableForItems - sizes.reduce((acc, v) => acc + v, 0)
  for (let index = 0; remaining > 0; index = (index + 1) % sizes.length) {
    sizes[index]++
    remaining--
  }

  return { safeSpacing, sizes }
}

/**
 * 将整组钳制到工作区内
 * 移植自 C# ClampGroupIntoWorkArea
 * 算法：计算整组的边界框，若超出工作区则整体平移
 * @param {Object<string, {x: number, y: number, width: number, height: number}>} results - id -> bounds 映射
 * @param {{x: number, y: number, width: number, height: number}} workArea - 工作区
 */
function clampGroupIntoWorkArea (results, workArea) {
  const ids = Object.keys(results)
  if (ids.length === 0) return

  // 计算整组边界框
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of ids) {
    const bounds = results[id]
    if (bounds.x < minX) minX = bounds.x
    if (bounds.y < minY) minY = bounds.y
    if (bounds.x + bounds.width > maxX) maxX = bounds.x + bounds.width
    if (bounds.y + bounds.height > maxY) maxY = bounds.y + bounds.height
  }
  const workRight = workArea.x + workArea.width
  const workBottom = workArea.y + workArea.height
  // 计算整体偏移量：仅当超出工作区时才平移
  const offsetX = minX < workArea.x
    ? workArea.x - minX
    : maxX > workRight
      ? workRight - maxX
      : 0
  const offsetY = minY < workArea.y
    ? workArea.y - minY
    : maxY > workBottom
      ? workBottom - maxY
      : 0
  if (offsetX === 0 && offsetY === 0) return

  // 应用偏移
  for (const id of ids) {
    const bounds = results[id]
    results[id] = {
      x: bounds.x + offsetX,
      y: bounds.y + offsetY,
      width: bounds.width,
      height: bounds.height
    }
  }
}

module.exports = {
  calculate,
  // 导出内部方法便于单元测试
  arrangeHorizontalSingleRow,
  arrangeVerticalSingleColumn,
  fitPrimarySizes,
  clampGroupIntoWorkArea,
  normalizeDirection,
  // 导出常量便于测试与外部引用
  HORIZONTAL_MINIMUM_WIDTH,
  VERTICAL_MINIMUM_HEIGHT,
  DIRECTION_VERTICAL
}