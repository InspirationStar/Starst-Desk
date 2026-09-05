// ============================================================
// 任务调度器
// 职责：每 30 秒扫描数据库中的启用任务，判断是否到期并执行
// 支持四种调度类型：一次性 / 每日 / 每周 / 每月
// 执行后更新 last_executed_at，记录执行历史
// 一次性任务执行后自动禁用
// 使用 setInterval 定时扫描，stop() 时清除
// ============================================================

const dayjs = require('dayjs')
const logger = require('./logger.js')
const taskDao = require('./../dao/task-dao.js')
const taskExecutionDao = require('./../dao/task-execution-dao.js')
const taskExecutor = require('./task-executor.js')
const dateUtils = require('./../utils/date-utils.js')

// 扫描周期（毫秒），30 秒
const SCAN_INTERVAL_MS = 30 * 1000

// 调度器内部状态
let scanTimer = null
let isRunning = false

// ============================================================
// 启动 / 停止
// ============================================================

/**
 * 启动调度器
 * 首次启动立即执行一次扫描，之后按 30 秒周期定时扫描
 */
function start () {
  if (isRunning) {
    logger.warn('Scheduler', '调度器已在运行，无需重复启动')
    return
  }
  isRunning = true
  logger.info('Scheduler', '调度器已启动，扫描周期 30 秒')

  // 首次启动立即执行一次扫描（捕获启动前错过的任务）
  tick()

  // 定时扫描
  scanTimer = setInterval(tick, SCAN_INTERVAL_MS)
}

/**
 * 停止调度器，清除定时器
 */
function stop () {
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }
  isRunning = false
  logger.info('Scheduler', '调度器已停止')
}

/**
 * 获取调度器运行状态
 * @returns {boolean}
 */
function isSchedulerRunning () {
  return isRunning
}

// ============================================================
// 扫描主循环
// ============================================================

/**
 * 单次扫描：查询启用任务，判断到期并执行
 */
async function tick () {
  try {
    const now = dateUtils.nowISO()
    logger.debug('Scheduler', `开始扫描: ${now}`)

    // 扫描到期任务
    await scanTasks(now)
  } catch (error) {
    logger.error('Scheduler', `扫描异常: ${error.message}`)
  }
}

/**
 * 扫描到期任务并执行
 * @param {string} now - 当前时间 ISO 字符串
 */
async function scanTasks (now) {
  // 查询所有启用的任务
  const tasks = taskDao.findEnabledTasks()
  if (tasks.length === 0) {
    return
  }

  for (const task of tasks) {
    try {
      if (isTaskDue(task, now)) {
        await executeTask(task, now)
      }
    } catch (error) {
      // 单个任务异常不中断整个扫描循环
      logger.error('Scheduler', `任务 [${task.name}] 处理异常: ${error.message}`)
    }
  }
}

// ============================================================
// 到期判断
// ============================================================

/**
 * 判断任务是否到期
 * 支持四种调度类型：one_shot / daily / weekly / monthly
 * @param {object} task - 任务对象
 * @param {string} now - 当前时间 ISO 字符串
 * @returns {boolean}
 */
function isTaskDue (task, now) {
  const nowDayjs = dayjs(now)
  const config = task.schedule_config
  const lastExecuted = task.last_executed_at ? dayjs(task.last_executed_at) : null

  // ---------- 一次性任务 ----------
  if (task.task_type === 'one_shot') {
    // 已执行过则不再到期
    if (lastExecuted) return false
    const dueTime = config.due_time
    if (!dueTime) return false
    // 当前时间 >= 到期时间
    return nowDayjs.isAfter(dayjs(dueTime)) || nowDayjs.isSame(dayjs(dueTime), 'minute')
  }

  // ---------- 循环任务 ----------
  if (task.task_type === 'recurring') {
    const targetTime = config.time || { hour: 0, minute: 0 }
    const targetHour = targetTime.hour || 0
    const targetMinute = targetTime.minute || 0

    // 构造今天的执行时间点
    const todayExecuteTime = nowDayjs
      .hour(targetHour)
      .minute(targetMinute)
      .second(0)
      .millisecond(0)

    // 当前时间还未到今天的执行时间点，未到期
    if (nowDayjs.isBefore(todayExecuteTime)) return false

    // 检查今天是否已执行过
    const todayDate = nowDayjs.format('YYYY-MM-DD')
    const lastExecutedDate = lastExecuted ? lastExecuted.format('YYYY-MM-DD') : null
    const executedToday = lastExecutedDate === todayDate

    // ---------- 每日任务 ----------
    if (config.type === 'daily') {
      return !executedToday
    }

    // ---------- 每周任务 ----------
    if (config.type === 'weekly') {
      const daysOfWeek = config.days_of_week || []
      const currentDayOfWeek = nowDayjs.day() // 0=周日, 1=周一...6=周六
      if (!daysOfWeek.includes(currentDayOfWeek)) return false
      return !executedToday
    }

    // ---------- 每月任务 ----------
    if (config.type === 'monthly') {
      const daysOfMonth = config.days_of_month || []
      const currentDayOfMonth = nowDayjs.date() // 1-31
      if (!daysOfMonth.includes(currentDayOfMonth)) return false
      return !executedToday
    }
  }

  return false
}

