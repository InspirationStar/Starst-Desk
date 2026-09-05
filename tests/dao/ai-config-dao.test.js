// ============================================================
// AI 配置 DAO 单元测试
// 覆盖 CRUD、激活/取消激活、加密密钥存储
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let db
let aiConfigDao

beforeEach(() => {
  db = setup.setupFreshDb()
  aiConfigDao = require('../../electron/dao/ai-config-dao.js')
})

afterEach(() => {
  try { db.close() } catch (e) {}
})

function makeConfig (overrides = {}) {
  return {
    provider_type: 'ollama',
    name: '本地 Ollama',
    api_endpoint: 'http://localhost:11434',
    api_key_encrypted: null,
    model_name: 'llama3',
    ...overrides
  }
}

describe('AIConfigDao - 创建配置', () => {
  test('应成功创建 Ollama 配置', () => {
    const config = aiConfigDao.create(makeConfig())
    assert.ok(config.id)
    assert.equal(config.provider_type, 'ollama')
    assert.equal(config.name, '本地 Ollama')
    assert.equal(config.is_active, 0, '默认未激活')
  })

  test('应支持三种提供商类型', () => {
    const providers = ['ollama', 'deepseek', 'custom']
    for (const p of providers) {
      const config = aiConfigDao.create(makeConfig({
        provider_type: p,
        name: `${p} 配置`,
        api_endpoint: `https://${p}.example.com`
      }))
      assert.equal(config.provider_type, p)
    }
  })

  test('应支持存储加密的 API 密钥', () => {
    const config = aiConfigDao.create(makeConfig({
      provider_type: 'deepseek',
      api_key_encrypted: 'A:encrypted-key-data'
    }))
    assert.equal(config.api_key_encrypted, 'A:encrypted-key-data')
  })

  test('应支持空 API 密钥（如 Ollama 无需密钥）', () => {
    const config = aiConfigDao.create(makeConfig({ api_key_encrypted: null }))
    assert.equal(config.api_key_encrypted, null)
  })
})

describe('AIConfigDao - 查询配置', () => {
  test('getById 应返回配置', () => {
    const created = aiConfigDao.create(makeConfig())
    const found = aiConfigDao.getById(created.id)
    assert.equal(found.name, '本地 Ollama')
  })

  test('getById 不存在的 ID 应返回 null', () => {
    assert.equal(aiConfigDao.getById('non-existent'), null)
  })

  test('findAll 应返回所有配置（按创建时间倒序）', async () => {
    aiConfigDao.create(makeConfig({ name: '第一' }))
    await new Promise(resolve => setTimeout(resolve, 1100))
    aiConfigDao.create(makeConfig({ name: '第二' }))
    const all = aiConfigDao.findAll()
    assert.equal(all.length, 2)
    // 倒序：第二在前
    assert.equal(all[0].name, '第二')
  })

  test('findActive 无激活配置应返回 null', () => {
    aiConfigDao.create(makeConfig())
    assert.equal(aiConfigDao.findActive(), null)
  })

  test('findActive 应返回当前激活的配置', () => {
    const c1 = aiConfigDao.create(makeConfig({ name: '配置1' }))
    aiConfigDao.create(makeConfig({ name: '配置2' }))
    aiConfigDao.activate(c1.id)
    const active = aiConfigDao.findActive()
    assert.equal(active.name, '配置1')
  })
})

describe('AIConfigDao - 更新配置', () => {
  test('应更新名称', () => {
    const config = aiConfigDao.create(makeConfig())
    const updated = aiConfigDao.update(config.id, { name: '新名称' })
    assert.equal(updated.name, '新名称')
  })

  test('应更新 API 端点', () => {
    const config = aiConfigDao.create(makeConfig())
    const updated = aiConfigDao.update(config.id, { api_endpoint: 'http://new.endpoint' })
    assert.equal(updated.api_endpoint, 'http://new.endpoint')
  })

  test('应更新加密密钥', () => {
    const config = aiConfigDao.create(makeConfig())
    const updated = aiConfigDao.update(config.id, { api_key_encrypted: 'S:new-key' })
    assert.equal(updated.api_key_encrypted, 'S:new-key')
  })

  test('应更新模型名称', () => {
    const config = aiConfigDao.create(makeConfig())
    const updated = aiConfigDao.update(config.id, { model_name: 'gpt-4' })
    assert.equal(updated.model_name, 'gpt-4')
  })

  test('空更新数据应返回原配置', () => {
    const config = aiConfigDao.create(makeConfig())
    const updated = aiConfigDao.update(config.id, {})
    assert.equal(updated.name, config.name)
  })
})

describe('AIConfigDao - 激活/取消激活', () => {
  test('activate 应激活指定配置', () => {
    const config = aiConfigDao.create(makeConfig())
    const activated = aiConfigDao.activate(config.id)
    assert.equal(activated.is_active, 1)
  })

  test('activate 应同时取消其他配置的激活状态', () => {
    const c1 = aiConfigDao.create(makeConfig({ name: '配置1' }))
    const c2 = aiConfigDao.create(makeConfig({ name: '配置2' }))
    aiConfigDao.activate(c1.id)
    aiConfigDao.activate(c2.id)

    // 只有 c2 应该被激活
    const active = aiConfigDao.findActive()
    assert.equal(active.id, c2.id)

    const c1Updated = aiConfigDao.getById(c1.id)
    assert.equal(c1Updated.is_active, 0)
  })
})

describe('AIConfigDao - 删除配置', () => {
  test('应删除存在的配置', () => {
    const config = aiConfigDao.create(makeConfig())
    const ok = aiConfigDao.del(config.id)
    assert.equal(ok, true)
    assert.equal(aiConfigDao.getById(config.id), null)
  })

  test('删除不存在的 ID 应返回 false', () => {
    assert.equal(aiConfigDao.del('non-existent'), false)
  })

  test('删除激活的配置后 findActive 应返回 null', () => {
    const config = aiConfigDao.create(makeConfig())
    aiConfigDao.activate(config.id)
    aiConfigDao.del(config.id)
    assert.equal(aiConfigDao.findActive(), null)
  })
})