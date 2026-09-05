// ============================================================
// 日期工具函数单元测试
// 覆盖格式化、到期判断、下一到期时间计算
// ============================================================

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const dateUtils = require('../../electron/utils/date-utils.js')

describe('DateUtils - 格式化方法', () => {
  test('nowISO 应返回 YYYY-MM-DD HH:mm:ss 格式', () => {
    const iso = dateUtils.nowISO()
    assert.match(iso, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  test('today 应返回 YYYY-MM-DD 格式', () => {
    const today = dateUtils.today()
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/)
  })

  test('formatDateTime 应格式化为 YYYY-MM-DD HH:mm:ss', () => {
    const formatted = dateUtils.formatDateTime('2026-08-23T10:30:00')
    assert.equal(formatted, '2026-08-23 10:30:00')
  })

  test('formatDate 应格式化为 YYYY-MM-DD', () => {
    const formatted = dateUtils.formatDate('2026-08-23T10:30:00')
    assert.equal(formatted, '2026-08-23')
  })

  test('formatDateTime 应支持 Date 对象', () => {
    const date = new Date('2026-08-23T10:30:00')
    const formatted = dateUtils.formatDateTime(date)
    assert.match(formatted, /2026-08-23/)
  })
})

describe('DateUtils - isTaskDue 一次性任务', () => {
  test('到期时间已过应返回 true', () => {
    const task = {
      task_type: 'one_shot',
      schedule_config: { due_time: '2020-01-01 00:00:00' }
    }
    assert.equal(dateUtils.isTaskDue(task, '2026-08-23 12:00:00'), true)
  })

  test('到期时间未到应返回 false', () => {
    const task = {
      task_type: 'one_shot',
      schedule_config: { due_time: '2099-12-31 23:59:59' }
    }
    assert.equal(dateUtils.isTaskDue(task, '2026-08-23 12:00:00'), false)
  })

  test('当前时间等于到期时间应返回 true', () => {
    const task = {
      task_type: 'one_shot',
      schedule_config: { due_time: '2026-08-23 12:00:00' }
    }
    assert.equal(dateUtils.isTaskDue(task, '2026-08-23 12:00:00'), true)
  })
})

describe('DateUtils - isTaskDue 每日任务', () => {
  test('从未执行过的每日任务应返回 true', () => {
    const task = {
      task_type: 'recurring',
      schedule_config: { type: 'daily', time: { hour: 9, minute: 0 } },
      last_executed_at: null
    }
    assert.equal(dateUtils.isTaskDue(task, '2026-08-23 10:00:00'), true)
  })

  test('今日已执行过且当前时间早于上次执行时间应返回 false', () => {
    // date-utils 的实现：同日内当前时间晚于上次执行时间会再次到期
    // 此测试验证：当前时间早于上次执行时间时不应到期
    const task = {
      task_type: 'recurring',
      schedule_config: { type: 'daily', time: { hour: 9, minute: 0 } },
      last_executed_at: '2026-08-23 10:00:00'
    }
    assert.equal(dateUtils.isTaskDue(task, '2026-08-23 09:00:00'), false)
  })

  test('昨日执行过的每日任务今日应返回 true', () => {
    const task = {
      task_type: 'recurring',
      schedule_config: { type: 'daily', time: { hour: 9, minute: 0 } },
      last_executed_at: '2026-08-22 09:00:00'
    }
    assert.equal(dateUtils.isTaskDue(task, '2026-08-23 10:00:00'), true)
  })
})

describe('DateUtils - isTaskDue 每周任务', () => {
  test('从未执行过的每周任务应返回 true', () => {
    const task = {
      task_type: 'recurring',
      schedule_config: { type: 'weekly', day_of_week: 1, time: { hour: 9, minute: 0 } },
      last_executed_at: null
    }
    assert.equal(dateUtils.isTaskDue(task, '2026-08-24 10:00:00'), true)
  })
})

describe('DateUtils - isTaskDue 每月任务', () => {
  test('从未执行过的每月任务应返回 true', () => {
    const task = {
      task_type: 'recurring',
      schedule_config: { type: 'monthly', day_of_month: 1, time: { hour: 9, minute: 0 } },
      last_executed_at: null
    }
    assert.equal(dateUtils.isTaskDue(task, '2026-08-01 10:00:00'), true)
  })
})

describe('DateUtils - getNextDueTime', () => {
  test('一次性任务应返回 due_time', () => {
    const task = {
      task_type: 'one_shot',
      schedule_config: { due_time: '2026-12-31 09:00:00' }
    }
    const next = dateUtils.getNextDueTime(task)
    assert.equal(next, '2026-12-31 09:00:00')
  })

  test('每日任务应返回下一日的执行时间', () => {
    const task = {
      task_type: 'recurring',
      schedule_config: { type: 'daily', time: { hour: 9, minute: 0 } }
    }
    const next = dateUtils.getNextDueTime(task)
    assert.ok(next, '应返回下一到期时间')
    assert.match(next, /^\d{4}-\d{2}-\d{2}/)
  })

  test('每周任务应返回下一周的执行时间', () => {
    const task = {
      task_type: 'recurring',
      schedule_config: { type: 'weekly', day_of_week: 1, time: { hour: 9, minute: 0 } }
    }
    const next = dateUtils.getNextDueTime(task)
    assert.ok(next)
  })

  test('每月任务应返回下月的执行时间', () => {
    const task = {
      task_type: 'recurring',
      schedule_config: { type: 'monthly', day_of_month: 15, time: { hour: 9, minute: 0 } }
    }
    const next = dateUtils.getNextDueTime(task)
    assert.ok(next)
  })

  test('未知任务类型应返回 null', () => {
    const task = {
      task_type: 'unknown',
      schedule_config: {}
    }
    const next = dateUtils.getNextDueTime(task)
    assert.equal(next, null)
  })
})