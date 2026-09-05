// ============================================================
// 音乐服务（主进程）
// 职责：监听媒体会话、控制播放、获取封面、会话持久化
// ============================================================

const { ipcMain, shell } = require('electron')
const https = require('https')
const fs = require('fs').promises
const path = require('path')
const os = require('os')
// 复用已有应用设置 DAO：音乐会话持久化（currentTrack/isPlaying/volume）
const appSettingDao = require('../dao/app-setting-dao.js')
const logger = require('../core/logger.js')

// ============================================================
// 状态管理
// ============================================================

let currentTrack = {
  title: '',
  artist: '',
  album: '',
  albumArt: null,
  duration: 0
}
let isPlaying = false
let volume = 1
let lastPositionUpdate = 0

// ============================================================
// 会话持久化（复用 app-setting-dao）
// ============================================================
const SESSION_KEY = 'music_session'

/**
 * 从 app-setting-dao 加载音乐会话状态
 * 恢复 currentTrack 和 volume，但 isPlaying 强制为 false（避免重启后自动播放打扰用户）
 */
function loadMusicSession () {
  try {
    const session = appSettingDao.getJson(SESSION_KEY, null)
    if (session && typeof session === 'object') {
      // 恢复 track 信息
      if (session.currentTrack && typeof session.currentTrack === 'object') {
        currentTrack = { ...currentTrack, ...session.currentTrack }
      }
      // 恢复音量
      if (typeof session.volume === 'number') {
        volume = Math.max(0, Math.min(1, session.volume))
      }
      // 不恢复 isPlaying（重启后不自动播放）
      isPlaying = false
      logger.info('MusicService', `音乐会话已恢复: track="${currentTrack.title}", volume=${volume}`)
    }
  } catch (error) {
    logger.warn('MusicService', `加载音乐会话失败: ${error.message}`)
  }
}

/**
 * 将当前会话状态保存到 app-setting-dao
 */
function saveMusicSession () {
  try {
    appSettingDao.setJson(SESSION_KEY, {
      currentTrack,
      isPlaying,
      volume
    })
  } catch (error) {
    logger.warn('MusicService', `保存音乐会话失败: ${error.message}`)
  }
}

// ============================================================
// IPC 处理器
// ============================================================

/**
 * 注册音乐服务相关的 IPC 通道
 */
function registerMusicChannels () {
  // 获取当前播放状态
  ipcMain.handle('music:get-status', async (event, data) => {
    try {
      return {
        isPlaying,
        volume,
        track: currentTrack
      }
    } catch (error) {
      console.error('[MusicService] music:get-status 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 切换播放状态
  ipcMain.handle('music:toggle-play', async (event, data) => {
    try {
      // 使用 Windows Media Session API
      await sendMediaCommand('playpause')
      isPlaying = !isPlaying
      saveMusicSession()
      return { isPlaying }
    } catch (error) {
      console.error('[MusicService] music:toggle-play 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 播放
  ipcMain.handle('music:play', async (event, data) => {
    try {
      await sendMediaCommand('play')
      isPlaying = true
      saveMusicSession()
      return { isPlaying: true }
    } catch (error) {
      console.error('[MusicService] music:play 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 暂停
  ipcMain.handle('music:pause', async (event, data) => {
    try {
      await sendMediaCommand('pause')
      isPlaying = false
      saveMusicSession()
      return { isPlaying: false }
    } catch (error) {
      console.error('[MusicService] music:pause 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 下一首
  ipcMain.handle('music:next-track', async (event, data) => {
    try {
      await sendMediaCommand('next')
      return { success: true }
    } catch (error) {
      console.error('[MusicService] music:next-track 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 上一首
  ipcMain.handle('music:prev-track', async (event, data) => {
    try {
      await sendMediaCommand('previous')
      return { success: true }
    } catch (error) {
      console.error('[MusicService] music:prev-track 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 设置音量
  ipcMain.handle('music:set-volume', async (event, data) => {
    try {
      const { volume: newVolume } = data
      volume = Math.max(0, Math.min(1, newVolume))
      await setSystemVolume(volume)
      saveMusicSession()
      return { volume }
    } catch (error) {
      console.error('[MusicService] music:set-volume 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 更新进度
  ipcMain.handle('music:update-progress', async (event, data) => {
    try {
      const { position } = data
      lastPositionUpdate = Date.now()
      return { position }
    } catch (error) {
      console.error('[MusicService] music:update-progress 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 更新当前曲目信息（渲染进程上报媒体会话元数据）
  ipcMain.handle('music:update-track', async (event, data) => {
    try {
      const { track } = data || {}
      if (track && typeof track === 'object') {
        currentTrack = { ...currentTrack, ...track }
        saveMusicSession()
      }
      return { track: currentTrack }
    } catch (error) {
      console.error('[MusicService] music:update-track 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 打开媒体应用
  ipcMain.handle('music:open-app', async (event, data) => {
    try {
      // 打开默认媒体播放器
      await shell.openPath('ms-settings:apps-default')
      return { success: true }
    } catch (error) {
      console.error('[MusicService] music:open-app 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 启动时恢复上次音乐会话（不自动播放，仅恢复 track 信息和 volume）
  loadMusicSession()
}

// ============================================================
// 媒体控制
// ============================================================

/**
 * 发送媒体命令（使用 Windows.Media API）
 * @param {string} command
 */
async function sendMediaCommand (command) {
  // 注意：Electron 主进程无法直接调用 Windows.Media API
  // 这里使用 PowerShell 脚本作为替代方案
  const { exec } = require('child_process')

  const commands = {
    playpause: 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{MEDIA_PLAY_PAUSE}")',
    play: 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{MEDIA_PLAY}")',
    pause: 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{MEDIA_PAUSE}")',
    next: 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{MEDIA_NEXT}")',
    previous: 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{MEDIA_PREV}")'
  }

  return new Promise((resolve, reject) => {
    const cmd = commands[command]
    if (!cmd) {
      reject(new Error(`未知命令: ${command}`))
      return
    }

    exec(`powershell -Command "${cmd}"`, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

/**
 * 设置系统音量
 * @param {number} volume
 */
async function setSystemVolume (volume) {
  // 注意：实际音量控制需要管理员权限或特定的 Windows API
  // 这里仅记录音量值供渲染进程使用
  volume = Math.max(0, Math.min(1, volume))
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  registerMusicChannels,
  getCurrentTrack: () => currentTrack,
  getIsPlaying: () => isPlaying,
  getVolume: () => volume,
  // 会话持久化
  loadMusicSession,
  saveMusicSession
}