// ============================================================
// 便签模块 IPC 通道
// 注册 note:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const noteDao = require('./../dao/note-dao.js')
const validators = require('./../utils/validators.js')
const logger = require('./../core/logger.js')

// ============================================================
// note:create
// 创建便签，校验 title/body 不同时为空，reminder_time 不早于 now
// ============================================================
register('note:create', async (event, data) => {
  try {
    // 校验内容
    if (!validators.isValidNoteContent(data)) {
      return failure('NOTE_CONTENT_EMPTY', '便签标题和正文不能同时为空')
    }

    // 校验提醒时间
    if (data.reminder_time && !validators.isReminderTimeValid(data.reminder_time)) {
      return failure('NOTE_REMINDER_PAST', '提醒时间不能早于当前时间')
    }

    const note = noteDao.create(data)
    return success(note)
  } catch (error) {
    logger.error('NoteChannels', `note:create 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// note:list
// 查询便签列表，支持 keyword/color_tag/sort_by 筛选
// ============================================================
register('note:list', async (event, data) => {
  try {
    const result = noteDao.list(data)
    return success(result)
  } catch (error) {
    logger.error('NoteChannels', `note:list 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// note:get
// 根据 ID 查询便签
// ============================================================
register('note:get', async (event, data) => {
  try {
    const note = noteDao.getById(data.id)
    if (!note) {
      return failure('NOTE_NOT_FOUND', '便签不存在')
    }
    return success(note)
  } catch (error) {
    logger.error('NoteChannels', `note:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// note:update
// 更新便签
// ============================================================
register('note:update', async (event, data) => {
  try {
    if (!data.id) {
      return failure('NOTE_ID_REQUIRED', '便签 ID 不能为空')
    }
    const note = noteDao.update(data.id, data)
    if (!note) {
      return failure('NOTE_NOT_FOUND', '便签不存在')
    }
    return success(note)
  } catch (error) {
    logger.error('NoteChannels', `note:update 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// note:delete
// 删除便签
// ============================================================
register('note:delete', async (event, data) => {
  try {
    if (!data.id) {
      return failure('NOTE_ID_REQUIRED', '便签 ID 不能为空')
    }
    const result = noteDao.del(data.id)
    return success({ deleted: result })
  } catch (error) {
    logger.error('NoteChannels', `note:delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// note:mark-reminded
// 标记便签为已提醒
// ============================================================
register('note:mark-reminded', async (event, data) => {
  try {
    if (!data.id) {
      return failure('NOTE_ID_REQUIRED', '便签 ID 不能为空')
    }
    noteDao.markReminded(data.id)
    return success({ success: true })
  } catch (error) {
    logger.error('NoteChannels', `note:mark-reminded 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// note:get-upcoming-reminders
// 查询指定时间范围内即将到期的未完成便签（供桌宠待办提醒使用）
// 参数：{ from, to } ISO 8601 时间字符串
// 返回：便签列表，按 reminder_time 升序
// ============================================================
register('note:get-upcoming-reminders', async (event, data) => {
  try {
    if (!data || !data.from || !data.to) {
      return failure('NOTE_TIME_RANGE_REQUIRED', '需要提供 from 和 to 时间参数')
    }
    const list = noteDao.findUpcomingReminders(data.from, data.to)
    return success({ list })
  } catch (error) {
    logger.error('NoteChannels', `note:get-upcoming-reminders 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}
