// ============================================================
// 健康提醒模块 IPC 通道
// 注册 health:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const healthConfigDao = require('./../dao/health-config-dao.js')
const healthRecordDao = require('./../dao/health-record-dao.js')
const validators = require('./../utils/validators.js')
const logger = require('./../core/logger.js')
const dayjs = require('dayjs')
const healthScheduler = require('./../modules/health-scheduler.js')

// ============================================================
// health:get-config
// 获取指定模块的健康配置
// ============================================================
register('health:get-config', async (event, data) => {
  try {
    if (!data.module_type) {
      return failure('MODULE_TYPE_REQUIRED', '模块类型不能为空')
    }
    if (!validators.isValidModuleType(data.module_type)) {
      return failure('MODULE_TYPE_INVALID', '模块类型不合法')
    }
    const config = healthConfigDao.getByModuleType(data.module_type)
    return success(config || {})
  } catch (error) {
    logger.error('HealthChannels', `health:get-config 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:update-config
// 更新健康配置，校验字段范围
// ============================================================
register('health:update-config', async (event, data) => {
  try {
    if (!data.module_type) {
      return failure('MODULE_TYPE_REQUIRED', '模块类型不能为空')
    }
    if (!validators.isValidModuleType(data.module_type)) {
      return failure('MODULE_TYPE_INVALID', '模块类型不合法')
    }

    // 校验配置范围
    const validation = validators.validateHealthConfig(data.module_type, data.config)
    if (!validation.valid) {
      return failure(validation.error || 'HEALTH_CONFIG_INVALID', validation.message || '配置参数不合法')
    }

    const config = healthConfigDao.upsert({
      module_type: data.module_type,
      is_enabled: data.is_enabled !== undefined ? data.is_enabled : true,
      config_json: data.config
    })
    healthScheduler.syncRunningState()
    return success(config)
  } catch (error) {
    logger.error('HealthChannels', `health:update-config 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:record
// 记录健康数据
// ============================================================
register('health:record', async (event, data) => {
  try {
    if (!data.module_type) {
      return failure('MODULE_TYPE_REQUIRED', '模块类型不能为空')
    }
    if (!validators.isValidModuleType(data.module_type)) {
      return failure('MODULE_TYPE_INVALID', '模块类型不合法')
    }
    if (!data.record_date || !data.record_time) {
      return failure('RECORD_DATE_TIME_REQUIRED', '记录日期和时间不能为空')
    }

    const record = healthRecordDao.record({
      module_type: data.module_type,
      record_date: data.record_date,
      record_time: data.record_time,
      value: data.value,
      content: data.content
    })
    return success(record)
  } catch (error) {
    logger.error('HealthChannels', `health:record 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:today-stats
// 查询今日统计数据
// ============================================================
register('health:today-stats', async (event, data) => {
  try {
    const dayjs = require('dayjs')
    const today = dayjs().format('YYYY-MM-DD')
    const records = healthRecordDao.findByDateRange(data.module_type, today, today, { page: 1, size: 100 })
    // 防御性处理：确保 records.list 是数组
    const list = (records && Array.isArray(records.list)) ? records.list : []
    return success({
      date: today,
      records: list,
      total: (records && typeof records.total === 'number') ? records.total : list.length
    })
  } catch (error) {
    logger.error('HealthChannels', `health:today-stats 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:history
// 查询历史记录
// ============================================================
register('health:history', async (event, data) => {
  try {
    if (!data.module_type || !data.start_date || !data.end_date) {
      return failure('REQUIRED_PARAMS', 'module_type、start_date、end_date 不能为空')
    }
    const result = healthRecordDao.findByDateRange(data.module_type, data.start_date, data.end_date, data)
    return success(result)
  } catch (error) {
    logger.error('HealthChannels', `health:history 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:stats
// 查询统计聚合数据
// ============================================================
register('health:stats', async (event, data) => {
  try {
    if (!data.module_type || !data.start_date || !data.end_date) {
      return failure('REQUIRED_PARAMS', 'module_type、start_date、end_date 不能为空')
    }
    if (!['day', 'week', 'month'].includes(data.period)) {
      return failure('PERIOD_INVALID', '周期参数不合法，应为 day/week/month')
    }
    const stats = healthRecordDao.getStats(data.module_type, data.start_date, data.end_date, data.period)
    return success(stats)
  } catch (error) {
    logger.error('HealthChannels', `health:stats 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:pause-sedentary
// 久坐暂停提醒（记录本次暂停）
// ============================================================
register('health:pause-sedentary', async (event, data) => {
  try {
    // 仅做接口预留，实际暂停逻辑由前端状态管理处理
    return success({ paused: true })
  } catch (error) {
    logger.error('HealthChannels', `health:pause-sedentary 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:record-completion
// 记录倒计时提醒完成情况（久坐伸展/护眼）
// value: 1=已完成, 0=未完成（跳过/超时）
// ============================================================
register('health:record-completion', async (event, data) => {
  try {
    if (!data.module_type) {
      return failure('MODULE_TYPE_REQUIRED', '模块类型不能为空')
    }
    if (!['sedentary', 'eye', 'stretch'].includes(data.module_type)) {
      return failure('MODULE_TYPE_INVALID', '仅久坐伸展/护眼支持完成率记录')
    }
    if (!data.record_date || !data.record_time) {
      return failure('RECORD_DATE_TIME_REQUIRED', '记录日期和时间不能为空')
    }

    const record = healthRecordDao.record({
      module_type: data.module_type,
      record_date: data.record_date,
      record_time: data.record_time,
      value: data.completed ? 1 : 0,
      content: data.content || (data.completed ? '已完成' : '未完成')
    })
    return success(record)
  } catch (error) {
    logger.error('HealthChannels', `health:record-completion 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:completion-stats
// 查询倒计时提醒完成率统计
// 返回 { total, completed, rate, daily: [{date, total, completed, rate}] }
// ============================================================
register('health:completion-stats', async (event, data) => {
  try {
    if (!data.module_type || !data.start_date || !data.end_date) {
      return failure('REQUIRED_PARAMS', 'module_type、start_date、end_date 不能为空')
    }

    const dayjs = require('dayjs')
    const startDate = dayjs(data.start_date)
    const endDate = dayjs(data.end_date)
    const daysCount = endDate.diff(startDate, 'day') + 1

    // 初始化每日统计
    const dailyMap = {}
    for (let i = 0; i < daysCount; i++) {
      const date = startDate.add(i, 'day').format('YYYY-MM-DD')
      dailyMap[date] = { date, total: 0, completed: 0, rate: 0 }
    }

    // 查询范围内所有记录
    const result = healthRecordDao.findByDateRange(data.module_type, data.start_date, data.end_date, { page: 1, size: 1000 })
    // 防御性处理：确保 result.list 是数组
    const recordList = (result && Array.isArray(result.list)) ? result.list : []
    let total = 0
    let completed = 0

    for (const record of recordList) {
      const day = dailyMap[record.record_date]
      if (!day) continue
      // value=1 表示已完成，value=0 表示未完成
      // 注意：旧数据中可能存在 value>1 的记录（如饮水量），此处仅统计 0/1
      if (record.value === 0 || record.value === 1) {
        day.total++
        total++
        if (record.value === 1) {
          day.completed++
          completed++
        }
      }
    }

    // 计算每日完成率
    const daily = Object.values(dailyMap).map(d => ({
      ...d,
      rate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0
    }))

    return success({
      total,
      completed,
      rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      daily
    })
  } catch (error) {
    logger.error('HealthChannels', `health:completion-stats 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:auto-sleep
// 自动记录睡眠事件（powerMonitor suspend/resume 触发）
// type# type: 'suspend' 记录入睡时间, 'resume' 记录起床时间
// 支持自定义时间（手动修改时使用）
// ============================================================
register('health:auto-sleep', async (event, data) => {
  try {
    const dayjs = require('dayjs')
    if (!data.type || !['suspend', 'resume'].includes(data.type)) {
      return failure('TYPE_INVALID', 'type 应为 suspend 或 resume')
    }

    // 自定义时间优先，否则使用当前时间
    let recordTime
    let recordDate
    if (data.custom_time && data.custom_date) {
      recordTime = `${data.custom_date} ${data.custom_time}:00`
      recordDate = data.custom_date
    } else if (data.custom_time) {
      recordDate = dayjs().format('YYYY-MM-DD')
      recordTime = `${recordDate} ${data.custom_time}:00`
    } else {
      recordDate = dayjs().format('YYYY-MM-DD')
      recordTime = dayjs().format('YYYY-MM-DD HH:mm:ss')
    }

    // value: 1=入睡(suspend), 2=起床(resume)
    const value = data.type === 'suspend' ? 1 : 2
    const content = data.type === 'suspend' ? '自动记录入睡' : '自动记录起床'

    const record = healthRecordDao.record({
      module_type: 'sleep',
      record_date: recordDate,
      record_time: recordTime,
      value,
      content
    })
    return success(record)
  } catch (error) {
    logger.error('HealthChannels', `health:auto-sleep 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:delete-sleep-record
// 删除指定日期的睡眠记录（手动修改时先清除旧记录）
// ============================================================
register('health:delete-sleep-record', async (event, data) => {
  try {
    if (!data.date || data.value === undefined) {
      return failure('REQUIRED_PARAMS', 'date 和 value 不能为空')
    }

    const { getDb } = require('./../dao/database.js')
    const db = getDb()
    // 删除指定日期和类型的睡眠记录
    const result = db.prepare(
      `DELETE FROM health_records WHERE module_type = 'sleep' AND record_date = ? AND value = ?`
    ).run(data.date, data.value)
    return success({ deleted: result.changes })
  } catch (error) {
    logger.error('HealthChannels', `health:delete-sleep-record 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

/**
 * 根据当前时间推测餐次
 * @returns {{ key: string, name: string, icon: string, time: string }}
 */
function guessCurrentMeal () {
  const h = new Date().getHours()
  if (h >= 5 && h < 10) return { key: 'breakfast', name: '早餐', icon: '🌅', time: '08:00' }
  if (h >= 10 && h < 14) return { key: 'lunch', name: '午餐', icon: '☀️', time: '12:00' }
  if (h >= 14 && h < 17) return { key: 'snack', name: '下午茶', icon: '🍵', time: '15:00' }
  if (h >= 17 && h < 21) return { key: 'dinner', name: '晚餐', icon: '🌙', time: '18:00' }
  return { key: 'snack', name: '宵夜', icon: '🍿', time: '22:00' }
}

// ============================================================
// health:trigger-reminder
// 手动触发健康提醒通知（用户点击"立即提醒"按钮时调用）
// 通过 notificationService 发送五重通知（含灵动岛），不等待调度器间隔
// data: { module_type: 'water'|'sedentary'|'eye'|'sleep'|'diet' }
// ============================================================
register('health:trigger-reminder', async (event, data) => {
  try {
    if (!data || !data.module_type) {
      return failure('MODULE_TYPE_REQUIRED', '模块类型不能为空')
    }
    const moduleType = data.module_type
    if (!validators.isValidModuleType(moduleType)) {
      return failure('MODULE_TYPE_INVALID', '模块类型不合法')
    }

    // 延迟 require 避免循环依赖
    const notificationService = require('./../core/notification-service.js')
    const healthRecordDao = require('./../dao/health-record-dao.js')

    // 根据模块类型构建通知内容
    let title = ''
    let body = ''
    let action = { label: '确认', value: 'done' }
    let extraData = { moduleType }

    // 读取模块配置
    const config = healthConfigDao.getByModuleType(moduleType)
    const cfg = (config && config.config_json) || {}
    const channels = cfg.channels || ['notification', 'popup']

    switch (moduleType) {
      case 'water': {
        const today = dayjs().format('YYYY-MM-DD')
        const todayTotal = healthRecordDao.todayTotal('water', today)
        const target = cfg.target_ml || 2000
        const percent = target > 0 ? Math.round((todayTotal / target) * 100) : 0
        const cupSizeMl = cfg.cup_size_ml || 200
        title = '喝水提醒 💧'
        body = `今日已饮水 ${todayTotal}ml / ${target}ml（${percent}%），点击快速记录`
        action = { label: '喝水', value: 'done' }
        extraData = { moduleType: 'water', cupSizeMl, todayTotal, target }
        break
      }
      case 'sedentary': {
        const customContent = cfg.custom_content
        const defaultContent = '建议起身活动：站立走动、伸展腰背、颈部环绕、眺望远处、喝水补充水分'
        title = '久坐伸展提醒 🪑🤸'
        body = customContent || defaultContent
        action = { label: '完成', value: 'done' }
        break
      }
      case 'eye': {
        const duration = cfg.duration_minutes || 5
        title = '护眼提醒 👁️'
        body = `建议进行 ${duration} 分钟护眼活动：闭眼休息或远眺 6 米外景物，可做眼保健操缓解疲劳`
        action = { label: '完成', value: 'done' }
        extraData = { moduleType: 'eye', durationMinutes: duration }
        break
      }
      case 'sleep': {
        const targetBedtime = cfg.target_bedtime || '23:00'
        const targetWakeup = cfg.target_wakeup || '07:00'
        title = '睡眠提醒 😴'
        body = `理想入睡时间为 ${targetBedtime}，建议放下手机准备休息，目标起床时间 ${targetWakeup}`
        action = { label: '知道了', value: 'done' }
        break
      }
      case 'diet': {
        const meal = guessCurrentMeal()
        title = `饮食提醒 ${meal.icon}`
        body = `到了${meal.name}时间（${meal.time}），记得按时进食`
        action = { label: '已吃', value: 'done' }
        extraData = { moduleType: 'diet', mealType: meal.key, mealName: meal.name, mealTime: meal.time }
        break
      }
      default:
        return failure('MODULE_TYPE_INVALID', `不支持的模块类型: ${moduleType}`)
    }

    // 灵动岛通知类型：water/diet 使用专用卡片，其他用 health 通用卡片
    const notifyType = (moduleType === 'water' || moduleType === 'diet') ? moduleType : 'health'
    // 通过 notificationService 发送通知（含灵动岛、系统通知、桌宠）
    notificationService.notify(notifyType, title, body, {
      source: { module: 'health', id: `${moduleType}-manual-${Date.now()}` },
      channels,
      action,
      extraData
    })

    logger.info('HealthChannels', `手动触发健康提醒: [${moduleType}] ${title}`)
    return success({ triggered: true, moduleType, title })
  } catch (error) {
    logger.error('HealthChannels', `health:trigger-reminder 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// health:get-last-reminded
// 获取各模块最后提醒时间戳（供前端计算倒计时剩余秒数，避免切页重置）
// ============================================================
register('health:get-last-reminded', async () => {
  try {
    const times = healthScheduler.getLastRemindedTimes()
    return success(times)
  } catch (error) {
    logger.error('HealthChannels', `health:get-last-reminded 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}
