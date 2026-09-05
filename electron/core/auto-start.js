// ============================================================
// 开机自启服务
// 使用 Electron app.setLoginItemSettings 配置开机自启
// Windows 平台同时写入注册表作为兼容方案
// ============================================================

const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const logger = require('./logger.js')

const AUTO_START_KEY = 'autostart'
const REGISTRY_PATH = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'

// 自启动附加参数：用于启动时识别自启动模式并最小化到托盘
// 重要：setLoginItemSettings 与 getLoginItemSettings 的 args 必须一致，
// 否则 Windows 注册表中的命令行参数不匹配，getLoginItemSettings 会返回 openAtLogin=false
const AUTO_START_ARGS = ['--autostart']

/**
 * 判断当前是否运行在开发模式
 * 开发模式下 process.execPath 是 electron.exe，自启动会启动裸 electron 而非应用
 * @returns {boolean}
 */
function isDevMode () {
  return process.env.NODE_ENV === 'development' || !app.isPackaged
}

/**
 * 获取当前自启状态
 * @returns {boolean}
 */
function isEnabled () {
  try {
    // 优先通过 Electron API 查询
    if (process.platform === 'win32') {
      // 必须传入与 setEnabled 时相同的 args，否则参数不匹配会返回 false
      const settings = app.getLoginItemSettings({ args: AUTO_START_ARGS })
      if (settings.openAtLogin !== undefined) {
        return settings.openAtLogin
      }
    }

    // 回退到注册表查询
    const { execSync } = require('child_process')
    const result = execSync(
      `reg query "HKCU\\${REGISTRY_PATH}" /v StarstDesk 2>nul`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return result.includes('StarstDesk')
  } catch (error) {
    logger.warn('AutoStart', `获取自启状态失败: ${error.message}`)
    return false
  }
}

/**
 * 设置开机自启
 * @param {boolean} enabled
 */
function setEnabled (enabled) {
  try {
    if (process.platform === 'win32') {
      // 使用 Electron API 设置
      // args 必须固定，isEnabled 读取时需传入相同 args
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: enabled ? AUTO_START_ARGS : []
      })

      if (enabled) {
        // 同时写入注册表作为兼容方案
        const { execSync } = require('child_process')
        const exePath = process.execPath.replace(/\\/g, '\\\\')
        execSync(
          `reg add "HKCU\\${REGISTRY_PATH}" /v StarstDesk /t REG_SZ /d "${exePath} --autostart" /f`,
          { stdio: 'pipe' }
        )
        logger.info('AutoStart', '开机自启已启用（注册表）')
      } else {
        // 清除注册表
        try {
          const { execSync } = require('child_process')
          execSync(
            `reg delete "HKCU\\${REGISTRY_PATH}" /v StarstDesk /f`,
            { stdio: 'pipe', shell: true }
          )
        } catch (e) { /* 注册表项不存在时忽略 */ }
        logger.info('AutoStart', '开机自启已禁用（注册表）')
      }
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled })
    }
  } catch (error) {
    logger.error('AutoStart', `设置自启失败: ${error.message}`)
  }
}

/**
 * 检查是否为自启动模式（--autostart 参数）
 * @returns {boolean}
 */
function isAutostartMode () {
  return process.argv.includes('--autostart')
}

module.exports = {
  isEnabled,
  setEnabled,
  isAutostartMode,
  isDevMode
}
