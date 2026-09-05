// ============================================================
// Todo IPC 通道注册
// ============================================================

const { registerTodoChannels } = require('../services/todo-service')

/**
 * 注册所有 Todo 相关的 IPC 通道
 */
function registerTodoIpcChannels () {
  registerTodoChannels()
}

module.exports = { registerTodoIpcChannels }