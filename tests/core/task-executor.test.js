// ============================================================
// 任务执行器单元测试
// 覆盖五种动作类型：message / open_app / exec_command / open_url / shutdown
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let electronMock
let taskExecutor

beforeEach(() => {
  // mock Electron（shell.openExternal 等）
  electronMock = setup.mockElectron({
    openExternal: async (url) => { /* mock：不打开真实浏览器 */ }
  })

  // mock tray-manager
  const trayManagerPath = require.resolve('../../electron/core/tray-manager.js')
  require.cache[trayManagerPath] = {
    id: trayManagerPath,
    filename: trayManagerPath,
    loaded: true,
    exports: {
      init: () => {},
      startBlink: () => {},
      stopBlink: () => {},
      destroy: () => {}
    }
  }

  // mock main.js
  const mainPath = require.resolve('../../electron/main.js')
  require.cache[mainPath] = {
    id: mainPath,
    filename: mainPath,
    loaded: true,
    exports: { getMainWindow: () => null }
  }

  // 清除 task-executor 缓存以应用 mock
  delete require.cache[require.resolve('../../electron/core/task-executor.js')]
  delete require.cache[require.resolve('../../electron/core/notification-service.js')]
  taskExecutor = require('../../electron/core/task-executor.js')
})

afterEach(() => {
  setup.unmockElectron()
})

describe('TaskExecutor - message 动作', () => {
  test('应成功执行 message 动作', async () => {
    const task = {
      id: 'task-1',
      name: '消息任务',
      action_type: 'message',
      action_payload: { title: '提醒标题', content: '提醒内容' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, true)
    assert.ok(result.message)
  })

  test('message 内容为空应返回失败', async () => {
    const task = {
      id: 'task-2',
      name: '空消息',
      action_type: 'message',
      action_payload: { title: '标题', content: '' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
    assert.match(result.message, /内容为空/)
  })

  test('message 缺省 title 应使用任务名作为标题', async () => {
    const task = {
      id: 'task-3',
      name: '默认标题任务',
      action_type: 'message',
      action_payload: { content: '内容' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, true)
  })

  test('message 使用 message 字段作为内容（兼容）', async () => {
    const task = {
      id: 'task-4',
      name: '兼容测试',
      action_type: 'message',
      action_payload: { message: '使用 message 字段' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, true)
  })
})

describe('TaskExecutor - open_url 动作', () => {
  test('应成功打开合法 URL', async () => {
    const task = {
      id: 'task-5',
      name: '打开网址',
      action_type: 'open_url',
      action_payload: { url: 'https://www.example.com' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, true)
    assert.match(result.message, /已打开网址/)
  })

  test('URL 为空应返回失败', async () => {
    const task = {
      id: 'task-6',
      name: '空 URL',
      action_type: 'open_url',
      action_payload: { url: '' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
    assert.match(result.message, /网址为空/)
  })

  test('非法 URL 格式应返回失败', async () => {
    const task = {
      id: 'task-7',
      name: '非法 URL',
      action_type: 'open_url',
      action_payload: { url: 'not-a-url' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
    assert.match(result.message, /URL 格式非法/)
  })

  test('ftp 协议 URL 应返回失败（仅允许 http/https）', async () => {
    const task = {
      id: 'task-8',
      name: 'FTP URL',
      action_type: 'open_url',
      action_payload: { url: 'ftp://files.example.com' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
  })
})

describe('TaskExecutor - exec_command 动作', () => {
  test('应成功执行简单命令', async () => {
    const task = {
      id: 'task-9',
      name: '执行命令',
      action_type: 'exec_command',
      action_payload: { command: 'echo hello' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, true)
    assert.match(result.message, /成功/)
  })

  test('命令为空应返回失败', async () => {
    const task = {
      id: 'task-10',
      name: '空命令',
      action_type: 'exec_command',
      action_payload: { command: '' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
    assert.match(result.message, /命令内容为空/)
  })

  test('使用 cmd 字段（兼容）', async () => {
    const task = {
      id: 'task-11',
      name: '兼容字段',
      action_type: 'exec_command',
      action_payload: { cmd: 'echo world' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, true)
  })

  test('执行不存在的命令应返回失败', async () => {
    const task = {
      id: 'task-12',
      name: '不存在命令',
      action_type: 'exec_command',
      action_payload: { command: 'this-command-does-not-exist-xyz' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
  })
})

describe('TaskExecutor - open_app 动作', () => {
  test('应用路径为空应返回失败', async () => {
    const task = {
      id: 'task-13',
      name: '空路径',
      action_type: 'open_app',
      action_payload: { path: '' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
    assert.match(result.message, /路径为空/)
  })

  test('应用路径不存在应返回失败', async () => {
    const task = {
      id: 'task-14',
      name: '不存在应用',
      action_type: 'open_app',
      action_payload: { path: 'C:/non/existent/app.exe' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
    assert.match(result.message, /路径不存在/)
  })

  test('应使用 app_path 字段（兼容）', async () => {
    const task = {
      id: 'task-15',
      name: '兼容字段',
      action_type: 'open_app',
      action_payload: { app_path: 'C:/non/existent/app.exe' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
    assert.match(result.message, /路径不存在/)
  })
})

describe('TaskExecutor - 错误处理', () => {
  test('未知动作类型应返回失败', async () => {
    const task = {
      id: 'task-16',
      name: '未知动作',
      action_type: 'unknown_action',
      action_payload: { foo: 'bar' }
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
    assert.match(result.message, /未知的动作类型/)
  })

  test('动作参数为空应返回失败', async () => {
    const task = {
      id: 'task-17',
      name: '空参数',
      action_type: 'message',
      action_payload: null
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
    assert.match(result.message, /参数为空/)
  })

  test('动作参数非对象应返回失败', async () => {
    const task = {
      id: 'task-18',
      name: '非对象参数',
      action_type: 'message',
      action_payload: 'invalid'
    }
    const result = await taskExecutor.execute(task)
    assert.equal(result.success, false)
  })
})