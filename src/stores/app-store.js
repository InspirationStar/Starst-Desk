// ============================================================
// 应用全局 Pinia Store
// 职责：管理主题、强调色、侧边栏折叠、关闭窗口行为、开机自启等全局状态
// 通过 IPC 与主进程同步配置（system:setting:get/set）
// ============================================================

import { defineStore } from 'pinia'
import { systemApi } from '@/utils/ipc-client'


// 主题支持的取值
const THEME_VALUES = ['light', 'dark', 'auto']

// 关闭窗口行为支持的取值
const CLOSE_BEHAVIOR_VALUES = ['minimize', 'quit']

const DEFAULT_ACCENT_COLOR = '#0078D4'

// 桌宠气泡字体大小范围（px）
// 默认值 14px 对齐主聊天界面 MarkdownRenderer 的 font-size
const PET_BUBBLE_FONT_SIZE_MIN = 12
const PET_BUBBLE_FONT_SIZE_MAX = 20
const PET_BUBBLE_FONT_SIZE_DEFAULT = 14

/**
 * 将 hex 颜色转换为 rgba 字符串
 * 支持 #RGB / #RRGGBB 格式
 * @param {string} hex 颜色值（如 '#0078D4'）
 * @param {number} [alpha=1] 透明度
 * @returns {string} rgba 字符串（如 'rgba(0, 120, 212, 0.09)'）
 */
function hexToRgba (hex, alpha = 1) {
  if (!hex || typeof hex !== 'string') return `rgba(0, 120, 212, ${alpha})`
  let h = hex.trim().replace('#', '')
  // 处理缩写 #RGB
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('')
  }
  if (h.length !== 6) return `rgba(0, 120, 212, ${alpha})`
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  if ([r, g, b].some(n => isNaN(n))) return `rgba(0, 120, 212, ${alpha})`
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 将主题应用到 DOM
 * - auto：根据系统 prefers-color-scheme 自动选择
 * - dark：添加 dark 类
 * - light：移除 dark 类
 * @param {string} theme 主题名
 */
function applyThemeToDom (theme) {
  const html = document.documentElement
  let isDark = false
  if (theme === 'dark') {
    isDark = true
  } else if (theme === 'auto') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  html.classList.toggle('dark', isDark)
  // 同步 data-theme 属性，组件暗色样式使用 [data-theme='dark'] 选择器
  html.setAttribute('data-theme', isDark ? 'dark' : 'light')
  // 派发主题变化事件，通知材质层（如 WidgetApp）重算材质 class 与字体颜色
  // 材质 class 与 dark class 需协同：主题切换后材质选择器命中状态可能改变
  // 仅在 window 存在时派发（防御 SSR/测试环境）
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('app:theme-changed', { detail: { isDark } }))
  }
}

/**
 * 将强调色应用到 DOM
 * 覆盖 Element Plus 主色与小部件强调色相关 CSS 变量
 * 应用范围：
 * - --el-color-primary：Element Plus 主色（按钮、链接、选中态等）
 * - --widget-accent：小部件强调色
 * - --widget-accent-wash：小部件强调色洗涤（半透明背景）
 * @param {string} color hex 颜色值（如 '#0078D4'）
 */
function applyAccentToDom (color) {
  if (!color || typeof color !== 'string') return
  const html = document.documentElement
  // Element Plus 主色
  html.style.setProperty('--el-color-primary', color)
  // 小部件强调色
  html.style.setProperty('--widget-accent', color)
  // 小部件强调色洗涤（alpha 0.09，对齐 widget.scss 默认值）
  html.style.setProperty('--widget-accent-wash', hexToRgba(color, 0.09))
}

