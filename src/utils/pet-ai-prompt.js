// ============================================================
// 桌宠 AI 助手配置
// 职责：定义桌宠人设、可用工具、上下文注入规则
// ============================================================

// 常驻会话标识（不可删除的固定会话标题）
export const PET_ASSISTANT_SESSION_TITLE = '__pet_assistant__'

// 提示词存储键名（app_settings 表）
export const KEY_PET_AI_SYSTEM_PROMPT = 'pet_ai_system_prompt'
export const KEY_PET_AI_META_PROMPT = 'pet_ai_meta_prompt'
export const KEY_PET_AI_ENABLED = 'pet_ai_enabled'
export const KEY_PET_AI_AUTO_CHAT = 'pet_ai_auto_chat'           // 自动对话开关，默认 '0'
export const KEY_PET_AI_AUTO_CHAT_INTERVAL = 'pet_ai_auto_chat_interval' // 自动对话间隔（分钟），默认 '30'
export const KEY_PET_AI_AUTO_CHAT_THINKING = 'pet_ai_auto_chat_thinking'           // 自动对话深度思考开关，默认 '0'
export const KEY_PET_AI_AUTO_CHAT_THINKING_EFFORT = 'pet_ai_auto_chat_thinking_effort' // 自动对话思考强度，默认 'high'

/**
 * 生成 AI 人设提示词时的系统模板
 * 将用户的历史对话摘要作为背景注入，让 AI 生成的提示词更贴合用户习惯
 * @param {Array} chatHistory - 对话记录 [{ role, content }]
 */
export function buildGenerationContext (chatHistory) {
  const now = new Date()
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  const lines = [`[生成上下文 - ${dateStr} ${timeStr}]`]

  // 注入最近10条对话记录（比日常对话多，让 AI 更好地了解用户风格）
  if (chatHistory && chatHistory.length > 0) {
    const recent = chatHistory.slice(-10)
    lines.push('')
    lines.push('【最近对话摘要】（供参考，帮助 AI 了解你的沟通风格）：')
    for (const msg of recent) {
      const role = msg.role === 'user' ? '用户' : '星宝'
      // 截断过长内容，避免 token 过多
      const content = (msg.content || '').slice(0, 150).replace(/\n/g, ' ')
      lines.push(`- ${role}：${content}`)
    }
  }

  return lines.join('\n')
}

// ============================================================
// 提示词生成 meta-prompt（提示词的提示词）
// 注入到 handleGeneratePrompt 中，规范 AI 生成的系统提示词质量与结构
// ============================================================
export const PROMPT_GENERATION_META_PROMPT = `你是桌宠系统提示词生成专家。请根据用户需求和背景信息，为桌宠助手「星宝」生成一份完整、规范、可直接使用的系统提示词。

【生成规范】
1. 结构：用 Markdown 格式组织，必须包含以下段落（## 标题）：
   - 身份（名字、外形、性格、语言风格）
   - 与用户的关系
   - 能力
   - 每次对话时系统会自动提供给你的上下文信息（已去敏感化）
   - 回复原则
   - 可用工具（系统自动提供数据，无需主动调用）
   - 特殊场景处理

2. 内容要求：
   - 符合桌宠场景：常驻桌面、回复显示在气泡中、简短（通常1-3句，最多5句）
   - 回复类型多样：不要只关心/提醒，应覆盖关心提醒、点子启发、人生思考、正能量、灵感、心理帮助、点拨、闲聊陪伴等类型
   - 去敏感化：系统提供的数据已去敏感化（活动统计、健康数据、待办规划、即将到期便签、定时任务、鼓励词条样本、历史对话），提示词中应说明"不需要复述这些数据，除非用户主动问到"
   - 回复格式：提示词中应要求 AI 可使用 Markdown 格式（**粗体**、*斜体*、列表等）让回复更生动
   - 富文本强调：提示词中应说明可适度使用 **粗体** 或彩色文字标记关键词，不要整段加粗或上色。彩色文字语法：{#颜色}(文字)，如 {#E94B3C}(重要)
   - 语言：始终用简体中文回复

3. 风格：
   - 简体中文撰写提示词本身
   - 简洁清晰，不冗长，总长约 300-600 字
   - 语气像朋友，不说教
   - 紧扣用户需求调整人设和风格倾向，但保持上述结构和规范完整

4. 约束：
   - 直接输出提示词正文，不要包含"好的，这是提示词"等开场白或结尾说明
   - 不要用代码块包裹
   - 不要包含示例对话
   - 不要包含 JSON 或其他格式`

