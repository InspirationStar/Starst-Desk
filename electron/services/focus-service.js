// ============================================================
// 专注会话服务（主进程）
// 使用 registry.register 注册 IPC 通道，自动包装为 { ok: true, data } 标准响应格式
// 集成专注护盾：创建会话时按需启动护盾，完成/取消时停止护盾
// ============================================================

const { register } = require('../ipc/registry')
const focusSessionDao = require('../dao/focus-session-dao')

const achievementService = require('./achievement-service')
const appSettingDao = require('../dao/app-setting-dao')
const focusGuard = require('../core/focus-guard.js')
const islandWindowManager = require('../core/island-window-manager.js')
const logger = require('../core/logger.js')

// 白名单持久化键
const GUARD_WHITELIST_KEY = 'focus_guard_whitelist'

function registerFocusSessionChannels () {
  // 获取当前进行中的会话
  register('focus:get-active', async () => {
    const session = focusSessionDao.getActiveSession()
    return { session }
  })

  // 创建专注会话
  register('focus:create', async (event, data) => {
    const session = focusSessionDao.create(data)
    // 启动专注护盾（仅在 options.shieldEnabled 为 true 时启动）
    const options = (data && data.options) || {}
    if (options.shieldEnabled) {
      // 合并持久化白名单与传入白名单（传入优先）
      let whitelist = options.guardWhitelist || options.focusGuardWhitelist
      if (!Array.isArray(whitelist)) {
        // 未传入白名单时使用持久化白名单
        whitelist = appSettingDao.getJson(GUARD_WHITELIST_KEY, null) || undefined
      }
      try {
        focusGuard.startGuard({ guardWhitelist: whitelist })
      } catch (error) {
        // 护盾启动失败不影响会话创建，仅记录日志
        logger.error('FocusService', `启动专注护盾失败: ${error.message}`)
      }
    }
    // 推送专注状态到灵动岛
    try {
      const totalMs = (session.duration_seconds || session.remaining_seconds || 0) * 1000
      islandWindowManager.updateFocusState({
        active: true,
        taskName: session.title || '专注中',
        remainingMs: (session.remaining_seconds || 0) * 1000,
        totalMs
      })
    } catch (e) {
      // 灵动岛更新失败不影响会话创建
    }
    return { session }
  })

  // 更新剩余时间
  register('focus:update-remaining', async (event, data) => {
    const ok = focusSessionDao.updateRemaining(data.id, data.remainingSeconds)
    return { success: ok }
  })

  // 灵动岛专注计时器每秒 tick（渲染进程调用，更新灵动岛倒计时）
  register('focus:tick', async (event, data) => {
    try {
      islandWindowManager.updateFocusState({
        active: true,
        taskName: data.taskName || '专注中',
        remainingMs: data.remainingMs || 0,
        totalMs: data.totalMs || 0
      })
    } catch (e) {
      // 忽略灵动岛更新失败
    }
    return { success: true }
  })

  // 完成专注
  register('focus:complete', async (event, data) => {
    const session = focusSessionDao.complete(data.id)
    // 停止专注护盾
    try {
      focusGuard.stopGuard()
    } catch (error) {
      // 护盾停止失败不影响响应，仅记录日志
      logger.error('FocusService', `停止专注护盾失败: ${error.message}`)
    }
    // 通知灵动岛退出专注模式
    try {
      islandWindowManager.updateFocusState({ active: false })
    } catch (e) {
      // 忽略
    }
    // 解锁成就：复用统一的成就检查逻辑（基于全局统计量设置绝对值，避免累加语义混乱）
    if (session) {
      achievementService.checkAchievements()
    }
    return { session }
  })

  // 取消专注
  register('focus:cancel', async (event, data) => {
    const session = focusSessionDao.cancel(data.id)
    // 停止专注护盾
    focusGuard.stopGuard()
    // 通知灵动岛退出专注模式
    try {
      islandWindowManager.updateFocusState({ active: false })
    } catch (e) {
      // 忽略
    }
    return { session }
  })

  // 删除专注会话
  register('focus:delete', async (event, data) => {
    if (!data || !data.id) {
      return { ok: false, error: { code: 'REQUIRED', message: '会话 ID 不能为空' } }
    }
    const ok = focusSessionDao.del(data.id)
    return { ok: true, data: { deleted: ok } }
  })

  // 更新会话标题
  register('focus:update-title', async (event, data) => {
    if (!data || !data.id || !data.title) {
      return { ok: false, error: { code: 'REQUIRED', message: '会话 ID 和标题不能为空' } }
    }
    try {
      const { getDb } = require('../dao/database.js')
      getDb().prepare(`UPDATE ${focusSessionDao.TABLE || 'focus_sessions'} SET title = ? WHERE id = ?`).run(data.title, data.id)
      return { ok: true, data: { id: data.id, title: data.title } }
    } catch (error) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 获取历史会话
  register('focus:list', async (event, data) => {
    const result = focusSessionDao.list(data || {})
    return result
  })

  // 获取专注统计汇总（总/今日时长、次数、模式分类、最近 7 天趋势）
  register('focus:stats', async () => {
    return focusSessionDao.getStats()
  })

  // 获取已安装应用列表（供护盾白名单配置 UI）
  register('focus:guard-get-apps', async () => {
    const apps = focusGuard.getInstalledApps()
    // 同时返回已保存的白名单（用户已勾选的应用）
    const savedWhitelist = appSettingDao.getJson(GUARD_WHITELIST_KEY, [])
    return { apps, whitelist: Array.isArray(savedWhitelist) ? savedWhitelist : [] }
  })

  // 保存护盾白名单到设置
  register('focus:guard-save-whitelist', async (event, data) => {
    const whitelist = Array.isArray(data?.whitelist) ? data.whitelist : []
    appSettingDao.setJson(GUARD_WHITELIST_KEY, whitelist)
    // 若护盾正在运行，热更新白名单
    if (focusGuard.isGuardEnabled()) {
      focusGuard.startGuard({ guardWhitelist: whitelist })
    }
    return { success: true }
  })
}

module.exports = { registerFocusSessionChannels }
