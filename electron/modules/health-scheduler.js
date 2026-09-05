// ============================================================
// 健康提醒调度器
// 独立运行的健康提醒扫描循环，每 30 秒检查各子模块触发条件
// 六大子模块：喝水/久坐伸展/护眼/睡眠/饮食（stretch 已合并到 sedentary）
// 触发时：
//   - 喝水/睡眠/饮食：调用 notification-service 发送三重通知
//   - 久坐伸展/护眼：通过 notification-service 在灵动岛显示带确认按钮的通知，
//     由 IslandHealthReminder.vue 显示倒计时等待用户确认
// 通过内存缓存记录触发时间，避免重复提醒
// 子需求7：程序启动时开始计时，到达设定间隔后才首次提醒（不立即提醒）
// ============================================================

const dayjs = require('dayjs')
const healthConfigDao = require('../dao/health-config-dao.js')
const healthRecordDao = require('../dao/health-record-dao.js')
const notificationService = require('../core/notification-service.js')
const logger = require('../core/logger.js')

// 扫描周期：30 秒（满足分钟级提醒精度）
const SCAN_INTERVAL_MS = 30 * 1000

// 各模块最后提醒时间（内存缓存，避免重复触发）
const lastRemindedAt = {}

// 久坐暂停状态（前端通过 IPC 控制）
let sedentaryPaused = false

// 全量暂停状态（桌宠"暂停提醒"按钮使用）
// 暂停时 tick 直接返回，所有子模块均不触发
let allPaused = false

// 饮食已提醒标记：{ 'YYYY-MM-DD-breakfast': true }，每餐每天只提醒一次
const dietReminded = {}

// 上次扫描日期，用于检测跨 00:00 重置
let lastDate = null

// 调度器定时器引用
let timer = null

// 标记是否已初始化启动时间基准（子需求7：确保从启动开始计时）
let startupInitialized = false

// ============================================================

// 子模块触发条件检查
// ============================================================

/**
 * 检查喝水提醒
 * 根据间隔时间触发，通知内容包含当日饮水进度
 * 子需求7：新启用模块首次检查时设置 baseline，不立即触发
 * @param {object} config - 配置记录
 * @param {number} now - 当前时间戳
 */
function checkWater (config, now) {
  const cfg = config.config_json || {}
  const intervalMinutes = Number.isFinite(cfg.interval_minutes) && cfg.interval_minutes > 0 ? cfg.interval_minutes : 60
  const intervalMs = intervalMinutes * 60 * 1000
  const last = lastRemindedAt.water || 0

  // 子需求7：新启用的模块 last 未设置（last === 0），首次检查时设置 baseline 并跳过
  // 确保从启用时刻开始计时，而非启用即提醒
  if (!last) {
    lastRemindedAt.water = now
    logger.debug('HealthScheduler', 'water 模块首次检查，设置启动时间基准')
    return
  }

  // 未到间隔时间，跳过
  if (now - last < intervalMs) return

  // 获取今日饮水量进度
  const today = dayjs().format('YYYY-MM-DD')
  const todayTotal = healthRecordDao.todayTotal('water', today)
  const target = cfg.target_ml || 2000
  const percent = target > 0 ? Math.round((todayTotal / target) * 100) : 0

  lastRemindedAt.water = now

  const cupSizeMl = cfg.cup_size_ml || 200
  notificationService.notify(
    'water',
    '喝水提醒 💧',
    `今日已饮水 ${todayTotal}ml / ${target}ml（${percent}%），点击快速记录`,
    {
      source: { module: 'health', id: `water-${now}` },
      channels: cfg.channels || ['notification', 'popup'],
      action: { label: '喝水', value: 'done' },
      extraData: { moduleType: 'water', cupSizeMl, todayTotal, target }
    }
  )
}

/**
 * 检查久坐伸展提醒
 * 合并了原 sedentary 和 stretch 模块（子需求8）
 * 触发时推送倒计时提醒事件，由渲染进程显示倒计时 overlay 等待用户确认
 * 子需求7：新启用模块首次检查时设置 baseline，不立即触发
 * @param {object} config - 配置记录
 * @param {number} now - 当前时间戳
 */
