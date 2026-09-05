// ============================================================
// 全局搜索服务（主进程）
// 职责：聚合搜索便签、待办、任务、文件、设置项
//      / SystemFontCatalogService / WindowsIndexSearchService
// ============================================================

const path = require('path')
const fs = require('fs')
const os = require('os')
const { app } = require('electron')
const { execFile } = require('child_process')
const logger = require('./../core/logger.js')
// 复用已有应用设置 DAO：搜索历史持久化
const appSettingDao = require('./../dao/app-setting-dao.js')

// ============================================================
// 搜索历史持久化（内存 + app_settings 持久化）
// 启动时从 app_settings 加载，addHistory/clearHistory 同步回写
// ============================================================
const searchHistory = []
const MAX_HISTORY = 50
const HISTORY_KEY = 'search_history'

/**
 * 从 app-setting-dao 加载搜索历史到内存
 * 模块初始化时调用，数据库未就绪时静默失败（保持空数组，下次写入时再持久化）
 */
function loadHistoryFromStorage () {
  try {
    const stored = appSettingDao.getJson(HISTORY_KEY, [])
    if (Array.isArray(stored) && stored.length > 0) {
      // 替换内存数组内容（保持引用）
      searchHistory.length = 0
      searchHistory.push(...stored)
      logger.info('SearchService', `搜索历史已从持久化加载: ${searchHistory.length} 条`)
    }
  } catch (error) {
    logger.warn('SearchService', `加载搜索历史失败: ${error.message}`)
  }
}

/**
 * 同步内存搜索历史到 app-setting-dao
 */
function saveHistoryToStorage () {
  try {
    appSettingDao.setJson(HISTORY_KEY, searchHistory)
  } catch (error) {
    logger.warn('SearchService', `保存搜索历史失败: ${error.message}`)
  }
}

/**
 * 添加搜索词到历史
 * @param {string} query
 */
function addHistory (query) {
  if (!query || query.trim() === '') return
  const existing = searchHistory.find(h => h.query === query)
  if (existing) {
    existing.count = (existing.count || 1) + 1
    existing.lastTime = new Date().toISOString()
  } else {
    searchHistory.unshift({ query, count: 1, lastTime: new Date().toISOString() })
  }
  if (searchHistory.length > MAX_HISTORY) {
    searchHistory.length = MAX_HISTORY
  }
  // 同步写入持久化
  saveHistoryToStorage()
}

/**
 * 获取搜索历史
 * @returns {Array}
 */
function getHistory () {
  return [...searchHistory]
}

/**
 * 清除搜索历史
 */
function clearHistory () {
  searchHistory.length = 0
  // 同步清除持久化
  saveHistoryToStorage()
}

// 模块初始化时加载持久化的搜索历史
loadHistoryFromStorage()

// ============================================================
// 用 PowerShell 调用 System.Drawing.Text.InstalledFontCollection 枚举已安装字体
// 懒加载 + 缓存，排序去重；非 Windows 平台返回空数组
// ============================================================

let systemFontsCache = null

/**
 * 获取系统已安装字体族列表（排序去重）
 * @param {boolean} useCache 是否使用缓存（默认 true）
 * @returns {Promise<Array<string>>}
 */
