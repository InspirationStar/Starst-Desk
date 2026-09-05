// ============================================================
// IPC 客户端封装
// 职责：统一渲染进程调用主进程 IPC 的入口，简化调用与错误处理
// 渲染进程通过此模块调用，不直接使用 window.electronAPI
// ============================================================

/**
 * 将数据转为可被 Electron 结构化克隆算法传输的纯对象
 * Vue reactive/ref 对象是 Proxy，无法被结构化克隆，会报 "An object could not be cloned."
 * 在 IPC 入口统一清洗，从根源杜绝 Proxy 传入，调用方无需各自处理
 * @param {any} data - 待清洗的数据
 * @returns {any} 不含 Proxy 的纯数据（基本类型原样返回，null/undefined 原样返回）
 */
function toPlain (data) {
  if (data == null || typeof data !== 'object') return data
  try {
    return JSON.parse(JSON.stringify(data))
  } catch (e) {
    // 含 BigInt/循环引用等无法 JSON 序列化的值，原样返回交由 IPC 层报错暴露问题
    return data
  }
}

/**
 * 调用主进程 IPC 方法
 * @param {string} channel IPC 通道名（格式：module:action）
 * @param {any} [data] 请求数据
 * @returns {Promise<any>} 主进程返回的 data 部分（成功时）
 * @throws {Error} 当主进程返回 { ok: false } 时抛出包含 code 与 message 的错误
 */
export async function invoke (channel, data) {
  const response = await window.electronAPI.invoke(channel, toPlain(data))

  // 统一响应格式：{ ok: true, data } 或 { ok: false, error: { code, message } }
  if (response && response.ok) {
    return response.data
  }

  // 主进程返回错误
  const error = response?.error || {}
  const err = new Error(error.message || `IPC 调用失败: ${channel}`)
  err.code = error.code || 'IPC_ERROR'
  err.channel = channel
  throw err
}

/**
 * 直接调用主进程 IPC 并返回原始响应（用于不走 registry.js 包装的 handler）
 * 部分 handler（如 todo-service）直接用 ipcMain.handle 注册，返回 { list, ... } / { error }
 * 此函数检查 response.error 字段判断成败，成功时返回整个 response
 * @param {string} channel IPC 通道名
 * @param {any} [data] 请求数据
 * @returns {Promise<any>} 主进程返回的响应对象
 * @throws {Error} 当响应包含 error 字段时抛出
 */
export async function rawInvoke (channel, data) {
  const response = await window.electronAPI.invoke(channel, toPlain(data))
  if (response && response.error) {
    const err = new Error(response.error.message || `IPC 调用失败: ${channel}`)
    err.code = response.error.code || 'IPC_ERROR'
    err.channel = channel
    throw err
  }
  return response
}

/**
 * 向主进程发送单向消息（fire-and-forget，无需等待响应）
 * 适用于高频场景如拖拽 move
 * @param {string} channel IPC 通道名（格式：module:action）
 * @param {any} [data] 消息数据
 */
export function send (channel, data) {
  window.electronAPI.send(channel, toPlain(data))
  // 返回已解决的 Promise，使调用方可安全使用 .catch() 链
  // （fire-and-forget 语义不变，IPC 已同步发出，此处仅补全返回值）
  return Promise.resolve()
}

/**
 * 监听主进程推送事件
 * @param {string} channel 事件通道名
 * @param {Function} callback 回调函数
 * @returns {Function} 取消监听函数
 */
export function on (channel, callback) {
  return window.electronAPI.on(channel, callback)
}

/**
 * 单次监听主进程推送事件
 * @param {string} channel 事件通道名
 * @param {Function} callback 回调函数
 */
export function once (channel, callback) {
  return window.electronAPI.once(channel, callback)
}

/**
 * 移除事件所有监听器
 * @param {string} channel 事件通道名
 */
export function removeAllListeners (channel) {
  return window.electronAPI.removeAllListeners(channel)
}

// ============================================================
// 按模块分组的便捷 API
// 后续任务会为每个模块扩展具体方法
// ============================================================
export const noteApi = {
  create: (data) => invoke('note:create', data),
  list: (params) => invoke('note:list', params),
  get: (id) => invoke('note:get', { id }),
  update: (data) => invoke('note:update', data),
  delete: (id) => invoke('note:delete', { id }),
  markReminded: (id) => invoke('note:mark-reminded', { id }),
  // 查询指定时间范围内即将到期的未完成便签（供桌宠待办提醒）
  // from/to 为 ISO 8601 时间字符串，返回 { list }
  getUpcomingReminders: (from, to) => invoke('note:get-upcoming-reminders', { from, to })
}

