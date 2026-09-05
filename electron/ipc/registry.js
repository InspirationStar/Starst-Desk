// ============================================================
// IPC 注册中心（占位）
// 后续任务 2.7 会实现统一注册 ipcMain.handle 与通道白名单
// ============================================================

const { ipcMain } = require('electron')

/**
 * 统一响应格式（成功）
 * @param {any} data 响应数据
 * @returns {{ ok: true, data: any }}
 */
function success (data) {
  return { ok: true, data }
}

/**
 * 统一响应格式（失败）
 * @param {string} code 错误码
 * @param {string} message 错误消息
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function failure (code, message) {
  return { ok: false, error: { code, message } }
}

/**
 * 注册 IPC 通道处理器
 * @param {string} channel 通道名（格式：module:action）
 * @param {Function} handler 处理函数
 */
function register (channel, handler) {
  ipcMain.handle(channel, async (event, data) => {
    try {
      const result = await handler(event, data)
      // 如果 handler 已返回标准响应格式（含 ok 字段），直接返回避免双重包裹
      if (result && typeof result === 'object' && 'ok' in result) {
        return result
      }
      return success(result)
    } catch (error) {
      return failure(error.code || 'INTERNAL_ERROR', error.message)
    }
  })
}

module.exports = {
  register,
  success,
  failure
}