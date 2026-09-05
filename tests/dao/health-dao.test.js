// ============================================================
// 健康配置/记录 DAO 单元测试
// 覆盖 health_configs 和 health_records 两张表
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let db
let healthConfigDao
let healthRecordDao

beforeEach(() => {
  db = setup.setupFreshDb()
  healthConfigDao = require('../../electron/dao/health-config-dao.js')
  healthRecordDao = require('../../electron/dao/health-record-dao.js')
})

afterEach(() => {
  try { db.close() } catch (e) {}
})

// ============================================================
// 健康配置 DAO
// ============================================================

describe('HealthConfigDao - UPSERT 配置', () => {
  test('应成功创建喝水配置', () => {
    const config = healthConfigDao.upsert({
      module_type: 'water',
      is_enabled: true,
      config_json: { target_ml: 2000, interval_minutes: 60 }
    })
    assert.ok(config.id)
    assert.equal(config.module_type, 'water')
    assert.equal(config.is_enabled, 1)
    assert.deepEqual(config.config_json, { target_ml: 2000, interval_minutes: 60 })
  })

  test('应支持六大模块类型', () => {
    const modules = ['water', 'sedentary', 'eye', 'stretch', 'sleep', 'diet']
    for (const m of modules) {
      const config = healthConfigDao.upsert({
        module_type: m,
        is_enabled: false,
        config_json: { test: true }
      })
      assert.equal(config.module_type, m)
    }
  })

  test('UPSERT 相同 module_type 应更新而非插入', () => {
    healthConfigDao.upsert({
      module_type: 'water',
      is_enabled: false,
      config_json: { target_ml: 1000 }
    })
    const updated = healthConfigDao.upsert({
      module_type: 'water',
      is_enabled: true,
      config_json: { target_ml: 2000 }
    })
    assert.equal(updated.is_enabled, 1)
    assert.deepEqual(updated.config_json, { target_ml: 2000 })

    // 应只有一条 water 记录
    const all = healthConfigDao.findAll()
    const waterConfigs = all.filter(c => c.module_type === 'water')
    assert.equal(waterConfigs.length, 1)
  })
})

describe('HealthConfigDao - 查询配置', () => {
  test('getByModuleType 应返回反序列化的配置', () => {
    healthConfigDao.upsert({
      module_type: 'eye',
      is_enabled: true,
      config_json: { interval_minutes: 30, duration_minutes: 5 }
    })
    const config = healthConfigDao.getByModuleType('eye')
    assert.deepEqual(config.config_json, { interval_minutes: 30, duration_minutes: 5 })
  })

  test('getByModuleType 不存在的模块应返回 null', () => {
    assert.equal(healthConfigDao.getByModuleType('water'), null)
  })

  test('findAll 应返回所有配置', () => {
    healthConfigDao.upsert({ module_type: 'water', is_enabled: true, config_json: {} })
    healthConfigDao.upsert({ module_type: 'eye', is_enabled: false, config_json: {} })
    const all = healthConfigDao.findAll()
    assert.equal(all.length, 2)
  })

  test('findAllEnabled 应只返回启用的配置', () => {
    healthConfigDao.upsert({ module_type: 'water', is_enabled: true, config_json: {} })
    healthConfigDao.upsert({ module_type: 'eye', is_enabled: false, config_json: {} })
    healthConfigDao.upsert({ module_type: 'stretch', is_enabled: true, config_json: {} })
    const enabled = healthConfigDao.findAllEnabled()
    assert.equal(enabled.length, 2)
    const modules = enabled.map(c => c.module_type).sort()
    assert.deepEqual(modules, ['stretch', 'water'])
  })
})

describe('HealthConfigDao - 更新配置', () => {
  test('应更新启用状态', () => {
    healthConfigDao.upsert({ module_type: 'water', is_enabled: false, config_json: {} })
    const updated = healthConfigDao.update('water', { is_enabled: true })
    assert.equal(updated.is_enabled, 1)
  })

  test('应更新配置 JSON', () => {
    healthConfigDao.upsert({
      module_type: 'water',
      is_enabled: true,
      config_json: { target_ml: 1000 }
    })
    const updated = healthConfigDao.update('water', {
      config_json: { target_ml: 3000, interval_minutes: 30 }
    })
    assert.deepEqual(updated.config_json, { target_ml: 3000, interval_minutes: 30 })
  })

  test('空更新数据应返回原配置', () => {
    healthConfigDao.upsert({
      module_type: 'water',
      is_enabled: true,
      config_json: { target_ml: 2000 }
    })
    const updated = healthConfigDao.update('water', {})
    assert.deepEqual(updated.config_json, { target_ml: 2000 })
  })
})