export const taskApi = {
  create: (data) => invoke('task:create', data),
  list: (params) => invoke('task:list', params),
  get: (id) => invoke('task:get', { id }),
  update: (data) => invoke('task:update', data),
  delete: (id) => invoke('task:delete', { id }),
  toggle: (id, enabled) => invoke('task:toggle', { id, enabled }),
  history: (taskId, params) => invoke('task:history', { task_id: taskId, ...params }),
  confirmCommand: () => invoke('task:confirm-command')
}

// ============================================================
// 规划待办 API 分组
// 通道命名规范：todo:action
// 用于待办事项 CRUD、完成状态切换、截止日期/重复规则/颜色/附件管理
// ============================================================
export const todoApi = {
  // 获取待办列表（支持 filter/page/size 参数）
  list: (params) => rawInvoke('todo:list', params),
  // 获取单个待办
  get: (id) => rawInvoke('todo:get', { id }),
  // 创建待办
  create: (data) => rawInvoke('todo:create', data),
  // 更新待办
  update: (data) => rawInvoke('todo:update', data),
  // 删除待办
  delete: (id) => rawInvoke('todo:delete', { id }),
  // 切换待办完成状态（enabled: 1=未完成/激活，0=已完成）
  toggle: (id, enabled) => rawInvoke('todo:toggle', { id, enabled }),
  // 设置截止日期
  setDueDate: (id, dueDate) => rawInvoke('todo:set-due-date', { id, dueDate }),
  // 设置重复规则
  setRecurrence: (id, recurrence) => rawInvoke('todo:set-recurrence', { id, recurrence }),
  // 设置颜色标签
  setColor: (id, color) => rawInvoke('todo:set-color', { id, color }),
  // 添加附件
  addAttachment: (id, attachment) => rawInvoke('todo:add-attachment', { id, attachment }),
  // 移除附件
  removeAttachment: (id, attachmentId) => rawInvoke('todo:remove-attachment', { id, attachmentId }),
  // 批量更新
  batchUpdate: (ids, data) => rawInvoke('todo:batch-update', { ids, data }),
  // 批量删除
  batchDelete: (ids) => rawInvoke('todo:batch-delete', { ids })
}

export const healthApi = {
  getConfig: (moduleType) => invoke('health:get-config', { module_type: moduleType }),
  setConfig: (data) => invoke('health:update-config', data),
  addRecord: (data) => invoke('health:record', data),
  listRecords: (params) => invoke('health:history', params),
  getStats: (params) => invoke('health:stats', params),
  // 手动触发健康提醒通知（用户点击"立即提醒"按钮时调用）
  triggerReminder: (moduleType) => invoke('health:trigger-reminder', { module_type: moduleType }),
  // 获取各模块最后提醒时间戳（用于计算倒计时剩余秒数）
  getLastReminded: () => invoke('health:get-last-reminded')
}

export const aiApi = {
  listConfigs: () => invoke('ai:config:list'),
  getConfig: (id) => invoke('ai:config:get', { id }),
  createConfig: (data) => invoke('ai:config:create', data),
  updateConfig: (data) => invoke('ai:config:update', data),
  deleteConfig: (id) => invoke('ai:config:delete', { id }),
  activateConfig: (id) => invoke('ai:config:activate', { id }),
  testConnection: (data) => invoke('ai:config:test-connection', data),
  listModels: (data) => invoke('ai:config:list-models', data),
  // 按模型类别查询配置列表（language / image / video）
  listConfigsByCategory: (category) => invoke('ai:config:list-by-category', { category })
}

export const chatApi = {
  listSessions: () => invoke('chat:session:list'),
  createSession: (data) => invoke('chat:session:create', data),
  deleteSession: (id) => invoke('chat:session:delete', { id }),
  bulkDeleteSessions: (ids) => invoke('chat:session:bulk-delete', { ids }),
  updateSession: (data) => invoke('chat:session:update', data),
  ensurePetAssistantSession: (data) => invoke('chat:session:ensure-pet-assistant', data),
  listMessages: (sessionId) => invoke('chat:message:list', { session_id: sessionId }),
  sendMessage: (data) => invoke('chat:message:send', data),
  generateMessage: (data) => invoke('chat:message:generate', data),
  stopGeneration: (sessionId) => invoke('chat:message:stop', { session_id: sessionId }),
  deleteMessage: (id) => invoke('chat:message:delete', { id }),
  clearMessagesBySession: (sessionId) => invoke('chat:message:clear-by-session', { session_id: sessionId }),
  createMessage: (data) => invoke('chat:message:create', data),
  updateMessage: (data) => invoke('chat:message:update', data),

  // 附件管理
  createAttachment: (data) => invoke('chat:attachment:create', data),
  getAttachment: (id) => invoke('chat:attachment:getById', { id }),
  findAttachmentsByMessage: (messageId) => invoke('chat:attachment:findByMessage', { message_id: messageId }),
  findAttachmentsBySession: (sessionId) => invoke('chat:attachment:findBySession', { session_id: sessionId }),
  deleteAttachment: (id) => invoke('chat:attachment:delete', { id }),
  deleteAttachmentsByMessage: (messageId) => invoke('chat:attachment:deleteByMessage', { message_id: messageId })
}

