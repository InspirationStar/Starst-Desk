// ============================================================
// 托盘动画中断协调器
// 遍历窗口集合，逐个调用取消并恢复回调，统计成功恢复数量
// 任意窗口抛错不影响其余窗口的恢复，错误通过 onFailure 回调上报
// ============================================================

/**
 * 取消并恢复所有窗口的托盘动画
 * @param {Array} windows 窗口集合
 * @param {Function} cancelAndRestore 单窗口取消并恢复回调 (window) => void
 * @param {Function|null} [onFailure] 失败回调 (window, error) => void
 * @returns {number} 成功恢复的窗口数量
 */
function cancelAndRestore (windows, cancelAndRestore, onFailure = null) {
  if (!Array.isArray(windows)) {
    throw new TypeError('windows 必须是数组')
  }
  if (typeof cancelAndRestore !== 'function') {
    throw new TypeError('cancelAndRestore 必须是函数')
  }

  let restoredCount = 0
  for (const window of windows) {
    try {
      cancelAndRestore(window)
      restoredCount++
    } catch (error) {
      if (typeof onFailure === 'function') {
        onFailure(window, error)
      }
    }
  }

  return restoredCount
}

module.exports = {
  cancelAndRestore
}