export const useAppStore = defineStore('app', {
  state: () => ({
    // 当前主题：light / dark / auto
    theme: 'light',
    // 强调色（hex 格式，如 '#0078D4'）
    accentColor: DEFAULT_ACCENT_COLOR,
    // 侧边栏折叠状态
    sidebarCollapsed: false,
    // 关闭窗口行为：minimize（最小化到托盘）/ quit（退出应用）
    closeBehavior: 'minimize',
    // 开机自启状态
    autoStart: false,
    // 是否开发模式（开发模式下自启动可能不生效，用于 UI 提示）
    autoStartDevMode: false,
    // 桌宠气泡字体大小（px，范围 12-20，默认 14 对齐主聊天界面）
    petBubbleFontSize: PET_BUBBLE_FONT_SIZE_DEFAULT,
    // 应用是否准备就绪
    ready: false,
    // 应用版本号
    version: '1.0.0'
  }),

  getters: {
    /**
     * 当前实际生效是否为深色模式
     */
    isDark (state) {
      if (state.theme === 'dark') return true
      if (state.theme === 'auto') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches
      }
      return false
    }
  },

  actions: {
    /**
     * 设置主题并应用
     * @param {string} theme 主题名（light / dark / auto）
     */
    async setTheme (theme) {
      if (!THEME_VALUES.includes(theme)) {
        console.warn('[AppStore] 无效主题:', theme)
        return
      }
      this.theme = theme
      applyThemeToDom(theme)
      // 持久化到主进程
      try {
        await systemApi.setSetting('theme', theme)
      } catch (err) {
        console.error('[AppStore] 保存主题失败:', err)
      }
    },

    /**
     * 设置强调色并应用
     * 持久化到 app_settings 表，并应用到 DOM CSS 变量
     * 主进程会向所有小部件窗口广播 app:setting-changed 事件
     * @param {string} color hex 颜色值（如 '#0078D4'）
     */
    async setAccentColor (color) {
      if (!color || typeof color !== 'string') {
        console.warn('[AppStore] 无效强调色:', color)
        return
      }
      this.accentColor = color
      applyAccentToDom(color)
      // 持久化到主进程
      try {
        await systemApi.setSetting('accent_color', color)
      } catch (err) {
        console.error('[AppStore] 保存强调色失败:', err)
      }
    },

    /**
     * 同步强调色（仅更新状态与 DOM，不持久化）
     * 用于接收主进程广播的 app:setting-changed 事件：其他窗口修改强调色后，
     * 本窗口通过此方法同步状态与 DOM，避免重复写入造成循环
     * @param {string} color hex 颜色值（如 '#0078D4'）
     */
    syncAccentColor (color) {
      if (!color || typeof color !== 'string') {
        console.warn('[AppStore] 无效强调色（同步）:', color)
        return
      }
      this.accentColor = color
      applyAccentToDom(color)
    },

    /**
     * 同步主题（仅更新状态与 DOM，不持久化）
     * 用于接收主进程广播的 app:setting-changed 事件：其他窗口切换主题后，
     * 本窗口（如桌宠窗口）通过此方法同步状态与 DOM，避免重复写入造成循环
     * @param {string} theme 主题名（light / dark / auto）
     */
    syncTheme (theme) {
      if (!THEME_VALUES.includes(theme)) {
        console.warn('[AppStore] 无效主题（同步）:', theme)
        return
      }
      this.theme = theme
      applyThemeToDom(theme)
    },

    /**
     * 设置桌宠气泡字体大小并持久化
     * @param {number} size 字体大小（px，范围 12-20）
     */
    async setPetBubbleFontSize (size) {
      const num = typeof size === 'number' ? size : parseInt(size, 10)
      if (isNaN(num) || num < PET_BUBBLE_FONT_SIZE_MIN || num > PET_BUBBLE_FONT_SIZE_MAX) {
        console.warn('[AppStore] 无效桌宠气泡字体大小:', size)
        return
      }
      this.petBubbleFontSize = num
      try {
        await systemApi.setSetting('pet_bubble_font_size', String(num))
      } catch (err) {
        console.error('[AppStore] 保存桌宠气泡字体大小失败:', err)
      }
    },

    /**
     * 同步桌宠气泡字体大小（仅更新状态，不持久化）
     * 用于接收主进程广播的 app:setting-changed 事件
     * @param {number|string} size 字体大小（px）
     */
    syncPetBubbleFontSize (size) {
      const num = typeof size === 'number' ? size : parseInt(size, 10)
      if (isNaN(num) || num < PET_BUBBLE_FONT_SIZE_MIN || num > PET_BUBBLE_FONT_SIZE_MAX) {
        console.warn('[AppStore] 无效桌宠气泡字体大小（同步）:', size)
        return
      }
      this.petBubbleFontSize = num
    },

    /**
     * 切换侧边栏折叠状态
     */
    toggleSidebar () {
      this.sidebarCollapsed = !this.sidebarCollapsed
      // 持久化折叠状态
      systemApi.setSetting('sidebar_collapsed', this.sidebarCollapsed).catch(() => {})
    },

    /**
     * 设置关闭窗口行为
     * @param {string} behavior minimize / quit
     */
    async setCloseBehavior (behavior) {
      if (!CLOSE_BEHAVIOR_VALUES.includes(behavior)) return
      this.closeBehavior = behavior
      try {
        await systemApi.setSetting('close_behavior', behavior)
      } catch (err) {
        console.error('[AppStore] 保存关闭行为失败:', err)
      }
    },

    /**
     * 设置开机自启
     * @param {boolean} enabled 是否启用
     */
    async setAutoStart (enabled) {
      try {
        await systemApi.setAutoStart(enabled)
        this.autoStart = enabled
      } catch (err) {
        console.error('[AppStore] 设置开机自启失败:', err)
        throw err
      }
    },

    /**

     * 标记应用就绪
     */
    setReady () {
      this.ready = true
    },

    /**
     * 初始化应用配置：从主进程读取已保存的设置
     * 在 App.vue 挂载时调用
     */
    async init () {
      // 读取主题
      try {
        const { value: theme } = await systemApi.getSetting('theme')
        if (theme && THEME_VALUES.includes(theme)) {
          this.theme = theme
        }
      } catch (err) {
        console.warn('[AppStore] 读取主题失败，使用默认值:', err.message)
      }
      applyThemeToDom(this.theme)

      // 读取强调色并应用
      try {
        const { value: accentColor } = await systemApi.getSetting('accent_color')
        if (accentColor && typeof accentColor === 'string') {
          this.accentColor = accentColor
        }
      } catch (err) {
        console.warn('[AppStore] 读取强调色失败，使用默认值:', err.message)
      }
      applyAccentToDom(this.accentColor)

      // 读取侧边栏折叠状态
      try {
        const { value: collapsed } = await systemApi.getSetting('sidebar_collapsed')
        if (typeof collapsed === 'boolean') {
          this.sidebarCollapsed = collapsed
        }
      } catch (err) {
        // 忽略：使用默认值
      }

      // 读取关闭窗口行为
      try {
        const { value: behavior } = await systemApi.getSetting('close_behavior')
        if (behavior && CLOSE_BEHAVIOR_VALUES.includes(behavior)) {
          this.closeBehavior = behavior
        }
      } catch (err) {
        // 忽略：使用默认值
      }

      // 读取开机自启状态
      try {
        const { enabled, devMode } = await systemApi.getAutoStart()
        this.autoStart = !!enabled
        this.autoStartDevMode = !!devMode
      } catch (err) {
        // 忽略：使用默认值
      }

      // 读取桌宠气泡字体大小
      try {
        const { value: fontSize } = await systemApi.getSetting('pet_bubble_font_size')
        const num = parseInt(fontSize, 10)
        if (!isNaN(num) && num >= PET_BUBBLE_FONT_SIZE_MIN && num <= PET_BUBBLE_FONT_SIZE_MAX) {
          this.petBubbleFontSize = num
        }
      } catch (err) {
        // 忽略：使用默认值
      }


      // 监听系统主题变化（auto 模式下实时切换）
      if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        mediaQuery.addEventListener('change', () => {
          if (this.theme === 'auto') {
            applyThemeToDom('auto')
          }
        })
      }

      this.setReady()
    }
  }
})

export default useAppStore