function checkSedentary (config, now) {
  // 暂停状态下不触发
  if (sedentaryPaused) return

  const cfg = config.config_json || {}
  const intervalMinutes = Number.isFinite(cfg.interval_minutes) && cfg.interval_minutes > 0 ? cfg.interval_minutes : 45
  const intervalMs = intervalMinutes * 60 * 1000
  const last = lastRemindedAt.sedentary || 0

  // 子需求7：新启用的模块首次检查时设置 baseline 并跳过
  if (!last) {
    lastRemindedAt.sedentary = now
    logger.debug('HealthScheduler', 'sedentary 模块首次检查，设置启动时间基准')
    return
  }

  if (now - last < intervalMs) return

  lastRemindedAt.sedentary = now

  // 自定义提醒内容或默认动作指导（合并自原 stretch 模块）
  const customContent = cfg.custom_content
  const defaultContent = '建议起身活动：站立走动、伸展腰背、颈部环绕、眺望远处、喝水补充水分'
  const body = customContent || defaultContent

  // 久坐提醒：直接在灵动岛显示带确认按钮的通知（不弹窗主窗口 overlay）
  // 久坐伸展无独立时长配置，倒计时使用灵动岛默认值兜底（60 秒）
  const sedentarySourceId = `sedentary-${Date.now()}`
  notificationService.notify('health', '久坐伸展提醒 🪑🤸', body, {
    source: { module: 'health', id: sedentarySourceId },
    channels: cfg.channels || ['popup'],
    action: { label: '完成', value: 'done' },
    extraData: { moduleType: 'sedentary' }
  })
}

/**
 * 检查护眼提醒
 * 触发时推送倒计时提醒事件，由渲染进程显示倒计时 overlay 等待用户确认
 * 子需求7：新启用模块首次检查时设置 baseline，不立即触发
 * @param {object} config - 配置记录
 * @param {number} now - 当前时间戳
 */
function checkEye (config, now) {
  const cfg = config.config_json || {}
  const intervalMinutes = Number.isFinite(cfg.interval_minutes) && cfg.interval_minutes > 0 ? cfg.interval_minutes : 30
  const intervalMs = intervalMinutes * 60 * 1000
  const last = lastRemindedAt.eye || 0

  // 子需求7：新启用的模块首次检查时设置 baseline 并跳过
  if (!last) {
    lastRemindedAt.eye = now
    logger.debug('HealthScheduler', 'eye 模块首次检查，设置启动时间基准')
    return
  }

  if (now - last < intervalMs) return

  const duration = cfg.duration_minutes || 5
  lastRemindedAt.eye = now

  // 护眼提醒：直接在灵动岛显示带确认按钮的通知（不弹窗主窗口 overlay）
  // durationMinutes 传递护眼活动时长（分钟），灵动岛据此计算倒计时秒数
  const eyeSourceId = `eye-${Date.now()}`
  notificationService.notify('health', '护眼提醒 👁️',
    `建议进行 ${duration} 分钟护眼活动：闭眼休息或远眺 6 米外景物，可做眼保健操缓解疲劳`, {
    source: { module: 'health', id: eyeSourceId },
    channels: cfg.channels || ['popup'],
    action: { label: '完成', value: 'done' },
    extraData: { moduleType: 'eye', durationMinutes: duration }
  })
}

/**
 * 检查运动伸展提醒（已合并到久坐伸展，此函数保留兼容但不再被调用）
 * @deprecated 已合并到 checkSedentary
 */
function checkStretch (config, now) {
  // stretch 已合并到 sedentary，此函数不再被调用
  // 保留函数定义以兼容旧代码引用
  return
}

/**
 * 检查睡眠提醒
 * 到理想入睡时间前 15 分钟提醒作息
 * @param {object} config - 配置记录
 * @param {number} now - 当前时间戳
 */
function checkSleep (config, now) {
  const cfg = config.config_json || {}
  const targetBedtime = cfg.target_bedtime // HH:mm 格式
  if (!targetBedtime) return

  // 解析理想入睡时间
  const [bedHour, bedMin] = targetBedtime.split(':').map(Number)
  const current = dayjs()
  const currentMinutes = current.hour() * 60 + current.minute()
  const bedMinutes = bedHour * 60 + bedMin

  // 入睡时间前 15 分钟提醒窗口（持续 5 分钟的触发窗口）
  const remindBefore = 15
  const windowSize = 5
  const diff = bedMinutes - currentMinutes

  // 当处于 [睡前15分钟, 睡前10分钟] 区间时触发
  if (diff < remindBefore && diff > remindBefore - windowSize) {
    const today = dayjs().format('YYYY-MM-DD')
    const key = `sleep-${today}`
    if (lastRemindedAt.sleep && dayjs(lastRemindedAt.sleep).format('YYYY-MM-DD') === today) {
      return // 今日已提醒
    }

    lastRemindedAt.sleep = now

    const targetWakeup = cfg.target_wakeup || '07:00'
    notificationService.notify(
      'health',
      '睡眠提醒 😴',
      `理想入睡时间为 ${targetBedtime}，建议放下手机准备休息，目标起床时间 ${targetWakeup}`,
      { source: { module: 'health', id: key }, channels: cfg.channels || ['notification', 'popup'], action: { label: '已记录', value: 'done' } }
    )
  }
}

