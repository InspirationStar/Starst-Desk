// ============================================================
// 桌宠 IPC 通道
// 注册 pet:* 系列处理器，参照 widget-channels.js 风格
// 使用 registry.js 的 register / success / failure 统一响应格式
// 拖拽通道（pet:drag:start/move/end）为高频 send 模式，
//   在 pet-window-manager.js 的 initDragIpc 中通过 ipcMain.on 直接监听
// ============================================================

const { register, success, failure } = require('./registry.js')
const petWindowManager = require('./../core/pet-window-manager.js')
const logger = require('./../core/logger.js')

// ============================================================
// pet:get-config - 获取桌宠完整配置
// 直接返回 config 对象：{ enabled, alwaysOnTop, x, y, width, height, remindersPaused, character }
// ============================================================
register('pet:get-config', async (event, data) => {
  try {
    const config = petWindowManager.getConfig()
    return success(config)
  } catch (error) {
    logger.error('PetChannels', `pet:get-config 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:update-config - 更新桌宠配置
// data: { enabled?, alwaysOnTop?, x?, y?, width?, height?, remindersPaused? }
// ============================================================
register('pet:update-config', async (event, data) => {
  try {
    petWindowManager.updateConfig(data)
    // 桌宠启用/禁用时通过 showPet/hidePet 统一处理窗口和 petKeyWatcher 启停
    if (typeof data.enabled === 'boolean') {
      if (data.enabled) {
        petWindowManager.showPet()
      } else {
        petWindowManager.hidePet()
      }
    }
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:update-config 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:show - 显示桌宠
// ============================================================
register('pet:show', async (event, data) => {
  try {
    petWindowManager.showPet()
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:show 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:hide - 隐藏桌宠
// ============================================================
register('pet:hide', async (event, data) => {
  try {
    petWindowManager.hidePet()
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:hide 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:toggle - 切换桌宠显隐
// ============================================================
register('pet:toggle', async (event, data) => {
  try {
    petWindowManager.togglePet()
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:toggle 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:set-always-on-top - 设置桌宠置顶
// data: { alwaysOnTop: boolean }
// ============================================================
register('pet:set-always-on-top', async (event, data) => {
  try {
    if (!data || typeof data !== 'object') {
      return failure('INVALID_DATA', 'data 必须为对象')
    }
    petWindowManager.setAlwaysOnTop(data.alwaysOnTop)
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:set-always-on-top 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:temp-always-on-top - 临时置顶（不持久化）
// 气泡显示时临时提升图层，气泡消失后恢复
// data: { alwaysOnTop: boolean }
// ============================================================
register('pet:temp-always-on-top', async (event, data) => {
  try {
    if (!data || typeof data !== 'object') {
      return failure('INVALID_DATA', 'data 必须为对象')
    }
    petWindowManager.setTemporaryAlwaysOnTop(data.alwaysOnTop)
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:temp-always-on-top 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:resize-to-content - 根据渲染进程测量的内容尺寸自适应调整窗口
// data: { width, height }
// ============================================================
register('pet:resize-to-content', async (event, data) => {
  try {
    if (!data || typeof data !== 'object') {
      return failure('INVALID_DATA', 'data 必须为对象')
    }
    const { width, height } = data
    if (typeof width !== 'number' || typeof height !== 'number') {
      return failure('INVALID_DATA', 'width 和 height 必须为数字')
    }
    petWindowManager.resizeToContent(width, height)
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:resize-to-content 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:reset-position - 重置桌宠位置到屏幕右下角默认位置
// 返回 { x, y } 重置后的坐标
// ============================================================
register('pet:reset-position', async (event, data) => {
  try {
    const position = petWindowManager.resetPosition()
    return success({ position })
  } catch (error) {
    logger.error('PetChannels', `pet:reset-position 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:pause-reminders - 暂停桌宠提醒
// ============================================================
register('pet:pause-reminders', async (event, data) => {
  try {
    petWindowManager.setRemindersPaused(true)
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:pause-reminders 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:resume-reminders - 恢复桌宠提醒
// ============================================================
register('pet:resume-reminders', async (event, data) => {
  try {
    petWindowManager.setRemindersPaused(false)
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:resume-reminders 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:get-reminders-paused - 查询桌宠提醒暂停状态
// 返回 { paused: boolean }
// ============================================================
register('pet:get-reminders-paused', async (event, data) => {
  try {
    const paused = petWindowManager.isRemindersPaused()
    return success({ paused })
  } catch (error) {
    logger.error('PetChannels', `pet:get-reminders-paused 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// pet:dismiss-reminder - 关闭当前提醒
// 占位处理器：渲染进程本地处理提醒关闭动画，主进程仅返回成功
// ============================================================
register('pet:dismiss-reminder', async (event, data) => {
  try {
    return success({ success: true })
  } catch (error) {
    logger.error('PetChannels', `pet:dismiss-reminder 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}