export const systemApi = {
  getSetting: (key) => invoke('system:setting:get', { key }),
  setSetting: (key, value) => invoke('system:setting:set', { key, value }),
  getAutoStart: () => invoke('system:autostart:get'),
  setAutoStart: (enabled) => invoke('system:autostart:set', { enabled }),
  exportConfig: () => invoke('system:export'),
  // 导入配置（从 JSON 文件）
  importConfig: () => invoke('system:import'),
  // 完整数据备份
  backup: () => invoke('system:backup'),
  // 从备份文件恢复数据
  restore: () => invoke('system:restore'),
  // 弹出系统文件夹选择对话框，返回 { path, cancelled }
  selectFolder: (options) => invoke('system:select-folder', options || {}),

  // 窗口控制（无边框窗口自定义按钮使用）
  minimizeWindow: () => invoke('system:window:minimize'),
  closeWindow: () => invoke('system:window:close'),

  // 应用控制
  quit: () => invoke('system:quit'),
  restart: () => invoke('system:restart'),

  // 缓存管理
  getCacheStats: () => invoke('system:cache:stats'),
  clearCache: (type) => invoke('system:cache:clear', { type: type || 'all' }),
  getLastClearTime: () => invoke('system:scheduled-clear:get').then(r => r.lastClearTime),
  getScheduledClearConfig: () => invoke('system:scheduled-clear:get'),
  setScheduledClearConfig: (hours) => invoke('system:scheduled-clear:set', { intervalHours: hours }),

  // 数据目录可配置
  // 获取当前数据目录信息 { currentPath, customPath, defaultPath, dbFilePath }
  getDataPath: () => invoke('system:get-data-path'),
  // 设置自定义数据目录路径（传入 null/空字符串恢复默认）
  // 返回 { savedPath, defaultPath, needRestart, message }
  setDataPath: (targetPath) => invoke('system:set-data-path', { path: targetPath })
}

// ============================================================
// 灵动岛 API 分组
// 通道命名规范：island:action
// 用于灵动岛外观配置（缩放/透明度/锚点/偏移/层级/显示时长）
// ============================================================
export const islandApi = {
  // 实时更新灵动岛外观配置（同时持久化到 app_settings 并应用到窗口）
  // prefs: { islandScale, islandOpacity, islandAnchor, islandOffsetX, islandOffsetY, islandLayer, islandDuration }
  updatePreferences: (prefs) => invoke('island:update-preferences', prefs),
  // 获取当前灵动岛外观配置
  getPreferences: () => invoke('island:get-preferences')
}

// ============================================================
// 桌面小部件 API 分组
// 通道命名规范：widget:action
// 用于小部件窗口管理与设置页配置
// ============================================================
export const fileApi = {
  // 获取文件格子列表
  listWidgets: () => invoke('file:list-widgets'),
  // 获取单个文件格子配置
  getWidget: (type) => invoke('file:get-widget', { widgetType: type }),
  // 列出文件夹内容
  listFiles: (path) => invoke('file:list-files', { path }),
  // 获取文件详情
  getFile: (path) => invoke('file:get-file-info', { path }),
  // 复制文件
  copyItems: (items, destPath) => invoke('file:copy-items', { items, destPath }),
  // 剪切文件
  cutItems: (items) => invoke('file:cut-items', { items }),
  // 移动文件
  moveItems: (items, destPath) => invoke('file:move-items', { items, destPath }),
  // 删除文件
  deleteItems: (items) => invoke('file:delete-items', { items }),
  // 重命名文件
  renameItem: (oldPath, newPath) => invoke('file:rename-item', { oldPath, newPath }),
  // 在资源管理器中显示
  revealInExplorer: (path) => invoke('file:reveal-in-explorer', { path }),
  // 打开文件
  openFile: (path) => invoke('file:open-file', { path }),
  // 打开文件夹
  openFolder: (path) => invoke('file:open-folder', { path }),
  // 获取桌面路径
  getDesktopPath: () => invoke('file:get-desktop-path').then(r => r?.path || ''),
  // 检查 QuickLook 是否运行
  checkQuickLook: () => invoke('file:check-quicklook'),
  // 创建文件夹
  createFolder: (parentPath, folderName) => invoke('file:create-folder', { parentPath, folderName })
}