// ============================================================
// 健康记录 DAO
// ============================================================

describe('HealthRecordDao - 记录写入', () => {
  test('应成功写入喝水记录', () => {
    const rec = healthRecordDao.record({
      module_type: 'water',
      record_date: '2026-08-23',
      record_time: '2026-08-23 10:00:00',
      value: 250
    })
    assert.ok(rec.id)
    assert.equal(rec.module_type, 'water')
    assert.equal(rec.value, 250)
  })

  test('应支持写入带 content 的记录', () => {
    const rec = healthRecordDao.record({
      module_type: 'diet',
      record_date: '2026-08-23',
      record_time: '2026-08-23 12:00:00',
      content: '午餐：米饭+青菜'
    })
    assert.equal(rec.content, '午餐：米饭+青菜')
  })

  test('应支持 value 为空（如久坐提醒）', () => {
    const rec = healthRecordDao.record({
      module_type: 'sedentary',
      record_date: '2026-08-23',
      record_time: '2026-08-23 14:00:00'
    })
    assert.equal(rec.value, null)
  })
})

describe('HealthRecordDao - 查询记录', () => {
  test('getById 应返回记录', () => {
    const rec = healthRecordDao.record({
      module_type: 'water',
      record_date: '2026-08-23',
      record_time: '2026-08-23 10:00:00',
      value: 200
    })
    const found = healthRecordDao.getById(rec.id)
    assert.equal(found.value, 200)
  })

  test('getById 不存在的 ID 应返回 null', () => {
    assert.equal(healthRecordDao.getById('non-existent'), null)
  })

  test('findByDateRange 应返回指定日期范围内的记录', () => {
    healthRecordDao.record({
      module_type: 'water',
      record_date: '2026-08-20',
      record_time: '2026-08-20 10:00:00',
      value: 200
    })
    healthRecordDao.record({
      module_type: 'water',
      record_date: '2026-08-22',
      record_time: '2026-08-22 10:00:00',
      value: 300
    })
    healthRecordDao.record({
      module_type: 'water',
      record_date: '2026-08-25',
      record_time: '2026-08-25 10:00:00',
      value: 400
    })

    const result = healthRecordDao.findByDateRange('water', '2026-08-21', '2026-08-23')
    assert.equal(result.total, 1)
    assert.equal(result.list[0].value, 300)
  })

  test('findByDateRange 应按模块类型过滤', () => {
    healthRecordDao.record({
      module_type: 'water',
      record_date: '2026-08-23',
      record_time: '2026-08-23 10:00:00',
      value: 200
    })
    healthRecordDao.record({
      module_type: 'eye',
      record_date: '2026-08-23',
      record_time: '2026-08-23 11:00:00'
    })

    const waterResult = healthRecordDao.findByDateRange('water', '2026-08-23', '2026-08-23')
    assert.equal(waterResult.total, 1)
    assert.equal(waterResult.list[0].module_type, 'water')
  })
})

describe('HealthRecordDao - 统计查询', () => {
  beforeEach(() => {
    // 写入多条喝水记录用于统计
    healthRecordDao.record({
      module_type: 'water',
      record_date: '2026-08-23',
      record_time: '2026-08-23 09:00:00',
      value: 200
    })
    healthRecordDao.record({
      module_type: 'water',
      record_date: '2026-08-23',
      record_time: '2026-08-23 12:00:00',
      value: 300
    })
    healthRecordDao.record({
      module_type: 'water',
      record_date: '2026-08-24',
      record_time: '2026-08-24 09:00:00',
      value: 500
    })
  })

  test('todayTotal 应返回当日累计值', () => {
    const total = healthRecordDao.todayTotal('water', '2026-08-23')
    assert.equal(total, 500)
  })

  test('todayTotal 无记录应返回 0', () => {
    const total = healthRecordDao.todayTotal('water', '2026-08-30')
    assert.equal(total, 0)
  })

  test('getStats 应按日聚合统计', () => {
    const stats = healthRecordDao.getStats('water', '2026-08-23', '2026-08-24', 'day')
    assert.equal(stats.length, 2)
    // 第一天 500，第二天 500
    const day1 = stats.find(s => s.period === '2026-08-23')
    const day2 = stats.find(s => s.period === '2026-08-24')
    assert.equal(day1.sum_value, 500)
    assert.equal(day2.sum_value, 500)
  })

  test('getStats 应按月聚合统计', () => {
    const stats = healthRecordDao.getStats('water', '2026-08-23', '2026-08-24', 'month')
    assert.equal(stats.length, 1)
    assert.equal(stats[0].period, '2026-08')
    assert.equal(stats[0].sum_value, 1000)
  })
})