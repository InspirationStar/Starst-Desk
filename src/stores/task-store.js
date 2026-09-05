// ============================================================
// 定时任务 Pinia Store
// 职责：管理任务列表状态，封装 IPC 调用，提供筛选与 CRUD actions
// state: list / total / loading / filter / history
// actions: fetchTasks / createTask / updateTask / deleteTask / toggleEnabled / getExecutionHistory / confirmCommand
// getters: enabledTasks / disabledTasks
// ============================================================

import { defineStore } from 'pinia'
import { taskApi } from '@/utils/ipc-client'

// ============================================================
// 辅助函数：解包 IPC 响应
// 由于 registry.js 自动包裹一层 success/failure，
// 而 task-channels.js 又手动包裹了一层，导致双重包裹
// 此函数用于解包内层 { ok, data } 或 { ok, error } 格式
// ============================================================
function unwrap (response) {
  // 空响应直接返回，由调用方做兼容处理
  if (response == null) return response
  if (typeof response !== 'object') return response

  // 双重包裹：{ ok: true, data: { ok: true, data: ... } }
  if ('ok' in response) {
    if (response.ok) {
      return response.data
    }
    const error = response.error || {}
    const err = new Error(error.message || '操作失败')
    err.code = error.code || 'UNKNOWN_ERROR'
    throw err
  }
  return response
}

/**
 * 规范化列表响应，确保返回 { list, total }
 * 防止 IPC 返回异常结构导致页面崩溃
 * @param {any} result - unwrap 后的数据
 * @returns {{ list: array, total: number }}
 */
function normalizeListResult (result) {
  if (!result || typeof result !== 'object') {
    return { list: [], total: 0 }
  }
  // 兼容直接返回数组的情况
  if (Array.isArray(result)) {
    return { list: result, total: result.length }
  }
  return {
    list: Array.isArray(result.list) ? result.list : [],
    total: typeof result.total === 'number' ? result.total : (result.list ? result.list.length : 0)
  }
}

export const useTaskStore = defineStore('task', {
  // ============================================================
  // State
  // ============================================================
  state: () => ({
    // 任务列表
    list: [],
    // 任务总数
    total: 0,
    // 加载状态
    loading: false,
    // 筛选条件：'all' | 'enabled' | 'disabled'
    filter: 'all',
    // 分页参数
    page: 1,
    pageSize: 50,
    // 执行历史缓存
    history: {
      list: [],
      total: 0,
      loading: false,
      page: 1,
      pageSize: 20
    }
  }),

  // ============================================================
  // Getters
  // ============================================================
  getters: {
    // 启用的任务列表（防御性处理：list 非数组时返回空数组，避免 "list.filter is not a function"）
    enabledTasks: (state) => Array.isArray(state.list)
      ? state.list.filter((t) => t.is_enabled === 1 || t.is_enabled === true)
      : [],

    // 禁用的任务列表
    disabledTasks: (state) => Array.isArray(state.list)
      ? state.list.filter((t) => t.is_enabled === 0 || t.is_enabled === false)
      : []
  },

  // ============================================================
  // Actions
  // ============================================================
  actions: {
    /**
     * 获取任务列表
     * @param {object} [params] - 可选的查询参数覆盖
     */
    async fetchTasks (params = {}) {
      this.loading = true
      try {
        // 构造查询参数
        const query = {
          page: params.page || this.page,
          size: params.size || this.pageSize
        }

        // 根据筛选条件设置 is_enabled
        if (this.filter === 'enabled') {
          query.is_enabled = true
        } else if (this.filter === 'disabled') {
          query.is_enabled = false
        }

        const response = await taskApi.list(query)
        const result = unwrap(response)
        // 规范化结果，避免异常结构导致页面崩溃
        const normalized = normalizeListResult(result)
        this.list = normalized.list
        this.total = normalized.total
      } catch (error) {
        console.error('[TaskStore] fetchTasks 失败:', error.message)
        // 失败时清空列表，避免显示陈旧数据
        this.list = []
        this.total = 0
        throw error
      } finally {
        this.loading = false
      }
    },

    /**
     * 创建任务
     * @param {object} data - { name, task_type, schedule_config, action_type, action_payload }
     * @returns {object} 创建的任务
     */
    async createTask (data) {
      const response = await taskApi.create(data)
      const task = unwrap(response)
      // 刷新列表（失败不阻塞创建成功的返回）
      try {
        await this.fetchTasks()
      } catch (err) {
        console.warn('[TaskStore] 创建后刷新列表失败:', err.message)
      }
      return task
    },

    /**
     * 更新任务
     * @param {object} data - 包含 id 和要更新的字段
     * @returns {object} 更新后的任务
     */
    async updateTask (data) {
      const response = await taskApi.update(data)
      const task = unwrap(response)
      // 刷新列表（失败不阻塞更新成功的返回）
      try {
        await this.fetchTasks()
      } catch (err) {
        console.warn('[TaskStore] 更新后刷新列表失败:', err.message)
      }
      return task
    },

    /**
     * 删除任务
     * @param {string} id - 任务 ID
     */
    async deleteTask (id) {
      const response = await taskApi.delete(id)
      unwrap(response)
      // 从本地列表中移除（防御性处理：list 非数组时先重置为空数组）
      if (!Array.isArray(this.list)) this.list = []
      this.list = this.list.filter((t) => t.id !== id)
      this.total = Math.max(0, this.total - 1)
    },

    /**
     * 切换任务启用/禁用状态
     * @param {string} id - 任务 ID
     * @param {boolean} enabled - 是否启用
     * @returns {object} 更新后的任务
     */
    async toggleEnabled (id, enabled) {
      const response = await taskApi.toggle(id, enabled)
      const task = unwrap(response)
      // 更新本地列表中的对应任务
      if (task) {
        const index = this.list.findIndex((t) => t.id === id)
        if (index !== -1) {
          this.list[index] = { ...this.list[index], ...task }
        }
      }
      return task
    },

    /**
     * 获取任务执行历史
     * @param {string} taskId - 任务 ID
     * @param {object} [params] - 可选的分页参数
     */
    async getExecutionHistory (taskId, params = {}) {
      this.history.loading = true
      try {
        const query = {
          page: params.page || this.history.page,
          size: params.size || this.history.pageSize
        }
        const response = await taskApi.history(taskId, query)
        const result = unwrap(response)
        // 规范化结果，避免异常结构导致页面崩溃
        const normalized = normalizeListResult(result)
        this.history.list = normalized.list
        this.history.total = normalized.total
        this.history.page = query.page
      } catch (error) {
        console.error('[TaskStore] getExecutionHistory 失败:', error.message)
        // 失败时清空历史列表
        this.history.list = []
        this.history.total = 0
        throw error
      } finally {
        this.history.loading = false
      }
    },

    /**
     * 确认命令执行风险
     * 首次配置 exec_command 动作时需调用此方法确认风险
     */
    async confirmCommand () {
      const response = await taskApi.confirmCommand()
      return unwrap(response)
    },

    /**
     * 设置筛选条件并刷新列表
     * @param {string} filter - 'all' | 'enabled' | 'disabled'
     */
    async setFilter (filter) {
      this.filter = filter
      this.page = 1
      await this.fetchTasks()
    },

    /**
     * 重置历史状态
     */
    resetHistory () {
      this.history.list = []
      this.history.total = 0
      this.history.page = 1
    }
  }
})

export default useTaskStore
