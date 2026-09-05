// ============================================================
// JumpList 服务（主进程）
// 职责：设置 Windows 任务栏跳转列表
// 使用 Electron app.setUserTasks API（仅 Windows）
// ============================================================

const { app } = require('electron')
const path = require('path')
const logger = require('./logger.js')

/**
 * 设置任务栏跳转列表
 * 提供：新建便签、新建待办、打开设置、查看活动统计
 * 仅 Windows 平台有效
 */
function setupJumpList () {
  if (process.platform !== 'win32') {
    logger.info('JumpList', '非 Windows 平台，跳过 JumpList 设置')
    return
  }

  try {
    // Electron setUserTasks API
    // 每个任务包含：program, arguments, title, description, iconPath, iconIndex
    const executablePath = app.getPath('exe')
    const iconPath = executablePath // 使用应用图标

    const tasks = [
      {
        program: executablePath,
        arguments: '--open-notes',
        title: '便签提醒',
        description: '打开便签提醒页面',
        iconPath,
        iconIndex: 0
      },
      {
        program: executablePath,
        arguments: '--open-todo',
        title: '待办&规划',
        description: '打开待办列表',
        iconPath,
        iconIndex: 0
      },
      {
        program: executablePath,
        arguments: '--open-tasks',
        title: '定时任务',
        description: '打开定时任务',
        iconPath,
        iconIndex: 0
      },
      {
        program: executablePath,
        arguments: '--open-settings',
        title: '应用设置',
        description: '打开应用设置',
        iconPath,
        iconIndex: 0
      },
      {
        program: executablePath,
        arguments: '--open-activity',
        title: '活动统计',
        description: '查看活动统计',
        iconPath,
        iconIndex: 0
      }
    ]

    app.setUserTasks(tasks)
    logger.info('JumpList', `已设置 ${tasks.length} 个跳转列表项`)
  } catch (error) {
    logger.warn('JumpList', `设置 JumpList 失败: ${error.message}`)
  }
}

/**
 * 解析启动参数，返回要打开的页面路径
 * @param {string[]} argv
 * @returns {string|null}
 */
function parseJumpListArgs (argv) {
  if (!argv || !Array.isArray(argv)) return null
  for (const arg of argv) {
    switch (arg) {
      case '--open-notes': return '/notes'
      case '--open-todo': return '/todo'
      case '--open-tasks': return '/tasks'
      case '--open-settings': return '/settings'
      case '--open-activity': return '/activity/stats'
      default: break
    }
  }
  return null
}

module.exports = {
  setupJumpList,
  parseJumpListArgs
}