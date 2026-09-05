// ============================================================
// 健康提醒 Pinia Store
// 管理六大子模块配置、健康数据记录与统计数据
// 通过 window.electronAPI.invoke 调用主进程 IPC
// ============================================================

import { defineStore } from 'pinia'
import dayjs from 'dayjs'

// 六大子模块类型
const MODULE_TYPES = ['water', 'sedentary', 'eye', 'stretch', 'sleep', 'diet']

// 各子模块默认配置
// 注意：stretch 已合并到 sedentary（久坐伸展），stretch 模块在 UI 中不再独立显示
// sedentary 的 config_json 增加 custom_content 字段（原 stretch 的自定义提醒内容）
const DEFAULT_CONFIGS = {
  water: {
    is_enabled: false,
    config_json: { target_ml: 2000, interval_minutes: 60 }
  },
  sedentary: {
    is_enabled: false,
    config_json: { interval_minutes: 45, custom_content: '' }
  },
  eye: {
    is_enabled: false,
    config_json: { interval_minutes: 30, duration_minutes: 5 }
  },
  stretch: {
    is_enabled: false,
    config_json: { interval_minutes: 60, custom_content: '' }
  },
  sleep: {
    is_enabled: false,
    config_json: { target_bedtime: '23:00', target_wakeup: '07:00' }
  },
  diet: {
    is_enabled: false,
    config_json: { breakfast: '08:00', lunch: '12:00', dinner: '18:00' }
  }
}

// 倒计时提醒模块列表（久坐伸展/护眼），触发时弹出倒计时 overlay 等待用户确认
const COUNTDOWN_MODULES = ['sedentary', 'eye']

/**
 * 调用健康模块 IPC 通道
 * 兼容 registry.js 自动包装导致的可能双重包装响应
 * @param {string} channel - IPC 通道名
 * @param {object} data - 请求数据
 * @returns {Promise<any>} 解包后的数据
 */
async function invokeHealth (channel, data) {
  // 净化 Vue reactive Proxy：Electron 结构化克隆算法无法克隆 Proxy
  // 会报 "An object could not be cloned."
  const plainData = data != null ? JSON.parse(JSON.stringify(data)) : data
  const res = await window.electronAPI.invoke(channel, plainData)
  if (!res || !res.ok) {
    const msg = res?.error?.message || 'IPC 调用失败'
    throw new Error(msg)
  }
  // 兼容双重包装：{ ok: true, data: { ok: true, data: actualData } }
  const inner = res.data
  if (inner && typeof inner === 'object' && 'ok' in inner) {
    if (!inner.ok) {
      throw new Error(inner.error?.message || 'IPC 调用失败')
    }
    return inner.data
  }
  return inner
}

/**
 * 获取今日日期字符串
 * @returns {string} YYYY-MM-DD
 */
function getToday () {
  return dayjs().format('YYYY-MM-DD')
}

/**
 * 获取当前时间字符串
 * @returns {string} YYYY-MM-DD HH:mm:ss
 */
function getNow () {
  return dayjs().format('YYYY-MM-DD HH:mm:ss')
}

