// ============================================================
// 任务动作执行器
// 负责分发执行四种任务动作：message / open_app / exec_command / open_url
// 每种动作返回统一格式 { success: boolean, message: string }
// 捕获执行错误并记录日志，不向外抛出异常
// ============================================================

const { shell } = require('electron')
const { exec, execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const logger = require('./logger.js')
const notificationService = require('./notification-service.js')
const validators = require('./../utils/validators.js')

// 命令执行超时时间（毫秒）
const COMMAND_TIMEOUT_MS = 60 * 1000

// ============================================================
// 主入口
// ============================================================

/**
 * 执行任务动作
 * @param {object} task - 任务对象，包含 action_type 和 action_payload
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function execute (task) {
  const { action_type: actionType, action_payload: payload } = task

  logger.info('TaskExecutor', `开始执行任务 [${task.name}] 动作类型: ${actionType}`)

  if (!payload || typeof payload !== 'object') {
    return { success: false, message: '动作参数为空' }
  }

  try {
    switch (actionType) {
      case 'message':
        return await executeMessage(task, payload)
      case 'open_app':
        return await executeOpenApp(task, payload)
      case 'exec_command':
        return await executeCommand(task, payload)
      case 'open_url':
        return await executeOpenUrl(task, payload)
      case 'shutdown':
        return await executeShutdown(task, payload)
      default:
        return { success: false, message: `未知的动作类型: ${actionType}` }
    }
  } catch (error) {
    logger.error('TaskExecutor', `任务 [${task.name}] 执行异常: ${error.message}`)
    return { success: false, message: error.message }
  }
}

// ============================================================
// 动作一：显示消息提醒
// 调用 notification-service 触发三重通知（系统通知 + 托盘闪烁 + 应用内弹窗）
// ============================================================
async function executeMessage (task, payload) {
  const title = payload.title || task.name || '定时任务提醒'
  const content = payload.content || payload.message || ''

  if (!content) {
    return { success: false, message: '消息内容为空' }
  }

  notificationService.notify('task', title, content, {
    source: { module: 'task', id: task.id }
  })

  logger.info('TaskExecutor', `任务 [${task.name}] 消息提醒已触发`)
  return { success: true, message: '消息提醒已发送' }
}

// ============================================================
// 动作二：打开应用程序
// 校验路径存在性，使用 child_process.execFile 启动
// ============================================================
async function executeOpenApp (task, payload) {
  const appPath = payload.path || payload.app_path
  const args = payload.args || []

  if (!appPath) {
    return { success: false, message: '应用程序路径为空' }
  }

  // 校验路径存在性
  if (!validators.isFileExistsSync(appPath)) {
    logger.warn('TaskExecutor', `任务 [${task.name}] 应用路径不存在: ${appPath}`)
    return { success: false, message: `应用程序路径不存在: ${appPath}` }
  }

  return new Promise((resolve) => {
    // 使用 execFile 启动应用程序，避免 shell 注入风险
    const child = execFile(appPath, Array.isArray(args) ? args : [], {
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: false,
      detached: true
    }, (error, stdout, stderr) => {
      if (error) {
        logger.error('TaskExecutor', `任务 [${task.name}] 启动应用失败: ${error.message}`)
        resolve({ success: false, message: `启动应用失败: ${error.message}` })
        return
      }
      logger.info('TaskExecutor', `任务 [${task.name}] 应用已启动: ${appPath}`)
      resolve({ success: true, message: `应用程序已启动: ${path.basename(appPath)}` })
    })

    // detached 进程独立于父进程，可立即 unref
    if (child) {
      child.unref()
    }
  })
}

// ============================================================
// 动作三：执行系统命令
// 使用 child_process.exec 执行，设置 60 秒超时，捕获退出码
// 注意：此动作需经用户风险确认后方可执行
// ============================================================
async function executeCommand (task, payload) {
  const command = payload.command || payload.cmd

  if (!command) {
    return { success: false, message: '命令内容为空' }
  }

  logger.info('TaskExecutor', `任务 [${task.name}] 执行命令: ${command}`)

  return new Promise((resolve) => {
    exec(command, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 // 1MB 输出缓冲区
    }, (error, stdout, stderr) => {
      if (error) {
        // 非零退出码或执行失败
        const errMsg = `命令执行失败（退出码 ${error.code || 'N/A'}）: ${error.message}`
        logger.error('TaskExecutor', `任务 [${task.name}] ${errMsg}`)
        resolve({ success: false, message: errMsg })
        return
      }

      // 命令执行成功
      const output = (stdout || '').trim()
      const summary = output ? `命令执行成功，输出: ${output.slice(0, 200)}` : '命令执行成功'
      logger.info('TaskExecutor', `任务 [${task.name}] ${summary}`)
      resolve({ success: true, message: summary })
    })
  })
}

// ============================================================
// 动作四：打开网址
// 校验 URL 格式，使用 shell.openExternal 打开默认浏览器
// ============================================================
async function executeOpenUrl (task, payload) {
  const url = payload.url

  if (!url) {
    return { success: false, message: '网址为空' }
  }

  // 校验 URL 格式
  if (!validators.isUrl(url)) {
    logger.warn('TaskExecutor', `任务 [${task.name}] URL 格式非法: ${url}`)
    return { success: false, message: `URL 格式非法: ${url}` }
  }

  try {
    await shell.openExternal(url)
    logger.info('TaskExecutor', `任务 [${task.name}] 已打开网址: ${url}`)
    return { success: true, message: `已打开网址: ${url}` }
  } catch (error) {
    logger.error('TaskExecutor', `任务 [${task.name}] 打开网址失败: ${error.message}`)
    return { success: false, message: `打开网址失败: ${error.message}` }
  }
}

// ============================================================
// 动作五：关机
// 调用 Windows shutdown 命令，默认 30 秒延迟以便用户取消
// 用户可通过 shutdown /a 取消关机
// ============================================================
async function executeShutdown (task, payload) {
  const delay = typeof payload.delay === 'number' ? payload.delay : 30

  logger.info('TaskExecutor', `任务 [${task.name}] 将在 ${delay} 秒后关机`)

  // 先发送通知提醒用户
  notificationService.notify('task', '定时关机提醒', `计算机将在 ${delay} 秒后关机，如需取消请执行 shutdown /a`, {
    source: { module: 'task', id: task.id }
  })

  return new Promise((resolve) => {
    exec(`shutdown /s /t ${delay}`, {
      timeout: COMMAND_TIMEOUT_MS
    }, (error) => {
      if (error) {
        logger.error('TaskExecutor', `任务 [${task.name}] 关机命令执行失败: ${error.message}`)
        resolve({ success: false, message: `关机命令执行失败: ${error.message}` })
        return
      }
      logger.info('TaskExecutor', `任务 [${task.name}] 关机命令已发送，${delay} 秒后关机`)
      resolve({ success: true, message: `关机命令已发送，${delay} 秒后关机` })
    })
  })
}

module.exports = {
  execute
}
