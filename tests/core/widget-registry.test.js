// ============================================================
// 桌面小部件类型注册表单元测试
// 覆盖 getDefinition / getAllTypes / isValidType / getDefaultBounds / register
// ============================================================

const { test, describe, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let widgetRegistry

beforeEach(() => {
  // widget-registry 不依赖数据库，但为保持测试环境一致性，仍初始化内存数据库
  setup.setupFreshDb()
  // 清除 require 缓存，确保每个测试用例获得全新的 WIDGET_TYPES
  const path = require('path')
  const registryPath = path.resolve(__dirname, '../../electron/core/widget-registry.js')
  delete require.cache[registryPath]
  widgetRegistry = require('../../electron/core/widget-registry.js')
})

describe('WidgetRegistry - getDefinition', () => {
  test('应返回便签类型定义', () => {
    const def = widgetRegistry.getDefinition('note')
    assert.ok(def)
    assert.equal(def.title, '便签')
    assert.equal(def.icon, 'EditPen')
    assert.ok(def.defaultWidth > 0)
    assert.ok(def.defaultHeight > 0)
    assert.ok(def.minWidth > 0)
    assert.ok(def.minHeight > 0)
  })

  test('应返回任务类型定义', () => {
    const def = widgetRegistry.getDefinition('task')
    assert.ok(def)
    assert.equal(def.title, '任务')
    assert.equal(def.icon, 'AlarmClock')
  })

  test('应返回健康类型定义', () => {
    const def = widgetRegistry.getDefinition('health')
    assert.ok(def)
    assert.equal(def.title, '健康')
    assert.equal(def.icon, 'FirstAidKit')
  })

  test('应返回待办类型定义', () => {
    const def = widgetRegistry.getDefinition('todo')
    assert.ok(def)
    assert.equal(def.title, '待办&规划')
    assert.equal(def.icon, 'List')
  })

  test('未知类型应返回 null', () => {
    const def = widgetRegistry.getDefinition('unknown')
    assert.equal(def, null)
  })

  test('null/undefined 应返回 null', () => {
    assert.equal(widgetRegistry.getDefinition(null), null)
    assert.equal(widgetRegistry.getDefinition(undefined), null)
  })
})

describe('WidgetRegistry - getAllTypes', () => {
  test('应返回所有 12 种内置类型', () => {
    const types = widgetRegistry.getAllTypes()
    assert.equal(types.length, 12)
    const typeNames = types.map(t => t.type).sort()
    assert.deepEqual(typeNames, ['desktop-organizer', 'file', 'health', 'music', 'note', 'productivity', 'search', 'system-monitor', 'tags', 'task', 'todo', 'weather'])
  })

  test('每项应包含 type 和元信息字段', () => {
    const types = widgetRegistry.getAllTypes()
    for (const t of types) {
      assert.ok(t.type, '应有 type 字段')
      assert.ok(t.title, '应有 title 字段')
      assert.ok(t.icon, '应有 icon 字段')
      assert.ok(t.defaultWidth > 0, '应有 defaultWidth')
      assert.ok(t.defaultHeight > 0, '应有 defaultHeight')
      assert.ok(t.minWidth > 0, '应有 minWidth')
      assert.ok(t.minHeight > 0, '应有 minHeight')
    }
  })
})

describe('WidgetRegistry - isValidType', () => {
  test('合法类型应返回 true', () => {
    assert.equal(widgetRegistry.isValidType('note'), true)
    assert.equal(widgetRegistry.isValidType('task'), true)
    assert.equal(widgetRegistry.isValidType('health'), true)
    assert.equal(widgetRegistry.isValidType('todo'), true)
    assert.equal(widgetRegistry.isValidType('weather'), true)
  })

  test('未知类型应返回 false', () => {
    assert.equal(widgetRegistry.isValidType('unknown'), false)
    assert.equal(widgetRegistry.isValidType('nonexistent'), false)
  })

  test('null/undefined/空字符串应返回 false', () => {
    assert.equal(widgetRegistry.isValidType(null), false)
    assert.equal(widgetRegistry.isValidType(undefined), false)
    assert.equal(widgetRegistry.isValidType(''), false)
  })
})

describe('WidgetRegistry - getDefaultBounds', () => {
  test('应返回便签默认位置和大小', () => {
    const bounds = widgetRegistry.getDefaultBounds('note')
    assert.ok(bounds)
    assert.equal(typeof bounds.x, 'number')
    assert.equal(typeof bounds.y, 'number')
    assert.equal(typeof bounds.width, 'number')
    assert.equal(typeof bounds.height, 'number')
    assert.ok(bounds.width > 0)
    assert.ok(bounds.height > 0)
  })

  test('应返回待办默认位置和大小', () => {
    const bounds = widgetRegistry.getDefaultBounds('todo')
    assert.ok(bounds)
    // 待办默认高度应大于 0
    assert.ok(bounds.height > 0, '待办默认高度应大于 0')
  })

  test('未知类型应返回 null', () => {
    const bounds = widgetRegistry.getDefaultBounds('unknown')
    assert.equal(bounds, null)
  })

  test('各类型默认位置不应重叠', () => {
    const types = widgetRegistry.getAllTypes()
    const boundsList = types.map(t => ({
      type: t.type,
      ...widgetRegistry.getDefaultBounds(t.type)
    }))
    // 检查任意两个小部件的 x 坐标不同（默认配置错开排列）
    for (let i = 0; i < boundsList.length; i++) {
      for (let j = i + 1; j < boundsList.length; j++) {
        assert.notEqual(boundsList[i].x, boundsList[j].x,
          `${boundsList[i].type} 和 ${boundsList[j].type} 默认 x 不应相同`)
      }
    }
  })
})

describe('WidgetRegistry - register 动态注册', () => {
  test('应成功注册新类型', () => {
    const ok = widgetRegistry.register('custom-widget', {
      title: '天气',
      icon: 'Sunny',
      defaultWidth: 300,
      defaultHeight: 200,
      defaultX: 1500,
      defaultY: 100,
      minWidth: 200,
      minHeight: 150
    })
    assert.equal(ok, true)
    assert.equal(widgetRegistry.isValidType('custom-widget'), true)
    const def = widgetRegistry.getDefinition('custom-widget')
    assert.equal(def.title, '天气')
  })

  test('注册已存在类型应返回 false', () => {
    const ok = widgetRegistry.register('note', {
      title: '新便签',
      icon: 'EditPen',
      defaultWidth: 100,
      defaultHeight: 100
    })
    assert.equal(ok, false)
  })

  test('注册无效类型标识应返回 false', () => {
    const ok = widgetRegistry.register(null, {
      title: 'T',
      icon: 'I',
      defaultWidth: 100,
      defaultHeight: 100
    })
    assert.equal(ok, false)
  })

  test('注册缺少必填字段应返回 false', () => {
    // 缺少 defaultWidth
    const ok = widgetRegistry.register('stock', {
      title: '股票',
      icon: 'TrendCharts',
      defaultHeight: 100
    })
    assert.equal(ok, false)
  })

  test('注册时未提供 defaultX/defaultY/minWidth/minHeight 应使用默认值', () => {
    const ok = widgetRegistry.register('test_widget', {
      title: '测试',
      icon: 'Test',
      defaultWidth: 100,
      defaultHeight: 100
    })
    assert.equal(ok, true)
    const def = widgetRegistry.getDefinition('test_widget')
    assert.equal(def.defaultX, 100, '未提供 defaultX 应使用默认值 100')
    assert.equal(def.defaultY, 100, '未提供 defaultY 应使用默认值 100')
    assert.equal(def.minWidth, 200, '未提供 minWidth 应使用默认值 200')
    assert.equal(def.minHeight, 200, '未提供 minHeight 应使用默认值 200')
  })
})