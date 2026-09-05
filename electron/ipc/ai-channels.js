// ============================================================
// AI 配置模块 IPC 通道
// 注册 ai:config:* 系列 IPC 处理器
// 包含测试连接、获取模型列表等辅助通道
// ============================================================

const { register, success, failure } = require('./registry.js')
const aiConfigDao = require('./../dao/ai-config-dao.js')
const aiAdapterFactory = require('./../core/ai-adapter.js')
const cryptoService = require('./../core/crypto-service.js')
const validators = require('./../utils/validators.js')
const logger = require('./../core/logger.js')

// ============================================================
// ai:config:list
// 返回所有配置，api_key 字段掩码处理
// ============================================================
register('ai:config:list', async (event, data) => {
  try {
    const configs = aiConfigDao.findAll()
    // 掩码 API 密钥，不返回加密原文
    const masked = configs.map(c => ({
      ...c,
      api_key_masked: c.api_key_encrypted ? '******' : '',
      api_key_encrypted: undefined
    }))
    return success(masked)
  } catch (error) {
    logger.error('AIChannels', `ai:config:list 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// ai:config:get
// 返回单个配置（掩码密钥）
// ============================================================
register('ai:config:get', async (event, data) => {
  try {
    if (!data.id) {
      return failure('CONFIG_ID_REQUIRED', '配置 ID 不能为空')
    }
    const config = aiConfigDao.getById(data.id)
    if (!config) {
      return failure('CONFIG_NOT_FOUND', '配置不存在')
    }
    config.api_key_masked = config.api_key_encrypted ? '******' : ''
    delete config.api_key_encrypted
    return success(config)
  } catch (error) {
    logger.error('AIChannels', `ai:config:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// ai:config:create
// api_key 明文传入，主进程加密后存储
// ============================================================
register('ai:config:create', async (event, data) => {
  try {
    if (!validators.isValidProviderType(data.provider_type)) {
      return failure('PROVIDER_TYPE_INVALID', '提供商类型不合法')
    }
    if (!data.name || !data.api_endpoint || !data.model_name) {
      return failure('REQUIRED_FIELDS', 'name、api_endpoint、model_name 不能为空')
    }

    // 校验模型类别（未传时默认 language）
    const modelCategory = data.model_category || 'language'
    if (!validators.isValidModelCategory(modelCategory)) {
      return failure('MODEL_CATEGORY_INVALID', '模型类别不合法（应为 language/image/video）')
    }

    // 校验 extra_config
    const extraConfigCheck = validators.isValidExtraConfig(modelCategory, data.extra_config)
    if (!extraConfigCheck.valid) {
      return failure(extraConfigCheck.error, extraConfigCheck.message)
    }

    // 非 Ollama 提供商必须配置 API 密钥（或通过 source_config_id 复用已有密钥）
    if (validators.isApiKeyRequired(data.provider_type)) {
      const hasApiKey = data.api_key && String(data.api_key).trim()
      const hasSourceConfigId = data.source_config_id != null && String(data.source_config_id) !== ''
      if (!hasApiKey && !hasSourceConfigId) {
        return failure('API_KEY_REQUIRED', '该提供商类型必须配置 API 密钥或选择已有 Key')
      }
    }

    // 加密 API 密钥（Ollama 不需要密钥）
    let apikeyEncrypted = null
    if (data.provider_type !== 'ollama') {
      if (data.source_config_id != null && String(data.source_config_id) !== '') {
        // 复用已有配置的密钥：从源配置复制 api_key_encrypted，避免重复输入
        const sourceConfig = aiConfigDao.getById(data.source_config_id)
        if (!sourceConfig) {
          return failure('SOURCE_CONFIG_NOT_FOUND', '源配置不存在，无法复用密钥')
        }
        if (!sourceConfig.api_key_encrypted) {
          return failure('SOURCE_CONFIG_NO_KEY', '源配置未设置密钥，无法复用')
        }
        apikeyEncrypted = sourceConfig.api_key_encrypted
      } else if (data.api_key) {
        apikeyEncrypted = cryptoService.encrypt(data.api_key)
      }
    }

    const config = aiConfigDao.create({
      provider_type: data.provider_type,
      name: data.name,
      api_endpoint: data.api_endpoint,
      api_key_encrypted: apikeyEncrypted,
      model_name: data.model_name,
      context_tokens: data.context_tokens,
      max_tokens: data.max_tokens,
      enable_thinking: data.enable_thinking,
      enable_vision: data.enable_vision,
      extra_config: data.extra_config,
      model_category: modelCategory
    })

    // 如果要求设为活跃模型
    if (data.is_active) {
      aiConfigDao.activate(config.id)
    }

    return success({
      ...config,
      api_key_masked: apikeyEncrypted ? '******' : '',
      api_key_encrypted: undefined
    })
  } catch (error) {
    logger.error('AIChannels', `ai:config:create 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// ai:config:update
// api_key 为空表示不修改密钥；非空表示更新密钥
// ============================================================
register('ai:config:update', async (event, data) => {
  try {
    if (!data.id) {
      return failure('CONFIG_ID_REQUIRED', '配置 ID 不能为空')
    }

    // 提供商类型变更时校验合法性
    if (data.provider_type !== undefined && !validators.isValidProviderType(data.provider_type)) {
      return failure('PROVIDER_TYPE_INVALID', '提供商类型不合法')
    }

    // 模型类别变更时校验合法性
    if (data.model_category !== undefined && !validators.isValidModelCategory(data.model_category)) {
      return failure('MODEL_CATEGORY_INVALID', '模型类别不合法（应为 language/image/video）')
    }

    // 校验 extra_config（需要确定校验用的 category）
    if (data.extra_config !== undefined) {
      // 优先使用本次传入的 model_category，否则读取现有配置的 model_category
      let categoryForCheck = data.model_category
      if (!categoryForCheck) {
        const existing = aiConfigDao.getById(data.id)
        categoryForCheck = existing ? existing.model_category : 'language'
      }
      const extraConfigCheck = validators.isValidExtraConfig(categoryForCheck, data.extra_config)
      if (!extraConfigCheck.valid) {
        return failure(extraConfigCheck.error, extraConfigCheck.message)
      }
    }

    const updateData = {}
    if (data.provider_type !== undefined) updateData.provider_type = data.provider_type
    if (data.name !== undefined) updateData.name = data.name
    if (data.api_endpoint !== undefined) updateData.api_endpoint = data.api_endpoint
    if (data.model_name !== undefined) updateData.model_name = data.model_name
    if (data.context_tokens !== undefined) updateData.context_tokens = data.context_tokens
    if (data.max_tokens !== undefined) updateData.max_tokens = data.max_tokens
    if (data.enable_thinking !== undefined) updateData.enable_thinking = data.enable_thinking
    if (data.enable_vision !== undefined) updateData.enable_vision = data.enable_vision
    if (data.extra_config !== undefined) updateData.extra_config = data.extra_config
    if (data.model_category !== undefined) updateData.model_category = data.model_category

    // api_key 处理：null/空字符串表示清空，undefined 表示不修改，非空字符串表示更新
    // source_config_id 处理：复用源配置的 api_key_encrypted（优先级高于 api_key）
    if (data.source_config_id !== undefined && data.source_config_id !== null && String(data.source_config_id) !== '') {
      const sourceConfig = aiConfigDao.getById(data.source_config_id)
      if (!sourceConfig) {
        return failure('SOURCE_CONFIG_NOT_FOUND', '源配置不存在，无法复用密钥')
      }
      if (!sourceConfig.api_key_encrypted) {
        return failure('SOURCE_CONFIG_NO_KEY', '源配置未设置密钥，无法复用')
      }
      updateData.api_key_encrypted = sourceConfig.api_key_encrypted
    } else if (data.api_key !== undefined) {
      if (data.api_key === null || data.api_key === '') {
        updateData.api_key_encrypted = null
      } else {
        updateData.api_key_encrypted = cryptoService.encrypt(data.api_key)
      }
    }

    const config = aiConfigDao.update(data.id, updateData)
    if (!config) {
      return failure('CONFIG_NOT_FOUND', '配置不存在')
    }

    // 处理激活状态
    if (data.is_active) {
      aiConfigDao.activate(config.id)
    }

    return success({
      ...config,
      api_key_masked: config.api_key_encrypted ? '******' : '',
      api_key_encrypted: undefined
    })
  } catch (error) {
    logger.error('AIChannels', `ai:config:update 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// ai:config:delete
// ============================================================
register('ai:config:delete', async (event, data) => {
  try {
    if (!data.id) {
      return failure('CONFIG_ID_REQUIRED', '配置 ID 不能为空')
    }
    const result = aiConfigDao.del(data.id)
    return success({ deleted: result })
  } catch (error) {
    logger.error('AIChannels', `ai:config:delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// ai:config:list-by-category
// 按模型类别返回配置列表（language / image / video）
// ============================================================
register('ai:config:list-by-category', async (event, data) => {
  try {
    if (!data.category || !validators.isValidModelCategory(data.category)) {
      return failure('MODEL_CATEGORY_INVALID', '模型类别不合法（应为 language/image/video）')
    }
    const configs = aiConfigDao.findByModelCategory(data.category)
    // 掩码 API 密钥，不返回加密原文
    const masked = configs.map(c => ({
      ...c,
      api_key_masked: c.api_key_encrypted ? '******' : '',
      api_key_encrypted: undefined
    }))
    return success(masked)
  } catch (error) {
    logger.error('AIChannels', `ai:config:list-by-category 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// ai:config:activate
// 激活指定模型（同时取消其他模型的激活状态）
// ============================================================
register('ai:config:activate', async (event, data) => {
  try {
    if (!data.id) {
      return failure('CONFIG_ID_REQUIRED', '配置 ID 不能为空')
    }
    const config = aiConfigDao.activate(data.id)
    if (!config) {
      return failure('CONFIG_NOT_FOUND', '配置不存在')
    }
    return success({
      ...config,
      api_key_masked: config.api_key_encrypted ? '******' : '',
      api_key_encrypted: undefined
    })
  } catch (error) {
    logger.error('AIChannels', `ai:config:activate 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// ai:config:test-connection
// 测试 AI 配置连接是否可用
// ============================================================
register('ai:config:test-connection', async (event, data) => {
  try {
    if (!data.id && !data.provider_type) {
      return failure('CONFIG_ID_REQUIRED', '配置 ID 或配置信息不能为空')
    }

    let config = null
    if (data.id) {
      config = aiConfigDao.getById(data.id)
      if (!config) {
        return failure('CONFIG_NOT_FOUND', '配置不存在')
      }
    } else {
      // 临时配置（用于配置页编辑时测试）
      config = {
        provider_type: data.provider_type,
        api_endpoint: data.api_endpoint,
        model_name: data.model_name,
        api_key_encrypted: data.api_key ? cryptoService.encrypt(data.api_key) : null,
        enable_thinking: data.enable_thinking ? 1 : 0,
        enable_vision: data.enable_vision ? 1 : 0
      }
    }

    const result = await aiAdapterFactory.testConnection(config)
    return success(result)
  } catch (error) {
    logger.error('AIChannels', `ai:config:test-connection 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// ai:config:list-models
// 获取模型列表（仅 Ollama 支持本地模型列表）
// ============================================================
register('ai:config:list-models', async (event, data) => {
  try {
    let config = null
    if (data.id) {
      config = aiConfigDao.getById(data.id)
      if (!config) {
        return failure('CONFIG_NOT_FOUND', '配置不存在')
      }
    } else {
      config = {
        provider_type: data.provider_type,
        api_endpoint: data.api_endpoint,
        model_name: data.model_name || 'test'
      }
    }

    const models = await aiAdapterFactory.listModels(config)
    return success({ models })
  } catch (error) {
    logger.error('AIChannels', `ai:config:list-models 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}
