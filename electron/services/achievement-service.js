// ============================================================
// 成就服务（主进程）
// 使用 registry.register 注册 IPC 通道，自动包装为 { ok: true, data } 标准响应格式
// ============================================================

const { register } = require('../ipc/registry')
const achievementDao = require('../dao/achievement-dao')
const groupDao = require('../dao/group-dao')
const projectDao = require('../dao/project-dao')
const focusSessionDao = require('../dao/focus-session-dao')
const aiAdapterFactory = require('../core/ai-adapter')
const aiConfigDao = require('../dao/ai-config-dao')
const logger = require('../core/logger')

function registerAchievementChannels () {
  // 获取成就列表
  register('achievement:list', async () => {
    const list = achievementDao.list()
    const stats = achievementDao.getStats()
    return { list, stats }
  })

  // 触发成就检查（在关键操作后调用）
  register('achievement:check', async () => {
    checkAchievements()
    return { checked: true }
  })

  // 解锁成就进度
  register('achievement:unlock', async (event, data) => {
    const unlocked = achievementDao.updateProgress(data.code, data.increment || 1)
    return { unlocked }
  })

  // 创建自定义成就
  register('achievement:create', async (event, data) => {
    const ach = achievementDao.create(data)
    return { achievement: ach }
  })

  // 更新自定义成就
  register('achievement:update', async (event, data) => {
    const ach = achievementDao.update(data.code, data)
    return { achievement: ach }
  })

  // 删除自定义成就
  register('achievement:delete', async (event, data) => {
    const success = achievementDao.remove(data.code)
    return { success }
  })

  // 批量更新节点位置
  register('achievement:update-position', async (event, data) => {
    achievementDao.batchUpdatePositions(data.positions || [])
    return { success: true }
  })

  // 重置所有：删除自定义成就 + 重置预置布局
  register('achievement:reset-all', async () => {
    const deletedCustom = achievementDao.deleteAllCustom()
    achievementDao.resetPresetLayout()
    return { deletedCount: deletedCustom.length }
  })

  // 恢复所有（撤销重置）
  register('achievement:restore-all', async (event, data) => {
    const success = achievementDao.restoreAll(data.achievements || [])
    return { success }
  })

  // AI 生成成就建议
  register('achievement:ai-generate', async (event, data) => {
    try {
      // 查找活跃的 AI 配置
      const activeConfig = aiConfigDao.findActive()
      if (!activeConfig) {
        return { error: 'NO_ACTIVE_CONFIG', message: '请先在 AI 模型配置中激活一个模型' }
      }

      // 获取当前成就列表作为上下文
      const existingAchievements = achievementDao.list()
      const context = existingAchievements.map(a => ({
        code: a.code, title: a.title, category: a.category,
        target: a.target, unlocked: Number(a.unlocked) === 1
      }))

      // 构造系统提示词
      const systemPrompt = `你是一个成就系统设计助手。基于用户当前的成就完成情况，自动生成延伸的后续成就节点和节点依赖关系。生成的成就应该是当前成就的进阶和延伸，形成更有挑战性的成就链。输出 JSON：{ "achievements": [{ "title": "成就标题", "description": "描述", "icon": "图标名(Trophy/Medal/Star/Flag/Aim/Timer/Calendar/Promotion)", "target": 目标数值, "category": "分支(task/focus/plan/custom)", "parentTitles": ["前置成就标题（引用现有成就标题，建立依赖关系）"] }] }。注意：生成的成就应与现有成就不重复，parentTitles 应引用现有成就的标题来建立延伸关系，形成成就链。`

      const userPrompt = data.prompt || '请基于我当前的成就完成情况，自动延伸生成后续的成就节点和节点依赖关系，形成更有挑战性的成就链'
      const fullPrompt = `现有成就：${JSON.stringify(context, null, 2)}\n\n用户需求：${userPrompt}`

      // 调用 AI
      const result = await aiAdapterFactory.chatStream(
        activeConfig,
        `achieve-gen-${Date.now()}`,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fullPrompt }
        ],
        { temperature: 0.8, max_tokens: 3000 },
        null
      )

      // 解析 AI 返回的 JSON
      let suggestions = []
      if (result?.content) {
        try {
          const jsonMatch = result.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
          const jsonStr = jsonMatch ? jsonMatch[1] : result.content
          const parsed = JSON.parse(jsonStr)
          suggestions = parsed.achievements || parsed || []
        } catch (e) {
          logger.warn('AchievementService', `AI 成就生成 JSON 解析失败: ${e.message}`)
        }
      }

      return { suggestions, promptUsed: { system: systemPrompt, user: fullPrompt } }
    } catch (error) {
      logger.error('AchievementService', `achievement:ai-generate 失败: ${error.message}`)
      return { error: 'INTERNAL_ERROR', message: error.message }
    }
  })
}