export const widgetApi = {
  // 获取所有小部件配置列表
  list: () => invoke('widget:list'),
  // 获取单个小部件配置
  get: (type) => invoke('widget:get', { widgetType: type }),
  // 创建/启用小部件
  create: (type) => invoke('widget:create', { widgetType: type }),
  // 删除/禁用小部件
  delete: (type) => invoke('widget:delete', { widgetType: type }),
  // 更新小部件配置（大小、位置、胶囊等）
  update: (data) => invoke('widget:update', data),
  // 更新位置/大小（拖拽节流专用）
  updateBounds: (type, bounds) => invoke('widget:update-bounds', { widgetType: type, bounds }),
  // 显示单个小部件
  show: (type) => invoke('widget:show', { widgetType: type }),
  // 隐藏单个小部件
  hide: (type) => invoke('widget:hide', { widgetType: type }),
  // 显示所有小部件
  showAll: () => invoke('widget:show-all'),
  // 隐藏所有小部件
  hideAll: () => invoke('widget:hide-all'),
  // 切换所有小部件显隐
  toggleAll: () => invoke('widget:toggle-all'),
  // 重置所有小部件（位置、尺寸、胶囊状态、锁定状态）
  resetAll: () => invoke('widget:reset-all'),
  // 切换胶囊状态
  toggleCapsule: (type, isCapsule) => invoke('widget:toggle-capsule', { widgetType: type, isCapsule }),
  // 主进程会调整窗口尺寸以适配胶囊/常规形态
  setCapsule: (widgetType, isCapsule) => invoke('widget:set-capsule', { widgetType, isCapsule }),
  // 获取全局热键配置
  getHotkey: () => invoke('widget:hotkey:get'),
  // 设置全局热键
  setHotkey: (accelerator) => invoke('widget:hotkey:set', { accelerator }),
  // 开始拖拽（主进程接管窗口移动，记录起始屏幕坐标）
  dragStart: (widgetType, startX, startY) => send('widget:drag:start', { widgetType, startX, startY }),
  // 拖拽移动（主进程计算新位置并执行吸附，使用 send 避免高频 invoke 卡顿）
  dragMove: (widgetType, x, y) => send('widget:drag:move', { widgetType, x, y }),
  // 拖拽结束（主进程持久化位置、捕获多显示器锚点、清除吸附引导）
  dragEnd: (widgetType) => send('widget:drag:end', { widgetType }),
  // 切换位置锁
  togglePositionLock: (widgetType) => invoke('widget:toggle-position-lock', { widgetType }),
  // 切换大小锁
  toggleSizeLock: (widgetType) => invoke('widget:toggle-size-lock', { widgetType }),
  // 重置位置到默认
  resetPosition: (widgetType) => invoke('widget:reset-position', { widgetType }),
  // 切换置顶
  toggleAlwaysOnTop: (widgetType) => invoke('widget:toggle-always-on-top', { widgetType }),
  // 获取窗口材质配置（mica / micaAlt / acrylic / acrylicBase / solid）
  getMaterial: () => invoke('widget:material:get'),
  // 设置窗口材质（动态切换所有小部件）
  // 材质取值：mica / micaAlt / acrylic / acrylicBase / solid
  setMaterial: (material) => invoke('widget:material:set', { material }),
  // 根据内容尺寸自适应调整窗口大小
  // 支持两种调用方式：resizeToContent(type, { width, height }) 或 resizeToContent(type, width, height)
  resizeToContent: (widgetType, widthOrSize, height) => {
    const size = typeof widthOrSize === 'object' && widthOrSize !== null
      ? widthOrSize
      : { width: widthOrSize, height }
    return invoke('widget:resize-to-content', { widgetType, width: size.width, height: size.height })
  },
  // 获取小部件折叠行为配置
  getCollapseBehavior: (widgetType) => invoke('widget:get-collapse-behavior', { widgetType }),
  // 设置小部件折叠行为（expanded / click / smart）
  setCollapseBehavior: (widgetType, behavior) => invoke('widget:set-collapse-behavior', { widgetType, behavior }),
  // 重命名小部件（更新 display_name 字段）
  rename: (widgetType, displayName) => invoke('widget:update', { widget_type: widgetType, display_name: displayName }),
  // 打开小部件设置页（通知主窗口跳转到该小部件的设置视图）
  openSettings: (widgetType) => send('widget:open-settings', { widgetType }),

  // ============================================================
  // 胶囊栏（多胶囊收纳）管理
  // 将多个折叠为胶囊的小部件排列成一条水平/垂直的栏
  // ============================================================
  // 创建胶囊栏
  createCapsuleBar: (widgetTypes, direction, options = {}) =>
    invoke('widget:capsule-bar:create', { widgetTypes, direction, options }),
  // 重新排列胶囊栏
  arrangeCapsuleBar: (barId) => invoke('widget:capsule-bar:arrange', { barId }),
  // 重排胶囊栏
  reorderCapsuleBar: (barId, newOrder) => invoke('widget:capsule-bar:reorder', { barId, newOrder }),
  // 销毁胶囊栏
  destroyCapsuleBar: (barId) => invoke('widget:capsule-bar:destroy', { barId })
}

