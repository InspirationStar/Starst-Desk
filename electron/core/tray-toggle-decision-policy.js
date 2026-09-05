// ============================================================
// 托盘切换决策策略
// 根据当前会话状态、小部件可见性与前台状态决定是否隐藏托盘
// 决策规则：
//   1. 已抬升会话（IsRaisedSession）→ 隐藏
//   2. 无可见小部件 → 不隐藏
//   3. 否则按前台本地状态决定
// ============================================================

/**
 * 构造托盘切换决策上下文
 * @param {boolean} isRaisedSession 是否处于已抬升会话
 * @param {boolean} hasVisibleWidgets 是否存在可见小部件
 * @param {boolean} isForegroundLocal 是否前台本地
 */
function createDecisionContext (isRaisedSession, hasVisibleWidgets, isForegroundLocal) {
  return {
    isRaisedSession: !!isRaisedSession,
    hasVisibleWidgets: !!hasVisibleWidgets,
    isForegroundLocal: !!isForegroundLocal
  }
}

/**
 * 判断是否应当隐藏托盘
 * @param {Object} context 决策上下文
 * @param {boolean} context.isRaisedSession 是否处于已抬升会话
 * @param {boolean} context.hasVisibleWidgets 是否存在可见小部件
 * @param {boolean} context.isForegroundLocal 是否前台本地
 * @returns {boolean}
 */
function shouldHide (context) {
  if (context.isRaisedSession) {
    return true
  }

  if (!context.hasVisibleWidgets) {
    return false
  }

  return context.isForegroundLocal
}

module.exports = {
  createDecisionContext,
  shouldHide
}