// ============================================================
// 任务执行
// ============================================================

/**
 * 执行单个到期任务
 * 1. 调用 taskExecutor 执行动作
 * 2. 记录执行历史
 * 3. 更新 last_executed_at
 * 4. 一次性任务执行后自动禁用
 * 5. 推送执行结果到渲染进程
 * @param {object} task - 任务对象
 * @param {string} now - 当前时间 ISO 字符串
 */
async function executeTask (task, now) {
  logger.info('Scheduler', `任务到期，开始执行: [${task.name}]`)

  // 执行任务动作
  let result = 'success'
  let errorMessage = null
  try {
    const execResult = await taskExecutor.execute(task)
    if (!execResult.success) {
      result = 'failed'
      errorMessage = execResult.message
    }
  } catch (error) {
    result = 'failed'
    errorMessage = error.message
    logger.error('Scheduler', `任务 [${task.name}] 执行异常: ${error.message}`)
  }

  // 记录执行历史
  try {
    taskExecutionDao.record({
      task_id: task.id,
      executed_at: now,
      result,
      error_message: errorMessage
    })
  } catch (error) {
    logger.error('Scheduler', `任务 [${task.name}] 记录执行历史失败: ${error.message}`)
  }

  // 更新任务状态
  try {
    const updates = { last_executed_at: now }
    // 一次性任务执行后自动禁用
    if (task.task_type === 'one_shot') {
      updates.is_enabled = false
    }
    taskDao.update(task.id, updates)
  } catch (error) {
    logger.error('Scheduler', `任务 [${task.name}] 更新状态失败: ${error.message}`)
  }

  // 推送执行结果到渲染进程（用于实时刷新任务列表）
  notifyTaskExecuted(task.id, result, errorMessage)

  // 一次性任务执行后自动禁用，可能需要停止调度器
  syncRunningState()

  logger.info('Scheduler', `任务 [${task.name}] 执行完成，结果: ${result}`)
}

/**
 * 推送任务执行结果到渲染进程
 * @param {string} taskId - 任务 ID
 * @param {string} result - 执行结果（success/failed）
 * @param {string|null} errorMessage - 错误信息
 */
function notifyTaskExecuted (taskId, result, errorMessage) {
  try {
    const { getMainWindow } = require('./../main.js')
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task:executed', {
        task_id: taskId,
        result,
        error_message: errorMessage
      })
    }
  } catch (error) {
    // 推送失败不影响调度器运行
    logger.debug('Scheduler', `推送执行结果失败: ${error.message}`)
  }
}

// ============================================================
// 错过任务处理（启动时调用）
// 对于启动前已过期的一次性任务，标记为禁用（不补执行）
// ============================================================

/**
 * 处理启动前错过的一次性任务
 * 将已过期但未执行的一次性任务标记为禁用
 */
function handleMissedTasks () {
  try {
    const now = dateUtils.nowISO()
    const tasks = taskDao.findEnabledTasks()
    let missedCount = 0

    for (const task of tasks) {
      if (task.task_type === 'one_shot' && !task.last_executed_at) {
        const config = task.schedule_config
        if (config && config.due_time && dayjs(now).isAfter(dayjs(config.due_time))) {
          // 已过期的一次性任务，标记为禁用
          taskDao.update(task.id, { is_enabled: false })
          missedCount++
          logger.info('Scheduler', `错过的一次性任务已禁用: [${task.name}]`)
        }
      }
    }

    if (missedCount > 0) {
      logger.info('Scheduler', `共处理 ${missedCount} 个错过的一次性任务`)
    }
  } catch (error) {
    logger.error('Scheduler', `处理错过任务失败: ${error.message}`)
  }
}

/**
 * 同步调度器运行状态：有启用任务才启动，无则停止
 * 在任务 CRUD / toggle 后调用，避免无任务时空转
 */
function syncRunningState () {
  try {
    const tasks = taskDao.findEnabledTasks()
    if (tasks.length > 0 && !isRunning) {
      start()
    } else if (tasks.length === 0 && isRunning) {
      stop()
    }
  } catch (error) {
    logger.error('Scheduler', `syncRunningState 失败: ${error.message}`)
  }
}

module.exports = {
  start,
  stop,
  isSchedulerRunning,
  tick,
  handleMissedTasks,
  syncRunningState
}
