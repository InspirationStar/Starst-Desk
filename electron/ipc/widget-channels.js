// ============================================================
// 桌面小部件 IPC 通道
// 注册 widget:* 系列处理器，参照 system-channels.js 风格
// 使用 registry.js 的 register / success / failure 统一响应格式
// ============================================================

const { register, success, failure } = require('./registry.js')
const { ipcMain } = require('electron')
const widgetDao = require('./../dao/widget-dao.js')
const widgetRegistry = require('./../core/widget-registry.js')
const widgetWindowManager = require('./../core/widget-window-manager.js')
const windowManager = require('./../core/window-manager.js')
const widgetHotkey = require('./../core/widget-hotkey.js')
const logger = require('./../core/logger.js')

// ============================================================
// widget:list - 获取所有小部件配置列表
// ============================================================
register('widget:list', async (event, data) => {
  try {
    const list = widgetDao.list()
    return success({ list })
  } catch (error) {
    logger.error('WidgetChannels', `widget:list 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:get - 获取单个小部件配置
// data: { widgetType }
// ============================================================
register('widget:get', async (event, data) => {
  try {
    const widget = widgetDao.getByType(data.widgetType)
    if (!widget) {
      return failure('NOT_FOUND', `小部件 ${data.widgetType} 不存在`)
    }
    // 返回 widget 对象本身（非 { widget }），所有小部件 loadConfig 直接访问 config.is_capsule 等字段
    return success(widget)
  } catch (error) {
    logger.error('WidgetChannels', `widget:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:create - 创建/启用小部件
// data: { widgetType }
// ============================================================
register('widget:create', async (event, data) => {
  try {
    if (!widgetRegistry.isValidType(data.widgetType)) {
      return failure('INVALID_TYPE', `未知小部件类型: ${data.widgetType}`)
    }
    // 若已存在则启用，否则创建新记录
    let widget = widgetDao.getByType(data.widgetType)
    if (widget) {
      widget = widgetDao.setEnabled(data.widgetType, true)
    } else {
      widget = widgetDao.create({ widget_type: data.widgetType, id: data.widgetType })
    }
    // 创建窗口
    widgetWindowManager.createWidgetWindow(data.widgetType)
    // 系统监控小部件启用时，启动系统指标采集器（按需轮询，避免未启用时空转）
    if (data.widgetType === 'system-monitor') {
      require('./../core/system-metrics-collector.js').startMetricsCollector()
    }
    return success({ widget })
  } catch (error) {
    logger.error('WidgetChannels', `widget:create 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:delete - 删除/禁用小部件
// data: { widgetType }
// ============================================================
register('widget:delete', async (event, data) => {
  try {
    // 销毁窗口
    widgetWindowManager.destroyWidgetWindow(data.widgetType)
    // 禁用（不删除记录，保留配置以便重新启用）
    const widget = widgetDao.setEnabled(data.widgetType, false)
    // 系统监控小部件禁用时，停止系统指标采集器
    if (data.widgetType === 'system-monitor') {
      require('./../core/system-metrics-collector.js').stopMetricsCollector()
    }
    return success({ widget })
  } catch (error) {
    logger.error('WidgetChannels', `widget:delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:update - 更新小部件配置
// data: { id?, widget_type?, ...fields }
// 支持通过 id 或 widget_type 更新（id 优先，其次 widget_type）
// 当更新 collapse_behavior / is_capsule 时，通知对应小部件窗口同步配置
// ============================================================
register('widget:update', async (event, data) => {
  try {
    const { id, widget_type, ...fields } = data
    // 优先用 id 更新，其次用 widget_type 查找后更新
    let widget
    if (id) {
      widget = widgetDao.update(id, fields)
    } else if (widget_type) {
      const existing = widgetDao.getByType(widget_type)
      if (existing) {
        widget = widgetDao.update(existing.id, fields)
      }
    }
    if (!widget) {
      return failure('NOT_FOUND', `小部件不存在（id=${id}, widget_type=${widget_type}）`)
    }
    // 如果更新了 collapse_behavior 或 is_capsule，通知对应小部件窗口重新加载配置
    if (fields.collapse_behavior !== undefined || fields.is_capsule !== undefined) {
      const targetWidgetType = widget.widget_type || widget_type
      if (targetWidgetType) {
        const win = widgetWindowManager.getWidgetWindow(targetWidgetType)
        if (win && !win.isDestroyed()) {
          try {
            win.webContents.send('widget:capsule-changed', {
              widgetType: targetWidgetType,
              isCapsule: widget.is_capsule,
              collapseBehavior: widget.collapse_behavior
            })
          } catch (e) { /* 忽略发送失败 */ }
        }
      }
    }
    return success({ widget })
  } catch (error) {
    logger.error('WidgetChannels', `widget:update 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:update-bounds - 拖拽/缩放时更新位置（节流由窗口管理器处理）
// data: { widgetType, bounds: { x, y, width, height } }
// ============================================================
register('widget:update-bounds', async (event, data) => {
  try {
    widgetWindowManager.updateWidgetBounds(data.widgetType, data.bounds)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:update-bounds 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:show - 显示单个小部件
// data: { widgetType }
// ============================================================
register('widget:show', async (event, data) => {
  try {
    widgetWindowManager.showWidget(data.widgetType)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:show 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:hide - 隐藏单个小部件
// data: { widgetType }
// ============================================================
register('widget:hide', async (event, data) => {
  try {
    widgetWindowManager.hideWidget(data.widgetType)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:hide 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:show-all - 显示所有小部件
// ============================================================
register('widget:show-all', async (event, data) => {
  try {
    widgetWindowManager.showAllWidgets()
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:show-all 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:hide-all - 隐藏所有小部件
// ============================================================
register('widget:hide-all', async (event, data) => {
  try {
    widgetWindowManager.hideAllWidgets()
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:hide-all 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:toggle-all - 切换所有小部件显隐
// ============================================================
register('widget:toggle-all', async (event, data) => {
  try {
    widgetWindowManager.toggleAllWidgets()
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:toggle-all 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:reset-all - 重置所有小部件（位置、尺寸、胶囊状态、锁定状态）
// 修复（问题 e）：遍历所有已创建的小部件窗口，重置到默认状态
// ============================================================
register('widget:reset-all', async (event, data) => {
  try {
    widgetWindowManager.resetAllWidgets()
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:reset-all 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:toggle-capsule - 切换胶囊状态
// data: { widgetType, isCapsule }
// ============================================================
register('widget:toggle-capsule', async (event, data) => {
  try {
    widgetWindowManager.setWidgetCapsule(data.widgetType, data.isCapsule)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:toggle-capsule 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:set-capsule - 设置胶囊状态（公开 API）
// data: { widgetType, isCapsule }
// 与 widget:toggle-capsule 功能相同，作为对外统一接口
// ============================================================
register('widget:set-capsule', async (event, data) => {
  try {
    widgetWindowManager.setCapsule(data.widgetType, data.isCapsule)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:set-capsule 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:toggle-position-lock - 切换位置锁
// data: { widgetType }
// ============================================================
register('widget:toggle-position-lock', async (event, data) => {
  try {
    widgetWindowManager.togglePositionLock(data.widgetType)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:toggle-position-lock 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:toggle-size-lock - 切换大小锁
// data: { widgetType }
// ============================================================
register('widget:toggle-size-lock', async (event, data) => {
  try {
    widgetWindowManager.toggleSizeLock(data.widgetType)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:toggle-size-lock 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:reset-position - 重置位置到默认
// data: { widgetType }
// ============================================================
register('widget:reset-position', async (event, data) => {
  try {
    widgetWindowManager.resetPosition(data.widgetType)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:reset-position 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:toggle-always-on-top - 切换置顶
// data: { widgetType }
// ============================================================
register('widget:toggle-always-on-top', async (event, data) => {
  try {
    widgetWindowManager.toggleAlwaysOnTop(data.widgetType)
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:toggle-always-on-top 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:resize-to-content - 根据渲染进程测量的内容尺寸自适应调整窗口
// data: { widgetType, width, height }
// ============================================================
register('widget:resize-to-content', async (event, data) => {
  try {
    if (!data || typeof data !== 'object') {
      return failure('INVALID_DATA', 'data 必须为对象')
    }
    const { widgetType, width, height } = data
    if (!widgetRegistry.isValidType(widgetType)) {
      return failure('INVALID_TYPE', `未知小部件类型: ${widgetType}`)
    }
    widgetWindowManager.resizeToContent(widgetType, { width, height })
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:resize-to-content 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:hotkey:get - 获取全局热键配置
// ============================================================
register('widget:hotkey:get', async (event, data) => {
  try {
    const accelerator = widgetHotkey.getAccelerator()
    return success({ accelerator })
  } catch (error) {
    logger.error('WidgetChannels', `widget:hotkey:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:hotkey:set - 设置全局热键
// data: { accelerator }
// ============================================================
register('widget:hotkey:set', async (event, data) => {
  try {
    const result = widgetHotkey.setAccelerator(data.accelerator)
    if (!result.ok) {
      return failure('HOTKEY_CONFLICT', result.error)
    }
    return success({ accelerator: data.accelerator })
  } catch (error) {
    logger.error('WidgetChannels', `widget:hotkey:set 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:material:get - 获取当前窗口材质配置
// 返回 { material: 'default' | 'mica' | 'acrylic' }
// 主窗口与小部件共享同一材质配置
// ============================================================
register('widget:material:get', async (event, data) => {
  try {
    const material = widgetWindowManager.getMaterial()
    return success({ material })
  } catch (error) {
    logger.error('WidgetChannels', `widget:material:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:material:set - 动态切换所有窗口的材质
// data: { material: 'default' | 'mica' | 'acrylic' }
// 同时应用到小部件窗口和主窗口（共享同一配置，同步切换）
// ============================================================
register('widget:material:set', async (event, data) => {
  try {
    const { material } = data
    // 应用到所有小部件窗口（内部会持久化配置）
    widgetWindowManager.setMaterial(material)
    // 同时应用到主窗口（标题栏材质，Win11 22H2+）
    try {
      windowManager.setMaterial(material)
    } catch (e) {
      logger.warn('WidgetChannels', `主窗口材质切换失败: ${e.message}`)
    }
    return success({ material })
  } catch (error) {
    logger.error('WidgetChannels', `widget:material:set 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:drag:start - 开始拖拽（主进程接管）
// data: { widgetType, startX, startY }
// 注：widget:drag:move 和 widget:drag:end 在 widget-window-manager.js
// 中通过 ipcMain.on 直接监听（无需走 register 的 invoke 模式）
// ============================================================
register('widget:drag:start', async (event, data) => {
  try {
    // 拖拽逻辑由 widget-window-manager 的 initDragIpc 处理
    // 此处仅作占位，实际拖拽通过 ipcMain.on 同步通道处理
    return success({ success: true })
  } catch (error) {
    logger.error('WidgetChannels', `widget:drag:start 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:get-collapse-behavior - 获取小部件折叠行为
// data: { widgetType }
// ============================================================
register('widget:get-collapse-behavior', async (event, data) => {
  try {
    const widget = widgetDao.getByType(data.widgetType)
    if (!widget) {
      return failure('NOT_FOUND', `小部件 ${data.widgetType} 不存在`)
    }
    return success({ behavior: widget.collapse_behavior || 'click' })
  } catch (error) {
    logger.error('WidgetChannels', `widget:get-collapse-behavior 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:set-collapse-behavior - 设置小部件折叠行为
// data: { widgetType, behavior: 'expanded' | 'click' | 'smart' }
// ============================================================
register('widget:set-collapse-behavior', async (event, data) => {
  try {
    const validBehaviors = ['expanded', 'click', 'smart']
    if (!validBehaviors.includes(data.behavior)) {
      return failure('INVALID_DATA', `无效的折叠行为: ${data.behavior}`)
    }
    const widget = widgetDao.getByType(data.widgetType)
    if (!widget) {
      return failure('NOT_FOUND', `小部件 ${data.widgetType} 不存在`)
    }
    const updated = widgetDao.update(widget.id, { collapse_behavior: data.behavior })
    // 广播折叠行为变化到对应小部件窗口，让渲染进程同步 UI 勾选状态
    try {
      const win = widgetWindowManager.getWidgetWindow(data.widgetType)
      if (win) {
        win.webContents.send('widget:capsule-changed', {
          widgetType: data.widgetType,
          collapseBehavior: data.behavior
        })
      }
    } catch (e) { /* 窗口可能未创建，忽略 */ }
    // 如果设置为 smart 模式且当前是 expanded，确保初始状态为胶囊
    if (data.behavior === 'smart' && updated) {
      try {
        widgetDao.setCapsule(data.widgetType, true)
      } catch (e) { /* 忽略胶囊状态设置失败 */ }
    }
    return success({ widget: updated })
  } catch (error) {
    logger.error('WidgetChannels', `widget:set-collapse-behavior 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// widget:open-settings - 打开小部件设置页
// 单向消息（ipcMain.on），通知主窗口跳转到小部件设置视图
// data: { widgetType }
// ============================================================
ipcMain.on('widget:open-settings', (event, data) => {
  try {
    if (!data || !data.widgetType) return
    const mainWin = windowManager.getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) {
      logger.warn('WidgetChannels', 'widget:open-settings: 主窗口不存在')
      return
    }
    // 显示并聚焦主窗口
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
    // 通知主窗口路由到小部件设置页并定位到对应小部件
    mainWin.webContents.send('navigate-to-widget-settings', { widgetType: data.widgetType })
  } catch (error) {
    logger.error('WidgetChannels', `widget:open-settings 失败: ${error.message}`)
  }
})

module.exports = {}