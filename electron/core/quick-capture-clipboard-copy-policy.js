// ============================================================
// 快速捕获剪贴板复制策略
// 判断是否应当将剪贴板项作为位图复制
// ============================================================

/**
 * 判断是否应当复制位图
 * @param {Object} item 剪贴板项
 * @param {boolean} item.isRecent 是否为最近项
 * @param {string} item.type 项类型（'image' | 'text' | ...）
 * @returns {boolean}
 */
function shouldCopyBitmap (item) {
  return !!item && !!item.isRecent && item.type === 'image'
}

module.exports = {
  shouldCopyBitmap
}