async function getSystemFonts (useCache = true) {
  if (useCache && systemFontsCache) {
    return systemFontsCache
  }

  if (process.platform !== 'win32') {
    systemFontsCache = []
    return systemFontsCache
  }

  return new Promise((resolve) => {
    // 用 PowerShell 调用 .NET InstalledFontCollection 枚举字体
    const script = [
      'Add-Type -AssemblyName System.Drawing',
      '$fonts = (New-Object System.Drawing.Text.InstalledFontCollection).Families',
      '$names = @()',
      'foreach ($f in $fonts) {',
      '  $name = $f.Name',
      "  if ($name -and $name.Trim() -ne '' -and -not $name.StartsWith('@')) {",
      '    $names += $name.Trim()',
      '  }',
      '}',
      "$names | Sort-Object -Unique -Culture 'zh-CN' | ConvertTo-Json -Compress"
    ].join('\n')
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', script
    ], { timeout: 8000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        // 字体枚举是便利功能，API/驱动失败应降级为空列表，不影响应用启动
        logger.warn('SearchService', `系统字体枚举失败: ${err.message}`)
        systemFontsCache = []
        return resolve(systemFontsCache)
      }

      try {
        const text = stdout.toString('utf8').trim()
        if (!text) {
          systemFontsCache = []
          return resolve(systemFontsCache)
        }
        // PowerShell 单元素时输出非数组 JSON，需统一为数组
        let list
        if (text.startsWith('[')) {
          list = JSON.parse(text)
        } else {
          list = [JSON.parse(text)]
        }
        systemFontsCache = normalizeFontFamilies(list)
        logger.info('SearchService', `系统字体枚举完成: ${systemFontsCache.length} 个字体族`)
        resolve(systemFontsCache)
      } catch (parseErr) {
        // 解析失败降级为空列表
        logger.warn('SearchService', `系统字体输出解析失败: ${parseErr.message}`)
        systemFontsCache = []
        resolve(systemFontsCache)
      }
    })
  })
}

/**
 * 规范化字体族列表（去重 + 排序 + 过滤）
 * @param {Array<string>} values
 * @returns {Array<string>}
 */
function normalizeFontFamilies (values) {
  const seen = new Set()
  const result = []
  for (const v of values) {
    if (!v || typeof v !== 'string') continue
    const trimmed = v.trim()
    // 过滤空白和以 @ 开头的垂直字体
    if (!trimmed || trimmed.startsWith('@')) continue
    const lower = trimmed.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    result.push(trimmed)
  }
  // 按当前文化排序（zh-CN），失败时回退 localeCompare
  try {
    result.sort(new Intl.Collator('zh-CN').compare)
  } catch {
    result.sort((a, b) => a.localeCompare(b))
  }
  return result
}

// ============================================================
// 用文件系统扫描模拟 Windows Search 索引（UseIndexerWhenAvailable 的回退路径）
// 覆盖用户库目录 + 自定义路径 + 开始菜单，按相关度 + 修改时间排序
// ============================================================

const INDEX_SEARCH_BUDGET_MS = 900

/**
 * 通过 Windows 索引搜索文件
 * @param {string} query 搜索词
 * @param {number} maxResults 最大结果数
 * @param {object} options { customPaths } 自定义索引路径
 * @returns {Promise<Array>}
 */
async function searchWindowsIndex (query, maxResults = 30, options = {}) {
  if (!query || query.trim() === '' || maxResults <= 0) {
    return []
  }

  const normalizedQuery = query.trim()
  const roots = getIndexedRoots(options.customPaths)

  // 并行搜索所有根目录，每个目录都有预算超时
  const batches = await Promise.all(
    roots.map(root => searchFolderWithIndex(root, normalizedQuery, maxResults))
  )

  const results = batches.flat()
  results.sort((a, b) => {
    if ((b.relevanceScore || 0) !== (a.relevanceScore || 0)) {
      return (b.relevanceScore || 0) - (a.relevanceScore || 0)
    }
    return new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0)
  })

  return results.slice(0, maxResults)
}

/**
 * 获取 Windows Search 索引覆盖的根目录
 * @param {Array<string>} customPaths 自定义索引路径
 * @returns {Array<string>}
 */
function getIndexedRoots (customPaths = []) {
  const roots = []
  const userProfile = os.homedir()

  // 用户库目录（Desktop/Documents/Downloads/Pictures/Music/Videos）
  const defaultDirs = [
    path.join(userProfile, 'Desktop'),
    path.join(userProfile, 'Documents'),
    path.join(userProfile, 'Downloads'),
    path.join(userProfile, 'Pictures'),
    path.join(userProfile, 'Music'),
    path.join(userProfile, 'Videos')
  ]
  for (const dir of defaultDirs) {
    if (dir && fs.existsSync(dir)) {
      roots.push(dir)
    }
  }

  // 自定义索引路径
  for (const p of customPaths) {
    if (p && p.trim() && fs.existsSync(p)) {
      roots.push(p)
    }
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    const programData = process.env.ProgramData
    if (appData) {
      const userPrograms = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      if (fs.existsSync(userPrograms)) roots.push(userPrograms)
    }
    if (programData) {
      const commonPrograms = path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      if (fs.existsSync(commonPrograms)) roots.push(commonPrograms)
    }
  }

  // 去重（大小写不敏感）
  const seen = new Set()
  const unique = []
  for (const r of roots) {
    const resolved = path.resolve(r)
    const lower = resolved.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      unique.push(resolved)
    }
  }
  return unique
}

