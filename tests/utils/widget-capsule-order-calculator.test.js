// ============================================================
// 胶囊拖拽排序计算器单元测试

// ============================================================
const { test } = require('node:test')
const assert = require('node:assert')
const calculator = require('../../electron/utils/widget-capsule-order-calculator.js')

test('moveToNearestSlot: 拖拽到最近槽位', () => {
  const ordered = ['a', 'b', 'c', 'd']
  const slots = [
    { x: 0, y: 0, width: 100, height: 42 },
    { x: 108, y: 0, width: 100, height: 42 },
    { x: 216, y: 0, width: 100, height: 42 },
    { x: 324, y: 0, width: 100, height: 42 }
  ]
  // 拖拽 a 到 c 的位置（中心 266）
  const result = calculator.moveToNearestSlot(
    ordered, slots, 'a',
    { x: 216, y: 0, width: 100, height: 42 },
    'horizontal'
  )
  // a 从 index 0 移到 index 2
  assert.deepStrictEqual(result, ['b', 'c', 'a', 'd'])
})

test('moveToNearestSlot: 垂直方向拖拽', () => {
  const ordered = ['a', 'b', 'c']
  const slots = [
    { x: 0, y: 0, width: 100, height: 42 },
    { x: 0, y: 50, width: 100, height: 42 },
    { x: 0, y: 100, width: 100, height: 42 }
  ]
  // 拖拽 a 到 c 的位置
  const result = calculator.moveToNearestSlot(
    ordered, slots, 'a',
    { x: 0, y: 100, width: 100, height: 42 },
    'vertical'
  )
  assert.deepStrictEqual(result, ['b', 'c', 'a'])
})

test('moveToNearestSlot: 未找到 activeId 返回原顺序副本', () => {
  const ordered = ['a', 'b', 'c']
  const slots = [
    { x: 0, y: 0, width: 100, height: 42 },
    { x: 100, y: 0, width: 100, height: 42 },
    { x: 200, y: 0, width: 100, height: 42 }
  ]
  const result = calculator.moveToNearestSlot(
    ordered, slots, 'x',
    { x: 200, y: 0, width: 100, height: 42 },
    'horizontal'
  )
  assert.deepStrictEqual(result, ['a', 'b', 'c'])
  // 确保返回副本而非原数组
  assert.notStrictEqual(result, ordered)
})

test('moveToNearestSlot: 单个胶囊返回原顺序副本', () => {
  const ordered = ['a']
  const slots = [{ x: 0, y: 0, width: 100, height: 42 }]
  const result = calculator.moveToNearestSlot(
    ordered, slots, 'a',
    { x: 50, y: 0, width: 100, height: 42 },
    'horizontal'
  )
  assert.deepStrictEqual(result, ['a'])
})

test('moveToNearestSlot: 最近槽位与当前位置相同返回原顺序副本', () => {
  const ordered = ['a', 'b', 'c']
  const slots = [
    { x: 0, y: 0, width: 100, height: 42 },
    { x: 108, y: 0, width: 100, height: 42 },
    { x: 216, y: 0, width: 100, height: 42 }
  ]
  // a 在原位置不动
  const result = calculator.moveToNearestSlot(
    ordered, slots, 'a',
    { x: 0, y: 0, width: 100, height: 42 },
    'horizontal'
  )
  assert.deepStrictEqual(result, ['a', 'b', 'c'])
})

test('mergeGroupOrder: 合并组内排序到全局排序', () => {
  // 全局 [a, b, c, d, e]，组内 [c, a] → 组内位置（a, c）按 c, a 替换
  const result = calculator.mergeGroupOrder(['a', 'b', 'c', 'd', 'e'], ['c', 'a'])
  assert.deepStrictEqual(result, ['c', 'b', 'a', 'd', 'e'])
})

test('mergeGroupOrder: 组内顺序与全局一致时不变', () => {
  const result = calculator.mergeGroupOrder(['a', 'b', 'c'], ['a', 'b', 'c'])
  assert.deepStrictEqual(result, ['a', 'b', 'c'])
})

test('mergeGroupOrder: 空组内顺序不变', () => {
  const result = calculator.mergeGroupOrder(['a', 'b', 'c'], [])
  assert.deepStrictEqual(result, ['a', 'b', 'c'])
})

test('getPrimaryCenter: 水平方向返回 2x + width', () => {
  assert.strictEqual(
    calculator.getPrimaryCenter({ x: 10, y: 20, width: 30, height: 40 }, false),
    50 // 10*2 + 30
  )
})

test('getPrimaryCenter: 垂直方向返回 2y + height', () => {
  assert.strictEqual(
    calculator.getPrimaryCenter({ x: 10, y: 20, width: 30, height: 40 }, true),
    80 // 20*2 + 40
  )
})

test('indexOf: 查找元素索引', () => {
  assert.strictEqual(calculator.indexOf(['a', 'b', 'c'], 'b'), 1)
  assert.strictEqual(calculator.indexOf(['a', 'b', 'c'], 'x'), -1)
})

test('normalizeDirection: 规范化方向', () => {
  assert.strictEqual(calculator.normalizeDirection('horizontal'), 'Horizontal')
  assert.strictEqual(calculator.normalizeDirection('vertical'), 'Vertical')
  assert.strictEqual(calculator.normalizeDirection('auto'), 'Auto')
  assert.strictEqual(calculator.normalizeDirection(null), 'Auto')
})