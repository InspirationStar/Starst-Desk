// ============================================================
// 通知服务单元测试
// 覆盖三重通知、去重机制、清除通知
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let electronMock
let notificationService
let trayManagerMock

beforeEach(() => {
  // mock tray-manager（记录闪烁调用）
  trayManagerMock = {
    init: () => {},
    startBlinkCalls: 0,
    stopBlinkCalls: 0,
    startBlink: function () { this.startBlinkCalls++ },
    stopBlink: function () { this.stopBlinkCalls++ },
    destroy: () => {}
  }
  const trayManagerPath = require.resolve('../../electron/core/tray-manager.js')
  require.cache[trayManagerPath] = {
    id: trayManagerPath,
    filename: trayManagerPath,
    loaded: true,
    exports: trayManagerMock
  }

  // mock main.js
  const mainPath = require.resolve('../../electron/main.js')
  require.cache[mainPath] = {
    id: mainPath,
    filename: mainPath,
    loaded: true,
    exports: { getMainWindow: () => null }
  }

  electronMock = setup.mockElectron()
  delete require.cache[require.resolve('../../electron/core/notification-service.js')]
  notificationService = require('../../electron/core/notification-service.js')
})

afterEach(() => {
  notificationService.clearNotification()
  setup.unmockElectron()
})

describe('NotificationService - notify', () => {
  test('应成功触发三重通知', () => {
    notificationService.notify('task', '测试标题', '测试内容')

    // 系统通知已通过 mock Notification.show() 触发
    // 托盘闪烁应被调用
    assert.equal(trayManagerMock.startBlinkCalls, 1, '应触发托盘闪烁')
    // 应用内通知因主窗口不可用被跳过（mock 返回 null）
  })

  test('应支持四种通知类型', () => {
    const types = ['note', 'task', 'health', 'ai']
    for (const type of types) {
      notificationService.notify(type, '标题', '内容')
    }
    assert.equal(trayManagerMock.startBlinkCalls, 4)
  })

  test('空标题和内容不应导致异常', () => {
    notificationService.notify('task', '', '')
    assert.ok(true, '不应抛出异常')
  })
})

describe('NotificationService - 去重机制', () => {
  test('相同 source.id 在 1 分钟内不应重复触发', () => {
    const source = { module: 'task', id: 'task-001' }

    notificationService.notify('task', '第一次', '内容', { source })
    notificationService.notify('task', '第二次', '内容', { source })

    // 第二次应被去重，托盘闪烁只应触发一次
    assert.equal(trayManagerMock.startBlinkCalls, 1, '相同 source 应去重')
  })

  test('不同 source.id 应分别触发', () => {
    notificationService.notify('task', 'A', '内容', { source: { module: 'task', id: 'task-A' } })
    notificationService.notify('task', 'B', '内容', { source: { module: 'task', id: 'task-B' } })

    assert.equal(trayManagerMock.startBlinkCalls, 2, '不同 source 不应去重')
  })

  test('不同 module 相同 id 应分别触发', () => {
    notificationService.notify('task', 'A', '内容', { source: { module: 'task', id: 'X' } })
    notificationService.notify('health', 'B', '内容', { source: { module: 'health', id: 'X' } })

    assert.equal(trayManagerMock.startBlinkCalls, 2)
  })

  test('无 source 不应去重', () => {
    notificationService.notify('task', 'A', '内容')
    notificationService.notify('task', 'B', '内容')

    assert.equal(trayManagerMock.startBlinkCalls, 2)
  })
})

describe('NotificationService - clearNotification', () => {
  test('clearNotification 应清除所有去重记录', () => {
    const source = { module: 'task', id: 'task-clear' }

    notificationService.notify('task', '第一次', '内容', { source })
    notificationService.clearNotification()
    notificationService.notify('task', '第二次', '内容', { source })

    // 清除后第二次应能触发
    assert.equal(trayManagerMock.startBlinkCalls, 2)
  })

  test('clearNotification 指定 sourceId 应只清除匹配的记录', () => {
    const s1 = { module: 'task', id: 'task-keep' }
    const s2 = { module: 'task', id: 'task-remove' }

    notificationService.notify('task', 'A', '内容', { source: s1 })
    notificationService.notify('task', 'B', '内容', { source: s2 })

    // 清除 s2 的记录
    notificationService.clearNotification('task-remove')

    // s1 应仍被去重
    notificationService.notify('task', 'A2', '内容', { source: s1 })
    // s2 应能再次触发
    notificationService.notify('task', 'B2', '内容', { source: s2 })

    // 初始 2 次 + s2 重新触发 1 次 = 3 次（s1 被去重）
    assert.equal(trayManagerMock.startBlinkCalls, 3)
  })
})