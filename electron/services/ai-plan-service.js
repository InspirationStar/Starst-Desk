// ============================================================
// AI 规划服务（主进程）
// 使用 registry.register 注册 IPC 通道，自动包装为 { ok: true, data } 标准响应格式
// 包含：
//   1. 短期规划历史 CRUD（ai-plan:create/list/apply/delete）
//   2. 长期计划管理（ai-plan:create-long/get-long-active/advance-cycle/start-review/complete-review/abandon-long）
//   3. AI 上下文感知（ai-plan:get-context），生成规划时注入当前数据状态
// ============================================================

const { register } = require('../ipc/registry')
const aiPlanDao = require('../dao/ai-plan-dao')
const longPlanDao = require('../dao/long-plan-dao')
const groupDao = require('../dao/group-dao')
const projectDao = require('../dao/project-dao')
const todoDao = require('../dao/todo-dao')
const focusSessionDao = require('../dao/focus-session-dao')
const aiConfigDao = require('../dao/ai-config-dao')
const aiAdapterFactory = require('../core/ai-adapter')
const dateUtils = require('../utils/date-utils')
const logger = require('../core/logger')

// ============================================================
// AI 系统提示词

// ============================================================

/**
 * 构建 AI 系统提示词
 * @param {boolean} longMode - 是否长期模式
 * @returns {string}
 */
function buildAiSystemPrompt (longMode = false) {
  const base = [
    '你是 Starst Desk 的个性化规划助手。语气要清楚、具体、专业，不要夸张抒情，',
    '不要编造用户没有给出的背景。用户会告诉你目标、需求或近期状态，你要把它转换成',
    '可以直接导入 Starst Desk 的每日任务、任务流和项目。',
    '',
    '输出必须包含两部分：',
    '1. 先用 3-5 句中文说明：目标判断、时间约束、执行节奏、今天/本周期先做什么。',
    '2. 然后输出且只输出一个 ```json 代码块，JSON 必须是对象，结构如下：'
  ].join('\n')

  if (longMode) {
    return base + '\n' + [
      '{',
      '  "mode": "long",',
      '  "title": "长期计划标题",',
      '  "summary": "整体计划摘要",',
      '  "tasks": [],',
      '  "groups": [{"name": "本周期每日执行任务流", "description": "用途", "steps": [{"name": "步骤名", "duration": 25, "type": "focus"}], "theme": "primary"}],',
      '  "projects": [{"name": "长期项目名", "desc": "项目说明", "progress": 0, "taskCount": 4, "milestones": [{"title": "阶段里程碑", "done": false}]}],',
      '  "longPlan": {',
      '    "goal": "长期目标",',
      '    "durationText": "例如：两个月",',
      '    "cycleLengthDays": 7,',
      '    "totalCycles": 8,',
      '    "roadmap": ["第1周期：打基础", "第2周期：巩固", "后续周期：根据复盘动态调整"],',
      '    "cycles": [{"index": 1, "title": "第1周期", "goal": "本周期目标", "days": [{"day": 1, "dateOffset": 0, "focus": "今日重点", "tasks": [{"title": "每日任务", "meta": "用时/要求/提示"}]}], "reviewPrompt": "本周期复盘问题"}],',
      '    "nextCycleInstruction": "周期结束后根据用户掌握情况生成下一周期."',
      '  }',
      '}',
      '',
      '长期计划规则：不要一次性生成完整两个月每日任务；要把长期目标拆为周期，通常 7 天一个周期；',
      '只生成第一个周期的每日任务，后续周期只写 roadmap 概览；当前周期最多 7 天，每天 2-4 个任务。',
      '每天任务要按先易后难排列，meta 写清用时、完成标准和资料建议。',
      '周期结束需要用户复盘掌握情况后再生成下一周期。',
      '如果用户给了明确时间段，durationText 和 totalCycles 必须匹配。字段名必须使用英文。'
    ].join('\n')
  }

  return base + '\n' + [
    '{',
    '  "title": "计划标题",',
    '  "mode": "short",',
    '  "summary": "计划摘要",',
    '  "tasks": [{"title": "任务名", "meta": "场景/优先级/提醒", "done": false}],',
    '  "groups": [{"name": "任务流名", "description": "用途", "steps": [{"name": "步骤名", "duration": 25, "type": "focus"}], "theme": "primary"}],',
    '  "projects": [{"name": "项目名", "desc": "项目说明", "progress": 0, "taskCount": 3, "milestones": [{"title": "里程碑", "done": false}]}]',
    '}',
    '',
    '约束：任务 4-8 个；任务流 1-3 个，每个 3-6 步，每步 duration 为分钟；项目 0-2 个；',
    '不要输出 JSON 以外的第二个代码块；不要在 JSON 内写注释；字段名必须使用英文。'
  ].join('\n')
}

