// ============================================================
// 日期/时间计算工具
// 提供 ISO 8601 格式化、每周/每月规则到期判断、日期范围计算等
// ============================================================

const dayjs = require('dayjs')

// ============================================================
// 格式化方法
// ============================================================

/**
 * 获取当前时间的本地时间字符串（不含时区标识）
 * 注意：使用 dayjs 本地时间，而非 toISOString() 的 UTC 时间
 * @returns {string} 例如 "2026-08-23 22:30:00"（本地时间）
 */
function nowISO () {
  return dayjs().format('YYYY-MM-DD HH:mm:ss')
}

/**
 * 获取当前日期字符串 YYYY-MM-DD
 * @returns {string}
 */
function today () {
  return dayjs().format('YYYY-MM-DD')
}

/**
 * 格式化日期为 YYYY-MM-DD HH:mm:ss
 * @param {string|Date} date
 * @returns {string}
 */
function formatDateTime (date) {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss')
}

/**
 * 格式化日期为 YYYY-MM-DD
 * @param {string|Date} date
 * @returns {string}
 */
function formatDate (date) {
  return dayjs(date).format('YYYY-MM-DD')
}

// ============================================================
// 到期判断方法
// ============================================================

/**
 * 判断定时任务是否到期
 * 支持四种调度类型：one_shot / daily / weekly / monthly
 * @param {object} task - 任务对象，包含 task_type 和 schedule_config
 * @param {string} now - 当前时间 ISO 8601 字符串
 * @returns {boolean}
 */
function isTaskDue (task, now) {
  const nowDayjs = dayjs(now)
  const config = task.schedule_config

  if (task.task_type === 'one_shot') {
    // 一次性任务：到期时间 <= 当前时间
    return config.due_time && dayjs(config.due_time).isBefore(nowDayjs) || dayjs(config.due_time).isSame(nowDayjs, 'minute')
  }

  if (task.task_type === 'recurring') {
    const lastExecuted = task.last_executed_at ? dayjs(task.last_executed_at) : null

    if (config.type === 'daily') {
      // 每日任务：上次执行日期的次日及之后
      if (!lastExecuted) return true
      const lastDate = lastExecuted.format('YYYY-MM-DD')
      const currentDate = nowDayjs.format('YYYY-MM-DD')
      // 执行时间是当天的同一分钟之后
      return currentDate > lastDate || (currentDate === lastDate && nowDayjs.isAfter(lastExecuted))
    }

    if (config.type === 'weekly') {
      // 每周任务：上次执行所在周的指定星期之后
      if (!lastExecuted) return true
      const lastWeekStart = lastExecuted.startOf('week').format('YYYY-MM-DD')
      const currentWeekStart = nowDayjs.startOf('week').format('YYYY-MM-DD')
      if (currentWeekStart > lastWeekStart) return true
      if (currentWeekStart === lastWeekStart) {
        // 同周内，判断当前星期几是否已到指定星期
        const targetDayOfWeek = config.day_of_week || 0 // 0=周日, 1=周一...
        const currentDay = nowDayjs.day()
        const lastDay = lastExecuted.day()
        if (currentDay > targetDayOfWeek && lastDay >= targetDayOfWeek) return true
        if (currentDay === targetDayOfWeek && nowDayjs.isAfter(lastExecuted)) return true
      }
      return false
    }

    if (config.type === 'monthly') {
      // 每月任务：上月及之后的指定日期之后
      if (!lastExecuted) return true
      const lastMonthStr = lastExecuted.format('YYYY-MM')
      const currentMonthStr = nowDayjs.format('YYYY-MM')
      if (currentMonthStr > lastMonthStr) return true
      if (currentMonthStr === lastMonthStr) {
        const targetDay = config.day_of_month || 1
        const currentDay = nowDayjs.date()
        // 处理目标日期超出当月天数的情况（如每月31日，2月只有28天则跳过）
        const daysInMonth = nowDayjs.daysInMonth()
        if (targetDay > daysInMonth) return false
        if (currentDay > targetDay) return true
        if (currentDay === targetDay && nowDayjs.isAfter(lastExecuted)) return true
      }
      return false
    }
  }

  return false
}

/**
 * 获取下一个任务到期时间（用于调试/展示）
 * @param {object} task
 * @returns {string|null}
 */
function getNextDueTime (task) {
  const now = dayjs()
  const config = task.schedule_config

  if (task.task_type === 'one_shot') {
    return config.due_time || null
  }

  if (task.task_type === 'recurring') {
    if (config.type === 'daily') {
      return now.add(1, 'day').hour(config.time?.hour || 9).minute(config.time?.minute || 0).second(0).millisecond(0).format('YYYY-MM-DDTHH:mm:ss')
    }
    if (config.type === 'weekly') {
      const targetDay = config.day_of_week || 0
      let nextDay = now.day()
      while (nextDay <= targetDay && dayjs().isSame(nextDay, 'day') === false) {
        nextDay = (nextDay + 1) % 7
      }
      return now.add(1, 'week').day(targetDay).hour(config.time?.hour || 9).minute(config.time?.minute || 0).format('YYYY-MM-DDTHH:mm:ss')
    }
    if (config.type === 'monthly') {
      const targetDay = config.day_of_month || 1
      const daysInMonth = now.daysInMonth()
      const day = Math.min(targetDay, daysInMonth)
      const nextMonth = now.month() >= 11 ? now.add(1, 'year').month(0) : now.month(now.month() + 1)
      return nextMonth.date(day).hour(config.time?.hour || 9).minute(config.time?.minute || 0).format('YYYY-MM-DDTHH:mm:ss')
    }
  }

  return null
}

module.exports = {
  nowISO,
  today,
  formatDateTime,
  formatDate,
  isTaskDue,
  getNextDueTime
}