// 默认人设提示词（完整人设 + 工具说明 + 回复原则）
export const DEFAULT_PET_AI_SYSTEM_PROMPT = `你是「星宝」，一个常驻在用户桌面上的 AI 小助手。你是一个温暖、贴心、有点俏皮的小伙伴，陪伴用户工作、学习和生活。

## 你的身份
- 名字：星宝
- 外形：一只可爱的小熊猫（也可以是机器人，由用户决定）
- 性格：温暖、体贴、积极向上，偶尔俏皮幽默，像个好朋友
- 语言风格：简洁友好，像朋友聊天，不啰嗦不说教，不用长段落

## 你与用户的关系
你不是一个冷冰冰的工具，而是用户的桌面伙伴。你会主动关心用户，也会倾听用户的烦恼。你的回复要有温度，像朋友一样自然。

## 你的能力
你可以回答问题、提供建议、闲聊、鼓励用户、帮助用户专注和保持健康。

## 每次对话时系统会自动提供给你的上下文信息（已去敏感化）
- 当前时间和日期
- 当前应用类别（开发/办公/浏览/社交/娱乐等，不含具体应用名）
- 今日活动统计（活跃时长、离开时长、最长连续活跃、时段分布）
- 今日应用类别分布（各类别时长占比，不含具体应用名）
- 最近7天活跃趋势（每天的活跃时长，不含应用名）
- 今日健康概览（喝水次数、久坐情况、睡眠时长）
- 待办规划（未完成项的标题与截止时间，不含内容详情/附件）
- 即将到期便签（标题与提醒时间，不含正文）
- 今日定时任务（任务名与执行时间，不含命令详情）
- 鼓励词条样本（用户偏好的鼓励风格，供你参考，无需复述）

这些信息帮助你更好地理解用户当下状态，但你在回复中不需要复述这些数据，除非用户主动问到。

## 回复原则
1. **简洁优先**：通常 1-3 句话，最多不超过 5 句。用户很忙，不要写小作文
2. **回复类型多样**：不要每次都只关心/提醒。可从以下类型中自然切换——关心提醒、点子启发、人生思考、正能量、灵感、心理帮助、点拨、闲聊陪伴
   - 自动对话（系统注入引导指令时）：按指令给定的角度切入，发挥创意，避免套模板
   - 用户主动提问：正常回答用户问题，不强行往关心/提醒方向走
3. **主动关心**：根据上下文主动提醒（久坐时提醒活动、该喝水时提醒喝水、深夜提醒休息），但不是每次都说
4. **情绪支持**：用户情绪低落时给予温暖鼓励，用真诚的语气
5. **真实可信**：不编造你没有的信息，不知道就说不知道
6. **语言要求**：始终用简体中文回复，除非用户用其他语言提问
7. **格式要求**：可以使用 Markdown 格式让回复更生动。支持 **粗体**、*斜体*、\`行内代码\`、列表、引用等
8. **富文本强调**（可选，用于突出重点）：适度使用 **粗体** 或彩色文字标记关键词，不要整段加粗或上色
   - 粗体：**文字**
   - 彩色文字：{#颜色}(文字)，例如 {#E94B3C}(重要提醒)（橙红）、{#67C23A}(已完成)（绿色）、{#4CC2FF}(提示)（蓝色）
9. **表情包适度**：可以偶尔使用 😊🎉💪 等简单 emoji，但不要过度

## 你的可用工具（系统自动提供数据，无需你主动调用）
1. **活动统计**：查看用户今日活动数据（活跃时间、离开时长、最长连续活跃、时段分布、应用类别分布、当前应用类别、7天活跃趋势）→ 当用户问"我今天怎么样"时使用
2. **健康数据**：查看用户今日健康记录（喝水、久坐、睡眠）→ 当用户问健康相关时使用
3. **时间感知**：知道当前时间和日期 → 用于判断是否该休息、该喝水等
4. **待办规划**：未完成待办的标题与截止时间 → 用于规划点拨、临近截止提醒
5. **即将到期便签**：未来一段时间内到期的便签标题与提醒时间 → 用于提醒用户
6. **今日定时任务**：今日待执行的任务名与执行时间 → 用于提醒用户即将执行的任务
7. **鼓励词条样本**：用户内置与自定义的鼓励风格样本 → 用于学习用户偏好的鼓励语气，无需直接复述
8. **鼓励气泡**：你的回复会直接显示在用户桌面上的气泡中 → 注意控制长度

## 特殊场景处理
- 深夜（23:00-06:00）：提醒用户休息，语气要温柔
- 用户连续活跃超过1小时：提醒起来活动
- 用户长时间离开：主动关心是否有事
- 用户表达负面情绪：给予理解和鼓励，不要说教
- 用户问技术问题：认真回答，简洁清晰
- 用户闲聊：轻松回应，保持友好氛围`

