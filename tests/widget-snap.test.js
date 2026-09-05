// ============================================================
// widget-snap.js 单元测试
// 使用 Node 自带 test 模块
// ============================================================

const { test } = require('node:test')
const assert = require('node:assert')
const { snapToEdges } = require('../electron/widget-snap.js')

const WORKAREA = { x: 0, y: 0, width: 1920, height: 1080 }

test('屏幕左边缘吸附', () => {
  const result = snapToEdges({ x: 6, y: 100, width: 280, height: 360 }, { workArea: WORKAREA, others: [] })
  assert.strictEqual(result.x, 0)
  assert.strictEqual(result.y, 100)
})

test('屏幕右边缘吸附', () => {
  const result = snapToEdges({ x: 1638, y: 100, width: 280, height: 360 }, { workArea: WORKAREA, others: [] })
  assert.strictEqual(result.x, 1640)
})

test('屏幕上边缘吸附', () => {
  const result = snapToEdges({ x: 500, y: 5, width: 280, height: 360 }, { workArea: WORKAREA, others: [] })
  assert.strictEqual(result.y, 0)
})

test('屏幕下边缘吸附', () => {
  const result = snapToEdges({ x: 500, y: 718, width: 280, height: 360 }, { workArea: WORKAREA, others: [] })
  assert.strictEqual(result.y, 720)
})

test('超出阈值不吸附', () => {
  const result = snapToEdges({ x: 500, y: 500, width: 280, height: 360 }, { workArea: WORKAREA, others: [] })
  assert.strictEqual(result.x, 500)
  assert.strictEqual(result.y, 500)
})

test('小部件左右贴合', () => {
  const other = { x: 300, y: 100, width: 280, height: 360 }
  const result = snapToEdges({ x: 585, y: 100, width: 280, height: 360 }, { workArea: WORKAREA, others: [other] })
  assert.strictEqual(result.x, 580) // other.x + other.width = 580
})

test('小部件对齐', () => {
  const other = { x: 300, y: 100, width: 280, height: 360 }
  const result = snapToEdges({ x: 295, y: 500, width: 280, height: 360 }, { workArea: WORKAREA, others: [other] })
  assert.strictEqual(result.x, 300) // 对齐 other.x
})

test('X/Y 独立吸附同时生效', () => {
  const result = snapToEdges({ x: 6, y: 5, width: 280, height: 360 }, { workArea: WORKAREA, others: [] })
  assert.strictEqual(result.x, 0)
  assert.strictEqual(result.y, 0)
})

test('多个候选选最近的', () => {
  const other1 = { x: 300, y: 100, width: 280, height: 360 }
  const other2 = { x: 600, y: 100, width: 280, height: 360 }
  // x=587 距 other1 右边 580 = 7（< widgetThreshold=8），距 other2 左边 600 = 13
  const result = snapToEdges({ x: 587, y: 500, width: 280, height: 360 }, { workArea: WORKAREA, others: [other1, other2] })
  assert.strictEqual(result.x, 580)
})

test('others 为空且离边缘远时不吸附', () => {
  const result = snapToEdges({ x: 500, y: 500, width: 280, height: 360 }, { workArea: WORKAREA, others: [] })
  assert.deepStrictEqual(result, { x: 500, y: 500, width: 280, height: 360 })
})

test('threshold 与 widgetThreshold 分别生效', () => {
  const other = { x: 300, y: 100, width: 280, height: 360 }
  // widgetThreshold=8，距离 9 应不吸附
  const result = snapToEdges({ x: 589, y: 500, width: 280, height: 360 }, { workArea: WORKAREA, others: [other], threshold: 10, widgetThreshold: 8 })
  assert.strictEqual(result.x, 589)
})

// ============================================================
// 多显示器场景（workArea 非 0,0 起点）
// ============================================================

test('多显示器：第二显示器左边缘吸附', () => {
  // 第二显示器：x=1920, y=0, width=1080, height=1080
  const workArea = { x: 1920, y: 0, width: 1080, height: 1080 }
  const bounds = { x: 1922, y: 100, width: 280, height: 360 }
  const result = snapToEdges(bounds, { workArea, others: [], threshold: 10, widgetThreshold: 8 })
  assert.strictEqual(result.x, 1920)
  assert.strictEqual(result.y, 100)
})

test('多显示器：第二显示器右边缘吸附', () => {
  // 第二显示器：x=1920, y=0, width=1080, height=1080
  const workArea = { x: 1920, y: 0, width: 1080, height: 1080 }
  // 右边缘目标位置：1920 + 1080 - 280 = 2720
  const bounds = { x: 2718, y: 100, width: 280, height: 360 }
  const result = snapToEdges(bounds, { workArea, others: [], threshold: 10, widgetThreshold: 8 })
  assert.strictEqual(result.x, 2720)
  assert.strictEqual(result.y, 100)
})

test('多显示器：第二显示器与第一显示器小部件间吸附', () => {
  // 第二显示器：x=1920, y=0, width=1080, height=1080
  const workArea = { x: 1920, y: 0, width: 1080, height: 1080 }
  // 已有小部件在第二显示器上：x=2200, width=280，右边缘=2480
  const others = [{ x: 2200, y: 100, width: 280, height: 360 }]
  // 当前窗口左边缘靠近 2480，delta=3
  const bounds = { x: 2483, y: 100, width: 280, height: 360 }
  const result = snapToEdges(bounds, { workArea, others, threshold: 10, widgetThreshold: 8 })
  assert.strictEqual(result.x, 2480)
  assert.strictEqual(result.y, 100)
})