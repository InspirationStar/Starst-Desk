// ============================================================
// 音乐 Store
// 职责：管理媒体会话状态、播放控制、专辑信息
// ============================================================

import { defineStore } from 'pinia'
import dayjs from 'dayjs'
import { musicApi } from '@/utils/ipc-client'

// 播放模式
const PLAY_MODES = {
  SEQUENTIAL: 'sequential',
  SINGLE: 'single',
  LOOP: 'loop',
  SHUFFLE: 'shuffle'
}

// 布局模式
const LAYOUTS = {
  COVER: 'cover',
  RECORD: 'record',
  COMPACT: 'compact'
}

export const useMusicStore = defineStore('music', {
  state: () => ({
    // 播放状态
    isPlaying: false,
    // 媒体会话对象
    mediaSession: null,
    // 当前歌曲信息
    trackInfo: {
      title: '',
      artist: '',
      album: '',
      albumArt: null,
      duration: 0
    },
    // 当前音量（0-1）
    volume: 1,
    // 是否静音
    isMuted: false,
    // 播放模式
    playMode: PLAY_MODES.SEQUENTIAL,
    // 布局模式
    layout: LAYOUTS.COVER,
    // 专辑主色调
    albumColor: null,
    // 当前进度（秒）
    progress: 0,
    // 总时长（秒）
    duration: 0,
    // 加载状态
    isLoading: false,
    // 错误信息
    error: null
  }),

  getters: {
    /**
     * 当前播放时间显示
     */
    currentTimeDisplay (state) {
      if (!state.progress) return '0:00'
      const minutes = Math.floor(state.progress / 60)
      const seconds = Math.floor(state.progress % 60)
      return `${minutes}:${seconds.toString().padStart(2, '0')}`
    },

    /**
     * 总时间显示
     */
    totalTimeDisplay (state) {
      if (!state.duration) return '0:00'
      const minutes = Math.floor(state.duration / 60)
      const seconds = Math.floor(state.duration % 60)
      return `${minutes}:${seconds.toString().padStart(2, '0')}`
    },

    /**
     * 播放进度百分比
     */
    progressPercent (state) {
      if (!state.duration) return 0
      return (state.progress / state.duration) * 100
    },

    /**
     * 是否为唱片布局
     */
    isRecordLayout (state) {
      return state.layout === LAYOUTS.RECORD
    },

    /**
     * 是否显示封面
     */
    showCover (state) {
      return state.layout !== LAYOUTS.COMPACT
    },

    /**
     * 专辑艺术获取
     */
    albumArtSrc (state) {
      if (!state.trackInfo.albumArt) return null
      return state.trackInfo.albumArt
    },

    /**
     * 播放模式图标
     */
    playModeIcon (state) {
      const icons = {
        [PLAY_MODES.SEQUENTIAL]: 'List',
        [PLAY_MODES.SINGLE]: 'Refresh',
        [PLAY_MODES.LOOP]: 'CircleCheck',
        [PLAY_MODES.SHUFFLE]: 'SwitchButton'
      }
      return icons[state.playMode] || 'List'
    }
  },

  actions: {
    /**
     * 初始化媒体会话
     */
    initMediaSession () {
      try {
        if ('mediaSession' in navigator) {
          this.mediaSession = navigator.mediaSession
          this.setupMediaSessionHandlers()
        }
      } catch (err) {
        console.error('[MusicStore] 初始化媒体会话失败:', err)
      }
    },

    /**
     * 设置媒体会话处理器
     */
    setupMediaSessionHandlers () {
      if (!this.mediaSession) return

      this.mediaSession.setActionHandler('play', () => this.togglePlay())
      this.mediaSession.setActionHandler('pause', () => this.togglePlay())
      this.mediaSession.setActionHandler('previoustrack', () => this.prevTrack())
      this.mediaSession.setActionHandler('nexttrack', () => this.nextTrack())
      this.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime) {
          this.progress = details.seekTime
        }
      })
      this.mediaSession.setActionHandler('stop', () => this.pause())
    },

    /**
     * 更新曲目信息
     * @param {object} info
     */
    updateTrackInfo (info) {
      this.trackInfo = { ...this.trackInfo, ...info }
      this.duration = info.duration || 0

      // 更新媒体会话元数据
      if (this.mediaSession && 'metadata' in this.mediaSession) {
        this.mediaSession.metadata = new MediaMetadata({
          title: info.title || '未知歌曲',
          artist: info.artist || '未知艺术家',
          album: info.album || '未知专辑',
          artwork: info.albumArt ? [{ src: info.albumArt, sizes: '512x512', type: 'image/jpeg' }] : []
        })
      }
    },

    /**
     * 切换播放状态
     */
    async togglePlay () {
      try {
        await musicApi.togglePlay()
        this.isPlaying = !this.isPlaying
        if (this.isPlaying) {
          this.startProgressTracking()
        } else {
          this.stopProgressTracking()
        }
      } catch (err) {
        console.error('[MusicStore] togglePlay 失败:', err)
        throw err
      }
    },

    /**
     * 播放
     */
    async play () {
      this.isPlaying = true
      try {
        await musicApi.play()
        this.startProgressTracking()
      } catch (err) {
        console.error('[MusicStore] play 失败:', err)
        throw err
      }
    },

    /**
     * 暂停
     */
    async pause () {
      this.isPlaying = false
      try {
        await musicApi.pause()
        this.stopProgressTracking()
      } catch (err) {
        console.error('[MusicStore] pause 失败:', err)
        throw err
      }
    },

    /**
     * 下一首
     */
    async nextTrack () {
      try {
        await musicApi.nextTrack()
      } catch (err) {
        console.error('[MusicStore] nextTrack 失败:', err)
        throw err
      }
    },

    /**
     * 上一首
     */
    async prevTrack () {
      try {
        await musicApi.prevTrack()
      } catch (err) {
        console.error('[MusicStore] prevTrack 失败:', err)
        throw err
      }
    },

    /**
     * 设置音量
     * @param {number} volume
     */
    async setVolume (volume) {
      this.volume = Math.max(0, Math.min(1, volume))
      this.isMuted = this.volume === 0
      try {
        await musicApi.setVolume(this.volume)
      } catch (err) {
        console.error('[MusicStore] setVolume 失败:', err)
        throw err
      }
    },

    /**
     * 切换静音
     */
    async toggleMute () {
      this.isMuted = !this.isMuted
      const newVolume = this.isMuted ? 0 : (this.volume || 0.5)
      await this.setVolume(newVolume)
    },

    /**
     * 设置播放模式
     * @param {string} mode
     */
    setPlayMode (mode) {
      const modes = Object.values(PLAY_MODES)
      if (modes.includes(mode)) {
        this.playMode = mode
      }
    },

    /**
     * 循环切换播放模式
     */
    cyclePlayMode () {
      const modes = Object.values(PLAY_MODES)
      const currentIndex = modes.indexOf(this.playMode)
      const nextIndex = (currentIndex + 1) % modes.length
      this.playMode = modes[nextIndex]
    },

    /**
     * 设置布局模式
     * @param {string} layout
     */
    setLayout (layout) {
      const layouts = Object.values(LAYOUTS)
      if (layouts.includes(layout)) {
        this.layout = layout
      }
    },

    /**
     * 循环切换布局
     */
    cycleLayout () {
      const layouts = Object.values(LAYOUTS)
      const currentIndex = layouts.indexOf(this.layout)
      const nextIndex = (currentIndex + 1) % layouts.length
      this.layout = layouts[nextIndex]
    },

    /**
     * 更新播放进度
     * @param {number} progress
     */
    updateProgress (progress) {
      this.progress = progress
    },

    /**
     * 提取专辑色彩
     * @param {string} imageUrl
     */
    async extractAlbumColor (imageUrl) {
      try {
        // TODO: 使用 color-thief 或其他库提取主色调
        // const colorThief = new ColorThief()
        // const color = colorThief.getColor(await loadImage(imageUrl))
        // this.albumColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`
        console.log('[MusicStore] 提取专辑色彩:', imageUrl)
      } catch (err) {
        console.error('[MusicStore] extractAlbumColor 失败:', err)
      }
    },

    /**
     * 开始进度追踪
     */
    startProgressTracking () {
      if (this.progressTimer) return
      this.progressTimer = setInterval(() => {
        if (this.isPlaying && this.duration > 0) {
          this.progress += 1
          if (this.progress >= this.duration) {
            this.progress = 0
            // 自动播放下一首
            this.nextTrack()
          }
        }
      }, 1000)
    },

    /**
     * 停止进度追踪
     */
    stopProgressTracking () {
      if (this.progressTimer) {
        clearInterval(this.progressTimer)
        this.progressTimer = null
      }
    },

    /**
     * 清理
     */
    cleanup () {
      this.stopProgressTracking()
    }
  }
})

export default useMusicStore