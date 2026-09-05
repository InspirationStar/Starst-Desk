// ============================================================
// AI 配置 Pinia Store
// 职责：管理 AI 模型配置列表状态，封装 IPC 调用
// 提供：拉取列表、创建/更新/删除配置、激活模型、测试连接、获取模型列表
// 密钥字段掩码显示（不返回明文）
// ============================================================

import { defineStore } from 'pinia'
import { aiApi } from '@/utils/ipc-client'

export const useAiConfigStore = defineStore('aiConfig', {
  state: () => ({
    // 配置列表（按 created_at 倒序）
    configs: [],
    // 当前活跃配置
    activeConfig: null,
    // 按类别分别记录活跃配置
    activeLanguageConfig: null,
    activeImageConfig: null,
    activeVideoConfig: null,
    // 加载状态
    loading: false,
    // 最近一次错误
    error: null
  }),

  getters: {
    /**
     * 是否有可用配置
     * @returns {boolean}
     */
    hasConfig (state) {
      return state.configs.length > 0
    },

    /**
     * 活跃配置 ID
     * @returns {string|null}
     */
    activeConfigId (state) {
      return state.activeConfig?.id || null
    },

    /**
     * 按提供商类型分组
     * @returns {object} { ollama: [], deepseek: [], custom: [] }
     */
    configsByProvider (state) {
      const groups = { ollama: [], deepseek: [], custom: [] }
      for (const config of state.configs) {
        if (groups[config.provider_type]) {
          groups[config.provider_type].push(config)
        }
      }
      return groups
    },

    /**
     * 按模型类别分组（language / image / video）
     * @returns {object} { language: [], image: [], video: [] }
     */
    configsByCategory (state) {
      const groups = { language: [], image: [], video: [] }
      for (const config of state.configs) {
        const category = config.model_category || 'language'
        if (groups[category]) {
          groups[category].push(config)
        }
      }
      return groups
    },

    /**
     * 按类别获取活跃配置
     * @param {string} category 模型类别（language/image/video）
     * @returns {object|null}
     */
    activeConfigByCategory (state) {
      return (category) => {
        if (category === 'language') return state.activeLanguageConfig
        if (category === 'image') return state.activeImageConfig
        if (category === 'video') return state.activeVideoConfig
        return null
      }
    }
  },

  actions: {
    /**
     * 拉取配置列表
     * @returns {Promise<Array>}
     */
    async fetchConfigs () {
      this.loading = true
      this.error = null
      try {
        const configs = await aiApi.listConfigs()
        this.configs = configs || []
        // 按类别分别识别活跃配置
        const activeConfigs = this.configs.filter(c => Number(c.is_active) === 1)
        this.activeConfig = activeConfigs[0] || null
        this.activeLanguageConfig = activeConfigs.find(c => (c.model_category || 'language') === 'language') || null
        this.activeImageConfig = activeConfigs.find(c => c.model_category === 'image') || null
        this.activeVideoConfig = activeConfigs.find(c => c.model_category === 'video') || null
        return this.configs
      } catch (err) {
        this.error = err.message
        console.error('[ai-config-store] fetchConfigs 失败:', err)
        return []
      } finally {
        this.loading = false
      }
    },

    /**
     * 创建配置
     * @param {object} data { provider_type, name, api_endpoint, api_key, model_name, is_active }
     * @returns {Promise<object|null>}
     */
    async createConfig (data) {
      this.error = null
      try {
        const config = await aiApi.createConfig(data)
        // 创建后刷新列表
        await this.fetchConfigs()
        return config
      } catch (err) {
        this.error = err.message
        console.error('[ai-config-store] createConfig 失败:', err)
        return null
      }
    },

    /**
     * 更新配置
     * @param {string} id 配置 ID
     * @param {object} data 要更新的字段
     * @returns {Promise<object|null>}
     */
    async updateConfig (id, data) {
      this.error = null
      try {
        const config = await aiApi.updateConfig({ id, ...data })
        await this.fetchConfigs()
        return config
      } catch (err) {
        this.error = err.message
        console.error('[ai-config-store] updateConfig 失败:', err)
        return null
      }
    },

    /**
     * 删除配置
     * @param {string} id 配置 ID
     * @returns {Promise<boolean>}
     */
    async deleteConfig (id) {
      this.error = null
      try {
        await aiApi.deleteConfig(id)
        this.configs = this.configs.filter(c => c.id !== id)
        // 如果删除的是活跃配置，清空活跃引用
        if (this.activeConfig?.id === id) {
          this.activeConfig = null
        }
        if (this.activeLanguageConfig?.id === id) {
          this.activeLanguageConfig = null
        }
        if (this.activeImageConfig?.id === id) {
          this.activeImageConfig = null
        }
        if (this.activeVideoConfig?.id === id) {
          this.activeVideoConfig = null
        }
        return true
      } catch (err) {
        this.error = err.message
        console.error('[ai-config-store] deleteConfig 失败:', err)
        return false
      }
    },

    /**
     * 设置活跃配置
     * @param {string} id 配置 ID
     * @returns {Promise<object|null>}
     */
    async setActiveConfig (id) {
      this.error = null
      try {
        const config = await aiApi.activateConfig(id)
        await this.fetchConfigs()
        return config
      } catch (err) {
        this.error = err.message
        console.error('[ai-config-store] setActiveConfig 失败:', err)
        return null
      }
    },

    /**
     * 测试连接
     * @param {object} data 配置信息（含 id 或完整配置字段）
     * @returns {Promise<{ ok: boolean, message?: string, latency?: number }>}
     */
    async testConnection (data) {
      try {
        return await aiApi.testConnection(data)
      } catch (err) {
        console.error('[ai-config-store] testConnection 失败:', err)
        return { ok: false, message: err.message }
      }
    },

    /**
     * 获取模型列表（仅 Ollama 支持本地模型列表）
     * @param {object} data 配置信息
     * @returns {Promise<Array<string>>}
     */
    async listModels (data) {
      try {
        const result = await aiApi.listModels(data)
        return result.models || []
      } catch (err) {
        console.error('[ai-config-store] listModels 失败:', err)
        return []
      }
    },

    /**
     * 根据 ID 获取配置
     * @param {string} id
     * @returns {object|null}
     */
    getConfigById (id) {
      return this.configs.find(c => c.id === id) || null
    },

    /**
     * 按模型类别查询配置列表（language / image / video）
     * @param {string} category 模型类别
     * @returns {Promise<Array>}
     */
    async listConfigsByCategory (category) {
      this.error = null
      try {
        const configs = await aiApi.listConfigsByCategory(category)
        return configs || []
      } catch (err) {
        this.error = err.message
        console.error('[ai-config-store] listConfigsByCategory 失败:', err)
        return []
      }
    }
  }
})

export default useAiConfigStore
