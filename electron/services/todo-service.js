// ============================================================
// Todo 服务（主进程）
// 职责：待办事项 CRUD、提醒管理、附件处理、到期提醒检查
// ============================================================

const { ipcMain, dialog, Notification } = require('electron')
const path = require('path')
const fs = require('fs').promises
const os = require('os')

// 复用已有通知基础设施（五重通知：系统通知 + 托盘闪烁 + 灵动岛 + 桌宠）
const notificationService = require('../core/notification-service.js')
// 复用已有应用设置 DAO（持久化已提醒 ID 列表，避免重启后重复提醒）
const appSettingDao = require('../dao/app-setting-dao.js')
const logger = require('../core/logger.js')

// ============================================================
// 工具函数
// ============================================================

/**
 * 格式化日期
 * @param {string|Date} date
 * @returns {string}
 */
function formatDate (date) {
  if (!date) return ''
  const d = new Date(date)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 计算截止日期状态
 * @param {string} dueDate
 * @returns {object} { status: 'overdue'|'today'|'future', label: string }
 */
function getDueDateStatus (dueDate) {
  if (!dueDate) return { status: 'none', label: '' }

  const now = new Date()
  const due = new Date(dueDate)
  const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { status: 'overdue', label: '已过期' }
  if (diffDays === 0) return { status: 'today', label: '今天' }
  if (diffDays === 1) return { status: 'future', label: '明天' }
  return { status: 'future', label: `${diffDays}天后` }
}

// ============================================================
// IPC 处理器
// ============================================================

/**
 * 注册 Todo 服务相关的 IPC 通道
 */
function registerTodoChannels () {
  // 获取待办列表
  ipcMain.handle('todo:list', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const { filter, page = 1, size = 20 } = data || {}

      // 防御性处理：确保 query 始终是数组
      let query = Array.isArray(todoDao.list()) ? todoDao.list() : []
      if (filter) {
        if (filter.status === 'active') {
          query = query.filter(t => Number(t.is_enabled) === 1)
        } else if (filter.status === 'completed') {
          query = query.filter(t => Number(t.is_enabled) === 0)
        }
        if (filter.color) {
          query = query.filter(t => t.color === filter.color)
        }
        if (filter.dueDate) {
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          if (filter.dueDate === 'today') {
            query = query.filter(t => {
              if (!t.due_date) return false
              const due = new Date(t.due_date)
              return due >= today && due < new Date(today.getTime() + 24 * 60 * 60 * 1000)
            })
          } else if (filter.dueDate === 'week') {
            const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
            query = query.filter(t => {
              if (!t.due_date) return false
              const due = new Date(t.due_date)
              return due >= today && due <= weekEnd
            })
          }
        }
      }

      // 分页
      const start = (page - 1) * size
      const paginated = query.slice(start, start + size)

      return {
        list: paginated,
        total: query.length,
        page,
        size
      }
    } catch (error) {
      console.error('[TodoService] todo:list 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message }, list: [], total: 0, page: 1, size: 20 }
    }
  })

  // 获取单个待办
  ipcMain.handle('todo:get', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const todo = todoDao.get(data.id)
      if (!todo) {
        return { error: { code: 'NOT_FOUND', message: `待办 ${data.id} 不存在` } }
      }
      return { todo }
    } catch (error) {
      console.error('[TodoService] todo:get 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 创建待办
  ipcMain.handle('todo:create', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const todo = todoDao.create(data)
      syncReminderCheckerState()
      return { todo }
    } catch (error) {
      console.error('[TodoService] todo:create 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 更新待办
  ipcMain.handle('todo:update', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const todo = todoDao.update(data.id, data)
      syncReminderCheckerState()
      return { todo }
    } catch (error) {
      console.error('[TodoService] todo:update 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 删除待办
  ipcMain.handle('todo:delete', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      todoDao.delete(data.id)
      syncReminderCheckerState()
      return { success: true }
    } catch (error) {
      console.error('[TodoService] todo:delete 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 切换待办完成状态
  ipcMain.handle('todo:toggle', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      // 直接按 id 查询待办（todos 表无 type 字段，getByType 语义不符）
      const todo = todoDao.get(data.id)
      if (!todo) {
        return { error: { code: 'NOT_FOUND', message: `待办 ${data.id} 不存在` } }
      }

      // is_enabled: 1=未完成（激活），0=已完成
      // data.enabled: 1=未完成，0=已完成
      const newEnabled = data.enabled !== undefined ? Number(data.enabled) : (Number(todo.is_enabled) === 1 ? 0 : 1)
      todoDao.setEnabled(todo.id, newEnabled === 1)
      syncReminderCheckerState()

      // 如果标记为完成，触发提醒
      if (newEnabled === 0 && todo.due_date) {
        const status = getDueDateStatus(todo.due_date)
        if (status.status === 'overdue') {
          sendReminder(`待办 "${todo.title}" 已过期`, 'deadline-overdue')
        }
      }

      return { todo: { ...todo, is_enabled: newEnabled } }
    } catch (error) {
      console.error('[TodoService] todo:toggle 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 设置截止日期
  ipcMain.handle('todo:set-due-date', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const todo = todoDao.update(data.id, { due_date: data.dueDate })
      syncReminderCheckerState()
      return { todo }
    } catch (error) {
      console.error('[TodoService] todo:set-due-date 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 设置重复规则
  ipcMain.handle('todo:set-recurrence', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const todo = todoDao.update(data.id, { recurrence: data.recurrence })
      return { todo }
    } catch (error) {
      console.error('[TodoService] todo:set-recurrence 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 设置颜色
  ipcMain.handle('todo:set-color', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const todo = todoDao.update(data.id, { color: data.color })
      return { todo }
    } catch (error) {
      console.error('[TodoService] todo:set-color 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 添加附件
  ipcMain.handle('todo:add-attachment', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const todo = todoDao.get(data.id)
      if (!todo) {
        return { error: { code: 'NOT_FOUND', message: `待办 ${data.id} 不存在` } }
      }

      const attachments = todo.attachments ? JSON.parse(todo.attachments) : []
      attachments.push({
        id: Date.now().toString(),
        name: data.name,
        path: data.path,
        type: data.type || 'file',
        size: data.size || 0,
        createdAt: new Date().toISOString()
      })

      const updated = todoDao.update(data.id, {
        attachments: JSON.stringify(attachments)
      })
      return { todo: updated, attachment: attachments[attachments.length - 1] }
    } catch (error) {
      console.error('[TodoService] todo:add-attachment 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 删除附件
  ipcMain.handle('todo:remove-attachment', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const todo = todoDao.get(data.id)
      if (!todo) {
        return { error: { code: 'NOT_FOUND', message: `待办 ${data.id} 不存在` } }
      }

      let attachments = todo.attachments ? JSON.parse(todo.attachments) : []
      attachments = attachments.filter(a => a.id !== data.attachmentId)

      const updated = todoDao.update(data.id, {
        attachments: JSON.stringify(attachments)
      })
      return { todo: updated }
    } catch (error) {
      console.error('[TodoService] todo:remove-attachment 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 批量操作
  ipcMain.handle('todo:batch-update', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const { ids, updates } = data

      const results = []
      for (const id of ids) {
        const todo = todoDao.get(id)
        if (todo) {
          const updated = todoDao.update(id, updates)
          results.push(updated)
        }
      }
      return { results }
    } catch (error) {
      console.error('[TodoService] todo:batch-update 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 批量删除
  ipcMain.handle('todo:batch-delete', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const { ids } = data

      for (const id of ids) {
        todoDao.delete(id)
      }
      return { success: true, count: ids.length }
    } catch (error) {
      console.error('[TodoService] todo:batch-delete 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 贪睡提醒：推迟该待办的提醒 10 分钟
  // 实现方式：将 due_date 推迟 10 分钟，并从已提醒列表中移除，使其重新进入提醒检查
  ipcMain.handle('todo:snooze-reminder', async (event, data) => {
    try {
      const todoDao = require('../dao/todo-dao')
      const { id, minutes = 10 } = data || {}
      const todo = todoDao.get(id)
      if (!todo) {
        return { error: { code: 'NOT_FOUND', message: `待办 ${id} 不存在` } }
      }

      // 以当前时间为基准推迟 due_date（若 due_date 已过期则从现在起算，否则在原 due_date 上加）
      const baseTime = todo.due_date ? new Date(todo.due_date) : new Date()
      const now = new Date()
      const newDueDate = (baseTime > now ? baseTime : now)
      newDueDate.setMinutes(newDueDate.getMinutes() + Number(minutes) || 10)

      todoDao.update(id, { due_date: newDueDate.toISOString() })
      // 从已提醒列表中移除，使其可重新触发提醒
      removeRemindedId(id)

      logger.info('TodoService', `待办 ${id} 贪睡 ${minutes} 分钟，新 due_date=${newDueDate.toISOString()}`)
      return { success: true, dueDate: newDueDate.toISOString() }
    } catch (error) {
      console.error('[TodoService] todo:snooze-reminder 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 按需启动到期提醒检查器（有带 due_date 的启用待办才轮询）
  syncReminderCheckerState()
}

/**
 * 发送提醒通知
 * @param {string} message
 * @param {string} type
 */
function sendReminder (message, type) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: '待办提醒',
      body: message,
      urgency: type === 'deadline-overdue' ? 2 : 1
    })
    notification.show()
  }
}

// ============================================================
// 到期提醒检查器（复用 notification-service 五重通知 + app-setting-dao 持久化已提醒状态）
// ============================================================

const REMINDER_INTERVAL_MS = 60 * 1000 // 检查周期：60 秒
const REMINDER_WINDOW_MS = 15 * 60 * 1000 // 提前提醒窗口：15 分钟
const REMINDED_KEY = 'todo_reminded_list' // app_settings 中存储已提醒 ID 的键名

let reminderTimer = null
let reminderRunning = false

/**
 * 读取已提醒 todo ID 列表（持久化在 app_settings）
 * @returns {string[]}
 */
function getRemindedIds () {
  const list = appSettingDao.getJson(REMINDED_KEY, [])
  return Array.isArray(list) ? list : []
}

/**
 * 标记某 todo 已提醒（持久化）
 * @param {string} id
 */
function addRemindedId (id) {
  const ids = getRemindedIds()
  if (!ids.includes(id)) {
    ids.push(id)
    appSettingDao.setJson(REMINDED_KEY, ids)
  }
}

/**
 * 从已提醒列表中移除某 todo（用于贪睡或 due_date 变更后重新启用提醒）
 * @param {string} id
 */
function removeRemindedId (id) {
  const ids = getRemindedIds()
  const idx = ids.indexOf(id)
  if (idx >= 0) {
    ids.splice(idx, 1)
    appSettingDao.setJson(REMINDED_KEY, ids)
  }
}

/**
 * 启动到期提醒检查器
 * 每 60 秒扫描一次到期待办，对 due_date <= now + 15min 且未提醒过的待办发送通知
 * 已提醒的 todo ID 持久化在 app_settings，避免应用重启后重复提醒
 */
function startReminderChecker () {
  if (reminderRunning) {
    logger.warn('TodoService', '提醒检查器已在运行，无需重复启动')
    return
  }
  reminderRunning = true
  logger.info('TodoService', `提醒检查器已启动，扫描周期 ${REMINDER_INTERVAL_MS / 1000} 秒，提前窗口 ${REMINDER_WINDOW_MS / 60000} 分钟`)

  // 首次启动立即检查一次
  checkReminders()

  reminderTimer = setInterval(checkReminders, REMINDER_INTERVAL_MS)
}

/**
 * 停止提醒检查器（应用退出时调用）
 */
function stopReminderChecker () {
  if (reminderTimer) {
    clearInterval(reminderTimer)
    reminderTimer = null
  }
  reminderRunning = false
  logger.info('TodoService', '提醒检查器已停止')
}

/**
 * 单次提醒检查：扫描到期待办并发送通知
 */
function checkReminders () {
  try {
    const todoDao = require('../dao/todo-dao')
    const all = todoDao.list()
    if (!Array.isArray(all) || all.length === 0) return

    const now = Date.now()
    const threshold = now + REMINDER_WINDOW_MS
    const remindedIds = getRemindedIds()

    for (const todo of all) {
      // 仅检查启用（未完成）且有 due_date 的待办
      if (Number(todo.is_enabled) !== 1) continue
      if (!todo.due_date) continue
      if (remindedIds.includes(todo.id)) continue

      const dueTime = new Date(todo.due_date).getTime()
      if (isNaN(dueTime)) continue

      // due_date <= now + 15min 即将到期或已过期
      if (dueTime <= threshold) {
        const isOverdue = dueTime <= now
        const body = isOverdue
          ? `"${todo.title}" 已过期`
          : `"${todo.title}" 即将到期`
        // 复用五重通知：系统通知 + 托盘闪烁 + 灵动岛 + 桌宠
        notificationService.notify('todo-reminder', '待办提醒', body, {
          source: { module: 'todo', id: todo.id },
          extraData: { todoId: todo.id, dueDate: todo.due_date, overdue: isOverdue }
        })
        // 标记已提醒，避免重复通知
        addRemindedId(todo.id)
        logger.info('TodoService', `待办提醒已发送: ${todo.id} (${body})`)
      }
    }
  } catch (error) {
    logger.error('TodoService', `提醒检查失败: ${error.message}`)
  }
}

/**
 * 同步提醒检查器运行状态：有带 due_date 的启用待办才启动，无则停止
 * 在待办 CRUD / toggle / set-due-date 后调用，避免无提醒待办时空转
 */
function syncReminderCheckerState () {
  try {
    const todoDao = require('../dao/todo-dao')
    const all = todoDao.list()
    const hasReminders = Array.isArray(all) && all.some(t =>
      Number(t.is_enabled) === 1 && t.due_date
    )
    if (hasReminders && !reminderRunning) {
      startReminderChecker()
    } else if (!hasReminders && reminderRunning) {
      stopReminderChecker()
    }
  } catch (error) {
    logger.error('TodoService', `syncReminderCheckerState 失败: ${error.message}`)
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  registerTodoChannels,
  formatDate,
  getDueDateStatus,
  // 到期提醒检查器
  startReminderChecker,
  stopReminderChecker,
  checkReminders,
  syncReminderCheckerState
}