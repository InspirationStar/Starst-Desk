// ============================================================
// 桌面整理 IPC 通道注册
// ============================================================

const { register, success, failure } = require('./registry')
const { registerDesktopOrganizationChannels } = require('../services/desktop-organization')

/**
 * 注册所有桌面整理相关的 IPC 通道
 */
function registerDesktopOrganizationIpcChannels () {
  registerDesktopOrganizationChannels()
}

module.exports = { registerDesktopOrganizationIpcChannels }