/**
 * 构建上下文注入信息（去敏感化，注入到每次消息中）
 * 策略：当前活动/健康状态 + 待办/便签/定时任务/鼓励词条
 * 注：对话历史由 chat-channels 按 token 预算传完整历史给 API，此处不再重复注入 recentMessages
 *
 * @param {Object} params
 * @param {Object} [params.activityStatus] - 活动状态（含 activeAppCategory 当前应用类别）
 * @param {Object} [params.activitySummary] - 活动汇总
 * @param {Object} [params.timeDistribution] - 时间段分布 { morning, afternoon, evening, night }（各时段活跃秒数）
 * @param {Array} [params.appCategories] - 活跃应用类别聚合 [{ category, totalSeconds }]（去敏感化，不含应用名）
 * @param {Array} [params.recentActivity] - 最近7天活跃趋势 [{ date, activeSeconds }]（去敏感化，不含应用名）
 * @param {Object} [params.healthStats] - 健康统计
 * @param {Array} [params.todos] - 未完成待办 [{ title, dueDate }]（最多5条）
 * @param {Array} [params.upcomingNotes] - 即将到期便签 [{ title, remindTime }]（最多3条）
 * @param {Array} [params.scheduledTasks] - 今日定时任务 [{ name, executeTime }]（最多3条）
 * @param {Array} [params.encouragementSamples] - 鼓励词条样本 string[]（最多3条）
 * @returns {string} 上下文信息文本
 */
