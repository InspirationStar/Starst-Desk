// ============================================================
// 胶囊栏排列计算器单元测试

// ============================================================
const { test } = require('node:test')
const assert = require('node:assert')
const calculator = require('../../electron/utils/widget-capsule-arrangement-calculator.js')

// 工作区与锚点公共 fixtures
const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
const anchor = { x: 100, y: 100 }

test('calculate: 空列表返回空结果', () => {
  const result = calculator.calculate([], workArea, anchor, 'LeftTop', 'horizontal', 8)
  assert.deepStrictEqual(result, {})
})

test('calculate: workArea 无效返回空结果', () => {
  const items = [{ id: 'a', width: 100, height: 42 }]
  assert.deepStrictEqual(calculator.calculate(items, { x: 0, y: 0, width: 0, height: 100 }, anchor, 'LeftTop', 'horizontal', 8), {})
  assert.deepStrictEqual(calculator.calculate(items, { x: 0, y: 0, width: 100, height: 0 }, anchor, 'LeftTop', 'horizontal', 8), {})
})

test('calculate: 水平左上锚点按序排列', () => {
  const items = [
    { id: 'a', width: 100, height: 42 },
    { id: 'b', width: 150, height: 42 },
    { id: 'c', width: 120, height: 42 }
  ]
  const result = calculator.calculate(items, workArea, anchor, 'LeftTop', 'horizontal', 8)
  // a: x=100, y=100, w=100, h=42
  assert.strictEqual(result.a.x, 100)
  assert.strictEqual(result.a.y, 100)
  assert.strictEqual(result.a.width, 100)
  assert.strictEqual(result.a.height, 42)
  // b: x=100+100+8=208
  assert.strictEqual(result.b.x, 208)
  assert.strictEqual(result.b.y, 100)
  assert.strictEqual(result.b.width, 150)
  // c: x=208+150+8=366
  assert.strictEqual(result.c.x, 366)
  assert.strictEqual(result.c.width, 120)
})

test('calculate: 水平右下锚点反向排列', () => {
  const items = [
    { id: 'a', width: 100, height: 42 },
    { id: 'b', width: 150, height: 42 }
  ]
  const result = calculator.calculate(items, workArea, { x: 1820, y: 1000 }, 'RightBottom', 'horizontal', 8)
  // a: x=1820-100=1720, y=1000-42=958
  assert.strictEqual(result.a.x, 1720)
  assert.strictEqual(result.a.y, 958)
  // b: cursorX=1720-8=1712, x=1712-150=1562
  assert.strictEqual(result.b.x, 1562)
  assert.strictEqual(result.b.y, 958)
})

test('calculate: 垂直左上锚点按序排列', () => {
  const items = [
    { id: 'a', width: 100, height: 42 },
    { id: 'b', width: 150, height: 42 }
  ]
  const result = calculator.calculate(items, workArea, anchor, 'LeftTop', 'vertical', 8)
  // commonWidth = min(1920, max(100,150)) = 150
  assert.strictEqual(result.a.x, 100)
  assert.strictEqual(result.a.y, 100)
  assert.strictEqual(result.a.width, 150)
  assert.strictEqual(result.a.height, 42)
  // b: y=100+42+8=150
  assert.strictEqual(result.b.y, 150)
  assert.strictEqual(result.b.width, 150)
})

test('calculate: 超出工作区宽度触发缩放', () => {
  const items = [
    { id: 'a', width: 800, height: 42 },
    { id: 'b', width: 800, height: 42 }
  ]
  const smallWorkArea = { x: 0, y: 0, width: 600, height: 1080 }
  const result = calculator.calculate(items, smallWorkArea, anchor, 'LeftTop', 'horizontal', 8)
  // 缩放后总和应不超过 availableForItems = 600 - 8 = 592
  const totalWidth = result.a.width + result.b.width + 8
  assert.ok(totalWidth <= 600, `总宽度 ${totalWidth} 应不超过 600`)
  // 每个胶囊不小于 effectiveMinimum
  assert.ok(result.a.width >= 1)
  assert.ok(result.b.width >= 1)
})

test('calculate: 锚点夹取到工作区内', () => {
  const items = [{ id: 'a', width: 100, height: 42 }]
  // 锚点超出工作区左上角
  const result = calculator.calculate(items, workArea, { x: -50, y: -50 }, 'LeftTop', 'horizontal', 8)
  assert.strictEqual(result.a.x, 0)
  assert.strictEqual(result.a.y, 0)
})

test('calculate: 整组钳制到工作区内', () => {
  const items = [
    { id: 'a', width: 100, height: 42 },
    { id: 'b', width: 100, height: 42 }
  ]
  // 工作区较小，触发整组平移
  const smallWorkArea = { x: 100, y: 100, width: 200, height: 200 }
  const result = calculator.calculate(items, smallWorkArea, { x: 50, y: 50 }, 'LeftTop', 'horizontal', 8)
  // 所有胶囊应在工作区内
  for (const id of ['a', 'b']) {
    assert.ok(result[id].x >= smallWorkArea.x, `${id}.x 应 >= 工作区 x`)
    assert.ok(result[id].y >= smallWorkArea.y, `${id}.y 应 >= 工作区 y`)
    assert.ok(result[id].x + result[id].width <= smallWorkArea.x + smallWorkArea.width, `${id} 右边界应 <= 工作区右边界`)
  }
})

test('normalizeDirection: 规范化方向', () => {
  assert.strictEqual(calculator.normalizeDirection('horizontal'), 'Horizontal')
  assert.strictEqual(calculator.normalizeDirection('HORIZONTAL'), 'Horizontal')
  assert.strictEqual(calculator.normalizeDirection('vertical'), 'Vertical')
  assert.strictEqual(calculator.normalizeDirection('Vertical'), 'Vertical')
  assert.strictEqual(calculator.normalizeDirection('auto'), 'Auto')
  assert.strictEqual(calculator.normalizeDirection(null), 'Auto')
  assert.strictEqual(calculator.normalizeDirection(undefined), 'Auto')
})

test('fitPrimarySizes: 尺寸总和不超过可用空间', () => {
  const { safeSpacing, sizes } = calculator.fitPrimarySizes([300, 400, 500], 600, 8, 96)
  const total = sizes.reduce((acc, v) => acc + v, 0) + safeSpacing * (sizes.length - 1)
  assert.ok(total <= 600, `总宽度 ${total} 应不超过 600`)
  // 每个尺寸至少为 1
  for (const s of sizes) assert.ok(s >= 1)
})

test('fitPrimarySizes: 原始尺寸不超时直接返回', () => {
  const { safeSpacing, sizes } = calculator.fitPrimarySizes([100, 100], 600, 8, 96)
  assert.deepStrictEqual(sizes, [100, 100])
  assert.strictEqual(safeSpacing, 8)
})