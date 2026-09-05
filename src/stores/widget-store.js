// ============================================================
// 桌面小部件 Pinia Store
// 职责：管理小部件列表状态、全局热键配置，封装 widgetApi IPC 调用
// 用于设置页（WidgetSettingsView）和小部件组件共享状态
// ============================================================

import { defineStore } from 'pinia'
import { widgetApi } from '@/utils/ipc-client'

export const useWidgetStore = defineStore('widget', {
  state: () => ({
    // 小部件配置列表
    widgets: [],
    // 全局热键（如 'Ctrl+Alt+D'）
    hotkey: 'Ctrl+Alt+D',
    // 加载状态
    loading: false,
    // 最近一次错误信息
    error: null
  }),

  getters: {
    /**
     * 已启用的小部件列表
     * @returns {Array}
     */
    enabledWidgets (state) {
      return state.widgets.filter(w => Number(w.is_enabled) === 1)
    },

    /**
     * 已禁用的小部件列表
     * @returns {Array}
     */
    disabledWidgets (state) {
      return state.widgets.filter(w => Number(w.is_enabled) !== 1)
    },

    /**
     * 是否有已启用的小部件
     * @returns {boolean}
     */
    hasEnabledWidgets (state) {
      return state.widgets.some(w => Number(w.is_enabled) === 1)
    }
  },

  actions: {
    /**
     * 加载所有小部件配置
     * @returns {Promise<Array>}
     */
    async loadWidgets () {
      this.loading = true
      this.error = null
      try {
        const result = await widgetApi.list()
        this.widgets = Array.isArray(result) ? result : (result?.list || [])
        return this.widgets
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] loadWidgets 失败:', err)
        this.widgets = []
        return []
      } finally {
        this.loading = false
      }
    },

    /**
     * 切换小部件启用/禁用状态
     * @param {string} type 小部件类型
     * @returns {Promise<boolean>} 切换后的启用状态
     */
    async toggleWidget (type) {
      this.error = null
      try {
        const widget = this.widgets.find(w => w.widget_type === type)
        const newEnabled = widget ? (Number(widget.is_enabled) === 1 ? 0 : 1) : 1
        if (newEnabled === 1) {
          // 启用：创建小部件
          await widgetApi.create(type)
        } else {
          // 禁用：删除小部件
          await widgetApi.delete(type)
        }
        // 本地同步更新
        const index = this.widgets.findIndex(w => w.widget_type === type)
        if (index !== -1) {
          this.widgets[index].is_enabled = newEnabled
        }
        return newEnabled === 1
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] toggleWidget 失败:', err)
        throw err
      }
    },

    /**
     * 切换胶囊状态
     * @param {string} type 小部件类型
     * @param {boolean} isCapsule 是否为胶囊形态
     * @returns {Promise<void>}
     */
    async toggleCapsule (type, isCapsule) {
      this.error = null
      try {
        await widgetApi.toggleCapsule(type, isCapsule)
        // 本地同步更新
        const index = this.widgets.findIndex(w => w.widget_type === type)
        if (index !== -1) {
          this.widgets[index].is_capsule = isCapsule ? 1 : 0
        }
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] toggleCapsule 失败:', err)
        throw err
      }
    },

    /**
     * 主进程会调整窗口尺寸以适配胶囊/常规形态，本地同步 is_capsule 字段
     * @param {string} type 小部件类型
     * @param {boolean} isCapsule 是否为胶囊形态
     * @returns {Promise<void>}
     */
    async setCapsule (type, isCapsule) {
      this.error = null
      try {
        await widgetApi.setCapsule(type, isCapsule)
        const index = this.widgets.findIndex(w => w.widget_type === type)
        if (index !== -1) {
          this.widgets.splice(index, 1, { ...this.widgets[index], is_capsule: isCapsule ? 1 : 0 })
        }
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] setCapsule 失败:', err)
        throw err
      }
    },

    /**
     * 更新小部件位置/大小
     * @param {string} type 小部件类型
     * @param {object} bounds { x, y, width, height }
     * @returns {Promise<void>}
     */
    async updateBounds (type, bounds) {
      this.error = null
      try {
        await widgetApi.updateBounds(type, bounds)
        // 本地同步更新
        const index = this.widgets.findIndex(w => w.widget_type === type)
        if (index !== -1) {
          const w = this.widgets[index]
          if (bounds.x !== undefined) w.position_x = bounds.x
          if (bounds.y !== undefined) w.position_y = bounds.y
          if (bounds.width !== undefined) w.width = bounds.width
          if (bounds.height !== undefined) w.height = bounds.height
        }
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] updateBounds 失败:', err)
        throw err
      }
    },

    /**
     * 更新小部件配置（通用）
     * @param {object} data 包含 widget_type 和要更新的字段
     * @returns {Promise<object>}
     */
    async updateWidget (data) {
      this.error = null
      try {
        const result = await widgetApi.update(data)
        // 本地同步更新
        const index = this.widgets.findIndex(w => w.widget_type === data.widget_type)
        if (index !== -1) {
          // 合并主进程返回结果，并用 splice 触发响应式
          // 即使 result 为空或字段不匹配，也用 data 中提交的字段兜底更新
          const merged = {
            ...this.widgets[index],   // 保留原有字段
            ...(result || {}),         // 合并主进程返回结果
            ...data                    // 用提交字段兜底（确保本地立即反映变更）
          }
          this.widgets.splice(index, 1, merged)
        }
        return result
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] updateWidget 失败:', err)
        throw err
      }
    },

    /**
     * 加载全局热键配置
     * @returns {Promise<string>}
     */
    async loadHotkey () {
      this.error = null
      try {
        const result = await widgetApi.getHotkey()
        // 兼容不同响应结构
        const hotkey = typeof result === 'string' ? result : (result?.accelerator || result?.hotkey)
        if (hotkey) {
          this.hotkey = hotkey
        }
        return this.hotkey
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] loadHotkey 失败:', err)
        return this.hotkey
      }
    },

    /**
     * 设置全局热键
     * @param {string} accelerator 热键（如 'Ctrl+Alt+D'）
     * @returns {Promise<boolean>}
     */
    async setHotkey (accelerator) {
      this.error = null
      try {
        await widgetApi.setHotkey(accelerator)
        this.hotkey = accelerator
        return true
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] setHotkey 失败:', err)
        throw err
      }
    },

    /**
     * 显示所有小部件
     * @returns {Promise<void>}
     */
    async showAll () {
      this.error = null
      try {
        await widgetApi.showAll()
        // 本地同步更新可见状态
        this.widgets.forEach(w => { w.is_visible = 1 })
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] showAll 失败:', err)
        throw err
      }
    },

    /**
     * 隐藏所有小部件
     * @returns {Promise<void>}
     */
    async hideAll () {
      this.error = null
      try {
        await widgetApi.hideAll()
        // 本地同步更新可见状态
        this.widgets.forEach(w => { w.is_visible = 0 })
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] hideAll 失败:', err)
        throw err
      }
    },

    /**
     * 切换所有小部件显隐
     * @returns {Promise<void>}
     */
    async toggleAll () {
      this.error = null
      try {
        await widgetApi.toggleAll()
        // 本地同步切换可见状态
        this.widgets.forEach(w => {
          w.is_visible = Number(w.is_visible) === 1 ? 0 : 1
        })
      } catch (err) {
        this.error = err.message
        console.error('[WidgetStore] toggleAll 失败:', err)
        throw err
      }
    },

    /**
     * 重置小部件位置到默认值
     * @param {string} type 小部件类型
     * @param {object} defaultBounds 默认位置 { x, y, width, height }
     * @returns {Promise<void>}
     */
    async resetPosition (type, defaultBounds) {
      return await this.updateBounds(type, defaultBounds)
    }
  }
})

export default useWidgetStore