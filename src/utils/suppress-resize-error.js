// ============================================================
// 抑制 ResizeObserver loop 无害警告
// Chromium 在 ResizeObserver 回调同步触发布局变化时会抛出
// "ResizeObserver loop completed with undelivered notifications."
// 这是引擎层面的已知行为，不影响功能，仅在控制台显示为错误噪音
// 此模块在 window error 事件中拦截该特定消息，阻止其输出到控制台
// ============================================================

/**
 * 在全局 error 事件中拦截 ResizeObserver loop 警告
 * 应在应用入口最早期调用，确保后续所有 ResizeObserver 实例都受保护
 */
export function suppressResizeObserverError () {
  window.addEventListener('error', (event) => {
    if (event && event.message && event.message.includes('ResizeObserver loop completed with undelivered notifications')) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  })
}