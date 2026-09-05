// ============================================================
// 天气 IPC 通道注册
// ============================================================

const { register, success, failure } = require('./registry')
const { registerWeatherChannels } = require('../services/weather-service')

/**
 * 注册所有天气相关的 IPC 通道
 */
function registerWeatherIpcChannels () {
  registerWeatherChannels()
}

module.exports = { registerWeatherIpcChannels }