/**
 * 检查饮食提醒
 * 到饭点提醒进食，每餐每天只提醒一次
 * @param {object} config - 配置记录
 * @param {number} now - 当前时间戳
 * @param {string} today - 今日日期 YYYY-MM-DD
 */
function checkDiet (config, now, today) {
  const cfg = config.config_json || {}
  const current = dayjs()
  const currentMinutes = current.hour() * 60 + current.minute()

  // 三餐配置
  const meals = [
    { key: 'breakfast', name: '早餐', icon: '🌅', defaultTime: '08:00' },
    { key: 'lunch', name: '午餐', icon: '☀️', defaultTime: '12:00' },
    { key: 'dinner', name: '晚餐', icon: '🌙', defaultTime: '18:00' }
  ]

  for (const meal of meals) {
    const mealTime = cfg[meal.key] || meal.defaultTime
    const [hour, min] = mealTime.split(':').map(Number)
    const mealMinutes = hour * 60 + min

    // 当前时间在饭点 5 分钟窗口内
    if (Math.abs(currentMinutes - mealMinutes) <= 5) {
      const key = `${today}-${meal.key}`
      // 每餐每天只提醒一次
      if (dietReminded[key]) continue

      dietReminded[key] = true

      notificationService.notify(
        'diet',
        `饮食提醒 ${meal.icon}`,
        `到了${meal.name}时间（${mealTime}），记得按时进食`,
        {
          source: { module: 'health', id: `diet-${key}` },
          channels: cfg.channels || ['notification', 'popup'],
          action: { label: '已吃', value: 'done' },
          extraData: { moduleType: 'diet', mealType: meal.key, mealName: meal.name, mealTime }
        }
      )
    }
  }
}

// ============================================================
// 调度器核心逻辑
// ============================================================

/**
 * 单次扫描：检查所有启用模块的触发条件
 */
function tick () {
  // 全量暂停时直接返回，所有子模块均不触发
  if (allPaused) return

  try {
    const now = Date.now()
    const today = dayjs().format('YYYY-MM-DD')

    // 跨越 00:00 重置当日状态
    if (lastDate && lastDate !== today) {
      resetDailyState()
    }
    lastDate = today

    // 获取所有启用的健康配置
    const configs = healthConfigDao.findAllEnabled()
    if (!configs || configs.length === 0) return

    // 按模块类型分发检查
    for (const config of configs) {
      try {
        switch (config.module_type) {
          case 'water':
            checkWater(config, now)
            break
          case 'sedentary':
            checkSedentary(config, now)
            break
          case 'eye':
            checkEye(config, now)
            break
          // stretch 已合并到 sedentary，不再独立检查
          case 'stretch':
            // 跳过：stretch 模块已合并到 sedentary（子需求8）
            break
          case 'sleep':
            checkSleep(config, now)
            break
          case 'diet':
            checkDiet(config, now, today)
            break
        }
      } catch (moduleError) {
        // 单模块异常不中断整体调度
        logger.error('HealthScheduler', `模块 ${config.module_type} 检查失败: ${moduleError.message}`)
      }
    }
  } catch (error) {
    logger.error('HealthScheduler', `tick 执行失败: ${error.message}`)
  }
}

/**
 * 跨越 00:00 重置当日内存状态
 * 历史记录保留在数据库中，仅重置内存缓存
 */
function resetDailyState () {
  // 重置饮食已提醒标记
  Object.keys(dietReminded).forEach(key => delete dietReminded[key])

  // 重置睡眠当日提醒标记
  delete lastRemindedAt.sleep

  logger.debug('HealthScheduler', '跨日重置完成，已清空饮食提醒标记与睡眠当日标记')
}

// ============================================================
// 调度器生命周期控制
// ============================================================

/**
 * 启动健康提醒调度器
 * 子需求7：从程序启动时开始计时，到达设定间隔后才首次提醒
 * 不立即执行 tick()，而是先初始化所有启用模块的 lastRemindedAt 为当前时间
 * 这样第一次提醒会在间隔后触发，而不是启动即提醒
 */