/**
 * 统一成就检查逻辑：基于全局统计量设置成就进度（绝对值语义）
 * 供 achievement:check IPC 与 focus:complete 等关键操作复用，避免累加语义导致的重复累加问题
 * @returns {void}
 */
function checkAchievements () {
  // 统计已完成待办数
  const completedCount = getCompletedTodoCount()
  achievementDao.setProgress('first_task', completedCount)
  achievementDao.setProgress('ten_tasks', completedCount)

  // 统计任务流数
  const groupResult = groupDao.list({ page: 1, size: 100 })
  const groupCount = groupResult.total
  achievementDao.setProgress('five_groups', groupCount)

  // 统计项目数
  const projectResult = projectDao.list({ page: 1, size: 100 })
  const projectCount = projectResult.total
  achievementDao.setProgress('three_projects', projectCount)

  // 统计专注会话
  const focusResult = focusSessionDao.list({ page: 1, size: 100 })
  const completedSessions = focusResult.list.filter(s => s.result === 'completed')
  const totalFocusSeconds = completedSessions.reduce((sum, s) => sum + s.total_seconds, 0)
  achievementDao.setProgress('first_focus', completedSessions.length)
  // target 为秒数（1800/3600），故传累计秒数而非分钟数，保持单位一致
  achievementDao.setProgress('thirty_focus_min', totalFocusSeconds)
  achievementDao.setProgress('hour_focus', totalFocusSeconds)

  // 彩虹达人：检查已完成待办中包含多少种不同颜色
  const colorCount = getCompletedTodoColorCount()
  achievementDao.setProgress('all_colors', colorCount)

  // 一周坚持：检查最近连续多少天有待办记录
  const streakDays = getTodoStreakDays()
  achievementDao.setProgress('streak_7', streakDays)

  // 规划者：检查是否使用过 AI 生成分期计划
  const planCount = getAiPlanCount()
  achievementDao.setProgress('plan_generator', planCount)
}

/**
 * 统计已完成待办数量
 * @returns {number}
 */
function getCompletedTodoCount () {
  try {
    const { getDb } = require('../dao/database')
    const db = getDb()
    const result = db.prepare("SELECT COUNT(*) as count FROM todos WHERE is_enabled = 0").get()
    return result.count
  } catch {
    return 0
  }
}

/**
 * 统计已完成待办中包含多少种不同颜色
 * @returns {number}
 */
function getCompletedTodoColorCount () {
  try {
    const { getDb } = require('../dao/database')
    const db = getDb()
    const rows = db.prepare("SELECT DISTINCT color FROM todos WHERE is_enabled = 0 AND color IS NOT NULL AND color != ''").all()
    return rows.length
  } catch {
    return 0
  }
}

/**
 * 统计最近连续多少天有待办记录（创建或完成）
 * @returns {number}
 */
function getTodoStreakDays () {
  try {
    const { getDb } = require('../dao/database')
    const dayjs = require('dayjs')
    const db = getDb()
    // 用本地时间计算 30 天前边界，避免 DATE('now') 返回 UTC 导致时区错位
    const startDate = dayjs().subtract(30, 'day').format('YYYY-MM-DD 00:00:00')
    // 查询最近30天内每天是否有待办记录
    const rows = db.prepare(`
      SELECT DISTINCT DATE(created_at) as day FROM todos
      WHERE created_at >= ?
      UNION
      SELECT DISTINCT DATE(updated_at) as day FROM todos
      WHERE updated_at >= ? AND is_enabled = 0
    `).all(startDate, startDate)
    const days = new Set(rows.map(r => r.day))
    // 从今天往回数连续天数
    let streak = 0
    const today = dayjs()
    for (let i = 0; i < 30; i++) {
      const dayStr = today.subtract(i, 'day').format('YYYY-MM-DD')
      if (days.has(dayStr)) {
        streak++
      } else if (i > 0) {
        break // 中断连续
      }
    }
    return streak
  } catch {
    return 0
  }
}

/**
 * 统计 AI 生成的分期计划数量
 * @returns {number}
 */
function getAiPlanCount () {
  try {
    const { getDb } = require('../dao/database')
    const db = getDb()
    const result = db.prepare("SELECT COUNT(*) as count FROM ai_plans").get()
    return result.count
  } catch {
    return 0
  }
}

module.exports = { registerAchievementChannels, checkAchievements }