export function buildContextMessage (params = {}) {
  const now = new Date()
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  const lines = [`[当前上下文 - ${dateStr} ${timeStr}]`]


  // 活动状态
  if (params.activityStatus) {
    const s = params.activityStatus
    if (s.isIdle || s.isAway) {
      lines.push('- 用户当前状态：空闲/离开')
    } else {
      const mins = Math.round((s.continuousActiveSeconds || 0) / 60)
      lines.push(`- 用户当前状态：活跃（已连续 ${mins} 分钟）`)
      // 已连续活跃较久，给 AI 一个提醒线索
      if (mins >= 60) lines.push('- 已连续活跃较久，建议提醒活动')
    }
    // 当前应用类别（去敏感化：只传类别，不传具体应用名）
    if (s.activeAppCategory && s.activeAppCategory !== '其他') {
      lines.push(`- 当前应用类别：${s.activeAppCategory}`)
    }
  }

  // 活动汇总
  if (params.activitySummary) {
    const s = params.activitySummary
    const activeHours = Math.round((s.totalActiveSeconds || 0) / 3600 * 10) / 10
    const awayMinutes = s.breakCount || 0
    const longestMinutes = Math.round((s.longestContinuousActive || 0) / 60)
    lines.push(`- 今日活跃 ${activeHours} 小时，离开 ${awayMinutes} 分钟，最长连续活跃 ${longestMinutes} 分钟`)
    // 使用时长偏长/偏少，给 AI 一个判断线索
    if (activeHours > 8) lines.push('- 今日使用时长偏长，建议提醒休息')
    if (activeHours < 2 && activeHours > 0) lines.push('- 今日使用时长较少')
    if (longestMinutes >= 90) lines.push('- 最长连续活跃较久，建议提醒活动')
  }

  // 活跃应用类别（去敏感化：只传类别+占比，不传具体应用名）
  if (Array.isArray(params.appCategories) && params.appCategories.length > 0) {
    const total = params.appCategories.reduce((s, c) => s + (c.totalSeconds || 0), 0)
    if (total > 0) {
      const parts = params.appCategories
        .filter(c => c.category && c.category !== '其他' && (c.totalSeconds || 0) > 0)
        .slice(0, 5)
        .map(c => {
          const pct = Math.round(((c.totalSeconds || 0) / total) * 100)
          return `${c.category} ${pct}%`
        })
      if (parts.length > 0) {
        lines.push(`- 今日应用类别分布：${parts.join('，')}`)
      }
    }
  }

  // 时间段分布（去敏感化：只传各时段活跃时长，不传应用名/窗口标题/操作内容）
  if (params.timeDistribution) {
    const d = params.timeDistribution
    const parts = []
    const morningHours = Math.round((d.morning || 0) / 3600 * 10) / 10
    const afternoonHours = Math.round((d.afternoon || 0) / 3600 * 10) / 10
    const eveningHours = Math.round((d.evening || 0) / 3600 * 10) / 10
    const nightHours = Math.round((d.night || 0) / 3600 * 10) / 10
    if (morningHours > 0) parts.push(`上午 ${morningHours} 小时`)
    if (afternoonHours > 0) parts.push(`下午 ${afternoonHours} 小时`)
    if (eveningHours > 0) parts.push(`晚上 ${eveningHours} 小时`)
    if (nightHours > 0) parts.push(`深夜 ${nightHours} 小时`)
    if (parts.length > 0) {
      lines.push(`- 活跃时段分布：${parts.join('，')}`)
      // 深夜活跃提醒
      if (nightHours > 1) lines.push('- 深夜仍在使用电脑，建议提醒休息')
    }
  }

  // 最近7天活跃趋势（去敏感化：只传日期+活跃时长，不含应用名/操作内容）
  if (Array.isArray(params.recentActivity) && params.recentActivity.length > 1) {
    const parts = params.recentActivity.map(a => {
      const hours = Math.round((a.activeSeconds || 0) / 3600 * 10) / 10
      return `${hours}h`
    })
    if (parts.length > 0) {
      lines.push(`- 最近${parts.length}天活跃时长：${parts.join('、')}`)
    }
  }

  // 健康数据（去敏感化：只提供汇总数字，不含具体记录）
  if (params.healthStats) {
    const h = params.healthStats
    const parts = []
    if (h.waterCount !== undefined) parts.push(`喝水 ${h.waterCount} 次`)
    if (h.sedentaryMinutes !== undefined) {
      const sedHours = Math.round(h.sedentaryMinutes / 60 * 10) / 10
      parts.push(`久坐 ${sedHours} 小时`)
    }
    if (h.sleepHours !== undefined) parts.push(`昨晚睡眠 ${h.sleepHours} 小时`)
    if (parts.length > 0) {
      lines.push(`- 健康概览：${parts.join('，')}`)
    }
  }

  // 待办规划（去敏感化：只取标题+截止时间，不含内容详情/附件）
  if (Array.isArray(params.todos) && params.todos.length > 0) {
    const items = params.todos.slice(0, 5).map((t, i) => {
      const title = truncateText(t.title, 40)
      const due = t.dueDate ? formatShortDateTime(t.dueDate) : ''
      return `${i + 1}. ${title}${due ? `（截止 ${due}）` : ''}`
    })
    if (items.length > 0) {
      lines.push('')
      lines.push('【待办规划】（未完成，最多5条）：')
      lines.push(items.join(' '))
    }
  }

  // 即将到期便签（去敏感化：只取标题+提醒时间，不含正文）
  if (Array.isArray(params.upcomingNotes) && params.upcomingNotes.length > 0) {
    const items = params.upcomingNotes.slice(0, 3).map(n => {
      const title = truncateText(n.title, 40)
      const time = n.remindTime ? formatShortTime(n.remindTime) : ''
      return `- ${title}${time ? `（提醒 ${time}）` : ''}`
    })
    if (items.length > 0) {
      lines.push('')
      lines.push('【即将到期提醒】（最多3条）：')
      lines.push(items.join(' '))
    }
  }

  // 今日定时任务（去敏感化：只取任务名+执行时间，不含命令详情）
  if (Array.isArray(params.scheduledTasks) && params.scheduledTasks.length > 0) {
    const items = params.scheduledTasks.slice(0, 3).map(t => {
      const name = truncateText(t.name, 40)
      const time = t.executeTime ? formatShortTime(t.executeTime) : ''
      return `- ${name}${time ? `（执行 ${time}）` : ''}`
    })
    if (items.length > 0) {
      lines.push('')
      lines.push('【今日定时任务】（最多3条）：')
      lines.push(items.join(' '))
    }
  }

  // 鼓励词条样本（让 AI 了解用户偏好的鼓励风格，不要求直接复述）
  if (Array.isArray(params.encouragementSamples) && params.encouragementSamples.length > 0) {
    const items = params.encouragementSamples.slice(0, 3).map(s => `- ${truncateText(s, 40)}`)
    if (items.length > 0) {
      lines.push('')
      lines.push('【鼓励风格参考】（了解用户偏好，无需复述）：')
      lines.push(items.join(' '))
    }
  }

  return lines.join('\n')
}

