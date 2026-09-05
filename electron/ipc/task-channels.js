// ============================================================
// 定时任务模块 IPC 通道
// 注册 task:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const taskDao = require('./../dao/task-dao.js')
const taskExecutionDao = require('./../dao/task-execution-dao.js')
const appSettingDao = require('./../dao/app-setting-dao.js')
const validators = require('./../utils/validators.js')
const logger = require('./../core/logger.js')
const scheduler = require('./../core/scheduler.js')

// ============================================================
// task:create
// 创建任务，exec_command 动作需已确认风险
// ============================================================
register('task:create', async (event, data) => {
  try {
    if (!validators.isValidTaskType(data.task_type)) {
      return failure('TASK_TYPE_INVALID', '任务类型不合法')
    }
    if (!validators.isValidActionType(data.action_type)) {
      return failure('TASK_ACTION_INVALID', '动作类型不合法')
    }

    // exec_command 动作需要风险确认
    if (data.action_type === 'exec_command') {
      const confirmed = appSettingDao.getBool('task_command_confirmed', false)
      if (!confirmed) {
        return failure('TASK_CMD_NOT_CONFIRMED', '命令执行需先确认风险')
      }
    }

    const task = taskDao.create(data)
    scheduler.syncRunningState()
    return success(task)
  } catch (error) {
    logger.error('TaskChannels', `task:create 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// task:list
// ============================================================
register('task:list', async (event, data) => {
  try {
    const result = taskDao.list(data)
    return success(result)
  } catch (error) {
    logger.error('TaskChannels', `task:list 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// task:get
// ============================================================
register('task:get', async (event, data) => {
  try {
    const task = taskDao.getById(data.id)
    if (!task) {
      return failure('TASK_NOT_FOUND', '任务不存在')
    }
    return success(task)
  } catch (error) {
    logger.error('TaskChannels', `task:get 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// task:update
// ============================================================
register('task:update', async (event, data) => {
  try {
    if (!data.id) {
      return failure('TASK_ID_REQUIRED', '任务 ID 不能为空')
    }
    const task = taskDao.update(data.id, data)
    if (!task) {
      return failure('TASK_NOT_FOUND', '任务不存在')
    }
    scheduler.syncRunningState()
    return success(task)
  } catch (error) {
    logger.error('TaskChannels', `task:update 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// task:delete
// ============================================================
register('task:delete', async (event, data) => {
  try {
    if (!data.id) {
      return failure('TASK_ID_REQUIRED', '任务 ID 不能为空')
    }
    const result = taskDao.del(data.id)
    scheduler.syncRunningState()
    return success({ deleted: result })
  } catch (error) {
    logger.error('TaskChannels', `task:delete 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// task:toggle
// 切换任务启用/禁用状态
// ============================================================
register('task:toggle', async (event, data) => {
  try {
    if (!data.id) {
      return failure('TASK_ID_REQUIRED', '任务 ID 不能为空')
    }
    const task = taskDao.toggle(data.id, data.enabled !== false)
    scheduler.syncRunningState()
    return success(task)
  } catch (error) {
    logger.error('TaskChannels', `task:toggle 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// task:history
// 查询任务执行历史
// ============================================================
register('task:history', async (event, data) => {
  try {
    if (!data.task_id) {
      return failure('TASK_ID_REQUIRED', '任务 ID 不能为空')
    }
    const result = taskExecutionDao.findByTaskId(data.task_id, data)
    return success(result)
  } catch (error) {
    logger.error('TaskChannels', `task:history 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// task:confirm-command
// 确认命令执行风险
// ============================================================
register('task:confirm-command', async (event, data) => {
  try {
    appSettingDao.set('task_command_confirmed', 'true')
    return success({ confirmed: true })
  } catch (error) {
    logger.error('TaskChannels', `task:confirm-command 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}
