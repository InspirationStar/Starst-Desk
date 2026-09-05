// ============================================================
// 小部件分组 Pinia Store
// 职责：管理小部件分组列表状态，封装 widgetGroupApi IPC 调用
// 用于设置页（WidgetSettingsView）分组管理面板与小部件标题栏分组导航共享状态
//   - id: 分组唯一标识
//   - name: 分组名称
//   - memberIds: 成员 widgetType 数组
//   - activeMemberId: 当前活跃成员 widgetType
//   - navigationStyle: 导航样式（follow-default / auto / tabs / stack）
//   - titleDisplayMode: 标题显示模式（follow-default / icon-and-text / icon-only / text-only）
//   - wheelSwitchEnabled: 滚轮切换开关（null 表示跟随默认）
//   - hoverSwitchEnabled: 悬停切换开关（null 表示跟随默认）
// ============================================================

import { defineStore } from 'pinia'
import { widgetGroupApi } from '@/utils/ipc-client'

export const useWidgetGroupStore = defineStore('widgetGroup', {
  state: () => ({
    // 分组列表
    groups: [],
    // 加载状态
    loading: false,
    // 最近一次错误信息
    error: null
  }),

  getters: {
    /**
     * 分组数量
     * @returns {number}
     */
    groupCount (state) {
      return state.groups.length
    },

    /**
     * 按成员 widgetType 查询所属分组
     * @param {string} widgetType 小部件类型
     * @returns {object|null} 分组对象或 null
     */
    getGroupByMember (state) {
      return (widgetType) => state.groups.find(g =>
        Array.isArray(g.memberIds) && g.memberIds.includes(widgetType)
      ) || null
    },

    /**
     * 按分组 id 查询分组
     * @param {string} id 分组 ID
     * @returns {object|null}
     */
    getGroupById (state) {
      return (id) => state.groups.find(g => g.id === id) || null
    },

    /**
     * 判断两个小部件是否在同一分组
     * @param {string} sourceType 源小部件类型
     * @param {string} targetType 目标小部件类型
     * @returns {boolean}
     */
    isInSameGroup (state) {
      return (sourceType, targetType) => {
        const sourceGroup = state.groups.find(g =>
          Array.isArray(g.memberIds) && g.memberIds.includes(sourceType)
        )
        if (!sourceGroup) return false
        return Array.isArray(sourceGroup.memberIds) && sourceGroup.memberIds.includes(targetType)
      }
    },

    /**
     * 获取可合并到指定小部件的目标列表
     * 排除自身、已同分组的成员
     * @param {string} widgetType 当前小部件类型
     * @param {Array<string>} allWidgetTypes 所有可用小部件类型列表
     * @returns {Array<string>}
     */
    getMergeTargets (state) {
      return (widgetType, allWidgetTypes) => {
        const currentGroup = state.groups.find(g =>
          Array.isArray(g.memberIds) && g.memberIds.includes(widgetType)
        )
        const excludeSet = new Set(currentGroup?.memberIds || [widgetType])
        return (allWidgetTypes || []).filter(t => !excludeSet.has(t))
      }
    }
  },

  actions: {
    /**
     * 加载所有分组
     * @returns {Promise<Array>}
     */
    async loadGroups () {
      this.loading = true
      this.error = null
      try {
        const result = await widgetGroupApi.list()
        this.groups = Array.isArray(result) ? result : (result?.list || [])
        return this.groups
      } catch (err) {
        this.error = err.message
        console.error('[WidgetGroupStore] loadGroups 失败:', err)
        this.groups = []
        return []
      } finally {
        this.loading = false
      }
    },

    /**
     * 创建分组
     * @param {string} name 分组名称
     * @param {Array<string>} memberIds 成员 widgetType 数组
     * @returns {Promise<object>} 创建后的分组对象
     */
    async createGroup (name, memberIds) {
      this.error = null
      try {
        const created = await widgetGroupApi.create(name, memberIds)
        if (created && created.id) {
          // 本地追加，使用 splice 触发响应式
          this.groups.splice(this.groups.length, 0, created)
        } else {
          // 后端未返回完整对象时重新加载
          await this.loadGroups()
        }
        return created
      } catch (err) {
        this.error = err.message
        console.error('[WidgetGroupStore] createGroup 失败:', err)
        throw err
      }
    },

    /**
     * 合并两个小部件为分组
     * @param {string} sourceType 源小部件类型
     * @param {string} targetType 目标小部件类型
     * @returns {Promise<object>} 合并后的分组对象
     */
    async mergeWidgets (sourceType, targetType) {
      this.error = null
      try {
        const merged = await widgetGroupApi.merge(sourceType, targetType)
        if (merged && merged.id) {
          // 检查是否已存在同 id 分组，避免重复
          const index = this.groups.findIndex(g => g.id === merged.id)
          if (index !== -1) {
            this.groups.splice(index, 1, merged)
          } else {
            this.groups.splice(this.groups.length, 0, merged)
          }
        } else {
          await this.loadGroups()
        }
        return merged
      } catch (err) {
        this.error = err.message
        console.error('[WidgetGroupStore] mergeWidgets 失败:', err)
        throw err
      }
    },

    /**
     * 将小部件加入已有分组
     * @param {string} groupId 分组 ID
     * @param {string} widgetType 小部件类型
     * @returns {Promise<object>} 更新后的分组对象
     */
    async joinGroup (groupId, widgetType) {
      this.error = null
      try {
        const updated = await widgetGroupApi.join(groupId, widgetType)
        this._patchGroup(groupId, updated)
        return updated
      } catch (err) {
        this.error = err.message
        console.error('[WidgetGroupStore] joinGroup 失败:', err)
        throw err
      }
    },

    /**
     * 从分组分离成员
     * @param {string} groupId 分组 ID
     * @param {string} widgetType 小部件类型
     * @returns {Promise<void>}
     */
    async detachMember (groupId, widgetType) {
      this.error = null
      try {
        const result = await widgetGroupApi.detach(groupId, widgetType)
        // 分离后分组可能解散（成员数 < 2），需根据返回结果处理
        if (result && result.dissolved) {
          // 分组已解散，从列表移除
          const index = this.groups.findIndex(g => g.id === groupId)
          if (index !== -1) {
            this.groups.splice(index, 1)
          }
        } else if (result && result.id) {
          this._patchGroup(groupId, result)
        } else {
          // 兜底重新加载
          await this.loadGroups()
        }
      } catch (err) {
        this.error = err.message
        console.error('[WidgetGroupStore] detachMember 失败:', err)
        throw err
      }
    },

    /**
     * 解散分组（删除分组，不删除成员）
     * @param {string} groupId 分组 ID
     * @returns {Promise<void>}
     */
    async dissolveGroup (groupId) {
      this.error = null
      try {
        await widgetGroupApi.delete(groupId)
        // 本地移除分组
        const index = this.groups.findIndex(g => g.id === groupId)
        if (index !== -1) {
          this.groups.splice(index, 1)
        }
      } catch (err) {
        this.error = err.message
        console.error('[WidgetGroupStore] dissolveGroup 失败:', err)
        throw err
      }
    },

    /**
     * 切换活跃成员
     * @param {string} groupId 分组 ID
     * @param {string} widgetType 小部件类型
     * @returns {Promise<void>}
     */
    async switchMember (groupId, widgetType) {
      this.error = null
      try {
        await widgetGroupApi.switchMember(groupId, widgetType)
        // 本地同步活跃成员
        const index = this.groups.findIndex(g => g.id === groupId)
        if (index !== -1) {
          const group = { ...this.groups[index], activeMemberId: widgetType }
          this.groups.splice(index, 1, group)
        }
      } catch (err) {
        this.error = err.message
        console.error('[WidgetGroupStore] switchMember 失败:', err)
        throw err
      }
    },

    /**
     * 更新分组配置（名称、导航样式、标题显示模式、滚轮/悬停切换开关等）
     * @param {string} id 分组 ID
     * @param {object} data 要更新的字段
     * @returns {Promise<object>} 更新后的分组对象
     */
    async updateGroup (id, data) {
      this.error = null
      try {
        const updated = await widgetGroupApi.update({ id, ...data })
        this._patchGroup(id, updated || { id, ...data })
        return updated
      } catch (err) {
        this.error = err.message
        console.error('[WidgetGroupStore] updateGroup 失败:', err)
        throw err
      }
    },

    /**
     * 按成员查询所属分组（强制走 IPC，绕过本地缓存）
     * 用于小部件窗口初始化时获取最新分组状态
     * @param {string} widgetType 小部件类型
     * @returns {Promise<object|null>}
     */
    async fetchGroupByMember (widgetType) {
      this.error = null
      try {
        return await widgetGroupApi.getByMember(widgetType)
      } catch (err) {
        this.error = err.message
        console.error('[WidgetGroupStore] fetchGroupByMember 失败:', err)
        return null
      }
    },

    /**
     * 内部辅助：合并更新分组对象到列表
     * @param {string} groupId 分组 ID
     * @param {object} patch 要合并的字段
     * @private
     */
    _patchGroup (groupId, patch) {
      if (!patch) return
      const index = this.groups.findIndex(g => g.id === groupId)
      if (index !== -1) {
        const merged = { ...this.groups[index], ...patch }
        this.groups.splice(index, 1, merged)
      } else if (patch.id) {
        // 新分组对象，追加
        this.groups.splice(this.groups.length, 0, patch)
      }
    }
  }
})

export default useWidgetGroupStore