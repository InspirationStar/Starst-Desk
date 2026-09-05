// ============================================================
// 待办 Pinia Store
// 职责：管理待办列表状态，封装 IPC 调用，提供搜索/筛选的派生数据
// 注意：todo-service 直接用 ipcMain.handle 返回 { list, ... } / { todo } / { error }，
//       未经过 registry.js 包装（没有 ok 字段），故不走 ipc-client.js 的 invoke，
//       而是直接调用 window.electronAPI.invoke 并自行处理响应格式。
// ============================================================

import { defineStore } from 'pinia'

/**
 * 直接调用主进程 todo IPC 通道并处理响应格式
 * todo-service 返回格式：{ list, ... } / { todo } / { success } / { error: { code, message } }
 * @param {string} channel IPC 通道名
 * @param {any} [data] 请求数据
 * @returns {Promise<any>} 主进程返回的响应对象（不含 error 字段时视为成功）
 * @throws {Error} 当响应包含 error 字段时抛出包含 code 与 message 的错误
 */
async function todoInvoke (channel, data) {
  // 净化 data：Vue reactive 对象/数组是 Proxy，无法被 Electron 结构化克隆算法克隆
  // 报错 "An object could not be cloned."。深拷贝为纯普通对象，确保 IPC 安全传输
  const plainData = data != null ? JSON.parse(JSON.stringify(data)) : data
  const response = await window.electronAPI.invoke(channel, plainData)
  if (response && response.error) {
    const err = new Error(response.error.message || `IPC 调用失败: ${channel}`)
    err.code = response.error.code || 'IPC_ERROR'
    err.channel = channel
    throw err
  }
  return response
}

