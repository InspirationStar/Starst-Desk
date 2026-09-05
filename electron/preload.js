// ============================================================
// Starst Desk 预加载脚本
// 职责：通过 contextBridge 在隔离的上下文中向渲染进程暴露受控 IPC API
// 安全约束：严禁暴露 require 或 ipcRenderer 原始对象，仅暴露白名单方法
// 运行环境：Node.js（CommonJS），但运行在隔离的上下文
// ============================================================

const { contextBridge, ipcRenderer } = require('electron')

// IPC 通道白名单
// 仅允许渲染进程通过以下前缀的通道与主进程通信
// 通道命名规范：module:action（如 note:create、task:list）
const ALLOWED_CHANNELS = [
  // 便签模块
  'note:create', 'note:list', 'note:get', 'note:update', 'note:delete', 'note:mark-reminded', 'note:get-upcoming-reminders',
  // 定时任务模块
  'task:create', 'task:list', 'task:get', 'task:update', 'task:delete', 'task:toggle', 'task:history', 'task:confirm-command',
  // 健康提醒模块
  'health:get-config', 'health:update-config', 'health:record', 'health:today-stats', 'health:history', 'health:stats', 'health:pause-sedentary',
  'health:record-completion', 'health:completion-stats', 'health:auto-sleep', 'health:delete-sleep-record',
  'health:trigger-reminder',  // 手动触发健康提醒通知（用户点击"立即提醒"按钮）
  'health:get-last-reminded',  // 获取各模块最后提醒时间戳（倒计时计算）
  // AI 对话模块 - 配置管理
  'ai:config:list', 'ai:config:get', 'ai:config:create', 'ai:config:update', 'ai:config:delete', 'ai:config:activate',
  'ai:config:test-connection', 'ai:config:list-models', 'ai:config:list-by-category',
  // 会话管理 - 含流式生成入口
  'chat:session:list', 'chat:session:create', 'chat:session:delete', 'chat:session:bulk-delete', 'chat:session:update', 'chat:session:ensure-pet-assistant',
  'chat:message:list', 'chat:message:send', 'chat:message:generate', 'chat:message:stop', 'chat:message:delete', 'chat:message:create', 'chat:message:update',
  'chat:message:clear-by-session',
  'media:clear-cache',
  // 系统设置
  'system:setting:get', 'system:setting:set', 'system:autostart:get', 'system:autostart:set', 'system:export',
  'system:select-folder',
  'system:import', 'system:backup', 'system:restore',
  // 应用控制（退出/重启）
  'system:quit', 'system:restart',
  // 数据目录可配置
  'system:get-data-path', 'system:set-data-path',
  // 缓存管理
  'system:cache:stats', 'system:cache:clear',
  'system:scheduled-clear:get', 'system:scheduled-clear:set',

  // 窗口控制（无边框窗口的最小化/关闭）
  'system:window:minimize', 'system:window:close',
  'window:set-always-on-top',
  // 桌面小部件模块
  'widget:list', 'widget:get', 'widget:create', 'widget:delete', 'widget:update',
  'widget:update-bounds', 'widget:show', 'widget:hide',
  'widget:show-all', 'widget:hide-all', 'widget:toggle-all', 'widget:reset-all',
  'widget:toggle-capsule', 'widget:hotkey:get', 'widget:hotkey:set',
  'widget:hotkey:status',                       // 获取完整热键状态
  'widget:hotkey:enabled:get', 'widget:hotkey:enabled:set',  // 主热键启用/禁用
  'widget:hotkey:reset',                        // 重置主热键为默认值
  'widget:hotkey:gesture:validate',             // 校验手势合法性
  'widget:search-hotkey:get', 'widget:search-hotkey:set',    // 搜索热键读写
  'widget:search-hotkey:enabled:get', 'widget:search-hotkey:enabled:set',  // 搜索热键启用/禁用
  'widget:drag:start', 'widget:drag:move', 'widget:drag:end',
  // 窗口材质管理
  'widget:material:get', 'widget:material:set',
  // 窗口尺寸自适应（渲染进程测量内容后通知主进程调整窗口）
  'widget:resize-to-content',
  // 设置胶囊状态（公开 API，与 widget:toggle-capsule 功能相同）
  'widget:set-capsule',
  // 折叠行为配置
  'widget:get-collapse-behavior', 'widget:set-collapse-behavior',
  // 打开小部件设置页（小部件窗口请求主窗口导航）
  'widget:open-settings',
  // 位置锁/大小锁/重置位置/置顶
  'widget:toggle-position-lock', 'widget:toggle-size-lock',
  'widget:reset-position', 'widget:toggle-always-on-top',
  // 胶囊栏（多胶囊收纳）管理
  'widget:capsule-bar:create', 'widget:capsule-bar:arrange',
  'widget:capsule-bar:reorder', 'widget:capsule-bar:destroy',

  // 桌面小部件分组模块
  'widget-group:list', 'widget-group:get', 'widget-group:create',
  'widget-group:update', 'widget-group:delete',
  'widget-group:merge', 'widget-group:join', 'widget-group:detach',
  'widget-group:switch-member', 'widget-group:get-by-member',

  // 桌宠模块
  'pet:get-config', 'pet:update-config', 'pet:show', 'pet:hide', 'pet:toggle',
  'pet:set-always-on-top', 'pet:temp-always-on-top', 'pet:resize-to-content',
  'pet:pause-reminders', 'pet:resume-reminders', 'pet:get-reminders-paused', 'pet:dismiss-reminder',
  'pet:drag:start', 'pet:drag:move', 'pet:drag:end',
  'pet:set-ignore-mouse-events',
  'pet:reset-position',
  'pet:work-area',

  // 附件管理
  'chat:attachment:create', 'chat:attachment:getById',
  'chat:attachment:findByMessage', 'chat:attachment:findBySession',
  'chat:attachment:delete', 'chat:attachment:deleteByMessage',
  // Agnes AI
  'agnes:image:generate', 'agnes:video:generate',
  'agnes:video:result', 'agnes:video:poll', 'agnes:save-base64-image',
  'agnes:model:spec',
  // 通用媒体服务（DALL-E / Stability AI / Agnes 统一接口）
  'media:generate', 'media:templates', 'media:video:poll', 'media:fetch-as-data-url',
  'media:save-to-local', 'media:read-local-file',
  // 截图
  'screenshot:full', 'screenshot:window', 'screenshot:area', 'screenshot:getDir',
  'selection:open', 'selection:confirm', 'selection:cancel',

  // 活动检测模块
  'activity:get-today-stats', 'activity:get-stats-by-date',
  'activity:get-current-status', 'activity:get-summary',
  'activity:get-top-apps', 'activity:clear-data',
  'activity:get-time-distribution', 'activity:get-active-segments',
  'activity:get-app-categories', 'activity:get-uncategorized-apps',
  'activity:ai-categorize-apps', 'activity:reset-app-categories',
  'activity:get-category-config', 'activity:update-app-category',

  // 媒体资产管理（AI 生成的图片/视频资产）
  'media-asset:list', 'media-asset:get', 'media-asset:create',
  'media-asset:findByMessageIds',
  'media-asset:delete', 'media-asset:batch-delete', 'media-asset:stats', 'media-asset:updatePath',

  // 待办模块
  'todo:list', 'todo:get', 'todo:create', 'todo:update', 'todo:delete', 'todo:toggle',
  'todo:set-due-date', 'todo:set-recurrence', 'todo:set-color',
  'todo:add-attachment', 'todo:remove-attachment', 'todo:batch-update', 'todo:batch-delete',
  'todo:snooze-reminder',

  // 文件管理模块
  'file:list-widgets', 'file:get-widget', 'file:list-files', 'file:get-file-info',
  'file:copy-items', 'file:cut-items', 'file:move-items', 'file:delete-items',
  'file:rename-item', 'file:reveal-in-explorer', 'file:open-file', 'file:open-folder',
  'file:get-desktop-path', 'file:check-quicklook', 'file:create-folder',

  // 天气模块
  'weather:get-weather', 'weather:search-cities', 'weather:clear-cache',

  // 音乐模块
  'music:get-status', 'music:toggle-play', 'music:play', 'music:pause',
  'music:next-track', 'music:prev-track', 'music:set-volume', 'music:update-progress', 'music:open-app',

  // 桌面整理模块
  'desktop-organization:scan', 'desktop-organization:preview',
  'desktop-organization:execute', 'desktop-organization:undo', 'desktop-organization:history',

  // 全局搜索模块
  'search:query', 'search:history', 'search:clear-history',

  // 标签模块
  'tags:list', 'tags:get', 'tags:create', 'tags:update', 'tags:delete', 'tags:stats',

  // 应用更新模块
  'update:check', 'update:download', 'update:install', 'update:get-status',

  // 发布说明模块
  'release-notes:list', 'release-notes:get-current',

  // 待办&规划增强模块 - 任务流
  'group:list', 'group:create', 'group:update', 'group:delete',
  // 待办&规划增强模块 - 项目
  'project:list', 'project:create', 'project:update', 'project:delete',
  // 待办&规划增强模块 - 专注会话
  'focus:get-active', 'focus:create', 'focus:update-remaining', 'focus:tick',
  'focus:complete', 'focus:cancel', 'focus:list', 'focus:stats',
  'focus:delete', 'focus:update-title',
  // 专注护盾 - 白名单配置
  'focus:guard-get-apps', 'focus:guard-save-whitelist',
  // 待办&规划增强模块 - 成就
  'achievement:list', 'achievement:check', 'achievement:unlock',
  'achievement:create', 'achievement:update', 'achievement:delete',
  'achievement:update-position', 'achievement:ai-generate',
  'achievement:reset-all', 'achievement:restore-all',
  // 待办&规划增强模块 - AI 规划
  'ai-plan:create', 'ai-plan:list', 'ai-plan:apply', 'ai-plan:delete',
  // 待办&规划增强模块 - AI 长期计划
  'ai-plan:create-long', 'ai-plan:get-long-active', 'ai-plan:advance-cycle',
  'ai-plan:start-review', 'ai-plan:complete-review', 'ai-plan:abandon-long', 'ai-plan:get-context',
  // AI 对话生成规划
  'ai-chat:generate-plan',

  // 启动前检测模块
  'startup-check:retry',  // 重新检测（请求-响应）
  'startup-check:exit',    // 退出应用（单向消息）

  // 剪贴板模块
  'clipboard:read-text', 'clipboard:write-text', 'clipboard:read-image', 'clipboard:clear',

  // 灵动岛外观配置（请求-响应模式）
  'island:update-preferences',  // 实时更新灵动岛外观配置
  'island:get-preferences',     // 获取当前灵动岛外观配置
  // 灵动岛操作回传（渲染进程 -> 主进程单向消息）
  // 用户点击通知操作按钮（如健康提醒的"已喝水"/"已休息"）时回传，主进程据此执行业务逻辑
  'island:action',
  // 灵动岛隐藏请求（渲染进程 -> 主进程单向消息）
  // 灵动岛队列清空后请求主进程隐藏窗口
  'island:hide',

  // 应用导航（小部件窗口通过 invoke 请求主窗口导航到指定路由）
  'app:navigate'
]

