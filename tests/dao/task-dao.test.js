// ============================================================
// 定时任务 DAO 单元测试
// 覆盖 CRUD、启用/禁用、JSON 序列化、查询
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let db
let taskDao

beforeEach(() => {
  db = setup.setupFreshDb()
  taskDao = require('../../electron/dao/task-dao.js')
})

afterEach(() => {
  try { db.close() } catch (e) {}
})

// 任务工厂
function makeTask (overrides = {}) {
  return {
    name: '测试任务',
    task_type: 'one_shot',
    schedule_config: { due_time: '2026-12-31 09:00:00' },
    action_type: 'message',
    action_payload: { title: '提醒', content: '内容' },
    ...overrides
  }
}

describe('TaskDao - 创建任务', () => {
  test('应成功创建一次性任务', () => {
    const task = taskDao.create(makeTask())
    assert.ok(task.id)
    assert.equal(task.name, '测试任务')
    assert.equal(task.task_type, 'one_shot')
    assert.equal(task.is_enabled, 1, '默认应启用')
    assert.ok(task.created_at)
    // schedule_config 应反序列化为对象
    assert.deepEqual(task.schedule_config, { due_time: '2026-12-31 09:00:00' })
    assert.deepEqual(task.action_payload, { title: '提醒', content: '内容' })
  })

  test('应成功创建循环任务', () => {
    const task = taskDao.create(makeTask({
      task_type: 'recurring',
      schedule_config: { type: 'daily', time: { hour: 9, minute: 0 } }
    }))
    assert.equal(task.task_type, 'recurring')
    assert.equal(task.schedule_config.type, 'daily')
  })

  test('应支持四种动作类型', () => {
    const actions = [
      { action_type: 'message', action_payload: { content: 'hi' } },
      { action_type: 'open_app', action_payload: { path: 'C:/app.exe' } },
      { action_type: 'exec_command', action_payload: { command: 'echo hi' } },
      { action_type: 'open_url', action_payload: { url: 'https://example.com' } }
    ]
    for (const action of actions) {
      const task = taskDao.create(makeTask(action))
      assert.equal(task.action_type, action.action_type)
    }
  })
})

describe('TaskDao - 查询任务', () => {
  test('getById 应返回反序列化后的任务', () => {
    const created = taskDao.create(makeTask())
    const found = taskDao.getById(created.id)
    assert.equal(found.id, created.id)
    assert.deepEqual(found.schedule_config, { due_time: '2026-12-31 09:00:00' })
  })

  test('getById 不存在的 ID 应返回 null', () => {
    assert.equal(taskDao.getById('non-existent'), null)
  })

  test('list 应返回所有任务', () => {
    taskDao.create(makeTask({ name: 'T1' }))
    taskDao.create(makeTask({ name: 'T2' }))
    const result = taskDao.list()
    assert.equal(result.total, 2)
  })

  test('list 应支持按启用状态筛选', () => {
    const t1 = taskDao.create(makeTask({ name: '启用' }))
    const t2 = taskDao.create(makeTask({ name: '禁用' }))
    taskDao.toggle(t2.id, false)

    const enabled = taskDao.list({ is_enabled: true })
    assert.equal(enabled.total, 1)
    assert.equal(enabled.list[0].name, '启用')

    const disabled = taskDao.list({ is_enabled: false })
    assert.equal(disabled.total, 1)
    assert.equal(disabled.list[0].name, '禁用')
  })

  test('list 应支持分页', () => {
    for (let i = 0; i < 5; i++) {
      taskDao.create(makeTask({ name: `T${i}` }))
    }
    const result = taskDao.list({ page: 1, size: 2 })
    assert.equal(result.list.length, 2)
    assert.equal(result.total, 5)
  })

  test('findEnabledTasks 应只返回启用的任务', () => {
    const t1 = taskDao.create(makeTask({ name: '启用' }))
    const t2 = taskDao.create(makeTask({ name: '禁用' }))
    taskDao.toggle(t2.id, false)

    const enabled = taskDao.findEnabledTasks()
    assert.equal(enabled.length, 1)
    assert.equal(enabled[0].name, '启用')
  })

  test('findEnabledTasks 应返回反序列化的 schedule_config', () => {
    taskDao.create(makeTask({
      task_type: 'recurring',
      schedule_config: { type: 'weekly', days_of_week: [1, 3, 5] }
    }))
    const enabled = taskDao.findEnabledTasks()
    assert.deepEqual(enabled[0].schedule_config.days_of_week, [1, 3, 5])
  })
})

describe('TaskDao - 更新任务', () => {
  test('应更新任务名称', () => {
    const task = taskDao.create(makeTask())
    const updated = taskDao.update(task.id, { name: '新名称' })
    assert.equal(updated.name, '新名称')
  })

  test('应更新调度配置（自动 JSON 序列化）', () => {
    const task = taskDao.create(makeTask())
    const newConfig = { type: 'daily', time: { hour: 10, minute: 30 } }
    const updated = taskDao.update(task.id, {
      task_type: 'recurring',
      schedule_config: newConfig
    })
    assert.equal(updated.task_type, 'recurring')
    assert.deepEqual(updated.schedule_config, newConfig)
  })

  test('应更新动作载荷（自动 JSON 序列化）', () => {
    const task = taskDao.create(makeTask())
    const newPayload = { url: 'https://test.com' }
    const updated = taskDao.update(task.id, {
      action_type: 'open_url',
      action_payload: newPayload
    })
    assert.equal(updated.action_type, 'open_url')
    assert.deepEqual(updated.action_payload, newPayload)
  })

  test('应更新启用状态', () => {
    const task = taskDao.create(makeTask())
    const updated = taskDao.update(task.id, { is_enabled: false })
    assert.equal(updated.is_enabled, 0)
  })

  test('空更新数据应返回原任务', () => {
    const task = taskDao.create(makeTask())
    const updated = taskDao.update(task.id, {})
    assert.equal(updated.name, task.name)
  })
})

describe('TaskDao - 删除任务', () => {
  test('应删除存在的任务', () => {
    const task = taskDao.create(makeTask())
    const ok = taskDao.del(task.id)
    assert.equal(ok, true)
    assert.equal(taskDao.getById(task.id), null)
  })

  test('删除不存在的 ID 应返回 false', () => {
    assert.equal(taskDao.del('non-existent'), false)
  })
})

describe('TaskDao - toggle 启用/禁用', () => {
  test('应禁用任务', () => {
    const task = taskDao.create(makeTask())
    const updated = taskDao.toggle(task.id, false)
    assert.equal(updated.is_enabled, 0)
  })

  test('应启用任务', () => {
    const task = taskDao.create(makeTask())
    taskDao.toggle(task.id, false)
    const updated = taskDao.toggle(task.id, true)
    assert.equal(updated.is_enabled, 1)
  })
})

describe('TaskDao - 边界条件', () => {
  test('空数据库 list 应返回空列表', () => {
    const result = taskDao.list()
    assert.equal(result.total, 0)
    assert.deepEqual(result.list, [])
  })

  test('空数据库 findEnabledTasks 应返回空数组', () => {
    const result = taskDao.findEnabledTasks()
    assert.deepEqual(result, [])
  })
})