export const useTodoStore = defineStore('todo', {
  state: () => ({
    // 待办列表（按 updated_at 倒序）
    list: [],
    // 总数（用于分页）
    total: 0,
    // 当前编辑的待办
    currentTodo: null,
    // 加载状态
    loading: false,
    // 最近一次错误信息（用于在 UI 上提示）
    error: null,
    // 查询条件
    query: {
      keyword: '',          // 搜索关键词（匹配 title）
      status: '',           // 状态筛选：active=未完成 / completed=已完成
      page: 1,
      size: 100             // 桌面应用单机使用，单页取 100 条足够
    }
  }),

  getters: {
    /**
     * 未完成待办（is_enabled === 1）
     * @returns {Array}
     */
    activeTodos (state) {
      return state.list.filter(todo => Number(todo.is_enabled) === 1)
    },

    /**
     * 已完成待办（is_enabled === 0）
     * @returns {Array}
     */
    completedTodos (state) {
      return state.list.filter(todo => Number(todo.is_enabled) === 0)
    },

    /**
     * 经过前端二次筛选的待办列表
     * @returns {Array}
     */
    filteredTodos (state) {
      return state.list
    },

    /**
     * 是否有待办
     * @returns {boolean}
     */
    hasTodos (state) {
      return state.list.length > 0
    },

    /**
     * 是否选中了待办
     * @returns {boolean}
     */
    hasCurrentTodo (state) {
      return state.currentTodo !== null
    }
  },

  actions: {
    /**
     * 拉取待办列表
     * @param {object} [override] 需要覆盖的查询条件
     * @returns {Promise<Array>} 待办列表
     */
    async fetchTodos (override = {}) {
      this.loading = true
      this.error = null
      try {
        // 合并查询条件
        this.query = { ...this.query, ...override }
        const params = {
          page: this.query.page,
          size: this.query.size
        }
        if (this.query.status) {
          params.filter = { status: this.query.status }
        }
        const result = await todoInvoke('todo:list', params)
        // 防御性处理：确保 list 始终是数组
        this.list = Array.isArray(result?.list) ? result.list : []
        this.total = result?.total || 0
        return this.list
      } catch (err) {
        this.error = err.message
        console.error('[todo-store] fetchTodos 失败:', err)
        return []
      } finally {
        this.loading = false
      }
    },

    /**
     * 拉取待办列表（list 别名，对齐命名习惯）
     * @param {object} [override] 需要覆盖的查询条件
     * @returns {Promise<Array>}
     */
    async list (override = {}) {
      return await this.fetchTodos(override)
    },

    /**
     * 获取单个待办
     * @param {string} id 待办 ID
     * @returns {Promise<object|null>}
     */
    async get (id) {
      this.error = null
      try {
        const result = await todoInvoke('todo:get', { id })
        return result?.todo || null
      } catch (err) {
        this.error = err.message
        console.error('[todo-store] get 失败:', err)
        return null
      }
    },

    /**
     * 创建待办
     * @param {object} data { title, is_enabled?, color?, due_date?, recurrence?, attachments? }
     * @returns {Promise<object|null>} 创建成功的待办
     */
    async create (data) {
      this.error = null
      try {
        const result = await todoInvoke('todo:create', data)
        const todo = result?.todo || null
        // 创建后立即刷新列表
        await this.fetchTodos()
        return todo
      } catch (err) {
        this.error = err.message
        console.error('[todo-store] create 失败:', err)
        return null
      }
    },

    /**
     * 更新待办
     * @param {string} id 待办 ID
     * @param {object} data 要更新的字段
     * @returns {Promise<object|null>} 更新后的待办
     */
    async update (id, data) {
      this.error = null
      try {
        const result = await todoInvoke('todo:update', { id, ...data })
        const todo = result?.todo || null
        // 本地同步更新，避免一次完整刷新
        if (todo) {
          const index = this.list.findIndex(item => item.id === id)
          if (index !== -1) {
            this.list[index] = { ...this.list[index], ...todo }
          }
          // 同步 currentTodo
          if (this.currentTodo && this.currentTodo.id === id) {
            this.currentTodo = { ...this.currentTodo, ...todo }
          }
        }
        return todo
      } catch (err) {
        this.error = err.message
        console.error('[todo-store] update 失败:', err)
        return null
      }
    },

    /**
     * 删除待办
     * @param {string} id 待办 ID
     * @returns {Promise<boolean>} 是否删除成功
     */
    async delete (id) {
      this.error = null
      try {
        await todoInvoke('todo:delete', { id })
        // 本地移除
        this.list = this.list.filter(item => item.id !== id)
        this.total = Math.max(0, this.total - 1)
        // 若删除的是当前选中待办，清空 currentTodo
        if (this.currentTodo && this.currentTodo.id === id) {
          this.currentTodo = null
        }
        return true
      } catch (err) {
        this.error = err.message
        console.error('[todo-store] delete 失败:', err)
        return false
      }
    },

    /**
     * 切换待办完成状态
     * is_enabled: 1=未完成（激活），0=已完成
     * @param {string} id 待办 ID
     * @param {number} enabled 1=未完成，0=已完成
     * @returns {Promise<object|null>} 更新后的待办
     */
    async toggle (id, enabled) {
      this.error = null
      try {
        const result = await todoInvoke('todo:toggle', { id, enabled })
        const todo = result?.todo || null
        // 本地同步更新
        if (todo) {
          const index = this.list.findIndex(item => item.id === id)
          if (index !== -1) {
            this.list[index] = { ...this.list[index], ...todo }
          }
        }
        return todo
      } catch (err) {
        this.error = err.message
        console.error('[todo-store] toggle 失败:', err)
        return null
      }
    },

    /**
     * 切换待办完成状态（语义化别名）
     * @param {object} todo 待办对象
     * @returns {Promise<boolean>}
     */
    async toggleComplete (todo) {
      const newEnabled = Number(todo.is_enabled) === 1 ? 0 : 1
      const updated = await this.toggle(todo.id, newEnabled)
      return updated !== null
    },

    /**
     * 设置截止日期
     * @param {string} id 待办 ID
     * @param {string} dueDate ISO 日期字符串
     * @returns {Promise<object|null>}
     */
    async setDueDate (id, dueDate) {
      this.error = null
      try {
        const result = await todoInvoke('todo:set-due-date', { id, dueDate })
        return result?.todo || null
      } catch (err) {
        this.error = err.message
        console.error('[todo-store] setDueDate 失败:', err)
        return null
      }
    },

    /**
     * 设置重复规则
     * @param {string} id 待办 ID
     * @param {string} recurrence 重复规则
     * @returns {Promise<object|null>}
     */
    async setRecurrence (id, recurrence) {
      this.error = null
      try {
        const result = await todoInvoke('todo:set-recurrence', { id, recurrence })
        return result?.todo || null
      } catch (err) {
        this.error = err.message
        console.error('[todo-store] setRecurrence 失败:', err)
        return null
      }
    },

    /**
     * 设置颜色标签
     * @param {string} id 待办 ID
     * @param {string} color 颜色标签
     * @returns {Promise<object|null>}
     */
    async setColor (id, color) {
      this.error = null
      try {
        const result = await todoInvoke('todo:set-color', { id, color })
        return result?.todo || null
      } catch (err) {
        this.error = err.message
        console.error('[todo-store] setColor 失败:', err)
        return null
      }
    },

    /**
     * 选中待办
     * @param {object|null} todo 待办对象，传 null 清空选中
     */
    selectTodo (todo) {
      this.currentTodo = todo ? { ...todo } : null
    },

    /**
     * 关闭详情编辑区
     */
    closeDetail () {
      this.currentTodo = null
    },

    /**
     * 搜索待办（设置关键词后立即查询）
     * @param {string} keyword
     * @returns {Promise<Array>}
     */
    async search (keyword) {
      this.query.keyword = keyword
      return await this.fetchTodos()
    },

    /**
     * 设置搜索关键词（不立即查询）
     * @param {string} keyword
     */
    setKeyword (keyword) {
      this.query.keyword = keyword
    },

    /**
     * 设置状态筛选
     * @param {string} status '' | 'active' | 'completed'
     */
    setStatus (status) {
      this.query.status = status
    },

    /**
     * 重置查询条件
     */
    resetQuery () {
      this.query = {
        keyword: '',
        status: '',
        page: 1,
        size: 100
      }
    }
  }
})

export default useTodoStore