// ============================================================
// 小部件分组 API 分组
// 通道命名规范：widget-group:action
// 用于小部件分组管理：创建/合并/分离/解散/切换活跃成员
// 后端返回统一格式 { ok, data } / { ok: false, error }，invoke 已自动解包
// ============================================================
export const widgetGroupApi = {
  // 列出所有分组，返回分组数组
  list: () => invoke('widget-group:list'),
  // 获取单个分组
  get: (id) => invoke('widget-group:get', { id }),
  // 创建分组（memberIds 为 widgetType 数组）
  create: (name, memberIds) => invoke('widget-group:create', { name, memberIds }),
  // 更新分组配置（名称、导航样式、活跃成员等）
  update: (data) => invoke('widget-group:update', data),
  // 删除分组（解散，不删除成员）
  delete: (id) => invoke('widget-group:delete', { id }),
  // 合并两个小部件为分组
  merge: (sourceWidgetType, targetWidgetType) => invoke('widget-group:merge', { sourceWidgetType, targetWidgetType }),
  // 将小部件加入已有分组
  join: (groupId, widgetType) => invoke('widget-group:join', { groupId, widgetType }),
  // 从分组分离成员
  detach: (groupId, widgetType) => invoke('widget-group:detach', { groupId, widgetType }),
  // 切换活跃成员
  switchMember: (groupId, widgetType) => invoke('widget-group:switch-member', { groupId, widgetType }),
  // 按成员查询所属分组，返回分组或 null
  getByMember: (widgetType) => invoke('widget-group:get-by-member', { widgetType })
}

// ============================================================
// 桌宠 API 分组
// 通道命名规范：pet:action
// 用于桌宠窗口管理与健康提醒交互
// ============================================================
export const petApi = {
  // 获取桌宠配置 { enabled, alwaysOnTop, x, y, width, height, remindersPaused }
  getConfig: () => invoke('pet:get-config'),
  // 更新桌宠配置
  updateConfig: (data) => invoke('pet:update-config', data),
  // 显示桌宠
  show: () => invoke('pet:show'),
  // 隐藏桌宠
  hide: () => invoke('pet:hide'),
  // 切换桌宠显隐
  toggle: () => invoke('pet:toggle'),
  // 设置置顶
  setAlwaysOnTop: (alwaysOnTop) => invoke('pet:set-always-on-top', { alwaysOnTop }),
  // 临时置顶（不持久化，气泡显示用）
  tempAlwaysOnTop: (alwaysOnTop) => invoke('pet:temp-always-on-top', { alwaysOnTop }),
  // 根据内容尺寸自适应调整窗口大小
  resizeToContent: (width, height) => invoke('pet:resize-to-content', { width, height }),
  // 重置桌宠位置到屏幕右下角默认位置，返回 { position: { x, y } }
  resetPosition: () => invoke('pet:reset-position'),
  // 暂停健康提醒
  pauseReminders: () => invoke('pet:pause-reminders'),
  // 恢复健康提醒
  resumeReminders: () => invoke('pet:resume-reminders'),
  // 查询提醒是否暂停 { paused }
  getRemindersPaused: () => invoke('pet:get-reminders-paused'),
  // 关闭/忽略指定提醒
  dismissReminder: (reminderId) => invoke('pet:dismiss-reminder', { reminderId }),
  // 开始拖拽（主进程接管窗口移动，记录起始屏幕坐标，send 模式）
  dragStart: (startX, startY) => send('pet:drag:start', { startX, startY }),
  // 拖拽移动（主进程计算新位置，send 模式，高频）
  dragMove: (x, y) => send('pet:drag:move', { x, y }),
  // 拖拽结束（主进程持久化位置，send 模式）
  dragEnd: () => send('pet:drag:end'),
  // 鼠标穿透控制：ignore=true 让透明区域鼠标穿透到下方应用
  setIgnoreMouseEvents: (ignore) => send('pet:set-ignore-mouse-events', { ignore })
}