// 主进程推送事件白名单（主进程 -> 渲染进程，通过 webContents.send）
const ALLOWED_EVENT_CHANNELS = [
  'reminder:popup',      // 应用内提醒弹窗
  'task:executed',       // 任务执行结果通知（用于实时刷新任务列表）
  'ai:stream:chunk',     // AI 流式响应增量
  'ai:stream:start',     // AI 流式响应开始
  'ai:stream:end',       // AI 流式响应结束
  'ai:stream:error',     // AI 流式响应错误
  'ai:tool-call',        // AI 工具调用事件
  'ai:context-inject',   // AI 上下文注入事件（每轮调用前显示注入内容）
  'chat:messages-changed', // 消息变更通知（跨窗口同步）
  'app:navigate',        // 主进程请求渲染进程导航到指定路由

  // 媒体生成进度推送
  'agnes:video:progress',  // Agnes 视频生成进度
  'media:video:progress',  // 通用视频生成进度

  // 桌面小部件事件
  'widget:bounds-changed',      // 小部件位置/大小变化通知
  'widget:capsule-changed',     // 小部件胶囊状态变化通知
  'widget:visibility-changed',  // 小部件显隐状态变化通知
  'widget:material-changed',    // 窗口材质变化通知（payload: { widgetType, material }，material 为 'mica'|'acrylic'|'none'）
  'widget:snap-guide',          // 拖拽吸附高亮引导通知（payload: { widgetType, edges: ['left'|'right'|'top'|'bottom'], target }）
  'widget:locks-changed',       // 小部件锁状态变化通知（payload: { widgetType, positionLock, sizeLock, alwaysOnTop }）
  'navigate-to-widget-settings', // 小部件窗口请求主窗口导航到设置页（payload: { widgetType }）

  // 桌宠事件
  'pet:reminder',                   // 桌宠提醒推送（payload: { type, title, body, source }）
  'pet:reminders-paused-changed',   // 桌宠提醒暂停状态变化通知（payload: { paused: boolean }）
  'pet:config-changed',             // 桌宠配置变化通知
  'pet:force-dismiss-reminder',     // 强制解除桌宠提醒状态（payload: { moduleType }）
  'pet:key-input',                  // 键盘敲击分类推送（payload: { category }，用于桌宠敲击反馈）



  // 应用设置变化广播（主进程 -> 渲染进程）
  // 当外观相关设置（如 accent_color）变化时，主进程向所有窗口推送此事件
  // 渲染进程据此同步应用外观，无需重新加载
  'app:setting-changed',             // 设置变化通知（payload: { key, value }）


  'selection:result',              // 选区窗口确认结果
  'selection:cancelled',            // 选区窗口取消

  // 启动前检测：主进程向检查窗口推送错误列表（payload: { errors: string[] }）
  'startup-check:errors',

  // 灵动岛事件（主进程 -> 灵动岛渲染进程）
  'island:show',                    // 显示灵动岛通知（payload: { type, title, body, icon, duration, action }）
  'island:hide',                    // 隐藏灵动岛
  'island:focus-update',             // 专注状态更新（payload: { active, taskName, remainingMs, totalMs }）

  // 桌宠工作区变化事件（主进程 -> 桌宠渲染进程）
  'pet:work-area',

  // 小部件分组切换事件
  'widget-group:switched',

  // 托盘动画事件
  'widget-tray-animation-gpu-turbo',
  'widget-tray-animation-gpu-cleanup',
  'widget-tray-animation-stop',
  'widget-tray-animation-state'
]

