// ============================================================
// 标签服务（主进程）
// 使用 registry.register 注册 IPC 通道，自动包装为 { ok: true, data } 标准响应格式
// 通道命名规范：tags:action
// 提供 CRUD、按名称查重、统计接口
// ============================================================

const { register, success, failure } = require('./../ipc/registry.js')
const tagsDao = require('./../dao/tags-dao.js')
const logger = require('./../core/logger.js')

// 合法颜色白名单（与 schema.js chk_tag_color 对齐）
const VALID_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white']

/**
 * 校验颜色是否合法
 * @param {string} color
 * @returns {boolean}
 */
function isValidColor (color) {
  return VALID_COLORS.includes(color)
}

/**
 * 注册标签 IPC 通道
 */
function registerTagsChannels () {
  // 列出所有标签
  register('tags:list', async (event, data) => {
    try {
      const list = tagsDao.list(data || {})
      return success({ list })
    } catch (error) {
      logger.error('TagsService', `tags:list 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })

  // 获取单个标签
  register('tags:get', async (event, data) => {
    try {
      const tag = tagsDao.get(data.id)
      if (!tag) {
        return failure('NOT_FOUND', `标签 ${data.id} 不存在`)
      }
      return success({ tag })
    } catch (error) {
      logger.error('TagsService', `tags:get 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })

  // 创建标签
  register('tags:create', async (event, data) => {
    try {
      if (!data || !data.name || !data.name.trim()) {
        return failure('INVALID_NAME', '标签名称不能为空')
      }
      const color = data.color || 'blue'
      if (!isValidColor(color)) {
        return failure('INVALID_COLOR', `非法颜色: ${color}`)
      }
      // 查重（同名标签不允许）
      const existing = tagsDao.getByName(data.name.trim())
      if (existing) {
        return failure('DUPLICATE_NAME', `标签名称已存在: ${data.name}`)
      }
      const tag = tagsDao.create({ name: data.name.trim(), color })
      return success({ tag })
    } catch (error) {
      logger.error('TagsService', `tags:create 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })

  // 更新标签（重命名/改颜色）
  register('tags:update', async (event, data) => {
    try {
      if (!data || !data.id) {
        return failure('INVALID_ID', '标签 id 不能为空')
      }
      const updateData = {}
      if (data.name !== undefined) {
        const trimmed = (data.name || '').trim()
        if (!trimmed) {
          return failure('INVALID_NAME', '标签名称不能为空')
        }
        // 查重（排除自身）
        const existing = tagsDao.getByName(trimmed)
        if (existing && existing.id !== data.id) {
          return failure('DUPLICATE_NAME', `标签名称已存在: ${data.name}`)
        }
        updateData.name = trimmed
      }
      if (data.color !== undefined) {
        if (!isValidColor(data.color)) {
          return failure('INVALID_COLOR', `非法颜色: ${data.color}`)
        }
        updateData.color = data.color
      }
      const tag = tagsDao.update(data.id, updateData)
      if (!tag) {
        return failure('NOT_FOUND', `标签 ${data.id} 不存在`)
      }
      return success({ tag })
    } catch (error) {
      logger.error('TagsService', `tags:update 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })

  // 删除标签
  register('tags:delete', async (event, data) => {
    try {
      const ok = tagsDao.del(data.id)
      if (!ok) {
        return failure('NOT_FOUND', `标签 ${data.id} 不存在`)
      }
      return success({ success: true })
    } catch (error) {
      logger.error('TagsService', `tags:delete 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })

  // 获取标签统计（总数 + 按颜色分组）
  register('tags:stats', async () => {
    try {
      const stats = tagsDao.getStats()
      return success(stats)
    } catch (error) {
      logger.error('TagsService', `tags:stats 失败: ${error.message}`)
      return failure('INTERNAL_ERROR', error.message)
    }
  })
}

module.exports = { registerTagsChannels }