// 注意：weather/music/desktop-organization 服务使用 ipcMain.handle 直接注册，
// 返回原始对象（成功）或 { error: {...} }（失败），不包装成 { ok: true, data } 格式。
// 因此使用 rawInvoke 而非 invoke，rawInvoke 检查 response.error 字段判断成败。
export const weatherApi = {
  // 获取天气数据
  getWeather: (city, units = 'metric') => rawInvoke('weather:get-weather', { city, units }),
  // 搜索城市
  searchCities: (query) => rawInvoke('weather:search-cities', { query }),
  // 清除缓存
  clearCache: () => rawInvoke('weather:clear-cache')
}

export const musicApi = {
  // 获取播放状态
  getStatus: () => rawInvoke('music:get-status'),
  // 切换播放/暂停
  togglePlay: () => rawInvoke('music:toggle-play'),
  // 播放
  play: () => rawInvoke('music:play'),
  // 暂停
  pause: () => rawInvoke('music:pause'),
  // 下一首
  nextTrack: () => rawInvoke('music:next-track'),
  // 上一首
  prevTrack: () => rawInvoke('music:prev-track'),
  // 设置音量
  setVolume: (volume) => rawInvoke('music:set-volume', { volume }),
  // 更新进度
  updateProgress: (position) => rawInvoke('music:update-progress', { position }),
  // 打开媒体应用
  openApp: () => rawInvoke('music:open-app')
}

export const desktopOrgApi = {
  // 扫描桌面
  scan: () => rawInvoke('desktop-organization:scan'),
  // 预览整理
  preview: (data) => rawInvoke('desktop-organization:preview', data),
  // 执行整理
  execute: (data) => rawInvoke('desktop-organization:execute', data),
  // 撤销整理
  undo: (data) => rawInvoke('desktop-organization:undo', data),
  // 获取历史
  history: () => rawInvoke('desktop-organization:history')
}

// 截图 API
export const screenshotApi = {
  // 全屏截图
  full: (data) => invoke('screenshot:full', data),
  // 当前窗口截图
  window: () => invoke('screenshot:window'),
  // 区域截图（由选区窗口坐标传入）
  area: (data) => invoke('screenshot:area', data),
  // 获取截图目录
  getDir: () => invoke('screenshot:getDir'),
  // 打开全屏透明选区窗口（绕开 desktopCapturer 延迟）
  openSelection: () => invoke('selection:open')
}

// ============================================================
// 全局搜索 API 分组
// 通道命名规范：search:action
// 用于聚合搜索便签/待办/任务/会话/设置/文件
// ============================================================
export const searchApi = {
  // 执行搜索
  query: (query, options) => invoke('search:query', { query, ...options }),
  // 获取搜索历史
  getHistory: () => invoke('search:history'),
  // 清除搜索历史
  clearHistory: () => invoke('search:clear-history')
}

// ============================================================
// 标签 API 分组
// 通道命名规范：tags:action
// 用于标签 CRUD、按名称查重、统计
// ============================================================
export const tagsApi = {
  // 列出所有标签（支持 keyword/color/sort 过滤）
  list: (params) => invoke('tags:list', params || {}),
  // 获取单个标签
  get: (id) => invoke('tags:get', { id }),
  // 创建标签 { name, color }
  create: (data) => invoke('tags:create', data),
  // 更新标签 { id, name?, color? }
  update: (data) => invoke('tags:update', data),
  // 删除标签
  delete: (id) => invoke('tags:delete', { id }),
  // 获取标签统计（总数 + 按颜色分组）
  stats: () => invoke('tags:stats')
}