export const useHealthStore = defineStore('health', {
  state: () => ({
    // 六大子模块配置，按模块类型索引
    configs: {},
    // 当前加载的记录列表
    records: [],
    // 统计数据
    stats: [],
    // 今日统计数据
    todayStats: {},
    // 加载状态
    loading: false,
    // 久坐暂停状态
    sedentaryPaused: false
  }),

  getters: {
    /**
     * 获取已启用的子模块列表
     * @returns {string[]}
     */
    enabledModules (state) {
      return MODULE_TYPES.filter(type => state.configs[type]?.is_enabled)
    },

    /**
     * 获取指定模块的配置
     * @param {string} moduleType
     * @returns {object}
     */
    getConfig (state) {
      return (moduleType) => {
        const config = state.configs[moduleType]
        if (!config) return { ...DEFAULT_CONFIGS[moduleType] }
        return config
      }
    },

    /**
     * 获取指定模块的 config_json
     * @param {string} moduleType
     * @returns {object}
     */
    getConfigJson (state) {
      return (moduleType) => {
        const config = state.configs[moduleType]
        if (!config) return { ...DEFAULT_CONFIGS[moduleType].config_json }
        return config.config_json || {}
      }
    },

    /**
     * 判断指定模块是否启用
     * @param {string} moduleType
     * @returns {boolean}
     */
    isModuleEnabled (state) {
      return (moduleType) => {
        return !!state.configs[moduleType]?.is_enabled
      }
    }
  },

  actions: {
    /**
     * 拉取所有子模块配置
     */
    async fetchConfigs () {
      this.loading = true
      try {
        const result = {}
        for (const moduleType of MODULE_TYPES) {
          const config = await invokeHealth('health:get-config', { module_type: moduleType })
          if (config && Object.keys(config).length > 0) {
            result[moduleType] = config
          } else {
            // 使用默认配置
            result[moduleType] = { ...DEFAULT_CONFIGS[moduleType] }
          }
        }
        this.configs = result
      } catch (error) {
        console.error('[HealthStore] fetchConfigs 失败:', error.message)
        throw error
      } finally {
        this.loading = false
      }
    },

    /**
     * 更新指定模块配置
     * @param {string} moduleType - 模块类型
     * @param {object} configJson - 配置内容
     * @param {boolean} isEnabled - 是否启用
     */
    async updateConfig (moduleType, configJson, isEnabled) {
      try {
        const currentConfig = this.configs[moduleType] || {}
        const data = {
          module_type: moduleType,
          is_enabled: isEnabled !== undefined ? isEnabled : !!currentConfig.is_enabled,
          config: { ...(currentConfig.config_json || {}), ...configJson }
        }
        const result = await invokeHealth('health:update-config', data)
        // 子需求5：无论 IPC 返回值如何，都同步更新本地 store
        // 确保启用开关状态与实际功能状态立即同步
        if (result && typeof result === 'object') {
          this.configs[moduleType] = result
        } else {
          // IPC 返回异常时，使用本地构造的预期状态更新（乐观更新）
          this.configs[moduleType] = {
            module_type: moduleType,
            is_enabled: data.is_enabled,
            config_json: data.config
          }
        }
        return this.configs[moduleType]
      } catch (error) {
        console.error(`[HealthStore] updateConfig(${moduleType}) 失败:`, error.message)
        throw error
      }
    },

    /**
     * 切换模块启用/禁用状态
     * @param {string} moduleType - 模块类型
     * @param {boolean} enabled - 目标状态
     */
    async toggleModule (moduleType, enabled) {
      const currentConfig = this.configs[moduleType] || {}
      const configJson = currentConfig.config_json || DEFAULT_CONFIGS[moduleType].config_json
      return await this.updateConfig(moduleType, configJson, enabled)
    },

    /**
     * 添加喝水记录
     * @param {number} amount - 饮水量(ml)
     */
    async addWaterRecord (amount) {
      try {
        const record = await invokeHealth('health:record', {
          module_type: 'water',
          record_date: getToday(),
          record_time: getNow(),
          value: amount,
          content: `饮水 ${amount}ml`
        })
        // 刷新今日统计
        await this.fetchTodayStats('water')
        return record
      } catch (error) {
        console.error('[HealthStore] addWaterRecord 失败:', error.message)
        throw error
      }
    },

    /**
     * 添加睡眠记录
     * @param {string} type - 记录类型：'bedtime' | 'wakeup'
     * @param {string} time - 时间 HH:mm
     */
    async addSleepRecord (type, time) {
      try {
        const record = await invokeHealth('health:record', {
          module_type: 'sleep',
          record_date: getToday(),
          record_time: `${getToday()} ${time}:00`,
          value: type === 'bedtime' ? 1 : 2,
          content: `${type === 'bedtime' ? '入睡' : '起床'}时间: ${time}`
        })
        await this.fetchTodayStats('sleep')
        return record
      } catch (error) {
        console.error('[HealthStore] addSleepRecord 失败:', error.message)
        throw error
      }
    },

    /**
     * 添加饮食记录
     * @param {string} meal - 餐次：'breakfast' | 'lunch' | 'dinner'
     * @param {string} content - 饮食内容描述
     */
    async addDietRecord (meal, content) {
      try {
        const record = await invokeHealth('health:record', {
          module_type: 'diet',
          record_date: getToday(),
          record_time: getNow(),
          value: meal === 'breakfast' ? 1 : (meal === 'lunch' ? 2 : 3),
          content: `${meal}: ${content}`
        })
        await this.fetchTodayStats('diet')
        return record
      } catch (error) {
        console.error('[HealthStore] addDietRecord 失败:', error.message)
        throw error
      }
    },

    /**
     * 添加通用健康记录
     * @param {string} moduleType - 模块类型
     * @param {number|null} value - 数值
     * @param {string|null} content - 内容描述
     */
    async addRecord (moduleType, value = null, content = null) {
      try {
        const record = await invokeHealth('health:record', {
          module_type: moduleType,
          record_date: getToday(),
          record_time: getNow(),
          value,
          content
        })
        await this.fetchTodayStats(moduleType)
        return record
      } catch (error) {
        console.error(`[HealthStore] addRecord(${moduleType}) 失败:`, error.message)
        throw error
      }
    },

    /**
     * 拉取历史记录
     * @param {string} moduleType - 模块类型
     * @param {string} startDate - 起始日期 YYYY-MM-DD
     * @param {string} endDate - 结束日期 YYYY-MM-DD
     * @param {object} options - 分页参数
     */
    async fetchRecords (moduleType, startDate, endDate, options = {}) {
      this.loading = true
      try {
        const result = await invokeHealth('health:history', {
          module_type: moduleType,
          start_date: startDate,
          end_date: endDate,
          page: options.page || 1,
          size: options.size || 50
        })
        // 防御性处理：result.list 可能非数组（IPC 返回异常结构）
        this.records = (result && Array.isArray(result.list)) ? result.list : []
        return result
      } catch (error) {
        console.error('[HealthStore] fetchRecords 失败:', error.message)
        this.records = []
        throw error
      } finally {
        this.loading = false
      }
    },

    /**
     * 拉取今日统计
     * @param {string} moduleType - 模块类型
     */
    async fetchTodayStats (moduleType) {
      try {
        const result = await invokeHealth('health:today-stats', {
          module_type: moduleType
        })
        this.todayStats[moduleType] = result
        return result
      } catch (error) {
        console.error('[HealthStore] fetchTodayStats 失败:', error.message)
        throw error
      }
    },

    /**
     * 拉取统计聚合数据
     * @param {string} moduleType - 模块类型
     * @param {string} startDate - 起始日期
     * @param {string} endDate - 结束日期
     * @param {string} period - 周期：day/week/month
     */
    async fetchStats (moduleType, startDate, endDate, period = 'day') {
      this.loading = true
      try {
        const result = await invokeHealth('health:stats', {
          module_type: moduleType,
          start_date: startDate,
          end_date: endDate,
          period
        })
        this.stats = result || []
        return result
      } catch (error) {
        console.error('[HealthStore] fetchStats 失败:', error.message)
        throw error
      } finally {
        this.loading = false
      }
    },

    /**
     * 暂停久坐提醒
     */
    async pauseSedentary () {
      try {
        await invokeHealth('health:pause-sedentary', {})
        this.sedentaryPaused = true
      } catch (error) {
        console.error('[HealthStore] pauseSedentary 失败:', error.message)
        throw error
      }
    },

    /**
     * 继续久坐提醒
     */
    resumeSedentary () {
      this.sedentaryPaused = false
    },

    /**
     * 记录倒计时提醒完成情况（久坐伸展/护眼）
     * @param {string} moduleType - 模块类型（sedentary/eye）
     * @param {boolean} completed - 是否已完成
     * @param {string} [content] - 附加内容描述
     */
    async recordCompletion (moduleType, completed, content = null) {
      try {
        const record = await invokeHealth('health:record-completion', {
          module_type: moduleType,
          record_date: getToday(),
          record_time: getNow(),
          completed,
          content
        })
        return record
      } catch (error) {
        console.error(`[HealthStore] recordCompletion(${moduleType}) 失败:`, error.message)
        throw error
      }
    },

    /**
     * 查询倒计时提醒完成率统计
     * @param {string} moduleType - 模块类型（sedentary/eye）
     * @param {string} startDate - 起始日期 YYYY-MM-DD
     * @param {string} endDate - 结束日期 YYYY-MM-DD
     * @returns {Promise<{total: number, completed: number, rate: number, daily: object[]}>}
     */
    async fetchCompletionStats (moduleType, startDate, endDate) {
      try {
        const result = await invokeHealth('health:completion-stats', {
          module_type: moduleType,
          start_date: startDate,
          end_date: endDate
        })
        return result
      } catch (error) {
        console.error(`[HealthStore] fetchCompletionStats(${moduleType}) 失败:`, error.message)
        throw error
      }
    },

    /**
     * 自动记录睡眠事件（powerMonitor suspend/resume 触发）
     * @param {string} type - 事件类型：'suspend' | 'resume'
     * @param {string} [customTime] - 自定义时间 HH:mm（手动修改时使用）
     * @param {string} [customDate] - 自定义日期 YYYY-MM-DD（手动修改时使用）
     */
    async autoRecordSleep (type, customTime = null, customDate = null) {
      try {
        const record = await invokeHealth('health:auto-sleep', {
          type,
          custom_time: customTime,
          custom_date: customDate
        })
        await this.fetchTodayStats('sleep')
        return record
      } catch (error) {
        console.error('[HealthStore] autoRecordSleep 失败:', error.message)
        throw error
      }
    },

    /**
     * 删除指定日期的睡眠记录（手动修改时先清除旧记录）
     * @param {string} date - 日期 YYYY-MM-DD
     * @param {number} value - 记录类型：1=入睡 2=起床
     */
    async deleteSleepRecord (date, value) {
      try {
        const result = await invokeHealth('health:delete-sleep-record', {
          date,
          value
        })
        return result
      } catch (error) {
        console.error('[HealthStore] deleteSleepRecord 失败:', error.message)
        throw error
      }
    }
  }
})

export default useHealthStore
export { MODULE_TYPES, DEFAULT_CONFIGS, COUNTDOWN_MODULES }
