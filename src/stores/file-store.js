// ============================================================
// 文件管理 Store
// 职责：管理文件格子状态、文件夹浏览、文件操作
// ============================================================

import { defineStore } from 'pinia'
import { fileApi } from '@/utils/ipc-client'
import dayjs from 'dayjs'

export const useFileStore = defineStore('file', {
  state: () => ({
    // 文件格子配置列表
    widgets: [],
    // 当前查看路径
    currentPath: '',
    // 布局模式：'icon' | 'list'
    layout: 'icon',
    // 排序方式
    sortBy: 'name',
    sortOrder: 'asc',
    // 文件列表
    files: [],
    // 选中项
    selectedItems: [],
    // 剪切板
    clipboard: {
      items: [],
      operation: null // 'copy' | 'cut'
    },
    // 加载状态
    loading: false,
    // 错误信息
    error: null
  }),

  getters: {
    /**
     * 当前格子的文件列表
     */
    currentFiles (state) {
      return state.files
    },

    /**
     * 选中项数量
     */
    selectedCount (state) {
      return state.selectedItems.length
    },

    /**
     * 是否有任何选中项
     */
    hasSelection (state) {
      return state.selectedItems.length > 0
    },

    /**
     * 是否可以复制
     */
    canCopy (state) {
      return state.selectedItems.length > 0
    },

    /**
     * 是否可以剪切
     */
    canCut (state) {
      return state.selectedItems.length > 0
    },

    /**
     * 是否可以粘贴
     */
    canPaste (state) {
      return state.clipboard.operation !== null && state.clipboard.items.length > 0
    },

    /**
     * 是否可以删除
     */
    canDelete (state) {
      return state.selectedItems.length > 0
    },

    /**
     * 格式化文件大小
     */
    formatFileSize () {
      return (bytes) => {
        if (bytes === 0) return '0 B'
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
     * 加载文件格子列表
     * @returns {Promise<Array>}
     */
    async loadWidgets () {
      this.loading = true
      this.error = null
      try {
        const result = await fileApi.listWidgets()
        this.widgets = Array.isArray(result) ? result : (result?.list || [])
        return this.widgets
      } catch (err) {
        this.error = err.message
        console.error('[FileStore] loadWidgets 失败:', err)
        this.widgets = []
        return []
      } finally {
        this.loading = false
      }
    },

    /**
     * 加载文件夹内容
     * @param {string} path 文件夹路径
     * @returns {Promise<Array>}
     */
    async loadFiles (path) {
      this.loading = true
      this.error = null
      this.currentPath = path
      try {
        const result = await fileApi.listFiles(path)
        this.files = Array.isArray(result) ? result : []
        this.selectedItems = []
        return this.files
      } catch (err) {
        this.error = err.message
        console.error('[FileStore] loadFiles 失败:', err)
        this.files = []
        return []
      } finally {
        this.loading = false
      }
    },

    /**
     * 设置布局模式
     * @param {'icon'|'list'} layout
     */
    setLayout (layout) {
      if (['icon', 'list'].includes(layout)) {
        this.layout = layout
      }
    },

    /**
     * 设置排序方式
     * @param {'name'|'date'|'type'|'size'} sortBy
     * @param {'asc'|'desc'} sortOrder
     */
    setSort (sortBy, sortOrder = 'asc') {
      if (['name', 'date', 'type', 'size'].includes(sortBy)) {
        this.sortBy = sortBy
        this.sortOrder = sortOrder
        this._sortFiles()
      }
    },

    /**
     * 内部排序文件列表
     */
    _sortFiles () {
      const sorted = [...this.files].sort((a, b) => {
        let comparison = 0
        switch (this.sortBy) {
          case 'name':
            comparison = a.name.localeCompare(b.name)
            break
          case 'date':
            comparison = new Date(a.dateModified || a.dateCreated) - new Date(b.dateModified || b.dateCreated)
            break
          case 'type':
            comparison = (a.type || '').localeCompare(b.type || '')
            break
          case 'size':
            comparison = (a.size || 0) - (b.size || 0)
            break
        }
        return this.sortOrder === 'asc' ? comparison : -comparison
      })
      this.files = sorted
    },

    /**
     * 选中/取消选中文件项
     * @param {string} path 文件路径
     * @param {boolean} selected 是否选中
     * @param {boolean} extend 是否扩展选中范围
     */
    toggleSelect (path, selected = true, extend = false) {
      if (extend && this.selectedItems.length > 0) {
        // 扩展选中：选中从最后一项到当前项之间的所有项
        const lastIndex = this.files.findIndex(f => f.path === this.selectedItems[this.selectedItems.length - 1])
        const currentIndex = this.files.findIndex(f => f.path === path)
        const start = Math.min(lastIndex, currentIndex)
        const end = Math.max(lastIndex, currentIndex)
        const range = this.files.slice(start, end + 1).map(f => f.path)
        this.selectedItems = selected ? [...range] : this.selectedItems.filter(p => !range.includes(p))
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
     * 全选文件
     */
    selectAll () {
      this.selectedItems = this.files.map(f => f.path)
    },

    /**
     * 取消全选
     */
    deselectAll () {
      this.selectedItems = []
    },

    /**
     * 复制选中项
     */
    async copyItems () {
      if (this.selectedItems.length === 0) return
      try {
        await fileApi.copyItems(this.selectedItems)
        this.clipboard = {
          items: [...this.selectedItems],
          operation: 'copy'
        }
      } catch (err) {
        console.error('[FileStore] copyItems 失败:', err)
        throw err
      }
    },

    /**
     * 剪切选中项
     */
    async cutItems () {
      if (this.selectedItems.length === 0) return
      try {
        await fileApi.cutItems(this.selectedItems)
        this.clipboard = {
          items: [...this.selectedItems],
          operation: 'cut'
        }
      } catch (err) {
        console.error('[FileStore] cutItems 失败:', err)
        throw err
      }
    },

    /**
     * 粘贴项
     * @param {string} destPath 目标路径
     */
    async pasteItems (destPath) {
      if (!this.canPaste) return
      try {
        if (this.clipboard.operation === 'copy') {
          await fileApi.copyItems(this.clipboard.items, destPath)
        } else if (this.clipboard.operation === 'cut') {
          await fileApi.moveItems(this.clipboard.items, destPath)
          this.clipboard = { items: [], operation: null }
        }
        // 刷新当前目录
        await this.loadFiles(this.currentPath)
      } catch (err) {
        console.error('[FileStore] pasteItems 失败:', err)
        throw err
      }
    },

    /**
     * 删除选中项
     */
    async deleteItems () {
      if (this.selectedItems.length === 0) return
      try {
        await fileApi.deleteItems(this.selectedItems)
        this.selectedItems = []
        // 刷新当前目录
        await this.loadFiles(this.currentPath)
      } catch (err) {
        console.error('[FileStore] deleteItems 失败:', err)
        throw err
      }
    },

    /**
     * 重命名项
     * @param {string} oldPath 原路径
     * @param {string} newPath 新路径
     */
    async renameItem (oldPath, newPath) {
      try {
        await fileApi.renameItem(oldPath, newPath)
        // 刷新当前目录
        await this.loadFiles(this.currentPath)
      } catch (err) {
        console.error('[FileStore] renameItem 失败:', err)
        throw err
      }
    },

    /**
     * 在资源管理器中显示
     * @param {string} path 文件路径
     */
    async revealInExplorer (path) {
      try {
        await fileApi.revealInExplorer(path)
      } catch (err) {
        console.error('[FileStore] revealInExplorer 失败:', err)
        throw err
      }
    },

    /**
     * 打开父目录
     */
    async openParentDirectory () {
      if (!this.currentPath) return
      const parentPath = this.currentPath.substring(0, this.currentPath.lastIndexOf('\\'))
      if (parentPath && parentPath !== this.currentPath) {
        await this.loadFiles(parentPath)
      }
    },

    /**
     * 导航到上级目录
     */
    navigateUp () {
      if (!this.currentPath) return
      const parts = this.currentPath.split('\\')
      if (parts.length > 1) {
        parts.pop()
        const parentPath = parts.join('\\')
        this.loadFiles(parentPath)
      }
    },

    /**
     * 导航到子目录
     * @param {string} folderName 文件夹名称
     */
    async navigateToFolder (folderName) {
      const folder = this.files.find(f => f.name === folderName && f.isDirectory)
      if (folder) {
        await this.loadFiles(folder.path)
      }
    },

    /**
     * 更新小部件配置
     * @param {object} data
     */
    async updateWidget (data) {
      try {
        const result = await fileApi.updateWidget(data)
        const index = this.widgets.findIndex(w => w.id === data.id)
        if (index !== -1) {
          this.widgets.splice(index, 1, { ...this.widgets[index], ...data })
        }
        return result
      } catch (err) {
        console.error('[FileStore] updateWidget 失败:', err)
        throw err
      }
    },

    /**
     * 清除剪切板
     */
    clearClipboard () {
      this.clipboard = { items: [], operation: null }
    }
  }
})

export default useFileStore