function start () {
  if (timer) {
    logger.warn('HealthScheduler', '调度器已在运行，无需重复启动')
    return
  }

  logger.info('HealthScheduler', '健康提醒调度器启动中...')

  // 子需求7：初始化启动时间基准
  // 为所有启用模块设置 lastRemindedAt = 当前时间
  // 这样首次检查时 now - last ≈ 0 < intervalMs，不会立即触发
  // 需要等待 intervalMs 后才首次触发
  initStartupBaseline()

  // 启动周期扫描（不立即执行 tick，从下一个扫描周期开始）
  timer = setInterval(tick, SCAN_INTERVAL_MS)
  logger.info('HealthScheduler', `健康提醒调度器已启动，扫描周期 ${SCAN_INTERVAL_MS / 1000} 秒，从启动开始计时`)
}

/**
 * 初始化启动时间基准（子需求7）
 * 为所有启用的模块设置 lastRemindedAt 为当前时间
 * 确保首次提醒在间隔后触发，而非启动即提醒
 */
function initStartupBaseline () {
  try {
    const now = Date.now()
    const configs = healthConfigDao.findAllEnabled()
    if (configs && configs.length > 0) {
      for (const config of configs) {
        // 跳过 stretch（已合并到 sedentary）
        if (config.module_type === 'stretch') continue
        // 跳过 sleep 和 diet（基于时间点触发，非间隔触发）
        if (config.module_type === 'sleep' || config.module_type === 'diet') continue
        lastRemindedAt[config.module_type] = now
      }
      logger.info('HealthScheduler', `已初始化 ${configs.filter(c => !['stretch', 'sleep', 'diet'].includes(c.module_type)).length} 个模块的启动时间基准`)
    }
    startupInitialized = true
  } catch (error) {
    logger.error('HealthScheduler', `初始化启动时间基准失败: ${error.message}`)
  }
}

/**
 * 停止健康提醒调度器
 */
function stop () {
  if (timer) {
    clearInterval(timer)
    timer = null
    logger.info('HealthScheduler', '健康提醒调度器已停止')
  }
}

/**
 * 暂停久坐提醒
 */
function pauseSedentary () {
  sedentaryPaused = true
  logger.info('HealthScheduler', '久坐提醒已暂停')
}

/**
 * 继续久坐提醒
 * 重置计时基准，从当前时刻重新计算间隔
 */
function resumeSedentary () {
  sedentaryPaused = false
  lastRemindedAt.sedentary = Date.now()
  logger.info('HealthScheduler', '久坐提醒已继续，重新开始计时')
}

/**
 * 获取久坐暂停状态
 * @returns {boolean}
 */
function isSedentaryPaused () {
  return sedentaryPaused
}

/**
 * 获取各模块最后提醒时间（供前端展示倒计时使用）
 * @returns {object}
 */
function getLastRemindedTimes () {
  return { ...lastRemindedAt }
}

/**
 * 全量暂停所有健康提醒
 * 桌宠"暂停提醒"按钮使用，暂停后 tick 直接返回
 */
function pauseAll () {
  allPaused = true
  // 停止定时器，避免 allPaused 状态下每 30s 空转
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  logger.info('HealthScheduler', '所有健康提醒已暂停，调度器已停止')
}

/**
 * 恢复所有健康提醒
 * 重置计时基准，从当前时刻重新计算各模块间隔（子需求7：从恢复时刻开始计时）
 */
function resumeAll () {
  allPaused = false
  // 重置所有模块最后提醒时间，从当前时刻重新计时
  const now = Date.now()
  Object.keys(lastRemindedAt).forEach(key => {
    lastRemindedAt[key] = now
  })
  // 按需重启调度器（有启用模块才启动）
  syncRunningState()
  logger.info('HealthScheduler', '所有健康提醒已恢复，从当前时刻重新开始计时')
}

/**
 * 查询全量暂停状态
 * @returns {boolean}
 */
function isAllPaused () {
  return allPaused
}

/**
 * 同步调度器运行状态：有启用模块才启动，无则停止
 * 在健康配置变更后调用，避免所有模块禁用时空转 30s 轮询
 */
function syncRunningState () {
  try {
    const configs = healthConfigDao.findAllEnabled()
    const hasEnabled = configs && configs.length > 0
    // allPaused 时不启动 timer，避免 tick 空转（resumeAll 会重新启动）
    if (hasEnabled && !timer && !allPaused) {
      start()
    } else if (!hasEnabled && timer) {
      stop()
    }
  } catch (error) {
    logger.error('HealthScheduler', `syncRunningState 失败: ${error.message}`)
  }
}

module.exports = {
  start,
  stop,
  syncRunningState,
  pauseSedentary,
  resumeSedentary,
  isSedentaryPaused,
  getLastRemindedTimes,
  // 全量暂停/恢复（桌宠"暂停提醒"按钮使用）
  pauseAll,
  resumeAll,
  isAllPaused
}