/**
 * 在指定根目录下搜索文件（文件系统扫描，模拟 Windows 索引）
 * 限制扫描深度和数量，避免性能问题
 * @param {string} rootPath
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<Array>}
 */
async function searchFolderWithIndex (rootPath, query, maxResults) {
  const results = []
  const lowerQuery = query.toLowerCase()

  // 扫描预算：深度 4 层、最多 2000 个条目，避免性能问题
  const MAX_DEPTH = 4
  const MAX_SCAN = 2000
  let scanned = 0

  function scan (dir, depth) {
    if (depth > MAX_DEPTH || results.length >= maxResults || scanned >= MAX_SCAN) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      // 权限不足或路径不存在，静默跳过
      return
    }
    for (const entry of entries) {
      if (results.length >= maxResults || scanned >= MAX_SCAN) return
      scanned++
      const name = entry.name
      // 跳过隐藏/系统文件
      if (name.startsWith('.') || name === 'desktop.ini' || name === 'Thumbs.db') continue

      if (name.toLowerCase().includes(lowerQuery)) {
        const fullPath = path.join(dir, name)
        let stat
        try {
          stat = fs.statSync(fullPath)
        } catch {
          continue
        }
        const isDir = entry.isDirectory()
        results.push({
          type: isDir ? 'folder' : 'file',
          id: fullPath,
          title: name,
          subtitle: dir,
          icon: isDir ? 'Folder' : 'Document',
          path: fullPath,
          payload: { fullPath, isDirectory: isDir },
          modifiedAt: stat.mtime.toISOString(),
          relevanceScore: computeRelevance(name, query)
        })
      }

      // 递归子目录
      if (entry.isDirectory() && depth < MAX_DEPTH) {
        scan(path.join(dir, name), depth + 1)
      }
    }
  }

  try {
    scan(rootPath, 0)
  } catch (err) {
    logger.warn('SearchService', `索引搜索 ${rootPath} 失败: ${err.message}`)
  }

  return results
}

/**
 * 计算搜索相关度
 * 完全匹配 95 > 无扩展名完全匹配 85 > 前缀匹配 75 > 无扩展名前缀匹配 65 > 包含 45 > 其他 35
 * @param {string} fileName
 * @param {string} query
 * @returns {number}
 */
function computeRelevance (fileName, query) {
  const lowerName = fileName.toLowerCase()
  const lowerQuery = query.toLowerCase()
  if (lowerName === lowerQuery) return 95.0
  if (lowerName.startsWith(lowerQuery)) return 75.0
  const nameWithoutExt = path.basename(fileName, path.extname(fileName))
  const lowerNameNoExt = nameWithoutExt.toLowerCase()
  if (lowerNameNoExt === lowerQuery) return 85.0
  if (lowerNameNoExt.startsWith(lowerQuery)) return 65.0
  if (lowerName.includes(lowerQuery)) return 45.0
  return 35.0
}

// ============================================================
// 各数据源搜索
// ============================================================

