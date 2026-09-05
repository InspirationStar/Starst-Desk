// ============================================================
// 活动检测 IPC 通道
// 注册 activity:* 系列处理器，参照 pet-channels.js 风格
// 使用 registry.js 的 register / success / failure 统一响应格式
// ============================================================

const { register, success, failure } = require('./registry.js')
const activityMonitor = require('./../core/activity-monitor.js')
const logger = require('./../core/logger.js')

// ============================================================
// activity:get-today-stats - 获取今日活动统计
// 返回 { date, totalActiveSeconds, totalIdleSeconds, ... }
// ============================================================
register('activity:get-today-stats', async (event, data) => {
  try {
    const stats = activityMonitor.getTodayStats()
    return success({ stats })
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-today-stats 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:get-stats-by-date - 获取指定日期统计
// data: { date: 'YYYY-MM-DD' }
// ============================================================
register('activity:get-stats-by-date', async (event, data) => {
  try {
    if (!data || !data.date) {
      return failure('INVALID_DATA', '缺少 date 参数')
    }
    const stats = activityMonitor.getStatsByDate(data.date)
    return success({ stats })
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-stats-by-date 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================

// activity:get-current-status - 获取当前活动状态
// 返回 { isIdle, isAway, isLocked, idleTime, activeApp, activeWindow, mouseDistance, continuousActiveSeconds }
// ============================================================
register('activity:get-current-status', async (event, data) => {
  try {
    const status = activityMonitor.getCurrentStatus()
    return success({ status })
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-current-status 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:get-summary - 获取最近 7 天汇总
// 返回 { summary: [...], topApps: [...] }
// ============================================================
register('activity:get-summary', async (event, data) => {
  try {
    // days=0 表示全部，undefined 默认 7
    const days = (data && typeof data.days === 'number') ? data.days : 7
    const summary = activityMonitor.getRecentSummary(days)
    const topApps = activityMonitor.getTopApps()
    return success({ summary, topApps })
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-summary 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:get-top-apps - 获取某天活跃应用 Top N
// 参数 { limit, date }：limit>0 取前 N，0 或不传表示全部；date 为 YYYY-MM-DD，不传默认今日
// 返回 { topApps: [...] }
// ============================================================
register('activity:get-top-apps', async (event, data) => {
  try {
    const limit = (data && typeof data.limit === 'number') ? data.limit : 0
    const date = data?.date || null
    const topApps = activityMonitor.getTopApps(limit, date)
    return success({ topApps })
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-top-apps 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:get-time-distribution - 获取指定日期时间段分布
// 参数 { date: 'YYYY-MM-DD' }，不传默认今日
// 返回 { distribution: { morning, afternoon, evening, night } }（各时段活跃秒数）
// ============================================================
register('activity:get-time-distribution', async (event, data) => {
  try {
    const date = data?.date || null
    const distribution = activityMonitor.getTimeDistribution(date)
    return success({ distribution })
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-time-distribution 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:get-active-segments - 获取指定日期连续活跃段数
// 参数 { date: 'YYYY-MM-DD' }，不传默认今日
// 返回 { segments: number }（活跃段数量，反映工作碎片化程度）
// ============================================================
register('activity:get-active-segments', async (event, data) => {
  try {
    const date = data?.date || null
    const segments = activityMonitor.getActiveSegments(date)
    return success({ segments })
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-active-segments 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:get-app-categories - 获取某天活跃应用按类别聚合的时长
// 参数 { date: 'YYYY-MM-DD' }，不传默认今日
// 返回 { categories: [{ category, totalSeconds }] }，按时长降序
// 用于活动统计页"活跃应用类别"指标，只展示类别 + 时长，不展示具体应用名
// ============================================================
register('activity:get-app-categories', async (event, data) => {
  try {
    const date = data?.date || null
    const categories = activityMonitor.getAppCategories(date)
    return success({ categories })
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-app-categories 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:get-uncategorized-apps - 获取今日未分类（category='其他'）的活跃应用进程名
// 返回 { apps: string[] }，用于 AI 分类预览
// ============================================================
register('activity:get-uncategorized-apps', async (event, data) => {
  try {
    const apps = activityMonitor.getUncategorizedApps()
    return success({ apps })
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-uncategorized-apps 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:ai-categorize-apps - 调用 AI 对未分类应用归类并持久化
// 返回 { categorized, total, message? }
// 失败原因：未配置 AI 模型 / AI 返回非 JSON / 网络错误
// ============================================================
register('activity:ai-categorize-apps', async (event, data) => {
  try {
    const result = await activityMonitor.aiCategorizeApps()
    return success(result)
  } catch (error) {
    logger.error('ActivityChannels', `activity:ai-categorize-apps 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:reset-app-categories - 清除 AI 分类持久化，恢复硬编码默认分类
// 返回 { reset: true }
// ============================================================
register('activity:reset-app-categories', async (event, data) => {
  try {
    activityMonitor.resetAiAppCategories()
    return success({ reset: true })
  } catch (error) {
    logger.error('ActivityChannels', `activity:reset-app-categories 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:get-category-config - 获取完整分类配置（AI分类 + 今日活跃应用分类情况）
// 返回 { aiCategories, apps: [{ app, category, totalSeconds }] }
// 用于分类管理界面展示
// ============================================================
register('activity:get-category-config', async (event, data) => {
  try {
    const config = activityMonitor.getAppCategoryConfig()
    return success(config)
  } catch (error) {
    logger.error('ActivityChannels', `activity:get-category-config 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// activity:update-app-category - 手动修改单个应用分类，持久化到 AI 分类
// 参数 { app: 进程名, category: 类别名 }
// 返回 { updated: boolean }
// ============================================================
register('activity:update-app-category', async (event, data) => {
  try {
    if (!data?.app || !data?.category) {
      return failure('INVALID_PARAMS', '应用名和类别不能为空')
    }
    const result = activityMonitor.updateAppCategory(data.app, data.category)
    return success({ updated: result })
  } catch (error) {
    logger.error('ActivityChannels', `activity:update-app-category 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})


// activity:clear-data - 清空指定日期范围的活动数据
register('activity:clear-data', async (event, data) => {
  try {
    const startDate = data?.startDate || null
    const endDate = data?.endDate || null
    const result = activityMonitor.clearData(startDate, endDate)
    if (result) {
      return success({ cleared: true })
    } else {
      return failure('CLEAR_FAILED', '清空活动数据失败')
    }
  } catch (error) {
    logger.error('ActivityChannels', `activity:clear-data 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

module.exports = {}