// ============================================================
// 专注会话 API 分组
// 通道命名规范：focus:action
// 用于专注会话管理（创建/完成/取消/统计），生产力小部件复用
// ============================================================
export const focusApi = {
  // 获取当前进行中的会话
  getActive: () => invoke('focus:get-active'),
  // 创建专注会话 { mode, title?, total_seconds?, options? }
  create: (data) => invoke('focus:create', data),
  // 更新剩余时间 { id, remainingSeconds }
  updateRemaining: (id, remainingSeconds) => invoke('focus:update-remaining', { id, remainingSeconds }),
  // 灵动岛专注计时器每秒 tick
  tick: (data) => invoke('focus:tick', data),
  // 完成专注
  complete: (id) => invoke('focus:complete', { id }),
  // 取消专注
  cancel: (id) => invoke('focus:cancel', { id }),
  // 删除专注会话
  delete: (id) => invoke('focus:delete', { id }),
  // 更新会话标题
  updateTitle: (id, title) => invoke('focus:update-title', { id, title }),
  // 获取历史会话列表
  list: (params) => invoke('focus:list', params || {}),
  // 获取专注统计汇总（总/今日时长、次数、模式分类、最近 7 天趋势）
  stats: () => invoke('focus:stats')
}

// ============================================================
// 应用更新 API 分组
// 通道命名规范：update:action
// 用于检查/下载/安装应用更新
// ============================================================
export const updateApi = {
  // 检查更新
  check: () => invoke('update:check'),
  // 下载更新
  download: () => invoke('update:download'),
  // 安装更新
  install: () => invoke('update:install'),
  // 获取更新状态
  getStatus: () => invoke('update:get-status')
}

// ============================================================
// 发布说明 API 分组
// 通道命名规范：release-notes:action
// ============================================================
export const releaseNotesApi = {
  // 获取发布说明列表
  list: () => invoke('release-notes:list'),
  // 获取当前版本的发布说明
  getCurrent: () => invoke('release-notes:get-current')
}

// Agnes AI 媒体生成 API
export const agnesApi = {
  // 图像生成
  imageGenerate: (data) => invoke('agnes:image:generate', data),
  generateImage: (data) => invoke('agnes:image:generate', data),
  // 视频生成
  videoGenerate: (data) => invoke('agnes:video:generate', data),
  generateVideo: (data) => invoke('agnes:video:generate', data),
  // 查询视频生成结果
  videoResult: (data) => invoke('agnes:video:result', data),
  getVideoResult: (data) => invoke('agnes:video:result', data),
  // 轮询视频生成状态
  videoPoll: (data) => invoke('agnes:video:poll', data),
  // 保存 Base64 图片
  saveBase64Image: (data) => invoke('agnes:save-base64-image', data),
  // 获取模型参数规格（供前端表单动态生成）
  getModelSpec: (modelName) => invoke('agnes:model:spec', { model_name: modelName })
}

// 通用媒体生成 API（DALL-E / Stability AI / Agnes 统一接口）
export const mediaApi = {
  // 通用媒体生成（根据 template_id / model_name 路由到对应模板）
  generate: (data) => invoke('media:generate', data),
  // 查询可用模板列表（传入 category 可按 image/video 过滤）
  listTemplates: (category) => invoke('media:templates', { category }),
  // 视频轮询：只查询一次状态（前端循环调用），避免后端完整轮询导致阻塞
  videoPoll: (data) => invoke('agnes:video:result', data),
  // 主进程下载 URL 返回 base64 data URL（绕过渲染进程 CORS 限制）
  fetchAsDataUrl: (url) => invoke('media:fetch-as-data-url', { url }),
  // 下载 URL 保存到本地磁盘，返回 { localPath, dataUrl }
  saveToLocal: (url, filename) => invoke('media:save-to-local', { url, filename }),
  // 读取本地文件返回 data URL（快速磁盘 IO，用于已缓存的媒体资产）
  readLocalFile: (localPath) => invoke('media:read-local-file', { localPath }),
  // 清除指定 URL 或全部媒体缓存（资产删除后调用）
  clearCache: (url) => invoke('media:clear-cache', url ? { url } : {})
}

