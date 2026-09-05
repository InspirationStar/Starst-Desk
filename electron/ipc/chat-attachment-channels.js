// ============================================================
// 聊天附件 IPC 通道
// 注册 chat:attachment:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const chatAttachmentDao = require('./../dao/chat-attachment-dao.js')
const logger = require('./../core/logger.js')

// ============================================================
// chat:attachment:create
// 创建附件记录
// ============================================================
register('chat:attachment:create', async (event, data) => {
  try {
    if (!data.message_id || !data.session_id || !data.type || !data.name) {
      return failure('REQUIRED_FIELDS', 'message_id, session_id, type, name 不能为空')
    }
    const attachment = chatAttachmentDao.create(data)
    return success(attachment)
  } catch (error) {
    logger.error('ChatAttachmentChannels', `chat:attachment:create 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:attachment:getById
// 按ID查询附件
// ============================================================
register('chat:attachment:getById', async (event, data) => {
  try {
    if (!data.id) {
      return failure('ATTACHMENT_ID_REQUIRED', '附件 ID 不能为空')
    }
    const attachment = chatAttachmentDao.getById(data.id)
    if (!attachment) {
      return failure('ATTACHMENT_NOT_FOUND', '附件不存在')
    }
    return success(attachment)
  } catch (error) {
    logger.error('ChatAttachmentChannels', `chat:attachment:getById 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:attachment:findByMessage
// 查询消息的所有附件
// ============================================================
register('chat:attachment:findByMessage', async (event, data) => {
  try {
    if (!data.message_id) {
      return failure('MESSAGE_ID_REQUIRED', '消息 ID 不能为空')
    }
    const attachments = chatAttachmentDao.findByMessage(data.message_id)
    return success(attachments)
  } catch (error) {
    logger.error('ChatAttachmentChannels', `chat:attachment:findByMessage 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:attachment:findBySession
// 查询会话的所有附件
// ============================================================
register('chat:attachment:findBySession', async (event, data) => {
  try {
    if (!data.session_id) {
      return failure('SESSION_ID_REQUIRED', '会话 ID 不能为空')
    }
    const attachments = chatAttachmentDao.findBySession(data.session_id)
    return success(attachments)
  } catch (error) {
    logger.error('ChatAttachmentChannels', `chat:attachment:findBySession 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:attachment:delete
// 删除附件
// ============================================================
register('chat:attachment:delete', async (event, data) => {
  try {
    if (!data.id) {
      return failure('ATTACHMENT_ID_REQUIRED', '附件 ID 不能为空')
    }
    const result = chatAttachmentDao.del(data.id)
    return success({ deleted: result })
  } catch (error) {
    logger.error('ChatAttachmentChannels', `chat:attachment:delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// chat:attachment:deleteByMessage
// 删除消息的所有附件（级联）
// ============================================================
register('chat:attachment:deleteByMessage', async (event, data) => {
  try {
    if (!data.message_id) {
      return failure('MESSAGE_ID_REQUIRED', '消息 ID 不能为空')
    }
    const count = chatAttachmentDao.deleteByMessage(data.message_id)
    return success({ deleted: count })
  } catch (error) {
    logger.error('ChatAttachmentChannels', `chat:attachment:deleteByMessage 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}