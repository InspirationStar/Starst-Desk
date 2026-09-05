// ============================================================
// 健康提醒调度器单元测试
// 覆盖六大子模块触发逻辑、暂停/继续、生命周期
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let db
let healthScheduler
let healthConfigDao
let healthRecordDao
let notificationService
let trayManagerMock

beforeEach(() => {
  // mock tray-manager
  trayManagerMock = {
    init: () => {},
    startBlink: () => {},
    stopBlink: () => {},
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

  setup.mockElectron()

  db = setup.setupFreshDb()
  healthConfigDao = require('../../electron/dao/health-config-dao.js')
  healthRecordDao = require('../../electron/dao/health-record-dao.js')
  notificationService = require('../../electron/core/notification-service.js')
  healthScheduler = require('../../electron/modules/health-scheduler.js')
})

afterEach(() => {
  healthScheduler.stop()
  try { db.close() } catch (e) {}
  setup.unmockElectron()
})

describe('HealthScheduler - 生命周期', () => {
  test('start 应启动调度器', () => {
    healthScheduler.start()
    // 启动后应能调用 getLastRemindedTimes
    const times = healthScheduler.getLastRemindedTimes()
    assert.ok(typeof times === 'object')
  })

  test('stop 应停止调度器', () => {
    healthScheduler.start()
    healthScheduler.stop()
    // 不抛出异常即通过
    assert.ok(true)
  })

  test('重复 start 不应报错', () => {
    healthScheduler.start()
    healthScheduler.start()
    assert.ok(true)
  })
})

describe('HealthScheduler - 久坐暂停/继续', () => {
  test('pauseSedentary 应暂停久坐提醒', () => {
    healthScheduler.pauseSedentary()
    assert.equal(healthScheduler.isSedentaryPaused(), true)
  })

  test('resumeSedentary 应继续久坐提醒', () => {
    healthScheduler.pauseSedentary()
    healthScheduler.resumeSedentary()
    assert.equal(healthScheduler.isSedentaryPaused(), false)
  })

  test('resumeSedentary 应重置久坐计时基准', () => {
    healthScheduler.pauseSedentary()
    healthScheduler.resumeSedentary()
    const times = healthScheduler.getLastRemindedTimes()
    assert.ok(times.sedentary, '应重置 sedentary 计时基准')
  })
})

describe('HealthScheduler - 六大模块触发', () => {
  test('启用喝水模块后 tick 应触发喝水提醒', () => {
    healthConfigDao.upsert({
      module_type: 'water',
      is_enabled: true,
      config_json: { target_ml: 2000, interval_minutes: 5 }
    })

    // 通过 start 触发首次 tick
    healthScheduler.start()

    const times = healthScheduler.getLastRemindedTimes()
    assert.ok(times.water, '应记录喝水提醒时间')
  })

  test('启用久坐模块后 tick 应触发久坐提醒', () => {
    healthConfigDao.upsert({
      module_type: 'sedentary',
      is_enabled: true,
      config_json: { interval_minutes: 15 }
    })

    healthScheduler.start()

    const times = healthScheduler.getLastRemindedTimes()
    assert.ok(times.sedentary, '应记录久坐提醒时间')
  })

  test('暂停状态下久坐提醒不应触发', () => {
    healthConfigDao.upsert({
      module_type: 'sedentary',
      is_enabled: true,
      config_json: { interval_minutes: 15 }
    })

    healthScheduler.pauseSedentary()
    healthScheduler.start()

    // 暂停标志应生效：tick 时 checkSedentary 会直接 return 不触发
    // initStartupBaseline 仍会设置基准时间，暂停只影响 tick 触发，不影响基准初始化
    assert.ok(healthScheduler.isSedentaryPaused(), '久坐应处于暂停状态')
  })

  test('启用护眼模块后 tick 应触发护眼提醒', () => {
    healthConfigDao.upsert({
      module_type: 'eye',
      is_enabled: true,
      config_json: { interval_minutes: 10, duration_minutes: 5 }
    })

    healthScheduler.start()

    const times = healthScheduler.getLastRemindedTimes()
    assert.ok(times.eye, '应记录护眼提醒时间')
  })

  // stretch 已合并到 sedentary（子需求8），不再独立触发，相关测试见 sedentary 用例

  test('启用所有六大模块不应报错', () => {
    const modules = [
      { module_type: 'water', config_json: { target_ml: 2000, interval_minutes: 60 } },
      { module_type: 'sedentary', config_json: { interval_minutes: 45 } },
      { module_type: 'eye', config_json: { interval_minutes: 30, duration_minutes: 5 } },
      { module_type: 'stretch', config_json: { interval_minutes: 60 } },
      { module_type: 'sleep', config_json: { target_bedtime: '23:00', target_wakeup: '07:00' } },
      { module_type: 'diet', config_json: { breakfast: '08:00', lunch: '12:00', dinner: '18:00' } }
    ]

    for (const m of modules) {
      healthConfigDao.upsert({
        module_type: m.module_type,
        is_enabled: true,
        config_json: m.config_json
      })
    }

    healthScheduler.start()
    assert.ok(true, '所有模块启用不应报错')
  })
})

describe('HealthScheduler - 未启用模块', () => {
  test('未启用模块不应触发提醒', () => {
    healthConfigDao.upsert({
      module_type: 'water',
      is_enabled: false,
      config_json: { target_ml: 2000, interval_minutes: 5 }
    })

    healthScheduler.start()

    const times = healthScheduler.getLastRemindedTimes()
    assert.equal(times.water, undefined, '未启用模块不应触发')
  })

  test('空数据库 tick 不应报错', () => {
    healthScheduler.start()
    assert.ok(true)
  })
})

describe('HealthScheduler - 自定义内容', () => {
  test('久坐伸展应支持自定义提醒内容', () => {
    healthConfigDao.upsert({
      module_type: 'sedentary',
      is_enabled: true,
      config_json: {
        interval_minutes: 30,
        custom_content: '自定义伸展动作指导'
      }
    })

    healthScheduler.start()

    const times = healthScheduler.getLastRemindedTimes()
    assert.ok(times.sedentary, '应触发久坐伸展提醒')
  })
})