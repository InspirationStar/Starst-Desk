// ============================================================
// ID 生成器单元测试
// 覆盖唯一性、格式
// ============================================================

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { generateId } = require('../../electron/utils/id-generator.js')

describe('IdGenerator - generateId', () => {
  test('应返回字符串', () => {
    const id = generateId()
    assert.equal(typeof id, 'string')
  })

  test('应符合 UUID v4 格式', () => {
    const id = generateId()
    // UUID v4 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('应保证唯一性（生成 1000 个不重复）', () => {
    const ids = new Set()
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId())
    }
    assert.equal(ids.size, 1000, '1000 个 ID 应全部唯一')
  })

  test('连续生成应产生不同 ID', () => {
    const id1 = generateId()
    const id2 = generateId()
    assert.notEqual(id1, id2)
  })

  test('长度应为 36 字符（含连字符）', () => {
    const id = generateId()
    assert.equal(id.length, 36)
  })
})