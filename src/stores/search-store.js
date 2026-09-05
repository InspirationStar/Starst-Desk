// ============================================================
// 搜索 Store
// 职责：管理搜索结果、历史、收藏、选中项
// ============================================================

import { defineStore } from 'pinia'
import dayjs from 'dayjs'

export const useSearchStore = defineStore('search', {
  state: () => ({
    // 当前搜索词
    query: '',
    // 搜索结果列表
    results: [],
    // 搜索历史
    history: [],
    // 收藏夹
    favorites: [],
    // 选中项
    selectedItems: [],
    // 当前筛选类型
    filterType: 'all', // 'all' | 'file' | 'folder' | 'app' | 'settings'
    // 加载状态
    isLoading: false,
    // 错误信息
    error: null,
    // 上次搜索时间
    lastSearchTime: null
  }),

  getters: {
    /**
     * 当前筛选后的结果
     */
    filteredResults (state) {
      if (state.filterType === 'all') {
        return state.results
      }
      return state.results.filter(result => result.type === state.filterType)
    },

    /**
     * 是否有选中项
     */
    hasSelection (state) {
      return state.selectedItems.length > 0
    },

    /**
     * 选中项数量
     */
    selectedCount (state) {
      return state.selectedItems.length
    },

    /**
     * 热门搜索词（按出现次数排序）
     */
    popularHistory (state) {
      return [...state.history]
        .sort((a, b) => (b.count || 1) - (a.count || 1))
        .slice(0, 10)
    },

    /**
     * 格式化文件大小
     */
    formatFileSize () {
      return (bytes) => {
        if (!bytes || bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
      }
    },

    /**
     * 格式化日期
     */
    formatDate () {
      return (date) => {
        if (!date) return ''
        return dayjs(date).format('YYYY-MM-DD HH:mm')
      }
    }
  },

  actions: {
    /**
     * 执行搜索
     * @param {string} query
     * @returns {Promise<Array>}
     */
    async search (query) {
      this.isLoading = true
      this.error = null
      this.query = query
      this.lastSearchTime = new Date().toISOString()

      try {
        // 调用主进程聚合搜索 IPC
        const { invoke } = await import('@/utils/ipc-client')
        const result = await invoke('search:query', {
          query,
          type: this.filterType,
          limit: 50
        })
        this.results = Array.isArray(result?.results) ? result.results : []
        if (Array.isArray(result?.history)) {
          this.history = result.history
        }
        return this.results
      } catch (err) {
        this.error = err.message
        console.error('[SearchStore] search 失败:', err)
        this.results = []
        return []
      } finally {
        this.isLoading = false
      }
    },

    /**
     * 添加到搜索历史
     * @param {string} query
     */
    addToHistory (query) {
      if (!query || query.trim() === '') return

      const existing = this.history.find(h => h.query === query)
      if (existing) {
        existing.count = (existing.count || 1) + 1
        existing.lastTime = new Date().toISOString()
      } else {
        this.history.unshift({
          query,
          count: 1,
          lastTime: new Date().toISOString()
        })
      }

      // 限制历史记录数量
      if (this.history.length > 50) {
        this.history = this.history.slice(0, 50)
      }
    },

    /**
     * 从历史中移除
     * @param {string} query
     */
    removeFromHistory (query) {
      this.history = this.history.filter(h => h.query !== query)
    },

    /**
     * 清除所有历史
     */
    clearHistory () {
      this.history = []
    },

    /**
     * 添加到收藏
     * @param {object} result
     */
    addToFavorites (result) {
      if (!result || !result.path) return

      const existing = this.favorites.find(f => f.path === result.path)
      if (!existing) {
        this.favorites.unshift({
          ...result,
          favoritedAt: new Date().toISOString()
        })
      }
    },

    /**
     * 从收藏中移除
     * @param {string} path
     */
    removeFromFavorites (path) {
      this.favorites = this.favorites.filter(f => f.path !== path)
    },

    /**
     * 切换收藏状态
     * @param {object} result
     * @returns {boolean} 是否已收藏
     */
    toggleFavorite (result) {
      const index = this.favorites.findIndex(f => f.path === result.path)
      if (index !== -1) {
        this.favorites.splice(index, 1)
        return false
      } else {
        this.addToFavorites(result)
        return true
      }
    },

    /**
     * 选中/取消选中结果项
     * @param {string} path
     * @param {boolean} selected
     * @param {boolean} extend
     */
    toggleSelect (path, selected = true, extend = false) {
      if (extend && this.selectedItems.length > 0) {
        // 扩展选中
        const lastIndex = this.results.findIndex(r => r.path === this.selectedItems[this.selectedItems.length - 1])
        const currentIndex = this.results.findIndex(r => r.path === path)
        const start = Math.min(lastIndex, currentIndex)
        const end = Math.max(lastIndex, currentIndex)
        const range = this.results.slice(start, end + 1).map(r => r.path)
        this.selectedItems = selected ? [...new Set([...this.selectedItems, ...range])] : this.selectedItems.filter(p => !range.includes(p))
      } else {
        const index = this.selectedItems.indexOf(path)
        if (selected) {
          if (index === -1) {
            this.selectedItems.push(path)
          }
        } else {
          if (index !== -1) {
            this.selectedItems.splice(index, 1)
          }
        }
      }
    },

    /**
     * 全选
     */
    selectAll () {
      this.selectedItems = this.results.map(r => r.path)
    },

    /**
     * 取消全选
     */
    deselectAll () {
      this.selectedItems = []
    },

    /**
     * 设置筛选类型
     * @param {'all'|'file'|'folder'|'app'|'settings'} type
     */
    setFilterType (type) {
      if (['all', 'file', 'folder', 'app', 'settings'].includes(type)) {
        this.filterType = type
        this.selectedItems = []
      }
    },

    /**
     * 批量打开
     */
    async batchOpen () {
      if (this.selectedItems.length === 0) return
      try {
        // TODO: 调用 IPC 批量打开
        // await searchApi.batchOpen(this.selectedItems)
        console.log('[SearchStore] 批量打开:', this.selectedItems)
      } catch (err) {
        console.error('[SearchStore] batchOpen 失败:', err)
        throw err
      }
    },

    /**
     * 批量在资源管理器中显示
     */
    async batchReveal () {
      if (this.selectedItems.length === 0) return
      try {
        // TODO: 调用 IPC 批量显示
        // await searchApi.batchReveal(this.selectedItems)
        console.log('[SearchStore] 批量显示:', this.selectedItems)
      } catch (err) {
        console.error('[SearchStore] batchReveal 失败:', err)
        throw err
      }
    },

    /**
     * 批量删除
     */
    async batchDelete () {
      if (this.selectedItems.length === 0) return
      try {
        // TODO: 调用 IPC 批量删除
        // await searchApi.batchDelete(this.selectedItems)
        this.selectedItems = []
        console.log('[SearchStore] 批量删除完成')
      } catch (err) {
        console.error('[SearchStore] batchDelete 失败:', err)
        throw err
      }
    },

    /**
     * 复制选中项路径
     */
    async copyPaths () {
      if (this.selectedItems.length === 0) return
      try {
        // TODO: 调用 IPC 复制到剪切板
        // await searchApi.copyPaths(this.selectedItems)
        const text = this.selectedItems.join('\n')
        await navigator.clipboard.writeText(text)
        console.log('[SearchStore] 路径已复制到剪切板')
      } catch (err) {
        console.error('[SearchStore] copyPaths 失败:', err)
        throw err
      }
    }
  }
})

export default useSearchStore