/**
 * 搜索便签
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function searchNotes (query, limit = 20) {
  try {
    const noteDao = require('./../dao/note-dao.js')
    const all = noteDao.list({ limit: 1000 })
    const q = query.toLowerCase()
    return all
      .filter(n => {
        const title = (n.title || '').toLowerCase()
        const body = (n.body || '').toLowerCase()
        return title.includes(q) || body.includes(q)
      })
      .slice(0, limit)
      .map(n => ({
        type: 'note',
        id: n.id,
        title: n.title || '无标题便签',
        subtitle: (n.body || '').slice(0, 80),
        icon: 'EditPen',
        path: `/notes`,
        payload: { id: n.id }
      }))
  } catch (error) {
    logger.warn('SearchService', `搜索便签失败: ${error.message}`)
    return []
  }
}

/**
 * 搜索待办
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function searchTodos (query, limit = 20) {
  try {
    const todoDao = require('./../dao/todo-dao.js')
    const all = todoDao.list({ limit: 1000 })
    const items = Array.isArray(all) ? all : (all?.items || all?.list || [])
    const q = query.toLowerCase()
    return items
      .filter(t => (t.title || '').toLowerCase().includes(q))
      .slice(0, limit)
      .map(t => ({
        type: 'todo',
        id: t.id,
        title: t.title || '无标题待办',
        subtitle: t.is_enabled ? '未完成' : '已完成',
        icon: 'List',
        path: `/todo`,
        payload: { id: t.id }
      }))
  } catch (error) {
    logger.warn('SearchService', `搜索待办失败: ${error.message}`)
    return []
  }
}

/**
 * 搜索定时任务
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function searchTasks (query, limit = 20) {
  try {
    const taskDao = require('./../dao/task-dao.js')
    const all = taskDao.list({})
    const items = Array.isArray(all) ? all : (all?.items || all?.list || [])
    const q = query.toLowerCase()
    return items
      .filter(t => (t.name || '').toLowerCase().includes(q))
      .slice(0, limit)
      .map(t => ({
        type: 'task',
        id: t.id,
        title: t.name,
        subtitle: t.task_type === 'one_shot' ? '单次任务' : '重复任务',
        icon: 'AlarmClock',
        path: `/tasks`,
        payload: { id: t.id }
      }))
  } catch (error) {
    logger.warn('SearchService', `搜索任务失败: ${error.message}`)
    return []
  }
}

/**
 * 搜索 AI 会话
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function searchChatSessions (query, limit = 20) {
  try {
    const chatSessionDao = require('./../dao/chat-session-dao.js')
    const all = chatSessionDao.list()
    const items = Array.isArray(all) ? all : (all?.items || all?.list || [])
    const q = query.toLowerCase()
    return items
      .filter(s => (s.title || '').toLowerCase().includes(q))
      .slice(0, limit)
      .map(s => ({
        type: 'chat',
        id: s.id,
        title: s.title || '未命名会话',
        subtitle: 'AI 对话',
        icon: 'ChatDotRound',
        path: `/ai-chat`,
        payload: { id: s.id }
      }))
  } catch (error) {
    logger.warn('SearchService', `搜索会话失败: ${error.message}`)
    return []
  }
}

/**
 * 搜索设置项（静态路由表）
 * @param {string} query
 * @returns {Promise<Array>}
 */
async function searchSettings (query) {
  const settings = [
    { title: '便签提醒', path: '/notes', icon: 'EditPen' },
    { title: '待办&规划', path: '/todo', icon: 'List' },
    { title: '定时任务', path: '/tasks', icon: 'AlarmClock' },
    { title: '健康提醒', path: '/health', icon: 'FirstAidKit' },
    { title: '健康统计', path: '/health/stats', icon: 'DataAnalysis' },
    { title: 'AI 对话', path: '/ai-chat', icon: 'ChatDotRound' },
    { title: 'AI 模型配置', path: '/ai-chat/config', icon: 'Setting' },
    { title: '资产盒子', path: '/ai-chat/assets', icon: 'Picture' },
    { title: '小部件管理', path: '/widgets/settings', icon: 'Grid' },
    { title: '桌宠配置', path: '/pet/settings', icon: 'Pointer' },
    { title: '活动统计', path: '/activity/stats', icon: 'DataAnalysis' },
    { title: '应用设置', path: '/settings', icon: 'Setting' }
  ]
  const q = query.toLowerCase()
  return settings
    .filter(s => s.title.toLowerCase().includes(q))
    .map(s => ({
      type: 'settings',
      id: s.path,
      title: s.title,
      subtitle: '页面导航',
      icon: s.icon,
      path: s.path,
      payload: {}
    }))
}