// ============================================================
// 活动检测 API 分组
// 通道命名规范：activity:action
// 用于查询用户活动统计、当前状态、活动日志
// ============================================================
export const activityApi = {
  // 获取今日活动统计
  getTodayStats: () => invoke('activity:get-today-stats'),
  // 获取指定日期统计 { date: 'YYYY-MM-DD' }
  getStatsByDate: (date) => invoke('activity:get-stats-by-date', { date }),

  // 获取当前活动状态
  getCurrentStatus: () => invoke('activity:get-current-status'),
  // 获取最近 7 天汇总 { summary, topApps }（topApps 仅含前 5）
  getSummary: (days) => invoke('activity:get-summary', days ? { days } : undefined),
  // 获取某天活跃应用 Top N { topApps }，limit>0 取前 N，0 表示全部
  // date 为 YYYY-MM-DD，不传默认今日
  getTopApps: (limit, date) => invoke('activity:get-top-apps', { limit, date }),
  // 获取指定日期时间段分布 { distribution: { morning, afternoon, evening, night } }
  // 不传 date 默认今日；各时段活跃秒数：上午6-12/下午12-18/晚上18-24/深夜0-6
  getTimeDistribution: (date) => invoke('activity:get-time-distribution', date ? { date } : undefined),
  // 获取指定日期连续活跃段数 { segments }，不传 date 默认今日
  getActiveSegments: (date) => invoke('activity:get-active-segments', date ? { date } : undefined),
  // 获取某天活跃应用按类别聚合的时长 { categories: [{ category, totalSeconds }] }
  // date 为 YYYY-MM-DD，不传默认今日；用于"活跃应用类别"指标，只展示类别 + 时长占比
  getAppCategories: (date) => invoke('activity:get-app-categories', date ? { date } : undefined),
  // 获取今日未分类（category='其他'）的活跃应用进程名 { apps: string[] }
  getUncategorizedApps: () => invoke('activity:get-uncategorized-apps'),
  // 调用 AI 对未分类应用归类并持久化 { categorized, total, message? }
  aiCategorizeApps: () => invoke('activity:ai-categorize-apps'),
  // 清除 AI 分类持久化，恢复硬编码默认分类 { reset: true }
  resetAppCategories: () => invoke('activity:reset-app-categories'),
  // 获取完整分类配置 { aiCategories, apps: [{ app, category, totalSeconds }] }
  getCategoryConfig: () => invoke('activity:get-category-config'),
  // 手动修改单个应用分类 { updated: boolean }
  updateAppCategory: (app, category) => invoke('activity:update-app-category', { app, category })
}

// ============================================================
// 媒体资产 API 分组
// 通道命名规范：media-asset:action
// 用于管理 AI 生成的图片/视频资产记录
// ============================================================
export const mediaAssetApi = {
  // 分页查询资产列表（支持 type / session_id / keyword 过滤）
  list: (params) => invoke('media-asset:list', params),
  // 获取单个资产
  get: (id) => invoke('media-asset:get', { id }),
  // 创建资产记录
  create: (data) => invoke('media-asset:create', data),
  // 删除资产
  delete: (id) => invoke('media-asset:delete', { id }),
  // 批量删除资产
  batchDelete: (ids) => invoke('media-asset:batch-delete', { ids }),
  // 获取统计信息（总图片数、总视频数、总大小）
  stats: () => invoke('media-asset:stats'),
  // 更新本地存储路径
  updatePath: (id, filePath) => invoke('media-asset:updatePath', { id, file_path: filePath }),
  // 按 message_id 批量查询资产（用于恢复 mediaMetadata.localPath）
  findByMessageIds: (messageIds) => invoke('media-asset:findByMessageIds', { message_ids: messageIds })
}

// ============================================================
// 剪贴板 API 分组
// 通道命名规范：clipboard:action
// 用于读取/写入剪贴板文本、读取剪贴板图片、清空剪贴板
// 供前端应用3使用（如复制分享链接、粘贴导入等场景）
// ============================================================
export const clipboardApi = {
  // 读取剪贴板文本
  readText: () => invoke('clipboard:read-text'),
  // 写入剪贴板文本
  writeText: (text) => invoke('clipboard:write-text', { text }),
  // 读取剪贴板图片（返回 { hasImage, base64?, mimeType? }）
  readImage: () => invoke('clipboard:read-image'),
  // 清空剪贴板
  clear: () => invoke('clipboard:clear')
}

export default {
  invoke,
  send,
  on,
  once,
  removeAllListeners,
  note: noteApi,
  task: taskApi,
  todo: todoApi,
  health: healthApi,
  ai: aiApi,
  chat: chatApi,
  system: systemApi,
  widget: widgetApi,
  widgetGroup: widgetGroupApi,
  pet: petApi,
  file: fileApi,
  weather: weatherApi,
  music: musicApi,
  desktopOrg: desktopOrgApi,
  screenshot: screenshotApi,
  agnes: agnesApi,
  media: mediaApi,
  activity: activityApi,
  mediaAsset: mediaAssetApi,
  search: searchApi,
  tags: tagsApi,
  focus: focusApi,
  update: updateApi,
  releaseNotes: releaseNotesApi,
  clipboard: clipboardApi
}