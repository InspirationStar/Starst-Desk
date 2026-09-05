// ============================================================
// AI 会话和消息 DAO 单元测试
// 覆盖 chat_sessions 和 chat_messages 两张表
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let db
let aiConfigDao
let chatSessionDao
let chatMessageDao

beforeEach(() => {
  db = setup.setupFreshDb()
  aiConfigDao = require('../../electron/dao/ai-config-dao.js')
  chatSessionDao = require('../../electron/dao/chat-session-dao.js')
  chatMessageDao = require('../../electron/dao/chat-message-dao.js')
})

afterEach(() => {
  try { db.close() } catch (e) {}
})

// 辅助：创建一个 AI 配置并返回其 ID（外键约束）
function createConfigId () {
  const config = aiConfigDao.create({
    provider_type: 'ollama',
    name: '测试配置',
    api_endpoint: 'http://localhost:11434',
    model_name: 'llama3'
  })
  return config.id
}

// ============================================================
// 会话 DAO
// ============================================================

describe('ChatSessionDao - 创建会话', () => {
  test('应成功创建会话', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({
      title: '新对话',
      model_config_id: configId
    })
    assert.ok(session.id)
    assert.equal(session.title, '新对话')
    assert.equal(session.model_config_id, configId)
    assert.equal(session.system_prompt, null)
    assert.ok(session.created_at)
    assert.ok(session.updated_at)
  })

  test('应支持系统提示词', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({
      title: '带提示词',
      model_config_id: configId,
      system_prompt: '你是一个助手'
    })
    assert.equal(session.system_prompt, '你是一个助手')
  })
})

describe('ChatSessionDao - 查询会话', () => {
  test('getById 应返回会话', () => {
    const configId = createConfigId()
    const created = chatSessionDao.create({ title: '查询', model_config_id: configId })
    const found = chatSessionDao.getById(created.id)
    assert.equal(found.title, '查询')
  })

  test('getById 不存在的 ID 应返回 null', () => {
    assert.equal(chatSessionDao.getById('non-existent'), null)
  })

  test('list 应返回所有会话（按更新时间倒序）', async () => {
    const configId = createConfigId()
    chatSessionDao.create({ title: '第一', model_config_id: configId })
    await new Promise(resolve => setTimeout(resolve, 1100))
    chatSessionDao.create({ title: '第二', model_config_id: configId })
    const result = chatSessionDao.list()
    assert.equal(result.total, 2)
    // 倒序：第二在前
    assert.equal(result.list[0].title, '第二')
  })

  test('list 应支持分页', () => {
    const configId = createConfigId()
    for (let i = 0; i < 3; i++) {
      chatSessionDao.create({ title: `会话${i}`, model_config_id: configId })
    }
    const result = chatSessionDao.list({ page: 1, size: 2 })
    assert.equal(result.list.length, 2)
    assert.equal(result.total, 3)
  })
})

describe('ChatSessionDao - 更新会话', () => {
  test('应更新标题', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: '原标题', model_config_id: configId })
    const updated = chatSessionDao.update(session.id, { title: '新标题' })
    assert.equal(updated.title, '新标题')
  })

  test('应更新系统提示词', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    const updated = chatSessionDao.update(session.id, { system_prompt: '新提示词' })
    assert.equal(updated.system_prompt, '新提示词')
  })

  test('应更新模型配置 ID', () => {
    const configId1 = createConfigId()
    const configId2 = aiConfigDao.create({
      provider_type: 'deepseek',
      name: '另一个',
      api_endpoint: 'https://api.deepseek.com',
      model_name: 'deepseek-chat'
    }).id
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId1 })
    const updated = chatSessionDao.update(session.id, { model_config_id: configId2 })
    assert.equal(updated.model_config_id, configId2)
  })

  test('空更新数据应返回原会话', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: '不变', model_config_id: configId })
    const updated = chatSessionDao.update(session.id, {})
    assert.equal(updated.title, '不变')
  })
})

describe('ChatSessionDao - 删除会话', () => {
  test('应删除存在的会话', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: '待删除', model_config_id: configId })
    const ok = chatSessionDao.del(session.id)
    assert.equal(ok, true)
    assert.equal(chatSessionDao.getById(session.id), null)
  })

  test('删除会话应级联删除关联消息', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    chatMessageDao.create({ session_id: session.id, role: 'user', content: '你好' })
    chatMessageDao.create({ session_id: session.id, role: 'assistant', content: '回复' })

    chatSessionDao.del(session.id)
    const result = chatMessageDao.findBySession(session.id)
    assert.equal(result.total, 0)
  })

  test('删除不存在的 ID 应返回 false', () => {
    assert.equal(chatSessionDao.del('non-existent'), false)
  })
})

