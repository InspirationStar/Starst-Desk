// ============================================================
// 桌面小部件 DAO 单元测试
// 覆盖 CRUD、按类型查询、状态切换、位置更新、边界条件
// 使用内存数据库 :memory:
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let db
let widgetDao

beforeEach(() => {
  // 每个测试用例使用全新的内存数据库
  db = setup.setupFreshDb()
  widgetDao = require('../../electron/dao/widget-dao.js')
})

afterEach(() => {
  try { db.close() } catch (e) {}
})

describe('WidgetDao - 创建小部件', () => {
  test('应成功创建包含类型的小部件', () => {
    const widget = widgetDao.create({ widget_type: 'note' })
    assert.ok(widget.id, '应生成 ID')
    assert.equal(widget.widget_type, 'note')
    assert.equal(widget.is_enabled, 1, '默认应启用')
    assert.equal(widget.is_visible, 1, '默认应可见')
    assert.equal(widget.is_capsule, 0, '默认非胶囊')

    assert.ok(widget.created_at)
    assert.ok(widget.updated_at)
  })

  test('应支持自定义位置和大小', () => {
    const widget = widgetDao.create({
      widget_type: 'todo',
      position_x: 500,
      position_y: 300,
      width: 200,
      height: 100
    })
    assert.equal(widget.position_x, 500)
    assert.equal(widget.position_y, 300)
    assert.equal(widget.width, 200)
    assert.equal(widget.height, 100)
  })

  test('应支持指定 ID', () => {
    const widget = widgetDao.create({ id: 'custom-id', widget_type: 'task' })
    assert.equal(widget.id, 'custom-id')
  })

  test('应支持胶囊配置', () => {
    const widget = widgetDao.create({
      widget_type: 'health',
      is_capsule: true
    })
    assert.equal(widget.is_capsule, 1)
  })

  test('应支持禁用状态', () => {
    const widget = widgetDao.create({
      widget_type: 'note',
      is_enabled: false,
      is_visible: false
    })
    assert.equal(widget.is_enabled, 0)
    assert.equal(widget.is_visible, 0)
  })

  test('应支持 config_json 配置', () => {
    const widget = widgetDao.create({
      widget_type: 'note',
      config_json: '{"theme":"dark"}'
    })
    assert.equal(widget.config_json, '{"theme":"dark"}')
  })

  test('非法 widget_type 应抛出异常', () => {
    assert.throws(() => {
      widgetDao.create({ widget_type: 'unknown_type' })
    }, /CHECK constraint failed/)
  })
})

describe('WidgetDao - 查询小部件', () => {
  test('list 应返回所有小部件', () => {
    widgetDao.create({ widget_type: 'note' })
    widgetDao.create({ widget_type: 'task' })
    widgetDao.create({ widget_type: 'todo' })
    const list = widgetDao.list()
    assert.equal(list.length, 3)
  })

  test('list 应按 widget_type 升序排列', () => {
    widgetDao.create({ widget_type: 'todo' })
    widgetDao.create({ widget_type: 'note' })
    widgetDao.create({ widget_type: 'task' })
    const list = widgetDao.list()
    assert.equal(list[0].widget_type, 'note')
    assert.equal(list[1].widget_type, 'task')
    assert.equal(list[2].widget_type, 'todo')
  })

  test('list 空表应返回空数组', () => {
    const list = widgetDao.list()
    assert.deepEqual(list, [])
  })

  test('getByType 应返回对应小部件', () => {
    widgetDao.create({ widget_type: 'note' })
    const found = widgetDao.getByType('note')
    assert.ok(found)
    assert.equal(found.widget_type, 'note')
  })

  test('getByType 不存在的类型应返回 null', () => {
    const found = widgetDao.getByType('note')
    assert.equal(found, null)
  })

  test('getById 应返回对应小部件', () => {
    const created = widgetDao.create({ widget_type: 'note' })
    const found = widgetDao.getById(created.id)
    assert.ok(found)
    assert.equal(found.id, created.id)
  })

  test('getById 不存在的 ID 应返回 null', () => {
    const found = widgetDao.getById('non-existent-id')
    assert.equal(found, null)
  })
})