/**
 * 校验通道是否在白名单中
 * @param {string} channel IPC 通道名
 * @returns {boolean} 是否允许
 */
function isChannelAllowed (channel) {
  return ALLOWED_CHANNELS.includes(channel)
}

/**
 * 校验事件通道是否在白名单中
 * @param {string} channel 事件通道名
 * @returns {boolean} 是否允许
 */
function isEventChannelAllowed (channel) {
  return ALLOWED_EVENT_CHANNELS.includes(channel)
}

// ============================================================
// 通过 contextBridge 暴露受控 API 到渲染进程
// 渲染进程通过 window.electronAPI 访问
// ============================================================
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 调用主进程 IPC 方法（请求-响应模式）
   * @param {string} channel IPC 通道名（必须在白名单中）
   * @param {any} [data] 请求数据
   * @returns {Promise<any>} 主进程响应，格式为 { ok: true, data } 或 { ok: false, error: { code, message } }
   */
  invoke (channel, data) {
    if (!isChannelAllowed(channel)) {
      return Promise.reject(new Error(`IPC 通道未授权: ${channel}`))
    }
    return ipcRenderer.invoke(channel, data)
  },

  /**
   * 向主进程发送单向消息（fire-and-forget，无需响应）
   * 适用于高频场景如拖拽 move，避免 invoke 等待响应造成卡顿
   * @param {string} channel IPC 通道名（必须在白名单中）
   * @param {any} [data] 消息数据
   */
  send (channel, data) {
    if (!isChannelAllowed(channel)) {
      console.warn(`IPC 通道未授权: ${channel}`)
      return
    }
    ipcRenderer.send(channel, data)
  },

  /**
   * 监听主进程推送的事件（订阅模式，用于流式响应、提醒弹窗等）
   * @param {string} channel 事件通道名（必须在白名单中）
   * @param {Function} callback 事件回调函数
   * @returns {Function} 取消监听函数
   */
  on (channel, callback) {
    if (!isEventChannelAllowed(channel)) {
      console.warn(`事件通道未授权: ${channel}`)
      return () => {}
    }
    const handler = (event, ...args) => callback(...args)
    ipcRenderer.on(channel, handler)
    // 返回取消监听函数，便于组件卸载时清理
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /**
   * 单次监听主进程推送的事件（once 模式）
   * @param {string} channel 事件通道名
   * @param {Function} callback 事件回调函数
   */
  once (channel, callback) {
    if (!isEventChannelAllowed(channel)) {
      console.warn(`事件通道未授权: ${channel}`)
      return
    }
    ipcRenderer.once(channel, (event, ...args) => callback(...args))
  },

  /**
   * 移除事件监听器
   * @param {string} channel 事件通道名
   * @param {Function} listener 要移除的监听函数
   */
  removeAllListeners (channel) {
    if (!isEventChannelAllowed(channel)) {
      return
    }
    ipcRenderer.removeAllListeners(channel)
  }
})