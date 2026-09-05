// ============================================================
// 桌面小部件窗口吸附纯逻辑模块
// 提供屏幕贴边吸附与小部件间吸附的纯函数计算
// 不依赖任何 Electron API，便于单元测试
// ============================================================

/**
 * 对窗口 bounds 执行屏幕贴边吸附与小部件间吸附
 * @param {object} bounds - { x, y, width, height }
 * @param {object} options - {
 *   workArea: { x, y, width, height },
 *   others: Array<{ x, y, width, height }>,
 *   threshold: number = 10,        // 屏幕边缘吸附阈值
 *   widgetThreshold: number = 8    // 小部件间吸附阈值
 * }
 * @returns {object} 吸附后的 { x, y, width, height }
 */
function snapToEdges (bounds, options) {
  const { workArea, others = [], threshold = 10, widgetThreshold = 8 } = options
  let { x, y, width, height } = bounds

  // X 维度：收集所有候选吸附坐标，选距离最小的
  const xCandidates = []
  // 屏幕边缘（用 threshold）
  xCandidates.push({ value: workArea.x, threshold })
  xCandidates.push({ value: workArea.x + workArea.width - width, threshold })
  // 小部件边缘（用 widgetThreshold）
  for (const other of others) {
    xCandidates.push({ value: other.x + other.width, threshold: widgetThreshold }) // 贴合：左边贴 other 右边
    xCandidates.push({ value: other.x - width, threshold: widgetThreshold })       // 贴合：右边贴 other 左边
    xCandidates.push({ value: other.x, threshold: widgetThreshold })               // 对齐：左边对齐
    xCandidates.push({ value: other.x + other.width - width, threshold: widgetThreshold }) // 对齐：右边对齐
  }
  let bestX = null
  let bestXDelta = Infinity
  for (const c of xCandidates) {
    const delta = Math.abs(x - c.value)
    if (delta < c.threshold && delta < bestXDelta) {
      bestXDelta = delta
      bestX = c.value
    }
  }
  if (bestX !== null) x = bestX

  // Y 维度：同理
  const yCandidates = []
  yCandidates.push({ value: workArea.y, threshold })
  yCandidates.push({ value: workArea.y + workArea.height - height, threshold })
  for (const other of others) {
    yCandidates.push({ value: other.y + other.height, threshold: widgetThreshold })
    yCandidates.push({ value: other.y - height, threshold: widgetThreshold })
    yCandidates.push({ value: other.y, threshold: widgetThreshold })
    yCandidates.push({ value: other.y + other.height - height, threshold: widgetThreshold })
  }
  let bestY = null
  let bestYDelta = Infinity
  for (const c of yCandidates) {
    const delta = Math.abs(y - c.value)
    if (delta < c.threshold && delta < bestYDelta) {
      bestYDelta = delta
      bestY = c.value
    }
  }
  if (bestY !== null) y = bestY

  return { x, y, width, height }
}

module.exports = { snapToEdges }