/**
 * 搜索桌面文件（轻量级，不递归子目录）
 * 保留原有桌面扫描逻辑，作为索引搜索的补充
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function searchDesktopFiles (query, limit = 30) {
  try {
    let desktopPath
    try {
      desktopPath = app.getPath('desktop')
    } catch {
      desktopPath = path.join(os.homedir(), 'Desktop')
    }
    if (!fs.existsSync(desktopPath)) return []

    const q = query.toLowerCase()
    const results = []

    function scan (dir, depth = 0) {
      if (depth > 1 || results.length >= limit) return
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (results.length >= limit) return
        const name = entry.name
        // 跳过隐藏文件和系统文件
        if (name.startsWith('.') || name === 'desktop.ini') continue
        if (name.toLowerCase().includes(q)) {
          const fullPath = path.join(dir, name)
          results.push({
            type: entry.isDirectory() ? 'folder' : 'file',
            id: fullPath,
            title: name,
            subtitle: fullPath,
            icon: entry.isDirectory() ? 'Folder' : 'Document',
            path: fullPath,
            payload: { fullPath, isDirectory: entry.isDirectory() }
          })
        }
        // 递归一级子目录
        if (entry.isDirectory() && depth === 0) {
          scan(path.join(dir, name), depth + 1)
        }
      }
    }

    scan(desktopPath)
    return results.slice(0, limit)
  } catch (error) {
    logger.warn('SearchService', `搜索桌面文件失败: ${error.message}`)
    return []
  }
}

// ============================================================
// 聚合搜索
// ============================================================

/**
 * 执行聚合搜索
 * @param {string} query 搜索词
 * @param {object} options { type, limit, customPaths }
 *   - type: 'all' | 'note' | 'todo' | 'task' | 'chat' | 'settings' | 'file' | 'folder'
 *   - limit: 每类最大结果数
 *   - customPaths: 自定义索引搜索路径
 * @returns {Promise<object>} { results, history }
 */
async function search (query, options = {}) {
  const q = (query || '').trim()
  if (!q) {
    return { results: [], history: getHistory() }
  }

  const type = options.type || 'all'
  const limit = options.limit || 20

  // 记入历史
  addHistory(q)

  const tasks = []
  if (type === 'all' || type === 'note') tasks.push(searchNotes(q, limit))
  if (type === 'all' || type === 'todo') tasks.push(searchTodos(q, limit))
  if (type === 'all' || type === 'task') tasks.push(searchTasks(q, limit))
  if (type === 'all' || type === 'chat') tasks.push(searchChatSessions(q, limit))
  if (type === 'all' || type === 'settings') tasks.push(searchSettings(q))
  if (type === 'all' || type === 'file' || type === 'folder') {
    // 优先使用 Windows 索引搜索（覆盖更广），桌面扫描作为补充
    tasks.push(searchWindowsIndex(q, limit, { customPaths: options.customPaths }))
    tasks.push(searchDesktopFiles(q, limit))
  }

  const settled = await Promise.allSettled(tasks)
  const results = []
  for (const r of settled) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      results.push(...r.value)
    }
  }

  // 去重（按 id + path）
  const seenIds = new Set()
  const deduped = []
  for (const r of results) {
    const key = `${r.type}:${r.id || r.path || r.title}`
    if (!seenIds.has(key)) {
      seenIds.add(key)
      deduped.push(r)
    }
  }

  // 按类型排序：设置 > 便签 > 待办 > 任务 > 会话 > 文件 > 文件夹
  const typeOrder = { settings: 0, note: 1, todo: 2, task: 3, chat: 4, file: 5, folder: 6 }
  deduped.sort((a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99))

  return { results: deduped, history: getHistory() }
}

module.exports = {
  search,
  getHistory,
  clearHistory,
  addHistory,
  getSystemFonts,
  normalizeFontFamilies,
  searchWindowsIndex,
  getIndexedRoots,
  computeRelevance
}
