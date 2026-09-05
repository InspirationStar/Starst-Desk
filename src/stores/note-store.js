// ============================================================
// 便签 Pinia Store
// 职责：管理便签列表状态，封装 IPC 调用，提供搜索/筛选/排序的派生数据
// 通过 utils/ipc-client.js 中已封装的 noteApi 与主进程通信
// ============================================================

import { defineStore } from 'pinia'
import { noteApi } from '@/utils/ipc-client'

export const useNoteStore = defineStore('note', {
  state: () => ({
    // 便签列表（按 updated_at 倒序）
    list: [],
    // 总数（用于分页）
    total: 0,
    currentNote: null,
    // 加载状态
    loading: false,
    // 最近一次错误信息（用于在 UI 上提示）
    error: null,
    // 查询条件
    query: {
      keyword: '',          // 搜索关键词（匹配 title/body）
      colorTag: '',         // 颜色筛选（空字符串表示全部）
      sortBy: 'updated_at', // 排序字段
      sortOrder: 'DESC',   // 排序方向
      page: 1,
      size: 100             // 桌面应用单机使用，单页取 100 条足够
    }
  }),

  getters: {
    /**
     * 置顶便签（is_pinned === 1）
     * @returns {Array}
     */
    pinnedNotes (state) {
      // 防御性处理：list 异常时返回空数组，避免 "list.filter is not a function"
      return Array.isArray(state.list) ? state.list.filter(note => Number(note.is_pinned) === 1) : []
    },

    /**
     * 普通便签（非置顶）
     * @returns {Array}
     */
    normalNotes (state) {
      return Array.isArray(state.list) ? state.list.filter(note => Number(note.is_pinned) !== 1) : []
    },

    /**
     * 经过前端二次筛选的便签列表
     * 当前 IPC 已支持 keyword/color_tag 筛选，这里保留 getter 以备前端即时筛选
     * @returns {Array}
     */
    filteredNotes (state) {
      return Array.isArray(state.list) ? state.list : []
    },

    /**
     * 是否有便签
     * @returns {boolean}
     */
    hasNotes (state) {
      return Array.isArray(state.list) ? state.list.length > 0 : false
    },

    /**
     * @returns {boolean}
     */
    hasCurrentNote (state) {
      return state.currentNote !== null
    }
  },

  actions: {
    /**
     * 拉取便签列表（list 别名，对齐任务要求的 list() 命名）
     * @param {object} [override] 需要覆盖的查询条件
     * @returns {Promise<Array>} 便签列表
     */
    async list (override = {}) {
      return await this.fetchNotes(override)
    },

    /**
     * 拉取便签列表
     * @param {object} [override] 需要覆盖的查询条件
     * @returns {Promise<Array>} 便签列表
     */
    async fetchNotes (override = {}) {
      this.loading = true
      this.error = null
      try {
        // 合并查询条件
        this.query = { ...this.query, ...override }
        const result = await noteApi.list({
          keyword: this.query.keyword,
          color_tag: this.query.colorTag,
          sort_by: this.query.sortBy,
          sort_order: this.query.sortOrder,
          page: this.query.page,
          size: this.query.size
        })
        this.list = result.list || []
        this.total = result.total || 0
        return this.list
      } catch (err) {
        this.error = err.message
        console.error('[note-store] fetchNotes 失败:', err)
        return []
      } finally {
        this.loading = false
      }
    },

    /**
     * 创建便签（create 别名，对齐任务要求的 create() 命名）
     * @param {object} data { title, body, color_tag, reminder_time, is_pinned }
     * @returns {Promise<object|null>} 创建成功的便签
     */
    async create (data) {
      return await this.createNote(data)
    },

    /**
     * 创建便签
     * @param {object} data { title, body, color_tag, reminder_time, is_pinned }
     * @returns {Promise<object|null>} 创建成功的便签
     */
    async createNote (data) {
      this.error = null
      try {
        const note = await noteApi.create(data)
        // 创建后立即刷新列表，保证排序与置顶分组正确
        await this.fetchNotes()
        if (note) {
          this.currentNote = note
        }
        return note
      } catch (err) {
        this.error = err.message
        console.error('[note-store] createNote 失败:', err)
        return null
      }
    },

    /**
     * 更新便签（update 别名，对齐任务要求的 update() 命名）
     * @param {string} id 便签 ID
     * @param {object} data 要更新的字段
     * @returns {Promise<object|null>} 更新后的便签
     */
    async update (id, data) {
      return await this.updateNote(id, data)
    },

    /**
     * 更新便签
     * @param {string} id 便签 ID
     * @param {object} data 要更新的字段
     * @returns {Promise<object|null>} 更新后的便签
     */
    async updateNote (id, data) {
      this.error = null
      try {
        const note = await noteApi.update({ id, ...data })
        // 本地同步更新，避免一次完整刷新（防御性处理：list 非数组时先重置为空数组）
        if (!Array.isArray(this.list)) this.list = []
        const index = this.list.findIndex(item => item.id === id)
        if (index !== -1) {
          this.list[index] = { ...this.list[index], ...note }
        }
        // 同步 currentNote
        if (this.currentNote && this.currentNote.id === id) {
          this.currentNote = { ...this.currentNote, ...note }
        }
        return note
      } catch (err) {
        this.error = err.message
        console.error('[note-store] updateNote 失败:', err)
        return null
      }
    },

    /**
     * 删除便签（delete 别名，对齐任务要求的 delete() 命名）
     * @param {string} id 便签 ID
     * @returns {Promise<boolean>} 是否删除成功
     */
    async delete (id) {
      return await this.deleteNote(id)
    },

    /**
     * 删除便签
     * @param {string} id 便签 ID
     * @returns {Promise<boolean>} 是否删除成功
     */
    async deleteNote (id) {
      this.error = null
      try {
        await noteApi.delete(id)
        // 本地移除（防御性处理：list 非数组时先重置为空数组）
        if (!Array.isArray(this.list)) this.list = []
        this.list = this.list.filter(item => item.id !== id)
        this.total = Math.max(0, this.total - 1)
        // 若删除的是当前选中便签，清空 currentNote
        if (this.currentNote && this.currentNote.id === id) {
          this.currentNote = null
        }
        return true
      } catch (err) {
        this.error = err.message
        console.error('[note-store] deleteNote 失败:', err)
        return false
      }
    },

    /**
     * 搜索便签（search 别名，对齐任务要求的 search() 命名）
     * @param {string} keyword
     * @returns {Promise<Array>}
     */
    async search (keyword) {
      return await this.searchNotes(keyword)
    },

    /**
     * 搜索便签（设置关键词后立即查询）
     * @param {string} keyword
     * @returns {Promise<Array>}
     */
    async searchNotes (keyword) {
      this.query.keyword = keyword
      return await this.fetchNotes()
    },

    /**
     * @param {object|null} note 便签对象，传 null 清空选中
     */
    selectNote (note) {
      this.currentNote = note ? { ...note } : null
    },

    /**
     */
    closeDetail () {
      this.currentNote = null
    },

    /**
     * 切换置顶状态
     * @param {object} note 便签对象
     * @returns {Promise<boolean>}
     */
    async togglePin (note) {
      const newPinned = Number(note.is_pinned) === 1 ? 0 : 1
      const updated = await this.updateNote(note.id, { is_pinned: newPinned })
      return updated !== null
    },

    /**
     * 切换完成状态
     * @param {object} note 便签对象
     * @returns {Promise<boolean>}
     */
    async toggleComplete (note) {
      const newCompleted = Number(note.is_completed) === 1 ? 0 : 1
      const updated = await this.updateNote(note.id, { is_completed: newCompleted })
      return updated !== null
    },

    /**
     * 设置搜索关键词（不立即查询，由调用方决定是否触发 fetchNotes）
     * @param {string} keyword
     */
    setKeyword (keyword) {
      this.query.keyword = keyword
    },

    /**
     * 设置颜色筛选
     * @param {string} colorTag
     */
    setColorTag (colorTag) {
      this.query.colorTag = colorTag
    },

    /**
     * 设置排序
     * @param {string} sortBy
     * @param {string} [sortOrder='DESC']
     */
    setSort (sortBy, sortOrder = 'DESC') {
      this.query.sortBy = sortBy
      this.query.sortOrder = sortOrder
    },

    /**
     * 标记便签为已提醒
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async markReminded (id) {
      try {
        await noteApi.markReminded(id)
        return true
      } catch (err) {
        console.error('[note-store] markReminded 失败:', err)
        return false
      }
    },

    /**
     * 重置查询条件
     */
    resetQuery () {
      this.query = {
        keyword: '',
        colorTag: '',
        sortBy: 'updated_at',
        sortOrder: 'DESC',
        page: 1,
        size: 100
      }
    }
  }
})

export default useNoteStore