/**
 * 构建 AI 上下文消息
 * 包含当前待办/项目/专注统计/长期计划状态

 * @returns {string}
 */
function buildAiContextMessage () {
  // 当前未完成待办（最多 8 个标题）
  const allTodos = todoDao.list({ status: 'active' })
  const pendingTasks = (allTodos || []).slice(0, 8).map(t => t.title || '').filter(Boolean)
  const todoCount = (allTodos || []).length

  // 当前进行中项目（最多 6 个名称）
  const projectResult = projectDao.list({ page: 1, size: 100 })
  const allProjects = (projectResult && projectResult.list) || []
  const activeProjects = allProjects.filter(p => Number(p.progress || 0) < 1).slice(0, 6).map(p => p.name || '').filter(Boolean)
  const projectCount = allProjects.length

  // 任务流数量
  const groupResult = groupDao.list({ page: 1, size: 100 })
  const groupCount = (groupResult && groupResult.total) || 0

  // 专注统计：今日完成的专注会话数与总时长
  const focusResult = focusSessionDao.list({ page: 1, size: 200 })
  const focusList = (focusResult && focusResult.list) || []
  const today = dateUtils.today()
  const todayFocus = focusList.filter(s => s.result === 'completed' && s.completed_at && s.completed_at.startsWith(today))
  const todayFocusCount = todayFocus.length
  const todayFocusSeconds = todayFocus.reduce((sum, s) => sum + (Number(s.total_seconds) || 0), 0)
  const todayFocusMinutes = Math.round(todayFocusSeconds / 60)

  let context = [
    '当前软件数据上下文：',
    `待办任务 ${todoCount} 个，任务流 ${groupCount} 个，项目 ${projectCount} 个。`,
    `今日专注会话 ${todayFocusCount} 次，累计 ${todayFocusMinutes} 分钟。`,
    `待办示例：${pendingTasks.length > 0 ? pendingTasks.join('、') : '暂无'}。`,
    `项目示例：${activeProjects.length > 0 ? activeProjects.join('、') : '暂无'}。`,
    '请避免生成与现有内容明显重复的条目。'
  ].join('')

  // 如果有激活的长期计划，注入当前周期信息和复盘状态
  const activeLongPlan = longPlanDao.getActive()
  if (activeLongPlan) {
    const cycles = Array.isArray(activeLongPlan.cycles) ? activeLongPlan.cycles : []
    const cycleIndex = Number(activeLongPlan.current_cycle) || 0
    const currentCycle = cycles[cycleIndex] || null
    context += [
      '当前存在 AI 长期计划：',
      `目标《${activeLongPlan.goal || activeLongPlan.title}》，`,
      `周期状态：${activeLongPlan.pending_review ? '等待复盘' : '执行中'}。`
    ].join('')
    if (currentCycle) {
      context += `当前周期《${currentCycle.title || ''}》，复盘提示：${currentCycle.reviewPrompt || ''}。`
    }
    context += '如果用户正在复盘，请根据掌握情况生成下一个周期的每日任务，并保留长期 roadmap。'
  }

  return context
}

/**
 * 从 AI 返回文本中提取 JSON 对象
 * 支持 ```json 代码块包裹或纯 JSON
 * @param {string} text
 * @returns {object|null}
 */
function extractPlanJson (text) {
  if (!text || typeof text !== 'string') return null
  // 优先匹配 ```json 代码块
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : text
  try {
    return JSON.parse(jsonStr)
  } catch (e) {
    logger.warn('AiPlanService', `AI 规划 JSON 解析失败: ${e.message}`)
    return null
  }
}

/**
 * 调用 AI 生成规划
 * @param {string} prompt - 用户目标描述
 * @param {boolean} longMode - 是否长期模式
 * @param {object} [extraMessages] - 额外消息（如复盘回答）
 * @returns {Promise<{plan: object, raw: string}>}
 */
async function callAiGeneratePlan (prompt, longMode = false, extraMessages = []) {
  const activeConfig = aiConfigDao.findActive()
  if (!activeConfig) {
    throw new Error('请先在 AI 模型配置中激活一个模型')
  }

  const messages = [
    { role: 'system', content: buildAiSystemPrompt(longMode) },
    { role: 'system', content: buildAiContextMessage() },
    { role: 'user', content: prompt }
  ]
  // 追加额外消息（如复盘回答），最多 10 条
  for (const msg of extraMessages.slice(-10)) {
    if (msg && msg.role && msg.content) {
      messages.push({ role: msg.role, content: String(msg.content) })
    }
  }

  const result = await aiAdapterFactory.chatStream(
    activeConfig,
    `plan-gen-${Date.now()}`,
    messages,
    { temperature: 0.7, max_tokens: longMode ? 6000 : 4000 },
    null
  )

  const plan = extractPlanJson(result?.content || '')
  return { plan, raw: result?.content || '' }
}

