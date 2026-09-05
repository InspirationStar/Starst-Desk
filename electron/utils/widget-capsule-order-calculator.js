// ============================================================
// 胶囊拖拽排序计算器（纯逻辑）
// 职责：拖拽时计算最近槽位并重排胶囊顺序；合并组内排序到全局排序
// 纯逻辑模块，不依赖 Vue/Electron，可独立单元测试
// 类型映射：
//   C# RectInt32  → JS { x, y, width, height }
//   C# IReadOnlyList<string> → JS Array<string>
//   C# long → JS number（JS Number 精度足够支持屏幕坐标）
// ============================================================

const DIRECTION_VERTICAL = 'Vertical'

/**
 * 规范化胶囊栏方向
 * 对齐 C# SettingsService.NormalizeWidgetCapsuleBarDirection
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
 * 计算矩形在主轴方向的中心坐标（避免除法，使用 2 倍中心）
 * 移植自 C# GetPrimaryCenter
 * 垂直方向返回 2*y + height，水平方向返回 2*x + width
 * 使用 2 倍中心避免浮点除法，比较结果等价
 * @param {{x: number, y: number, width: number, height: number}} bounds
 * @param {boolean} vertical - 是否垂直方向
 * @returns {number} 主轴 2 倍中心坐标
 */
function getPrimaryCenter (bounds, vertical) {
  return vertical
    ? bounds.y * 2 + bounds.height
    : bounds.x * 2 + bounds.width
}

/**
 * 在有序列表中查找指定值的索引
 * 移植自 C# IndexOf（顺序相等比较）
 * @param {string[]} items
 * @param {string} value
 * @returns {number} 索引；未找到返回 -1
 */
function indexOf (items, value) {
  for (let i = 0; i < items.length; i++) {
    if (items[i] === value) return i
  }
  return -1
}

/**
 * 拖拽时将胶囊移动到最近的槽位
 * 移植自 C# MoveToNearestSlot
 * 算法：
 *   1. 找到当前拖拽胶囊在有序列表中的索引
 *   2. 计算拖拽提议位置的主轴中心
 *   3. 遍历所有槽位，找到主轴中心距离最近的槽位
 *   4. 若最近槽位与当前索引相同，返回原顺序
 *   5. 否则将拖拽胶囊从原位置移除，插入到最近槽位
 * @param {string[]} orderedIds - 当前排序的 id 列表
 * @param {Array<{x: number, y: number, width: number, height: number}>} slotBounds - 每个槽位的 bounds
 * @param {string} activeId - 正在拖拽的 id
 * @param {{x: number, y: number, width: number, height: number}} proposedBounds - 拖拽提议的新位置
 * @param {string} direction - 'horizontal' | 'vertical'（不区分大小写）
 * @returns {string[]} 新的排序 id 列表
 */
function moveToNearestSlot (orderedIds, slotBounds, activeId, proposedBounds, direction) {
  const activeIndex = indexOf(orderedIds, activeId)
  // 未找到拖拽项或列表少于 2 项：返回原顺序副本
  if (activeIndex < 0 || orderedIds.length < 2) {
    return orderedIds.slice()
  }

  const vertical = normalizeDirection(direction) === DIRECTION_VERTICAL
  const proposedCenter = getPrimaryCenter(proposedBounds, vertical)
  let nearestIndex = activeIndex
  let nearestDistance = Number.MAX_SAFE_INTEGER
  const slotCount = Math.min(orderedIds.length, slotBounds.length)
  for (let index = 0; index < slotCount; index++) {
    const slot = slotBounds[index]
    const distance = Math.abs(proposedCenter - getPrimaryCenter(slot, vertical))
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }

  // 最近槽位与当前位置相同：无需重排
  if (nearestIndex === activeIndex) {
    return orderedIds.slice()
  }

  // 从原位置移除并插入到最近槽位
  const reordered = orderedIds.slice()
  reordered.splice(activeIndex, 1)
  reordered.splice(nearestIndex, 0, activeId)
  return reordered
}

/**
 * 合并组内排序到全局排序
 * 移植自 C# MergeGroupOrder
 * 算法：遍历全局排序，遇到属于组内的 id 时按 groupOrder 顺序替换
 *   保持组外 id 不变，组内 id 按 groupOrder 重新排列
 * @param {string[]} completeOrder - 全局排序
 * @param {string[]} groupOrder - 组内排序
 * @returns {string[]} 合并后的排序
 */
function mergeGroupOrder (completeOrder, groupOrder) {
  // 组内 id 集合（O(1) 查找）
  const groupIds = new Set(groupOrder)
  const result = completeOrder.slice()
  let groupIndex = 0
  for (let index = 0; index < result.length && groupIndex < groupOrder.length; index++) {
    if (groupIds.has(result[index])) {
      result[index] = groupOrder[groupIndex++]
    }
  }
  return result
}

module.exports = {
  moveToNearestSlot,
  mergeGroupOrder,
  // 导出内部方法便于单元测试
  getPrimaryCenter,
  indexOf,
  normalizeDirection,
  DIRECTION_VERTICAL
}