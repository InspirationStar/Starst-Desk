// ============================================================
// 便签 DAO 单元测试
// 覆盖 CRUD、搜索筛选排序、提醒查询、边界条件
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let db
let noteDao

beforeEach(() => {
  // 每个测试用例使用全新的内存数据库
  db = setup.setupFreshDb()
  noteDao = require('../../electron/dao/note-dao.js')
})

afterEach(() => {
  try { db.close() } catch (e) {}
})

describe('NoteDao - 创建便签', () => {
  test('应成功创建包含标题和正文的便签', () => {
    const note = noteDao.create({ title: '测试标题', body: '测试正文' })
    assert.ok(note.id, '应生成 ID')
    assert.equal(note.title, '测试标题')
    assert.equal(note.body, '测试正文')
    assert.equal(note.color_tag, 'yellow', '默认颜色应为 yellow')
    assert.equal(note.is_pinned, 0)
    assert.equal(note.is_completed, 0)
    assert.equal(note.is_reminded, 0)
    assert.ok(note.created_at)
    assert.ok(note.updated_at)
  })

  test('应支持自定义颜色标签', () => {
    const note = noteDao.create({ title: '红色便签', color_tag: 'red' })
    assert.equal(note.color_tag, 'red')
  })

  test('应支持置顶便签', () => {
    const note = noteDao.create({ title: '置顶', is_pinned: true })
    assert.equal(note.is_pinned, 1)
  })

  test('应支持设置提醒时间', () => {
    const reminder = '2026-12-31 23:59:00'
    const note = noteDao.create({ title: '提醒', reminder_time: reminder })
    assert.equal(note.reminder_time, reminder)
  })

  test('应仅含正文也能创建（title 为 null）', () => {
    const note = noteDao.create({ body: '只有正文' })
    assert.equal(note.title, null)
    assert.equal(note.body, '只有正文')
  })
})

describe('NoteDao - 查询便签', () => {
  test('getById 应返回完整便签对象', () => {
    const created = noteDao.create({ title: '查询测试', body: '内容' })
    const found = noteDao.getById(created.id)
    assert.deepEqual(found.id, created.id)
    assert.equal(found.title, '查询测试')
  })

  test('getById 不存在的 ID 应返回 null', () => {
    const found = noteDao.getById('non-existent-id')
    assert.equal(found, null)
  })

  test('list 应返回所有便签和总数', () => {
    noteDao.create({ title: '便签1' })
    noteDao.create({ title: '便签2' })
    noteDao.create({ title: '便签3' })
    const result = noteDao.list()
    assert.equal(result.total, 3)
    assert.equal(result.list.length, 3)
  })

  test('list 应支持关键词搜索（匹配标题）', () => {
    noteDao.create({ title: '购物清单' })
    noteDao.create({ title: '工作计划' })
    noteDao.create({ title: '购物优惠码' })
    const result = noteDao.list({ keyword: '购物' })
    assert.equal(result.total, 2)
    assert.equal(result.list.length, 2)
  })

  test('list 应支持关键词搜索（匹配正文）', () => {
    noteDao.create({ title: 'A', body: '今天天气真好' })
    noteDao.create({ title: 'B', body: '工作内容' })
    const result = noteDao.list({ keyword: '天气' })
    assert.equal(result.total, 1)
    assert.equal(result.list[0].title, 'A')
  })

  test('list 应支持颜色筛选', () => {
    noteDao.create({ title: '红', color_tag: 'red' })
    noteDao.create({ title: '蓝', color_tag: 'blue' })
    noteDao.create({ title: '红2', color_tag: 'red' })
    const result = noteDao.list({ color_tag: 'red' })
    assert.equal(result.total, 2)
  })

  test('list 应支持分页', () => {
    for (let i = 0; i < 5; i++) {
      noteDao.create({ title: `便签${i}` })
    }
    const page1 = noteDao.list({ page: 1, size: 2 })
    const page2 = noteDao.list({ page: 2, size: 2 })
    assert.equal(page1.list.length, 2)
    assert.equal(page2.list.length, 2)
    // 两页 ID 不应重叠
    const ids1 = page1.list.map(n => n.id)
    const ids2 = page2.list.map(n => n.id)
    for (const id of ids2) {
      assert.ok(!ids1.includes(id), '分页 ID 不应重叠')
    }
  })

  test('list 应支持按创建时间升序排序', async () => {
    noteDao.create({ title: '第一' })
    await new Promise(resolve => setTimeout(resolve, 1100))
    noteDao.create({ title: '第二' })
    const result = noteDao.list({ sort_by: 'created_at', sort_order: 'ASC' })
    assert.equal(result.list[0].title, '第一')
    assert.equal(result.list[1].title, '第二')
  })

  test('list 应防御 SQL 注入（非法排序字段回退到默认）', () => {
    noteDao.create({ title: '安全测试' })
    // 非法字段不应导致错误
    const result = noteDao.list({ sort_by: 'DROP TABLE notes;--' })
    assert.equal(result.total, 1)
  })

  test('list 应转义 LIKE 通配符 %', () => {
    noteDao.create({ title: '100%完成' })
    noteDao.create({ title: '另一个便签' })
    const result = noteDao.list({ keyword: '100%完成' })
    assert.equal(result.total, 1)
    assert.equal(result.list[0].title, '100%完成')
  })
})