/**
 * 将长期计划 JSON 持久化到 long_plans 表
 * @param {object} plan - AI 返回的长期计划 JSON
 * @returns {object} 创建的 long_plans 记录
 */
function persistLongPlan (plan) {
  const longPlan = plan.longPlan || {}
  return longPlanDao.create({
    goal: longPlan.goal || plan.title || '',
    title: plan.title || '未命名长期计划',
    summary: plan.summary || null,
    duration_text: longPlan.durationText || null,
    cycle_length_days: longPlan.cycleLengthDays || 7,
    total_cycles: longPlan.totalCycles || 8,
    roadmap: longPlan.roadmap || [],
    cycles: longPlan.cycles || []
  })
}

// ============================================================
// IPC 通道注册
// ============================================================

function registerAiPlanChannels () {
  // 保存 AI 规划（短期）
  // 注入上下文：将当前数据上下文一并存入 plan_json，便于后续追溯
  register('ai-plan:create', async (event, data) => {
    const plan = aiPlanDao.create(data)
    return { plan }
  })

  // 获取规划历史
  register('ai-plan:list', async () => {
    const list = aiPlanDao.list(20)
    return { list }
  })

  // 导入规划（将 AI 规划内容写入对应表）
  register('ai-plan:apply', async (event, data) => {
    let plan
    try {
      plan = JSON.parse(data.planJson)
    } catch (e) {
      throw new Error('规划数据格式无效，无法解析')
    }
    const created = { groups: 0, projects: 0, todos: 0 }

    // 导入任务流
    if (plan.groups && Array.isArray(plan.groups)) {
      for (const g of plan.groups) {
        try {
          groupDao.create({ name: g.name, description: g.description, steps: g.steps })
          created.groups++
        } catch (e) { console.warn('[AiPlanService] 导入任务流失败:', g.name, e.message) }
      }
    }

    // 导入项目
    if (plan.projects && Array.isArray(plan.projects)) {
      for (const p of plan.projects) {
        try {
          projectDao.create({ name: p.name, description: p.description, milestones: p.milestones })
          created.projects++
        } catch (e) { console.warn('[AiPlanService] 导入项目失败:', p.name, e.message) }
      }
    }

    // 导入任务
    if (plan.tasks && Array.isArray(plan.tasks)) {
      for (const t of plan.tasks) {
        try {
          todoDao.create({ title: t.title, meta: t.meta || null })
          created.todos++
        } catch (e) { console.warn('[AiPlanService] 导入任务失败:', t.title, e.message) }
      }
    }

    // 标记已应用
    if (data.planId) {
      aiPlanDao.markApplied(data.planId)
    }

    return { created }
  })

  // 删除规划
  register('ai-plan:delete', async (event, data) => {
    const ok = aiPlanDao.del(data.id)
    return { success: ok }
  })

  // ============================================================
  // 长期计划 IPC 通道
  // ============================================================

  // 生成长期计划（调用 AI API，系统提示词要求生成周期性计划）
  // 输入：{ goal, durationText?, messages? }
  // 输出：{ plan, longPlan }
  register('ai-plan:create-long', async (event, data) => {
    const { goal, durationText, messages } = data || {}
    if (!goal || !String(goal).trim()) {
      throw new Error('长期目标不能为空')
    }

    // 检查是否已有激活的长期计划
    const existing = longPlanDao.getActive()
    if (existing && !existing.pending_review) {
      throw new Error('当前已有激活的长期计划，请先放弃或完成后再创建新计划')
    }

    // 构造用户提示词
    let prompt = String(goal).trim()
    if (durationText) {
      prompt += `\n持续时间：${durationText}`
    }

    const { plan, raw } = await callAiGeneratePlan(prompt, true, messages || [])
    if (!plan) {
      throw new Error('AI 返回内容无法解析为 JSON，请重试')
    }

    // 强制设置为长期模式
    plan.mode = 'long'
    if (!plan.longPlan) {
      throw new Error('AI 返回的不是有效的长期计划（缺少 longPlan 字段）')
    }

    // 持久化到 long_plans 表
    const longPlanRecord = persistLongPlan(plan)

    // 同时保存到 ai_plans 历史表
    try {
      aiPlanDao.create({
        prompt: prompt,
        planJson: JSON.stringify(plan)
      })
    } catch (e) {
      logger.warn('AiPlanService', `长期计划保存到历史表失败: ${e.message}`)
    }

    return { plan, longPlan: longPlanRecord, raw }
  })

  // 获取当前激活的长期计划
  register('ai-plan:get-long-active', async () => {
    const longPlan = longPlanDao.getActive()
    return { longPlan }
  })

  // 推进到下一周期
  // 输入：{ id }
  register('ai-plan:advance-cycle', async (event, data) => {
    const { id } = data || {}
    if (!id) throw new Error('长期计划 ID 不能为空')
    const longPlan = longPlanDao.advanceCycle(id)
    return { longPlan }
  })

  // 开始复盘（标记 pending_review = 1）
  // 输入：{ id }
  register('ai-plan:start-review', async (event, data) => {
    const { id } = data || {}
    if (!id) throw new Error('长期计划 ID 不能为空')
    const longPlan = longPlanDao.markReview(id)
    return { longPlan }
  })

  // 完成复盘（调用 AI 生成下一周期任务）
  // 输入：{ id, reviewAnswer, messages? }
  // 输出：{ longPlan, newCycle, raw }
  register('ai-plan:complete-review', async (event, data) => {
    const { id, reviewAnswer, messages } = data || {}
    if (!id) throw new Error('长期计划 ID 不能为空')

    const current = longPlanDao.getById(id)
    if (!current) throw new Error('长期计划不存在')

    // 构造复盘提示词
    const currentCycle = (current.cycles || [])[current.current_cycle] || null
    const reviewPrompt = currentCycle?.reviewPrompt || '请总结本周期掌握情况，并描述下一周期希望加强的方向'
    let reviewText = `这是周期复盘环节。\n本周期复盘问题：${reviewPrompt}\n用户回答：${reviewAnswer || '（未提供）'}\n请根据用户掌握情况，生成下一周期的每日任务（每天 2-4 个，按先易后难排列），并保留长期 roadmap。`
    if (current.goal) {
      reviewText += `\n长期目标：${current.goal}`
    }
    if (current.duration_text) {
      reviewText += `\n持续时间：${current.duration_text}`
    }

    // 调用 AI 生成下一周期
    const { plan, raw } = await callAiGeneratePlan(reviewText, true, messages || [])
    if (!plan || !plan.longPlan || !Array.isArray(plan.longPlan.cycles) || plan.longPlan.cycles.length === 0) {
      throw new Error('AI 返回的下一周期内容无效，请重试')
    }

    // 取 AI 生成的第一个周期作为新周期
    const newCycle = plan.longPlan.cycles[0]
    const newRoadmap = plan.longPlan.roadmap || current.roadmap

    // 写入数据库
    const longPlan = longPlanDao.completeReview(id, {
      cycle: newCycle,
      roadmap: newRoadmap
    })

    return { longPlan, newCycle, raw }
  })

  // 放弃长期计划
  // 输入：{ id }
  register('ai-plan:abandon-long', async (event, data) => {
    const { id } = data || {}
    if (!id) throw new Error('长期计划 ID 不能为空')
    const longPlan = longPlanDao.abandon(id)
    return { longPlan }
  })

  // 获取当前数据上下文（待办数、项目数、专注统计等）
  register('ai-plan:get-context', async () => {
    const context = buildAiContextMessage()
    // 同时返回结构化数据，便于前端展示
    const allTodos = todoDao.list({ status: 'active' }) || []
    const projectResult = projectDao.list({ page: 1, size: 100 })
    const allProjects = (projectResult && projectResult.list) || []
    const groupResult = groupDao.list({ page: 1, size: 100 })
    const groupCount = (groupResult && groupResult.total) || 0
    const focusResult = focusSessionDao.list({ page: 1, size: 200 })
    const focusList = (focusResult && focusResult.list) || []
    const today = dateUtils.today()
    const todayFocus = focusList.filter(s => s.result === 'completed' && s.completed_at && s.completed_at.startsWith(today))
    const todayFocusSeconds = todayFocus.reduce((sum, s) => sum + (Number(s.total_seconds) || 0), 0)

    const activeLongPlan = longPlanDao.getActive()

    return {
      context,
      stats: {
        todoCount: allTodos.length,
        groupCount,
        projectCount: allProjects.length,
        todayFocusCount: todayFocus.length,
        todayFocusMinutes: Math.round(todayFocusSeconds / 60),
        pendingTasks: allTodos.slice(0, 8).map(t => t.title).filter(Boolean),
        activeProjects: allProjects.filter(p => Number(p.progress || 0) < 1).slice(0, 6).map(p => p.name).filter(Boolean)
      },
      activeLongPlan: activeLongPlan ? {
        id: activeLongPlan.id,
        goal: activeLongPlan.goal,
        title: activeLongPlan.title,
        currentCycle: activeLongPlan.current_cycle,
        totalCycles: activeLongPlan.total_cycles,
        pendingReview: activeLongPlan.pending_review
      } : null
    }
  })
}

module.exports = {
  registerAiPlanChannels,
  // 暴露给其他模块使用
  buildAiSystemPrompt,
  buildAiContextMessage,
  callAiGeneratePlan
}
