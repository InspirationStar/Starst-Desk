// ============================================================
// 音乐 IPC 通道注册
// ============================================================

const { register, success, failure } = require('./registry')
const { registerMusicChannels } = require('../services/music-service')

/**
 * 注册所有音乐相关的 IPC 通道
 */
function registerMusicIpcChannels () {
  registerMusicChannels()
}

module.exports = { registerMusicIpcChannels }