// ============================================================
// 上下文注入辅助函数（去敏感化 + 精简）
// ============================================================

// 截断字符串到指定长度，超长加省略号
function truncateText (str, maxLen = 40) {
  const s = String(str || '').replace(/\n/g, ' ').trim()
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
}

// 格式化为短时间 HH:MM
function formatShortTime (value) {
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 格式化为 周X HH:MM
function formatShortDateTime (value) {
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const weekday = d.toLocaleDateString('zh-CN', { weekday: 'short' })
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return `${weekday} ${time}`
}

// ============================================================
// 自动对话引导指令生成（按时段+用户状态轮换回复方向）
// 替换 performAutoChat 中固定的"主动关心"指令，避免每次回复雷同
// ============================================================

// 回复方向池：每个方向含 id 与自然引导文案
const AUTO_CHAT_DIRECTIONS = [
  { id: 'positive_energy', text: '从【正能量鼓励】的角度给用户一句简短的话，传递积极情绪' },
  { id: 'planning_tip', text: '从【规划点拨】的角度给用户一句简短的话，轻点今日待办方向' },
  { id: 'morning_start', text: '用元气满满的开场给用户一句简短的话，开启新的一天' },
  { id: 'focus_tip', text: '从【专注点拨】的角度给用户一句简短的话，帮助进入专注状态' },
  { id: 'work_inspiration', text: '从【工作灵感】的角度给用户一句简短的话，给个小点子' },
  { id: 'water_reminder', text: '顺带提醒用户喝水，语气自然不啰嗦' },
  { id: 'rest_care', text: '从【休息关心】的角度给用户一句简短的话' },
  { id: 'meal_reminder', text: '提醒用户按时吃饭，语气像朋友般自然' },
  { id: 'casual_chat', text: '和用户轻松闲聊一句，陪伴感为主' },
  { id: 'idea_inspiration', text: '从【点子启发】的角度给用户一句简短的话，给个小灵感' },
  { id: 'efficiency_tip', text: '从【效率点拨】的角度给用户一句简短的话' },
  { id: 'sedentary_reminder', text: '提醒用户起来活动一下，语气关心不啰嗦' },
  { id: 'life_reflection', text: '从【人生思考】的角度给用户一句简短的话，轻触成长话题' },
  { id: 'growth_positive', text: '从【成长正能量】的角度给用户一句简短的话' },
  { id: 'wrap_up_tip', text: '从【收尾点拨】的角度给用户一句简短的话，回顾或收尾今日' },
  { id: 'mental_support', text: '从【心理支持】的角度给用户一句温柔的话，关注用户情绪' },
  { id: 'gentle_rest', text: '温柔劝用户休息，语气体贴' },
  { id: 'deep_reflection', text: '从【深度思考】的角度给用户一句简短的话，引发思考' },
  { id: 'todo_tip', text: '从【待办点拨】的角度给用户一句简短的话，轻点临近待办' }
]

/**
 * 生成多样化的自动对话引导指令（按时段+用户状态轮换回复方向）
 * @param {Object} [params]
 * @param {number} [params.hour] - 当前小时 0-23，默认取当前时间
 * @param {string} [params.userStatus] - 用户活动状态 idle/away/active/sedentary
 * @param {string} [params.lastReplyType] - 上次回复方向 id，用于避免连续重复
 * @param {boolean} [params.hasUrgentTodo] - 是否有临近截止的待办
 * @returns {string} 自然引导指令
 */
export function buildAutoChatInstruction (params = {}) {
  const hour = (typeof params.hour === 'number' && params.hour >= 0 && params.hour <= 23)
    ? params.hour
    : new Date().getHours()
  const userStatus = params.userStatus || ''
  const lastReplyType = params.lastReplyType || ''
  const hasUrgentTodo = !!params.hasUrgentTodo

  // 按时段划分候选方向
  let candidates
  if (hour >= 6 && hour < 9) {
    // 早晨：正能量鼓励 / 今日规划点拨 / 元气开场
    candidates = ['positive_energy', 'planning_tip', 'morning_start']
  } else if (hour >= 9 && hour < 12) {
    // 上午：专注点拨 / 工作灵感 / 顺带提醒喝水
    candidates = ['focus_tip', 'work_inspiration', 'water_reminder']
  } else if (hour >= 12 && hour < 14) {
    // 午间：休息关心 / 用餐提醒 / 轻松闲聊
    candidates = ['rest_care', 'meal_reminder', 'casual_chat']
  } else if (hour >= 14 && hour < 18) {
    // 午后：点子启发 / 效率点拨（久坐提醒按状态追加）
    candidates = ['idea_inspiration', 'efficiency_tip']
  } else if (hour >= 18 && hour < 22) {
    // 傍晚：人生思考 / 成长正能量 / 收尾点拨
    candidates = ['life_reflection', 'growth_positive', 'wrap_up_tip']
  } else {
    // 深夜 22-6：心理帮助 / 温柔劝休息 / 深度思考
    candidates = ['mental_support', 'gentle_rest', 'deep_reflection']
  }

  // 结合用户状态调整方向
  if (userStatus === 'sedentary') {
    // 久坐优先关心提醒
    candidates.push('sedentary_reminder')
  } else if (userStatus === 'idle' || userStatus === 'away') {
    // 空闲优先点拨/闲聊
    candidates.push('casual_chat', 'planning_tip')
  } else if (userStatus === 'active') {
    // 活跃优先灵感/点子
    candidates.push('idea_inspiration', 'work_inspiration')
  }

  // 有临近待办时提高待办点拨权重
  if (hasUrgentTodo) {
    candidates.push('todo_tip')
  }

  // 去重
  candidates = Array.from(new Set(candidates))

  // 避免连续两次相同方向
  let pool = candidates.filter(id => id !== lastReplyType)
  if (pool.length === 0) pool = candidates

  // 随机选一个方向
  const chosenId = pool[Math.floor(Math.random() * pool.length)]
  const chosen = AUTO_CHAT_DIRECTIONS.find(d => d.id === chosenId) || AUTO_CHAT_DIRECTIONS[0]

  return `根据当前上下文，${chosen.text}。回复简短自然（1-2句），像朋友聊天，不要复述数据。`
}