// ============================================================
// 消息 DAO
// ============================================================

describe('ChatMessageDao - 创建消息', () => {
  test('应成功创建用户消息', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    const msg = chatMessageDao.create({
      session_id: session.id,
      role: 'user',
      content: '你好'
    })
    assert.ok(msg.id)
    assert.equal(msg.role, 'user')
    assert.equal(msg.content, '你好')
    assert.equal(msg.is_complete, 1, '默认应完成')
  })

  test('应成功创建助手消息', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    const msg = chatMessageDao.create({
      session_id: session.id,
      role: 'assistant',
      content: '我是助手'
    })
    assert.equal(msg.role, 'assistant')
  })

  test('应支持未完成的消息（流式生成中）', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    const msg = chatMessageDao.create({
      session_id: session.id,
      role: 'assistant',
      content: '生成中...',
      is_complete: false
    })
    assert.equal(msg.is_complete, 0)
  })
})

describe('ChatMessageDao - 查询消息', () => {
  test('getById 应返回消息', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    const msg = chatMessageDao.create({
      session_id: session.id,
      role: 'user',
      content: '查询测试'
    })
    const found = chatMessageDao.getById(msg.id)
    assert.equal(found.content, '查询测试')
  })

  test('getById 不存在的 ID 应返回 null', () => {
    assert.equal(chatMessageDao.getById('non-existent'), null)
  })

  test('findBySession 应返回会话所有消息（按创建时间正序）', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    chatMessageDao.create({ session_id: session.id, role: 'user', content: '第一条' })
    chatMessageDao.create({ session_id: session.id, role: 'assistant', content: '第二条' })
    chatMessageDao.create({ session_id: session.id, role: 'user', content: '第三条' })

    const result = chatMessageDao.findBySession(session.id)
    assert.equal(result.total, 3)
    assert.equal(result.list[0].content, '第一条')
    assert.equal(result.list[2].content, '第三条')
  })

  test('findBySession 应支持分页', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    for (let i = 0; i < 5; i++) {
      chatMessageDao.create({ session_id: session.id, role: 'user', content: `消息${i}` })
    }
    const result = chatMessageDao.findBySession(session.id, { page: 1, size: 2 })
    assert.equal(result.list.length, 2)
    assert.equal(result.total, 5)
  })
})

describe('ChatMessageDao - 更新消息', () => {
  test('应更新消息内容', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    const msg = chatMessageDao.create({
      session_id: session.id,
      role: 'assistant',
      content: '初始内容'
    })
    const updated = chatMessageDao.update(msg.id, '更新后的内容')
    assert.equal(updated.content, '更新后的内容')
  })

  test('markComplete 应标记消息为已完成', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    const msg = chatMessageDao.create({
      session_id: session.id,
      role: 'assistant',
      content: '...',
      is_complete: false
    })
    const ok = chatMessageDao.markComplete(msg.id)
    assert.equal(ok, true)
    const updated = chatMessageDao.getById(msg.id)
    assert.equal(updated.is_complete, 1)
  })
})

describe('ChatMessageDao - 删除消息', () => {
  test('应删除指定消息', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    const msg = chatMessageDao.create({
      session_id: session.id,
      role: 'user',
      content: '待删除'
    })
    const ok = chatMessageDao.del(msg.id)
    assert.equal(ok, true)
    assert.equal(chatMessageDao.getById(msg.id), null)
  })

  test('deleteBySession 应删除会话所有消息并返回数量', () => {
    const configId = createConfigId()
    const session = chatSessionDao.create({ title: 'T', model_config_id: configId })
    chatMessageDao.create({ session_id: session.id, role: 'user', content: '1' })
    chatMessageDao.create({ session_id: session.id, role: 'assistant', content: '2' })
    chatMessageDao.create({ session_id: session.id, role: 'user', content: '3' })

    const count = chatMessageDao.deleteBySession(session.id)
    assert.equal(count, 3)
    const result = chatMessageDao.findBySession(session.id)
    assert.equal(result.total, 0)
  })

  test('删除不存在的消息 ID 应返回 false', () => {
    assert.equal(chatMessageDao.del('non-existent'), false)
  })
})