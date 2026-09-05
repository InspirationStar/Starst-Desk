// ============================================================
// 五重通知服务
// 统一接口：notify(type, title, body, options)
// 五重通知：①系统通知 ②托盘闪烁 ③灵动岛浮窗 ④桌宠提醒
// 同一 source.id 在 1 分钟内不重复触发（内存 Map 去重）
// 灵动岛浮窗取代了原"应用内弹窗"和"独立提醒窗口"两个渠道
// ============================================================

const { Notification, BrowserWindow } = require('electron')
const logger = require('./logger.js')
const trayManager = require('./tray-manager.js')

// 通知去重 Map：sourceId -> timestamp
const notifiedMap = new Map()
const DEDUP_WINDOW_MS = 60 * 1000 // 1 分钟去重窗口

/**
 * 三重通知统一接口
 * @param {string} type - 通知类型（note/task/health/ai）
 * @param {string} title - 通知标题
 * @param {string} body - 通知内容
 * @param {object} [options] - 额外选项
 * @param {object} [options.source] - 来源标识 { module, id }，用于去重
 */
function notify (type, title, body, options = {}) {
  const { source, channels } = options

  // 去重检查
  if (source && source.id) {
    const key = `${type}:${source.module}:${source.id}`
    const now = Date.now()
    const lastNotified = notifiedMap.get(key) || 0

    if (now - lastNotified < DEDUP_WINDOW_MS) {
      logger.debug('NotificationService', `通知已去重跳过: ${key}`)
      return
    }

    notifiedMap.set(key, now)

    // 清理过期条目（超过 5 分钟的记录）
    for (const [k, v] of notifiedMap.entries()) {
      if (now - v > 5 * 60 * 1000) {
        notifiedMap.delete(k)
      }
    }
  }

  logger.info('NotificationService', `[${type}] ${title}: ${body}`)

  // 根据 channels 配置决定发布渠道
  // channels: ['notification'(系统通知), 'popup'(应用通知)]
  // 桌宠气泡通知始终发送（由桌宠设置页面控制是否启用，不受 channels 控制）
  const chans = Array.isArray(channels) && channels.length > 0
    ? channels
    : ['notification', 'popup']

  // ① 系统通知
  if (chans.includes('notification')) {
    sendSystemNotification(title, body, options)
  }

  // ② 托盘闪烁（始终执行，确保用户不会错过）
  trayManager.startBlink()
  setTimeout(() => {
    trayManager.stopBlink()
  }, 30000)

  // ③ 灵动岛浮窗（统一应用提醒渠道，取代原应用内弹窗 + 独立提醒窗口）
  if (chans.includes('popup')) {
    sendInAppNotification(type, title, body, options)
  }

  // ④ 桌宠提醒（始终发送，由桌宠设置页面控制是否启用）
  sendPetNotification(type, title, body, options)
}

/**
 * 发送系统通知
 * @param {string} title
 * @param {string} body
 * @param {object} options
 */
function sendSystemNotification (title, body, options) {
  try {
    // 检查是否支持系统通知
    if (!Notification.isSupported()) {
      logger.warn('NotificationService', '系统通知不支持')
      return
    }

    // 安全修复：Electron Notification 构造选项不包含 onClick，需通过事件监听绑定点击回调
    const notif = new Notification({
      title,
      body,
      silent: options.silent || false
    })

    // 点击通知时唤起主窗口
    if (typeof options.onClick === 'function') {
      notif.on('click', options.onClick)
    }

    notif.show()
  } catch (error) {
    logger.error('NotificationService', `系统通知发送失败: ${error.message}`)
  }
}

/**
 * 发送灵动岛浮窗通知（统一应用提醒渠道）
 * 取代原"应用内弹窗"和"独立提醒窗口"两个渠道
 * 灵动岛从屏幕顶部居中向下弹出，独立窗口，不抢夺焦点
 * @param {string} type
 * @param {string} title
 * @param {string} body
 * @param {object} options
 */
function sendInAppNotification (type, title, body, options) {
  try {
    // 延迟 require 避免循环依赖
    const islandWindowManager = require('./island-window-manager.js')
    const source = options?.source
    islandWindowManager.showIsland({
      type,
      title,
      body,
      source,
      extraData: options.extraData,
      action: options.action,
      duration: options.duration
    })
  } catch (error) {
    logger.error('NotificationService', `灵动岛通知发送失败: ${error.message}`)
  }
}

/**
 * 发送桌宠提醒通知（第四重通知渠道）
 * 延迟 require pet-window-manager 避免循环依赖
 * 调用 petWindowManager.sendReminder 向桌宠窗口推送 pet:reminder 事件
 * 桌宠未启用或暂停提醒时由 pet-window-manager 内部跳过
 * @param {string} type - 通知类型（note/task/health/ai）
 * @param {string} title - 通知标题
 * @param {string} body - 通知内容
 * @param {object} options - 额外选项（含 source 等）
 */
function sendPetNotification (type, title, body, options) {
  try {
    // 延迟 require 避免循环依赖（notification-service ← pet-window-manager ← notification-service）
    const petWindowManager = require('./pet-window-manager.js')
    const source = options?.source
    petWindowManager.sendReminder(type, title, body, source)
  } catch (error) {
    logger.warn('NotificationService', `桌宠通知发送失败: ${error.message}`)
  }
}

/**
 * 发送灵动岛浮窗通知（兼容旧调用名）
 * 原独立提醒窗口已合并到灵动岛渠道，此函数保留为 sendInAppNotification 的别名
 * 避免外部调用方因 API 变更而报错
 * @param {string} type - 通知类型（note/task/health/ai）
 * @param {string} title - 通知标题
 * @param {string} body - 通知内容
 * @param {object} options - 额外选项（含 source 等）
 */
function sendReminderWindowNotification (type, title, body, options) {
  // 独立提醒窗口已合并到灵动岛，直接调用 sendInAppNotification
  sendInAppNotification(type, title, body, options)
}

/**
 * 清除通知去重记录（可用于手动清除）
 * @param {string} [sourceId] - 指定清除某个 sourceId 的记录，不传则清除所有
 */
function clearNotification (sourceId) {
  if (sourceId) {
    for (const key of notifiedMap.keys()) {
      if (key.includes(sourceId)) {
        notifiedMap.delete(key)
      }
    }
  } else {
    notifiedMap.clear()
  }
}

module.exports = {
  notify,
  clearNotification
}
