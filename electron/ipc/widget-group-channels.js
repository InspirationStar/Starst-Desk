// ============================================================
// 小部件分组 IPC 通道
// 注册 widget-group:* 系列处理器，参照 widget-channels.js 风格
// 使用 registry.js 的 register / success / failure 统一响应格式
// ============================================================

const { register, success, failure } = require('./registry.js')
const widgetGroupService = require('./../services/widget-group-service.js')
const logger = require('./../core/logger.js')

/**
 * 将 service 层抛出的 WidgetGroupError 转换为 failure 响应
 * 普通异常统一映射为 INTERNAL_ERROR
 * @param {Error} error
 * @returns {{ ok: false, error: { code, message } }}
 */
function toFailure (error) {
  if (error && error.code) {
    return failure(error.code, error.message)
  }
  return failure('INTERNAL_ERROR', error.message)
}

// ============================================================
// widget-group:list - 列出所有分组
// ============================================================
register('widget-group:list', async (event, data) => {
  try {
    const list = widgetGroupService.list()
    return success({ list })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:list 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:create - 创建分组
// data: { name?, member_ids: string[], active_member?, ...位置/样式字段 }
// ============================================================
register('widget-group:create', async (event, data) => {
  try {
    const group = widgetGroupService.create(data || {})
    return success({ group })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:create 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:update - 更新分组配置
// data: { id, ...fields }
// ============================================================
register('widget-group:update', async (event, data) => {
  try {
    if (!data || !data.id) {
      return failure('INVALID_PARAMS', '缺少分组 ID')
    }
    const { id, ...fields } = data
    const group = widgetGroupService.update(id, fields)
    return success({ group })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:update 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:delete - 删除分组（解散，不删除成员小部件）
// data: { id }
// ============================================================
register('widget-group:delete', async (event, data) => {
  try {
    if (!data || !data.id) {
      return failure('INVALID_PARAMS', '缺少分组 ID')
    }
    const ok = widgetGroupService.dissolve(data.id)
    return success({ success: ok })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:delete 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:merge - 合并两个小部件为分组
// data: { sourceWidgetType, targetWidgetType, name?, ...位置/样式字段 }
// ============================================================
register('widget-group:merge', async (event, data) => {
  try {
    const group = widgetGroupService.merge(data || {})
    return success({ group })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:merge 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:join - 将小部件加入已有分组
// data: { groupId, widgetType }
// ============================================================
register('widget-group:join', async (event, data) => {
  try {
    const group = widgetGroupService.join(data || {})
    return success({ group })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:join 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:detach - 从分组分离成员
// data: { groupId, widgetType }
// 返回: { group } 分离后的分组；若分组已解散则 { group: null, dissolved: true }
// ============================================================
register('widget-group:detach', async (event, data) => {
  try {
    const group = widgetGroupService.detach(data || {})
    return success({ group, dissolved: group === null })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:detach 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:switch-member - 切换活跃成员
// data: { groupId, widgetType }
// ============================================================
register('widget-group:switch-member', async (event, data) => {
  try {
    const group = widgetGroupService.switchMember(data || {})
    return success({ group })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:switch-member 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:get-by-member - 按成员查询所属分组
// data: { widgetType }
// 返回: { group } 所属分组，未归属任何分组时 group 为 null
// ============================================================
register('widget-group:get-by-member', async (event, data) => {
  try {
    if (!data || !data.widgetType) {
      return failure('INVALID_PARAMS', '缺少 widgetType')
    }
    const group = widgetGroupService.getByMember(data.widgetType)
    return success({ group })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:get-by-member 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:get - 按 ID 查询分组
// data: { id }
// ============================================================
register('widget-group:get', async (event, data) => {
  try {
    if (!data || !data.id) {
      return failure('INVALID_PARAMS', '缺少分组 ID')
    }
    const group = widgetGroupService.getById(data.id)
    if (!group) {
      return failure('GROUP_NOT_FOUND', `分组 ${data.id} 不存在`)
    }
    return success({ group })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:get 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:hit-test - 拖放命中测试
// data: { sourceWidgetType, targetBounds?, pointerX, pointerY }
// 返回: { hit: boolean, targetWidgetType: string|null, zone: 'header'|'body'|'none' }
// ============================================================
register('widget-group:hit-test', async (event, data) => {
  try {
    if (!data || typeof data.pointerX !== 'number' || typeof data.pointerY !== 'number') {
      return failure('INVALID_PARAMS', '缺少 pointerX / pointerY')
    }
    const result = widgetGroupService.hitTest(data)
    return success(result)
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:hit-test 失败: ${error.message}`)
    return toFailure(error)
  }
})

// ============================================================
// widget-group:request-switch - 请求切换到分组中的下一个/上一个成员
// data: { widgetType, direction: 'next' | 'prev' }
// 返回: { success: true }（异步切换，前端通过 widget-group:switched 事件接收结果）
// ============================================================
register('widget-group:request-switch', async (event, data) => {
  try {
    if (!data || !data.widgetType) {
      return failure('INVALID_PARAMS', '缺少 widgetType')
    }
    if (data.direction !== 'next' && data.direction !== 'prev') {
      return failure('INVALID_PARAMS', `direction 必须为 'next' 或 'prev'`)
    }
    await widgetGroupService.requestSwitch(data.widgetType, data.direction)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetGroupChannels', `widget-group:request-switch 失败: ${error.message}`)
    return toFailure(error)
  }
})