describe('WidgetDao - 更新小部件', () => {
  test('应更新位置和大小', () => {
    const widget = widgetDao.create({ widget_type: 'note' })
    const updated = widgetDao.update(widget.id, {
      position_x: 200,
      position_y: 150,
      width: 300,
      height: 400
    })
    assert.equal(updated.position_x, 200)
    assert.equal(updated.position_y, 150)
    assert.equal(updated.width, 300)
    assert.equal(updated.height, 400)
  })

  test('应更新启用状态', () => {
    const widget = widgetDao.create({ widget_type: 'note' })
    const updated = widgetDao.update(widget.id, { is_enabled: false })
    assert.equal(updated.is_enabled, 0)
  })

  test('应更新胶囊状态', () => {
    const widget = widgetDao.create({ widget_type: 'note' })
    const updated = widgetDao.update(widget.id, {
      is_capsule: true
    })
    assert.equal(updated.is_capsule, 1)
  })

  test('应更新 config_json', () => {
    const widget = widgetDao.create({ widget_type: 'note' })
    const updated = widgetDao.update(widget.id, { config_json: '{"key":"value"}' })
    assert.equal(updated.config_json, '{"key":"value"}')
  })

  test('空更新数据应返回原小部件', () => {
    const widget = widgetDao.create({ widget_type: 'note' })
    const updated = widgetDao.update(widget.id, {})
    assert.equal(updated.id, widget.id)
    assert.equal(updated.widget_type, widget.widget_type)
  })

  test('更新不存在的 ID 应返回 null', () => {
    const updated = widgetDao.update('non-existent', { is_enabled: false })
    assert.equal(updated, null)
  })
})

describe('WidgetDao - updateBounds 专用方法', () => {
  test('应仅更新位置和大小字段', () => {
    const widget = widgetDao.create({
      widget_type: 'note',
      is_enabled: false,
      is_capsule: true,
      config_json: '{"k":"v"}'
    })
    const updated = widgetDao.updateBounds(widget.id, {
      x: 800,
      y: 600,
      width: 500,
      height: 700
    })
    assert.equal(updated.position_x, 800)
    assert.equal(updated.position_y, 600)
    assert.equal(updated.width, 500)
    assert.equal(updated.height, 700)
    // 其他字段应保持不变
    assert.equal(updated.is_enabled, 0, 'is_enabled 不应变化')
    assert.equal(updated.is_capsule, 1, 'is_capsule 不应变化')
    assert.equal(updated.config_json, '{"k":"v"}', 'config_json 不应变化')
  })

  test('updateBounds 不存在的 ID 应返回 null', () => {
    const result = widgetDao.updateBounds('non-existent', { x: 0, y: 0, width: 100, height: 100 })
    assert.equal(result, null)
  })
})

describe('WidgetDao - 状态切换方法', () => {
  test('setEnabled 应切换启用状态', () => {
    widgetDao.create({ widget_type: 'note', is_enabled: true })
    const w1 = widgetDao.setEnabled('note', false)
    assert.equal(w1.is_enabled, 0)
    const w2 = widgetDao.setEnabled('note', true)
    assert.equal(w2.is_enabled, 1)
  })

  test('setVisible 应切换显隐状态', () => {
    widgetDao.create({ widget_type: 'note', is_visible: true })
    const w1 = widgetDao.setVisible('note', false)
    assert.equal(w1.is_visible, 0)
    const w2 = widgetDao.setVisible('note', true)
    assert.equal(w2.is_visible, 1)
  })

  test('setCapsule 应切换胶囊状态', () => {
    widgetDao.create({ widget_type: 'note', is_capsule: false })
    const w1 = widgetDao.setCapsule('note', true)
    assert.equal(w1.is_capsule, 1)
    const w2 = widgetDao.setCapsule('note', false)
    assert.equal(w2.is_capsule, 0)
  })

  test('状态切换方法对不存在的类型应返回 null', () => {
    assert.equal(widgetDao.setEnabled('note', true), null)
    assert.equal(widgetDao.setVisible('note', true), null)
    assert.equal(widgetDao.setCapsule('note', true), null)
  })
})

describe('WidgetDao - 删除小部件', () => {
  test('应删除存在的小部件', () => {
    const widget = widgetDao.create({ widget_type: 'note' })
    const ok = widgetDao.del(widget.id)
    assert.equal(ok, true)
    assert.equal(widgetDao.getById(widget.id), null)
  })

  test('删除不存在的 ID 应返回 false', () => {
    const ok = widgetDao.del('non-existent')
    assert.equal(ok, false)
  })
})

describe('WidgetDao - UNIQUE 约束', () => {
  test('同类型小部件应受 UNIQUE 约束限制', () => {
    widgetDao.create({ widget_type: 'note' })
    assert.throws(() => {
      widgetDao.create({ widget_type: 'note' })
    }, /UNIQUE constraint failed/)
  })
})