describe('NoteDao - 更新便签', () => {
  test('应更新标题', () => {
    const note = noteDao.create({ title: '原标题' })
    const updated = noteDao.update(note.id, { title: '新标题' })
    assert.equal(updated.title, '新标题')
  })

  test('应更新正文', () => {
    const note = noteDao.create({ title: 'T', body: '原正文' })
    const updated = noteDao.update(note.id, { body: '新正文' })
    assert.equal(updated.body, '新正文')
  })

  test('应更新颜色标签', () => {
    const note = noteDao.create({ title: 'T', color_tag: 'yellow' })
    const updated = noteDao.update(note.id, { color_tag: 'green' })
    assert.equal(updated.color_tag, 'green')
  })

  test('应更新置顶状态', () => {
    const note = noteDao.create({ title: 'T', is_pinned: false })
    const updated = noteDao.update(note.id, { is_pinned: true })
    assert.equal(updated.is_pinned, 1)
  })

  test('应更新完成状态', () => {
    const note = noteDao.create({ title: 'T' })
    const updated = noteDao.update(note.id, { is_completed: true })
    assert.equal(updated.is_completed, 1)
  })

  test('应更新提醒时间', () => {
    const note = noteDao.create({ title: 'T' })
    const updated = noteDao.update(note.id, { reminder_time: '2026-12-31 23:59:00' })
    assert.equal(updated.reminder_time, '2026-12-31 23:59:00')
  })

  test('空更新数据应返回原便签', () => {
    const note = noteDao.create({ title: '不变' })
    const updated = noteDao.update(note.id, {})
    assert.equal(updated.title, '不变')
  })

  test('更新不存在的 ID 应返回 null', () => {
    const updated = noteDao.update('non-existent', { title: 'X' })
    assert.equal(updated, null)
  })
})

describe('NoteDao - 删除便签', () => {
  test('应删除存在的便签', () => {
    const note = noteDao.create({ title: '待删除' })
    const ok = noteDao.del(note.id)
    assert.equal(ok, true)
    assert.equal(noteDao.getById(note.id), null)
  })

  test('删除不存在的 ID 应返回 false', () => {
    const ok = noteDao.del('non-existent')
    assert.equal(ok, false)
  })
})

describe('NoteDao - 提醒查询', () => {
  test('findDueReminders 应返回到期未提醒的便签', () => {
    noteDao.create({ title: '已到期', reminder_time: '2020-01-01 00:00:00' })
    noteDao.create({ title: '未到期', reminder_time: '2099-12-31 23:59:59' })
    const due = noteDao.findDueReminders('2026-08-23 12:00:00')
    assert.equal(due.length, 1)
    assert.equal(due[0].title, '已到期')
  })

  test('findDueReminders 应排除已提醒的便签', () => {
    const n1 = noteDao.create({ title: '已提醒', reminder_time: '2020-01-01 00:00:00' })
    noteDao.markReminded(n1.id)
    noteDao.create({ title: '未提醒', reminder_time: '2020-01-01 00:00:00' })
    const due = noteDao.findDueReminders('2026-08-23 12:00:00')
    assert.equal(due.length, 1)
    assert.equal(due[0].title, '未提醒')
  })

  test('findDueReminders 应排除已完成的便签', () => {
    const n1 = noteDao.create({ title: '已完成', reminder_time: '2020-01-01 00:00:00' })
    noteDao.update(n1.id, { is_completed: true })
    const due = noteDao.findDueReminders('2026-08-23 12:00:00')
    assert.equal(due.length, 0)
  })

  test('findDueReminders 应按提醒时间升序返回', () => {
    noteDao.create({ title: '晚', reminder_time: '2020-02-01 00:00:00' })
    noteDao.create({ title: '早', reminder_time: '2020-01-01 00:00:00' })
    const due = noteDao.findDueReminders('2026-08-23 12:00:00')
    assert.equal(due[0].title, '早')
    assert.equal(due[1].title, '晚')
  })

  test('markReminded 应将便签标记为已提醒', () => {
    const note = noteDao.create({ title: 'T', reminder_time: '2020-01-01 00:00:00' })
    const ok = noteDao.markReminded(note.id)
    assert.equal(ok, true)
    const updated = noteDao.getById(note.id)
    assert.equal(updated.is_reminded, 1)
  })

  test('markMissedReminders 应标记过期未提醒便签', () => {
    noteDao.create({ title: '错过1', reminder_time: '2020-01-01 00:00:00' })
    noteDao.create({ title: '错过2', reminder_time: '2020-02-01 00:00:00' })
    noteDao.create({ title: '未到期', reminder_time: '2099-12-31 00:00:00' })
    const count = noteDao.markMissedReminders('2026-08-23 12:00:00')
    assert.equal(count, 2)
  })
})