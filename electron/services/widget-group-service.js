// ============================================================
// 小部件分组服务（主进程业务逻辑层）
// 提供分组的创建、合并、分离、解散、成员切换等业务方法
// 纯业务逻辑，不直接注册 IPC 通道（由 widget-group-channels.js 调用）
// 参照 group-service.js 风格，使用中文注释
// ============================================================

const widgetGroupDao = require('../dao/widget-group-dao.js')
const widgetDao = require('../dao/widget-dao.js')
const widgetRegistry = require('../core/widget-registry.js')
const logger = require('../core/logger.js')
// 懒加载 widget-window-manager / window-manager，避免模块加载阶段的循环依赖
let _widgetWindowManager = null
let _windowManager = null
function getWidgetWindowManager () {
  if (!_widgetWindowManager) {
    _widgetWindowManager = require('../core/widget-window-manager.js')
  }
  return _widgetWindowManager
}
function getWindowManager () {
  if (!_windowManager) {
    _windowManager = require('../core/window-manager.js')
  }
  return _windowManager
}

/**
 * 分组最大成员数
 */
const MAXIMUM_MEMBER_COUNT = 8

// ============================================================
// 业务错误
// ============================================================

/**
 * 业务错误类，携带 code 字段供 IPC 层返回标准化错误
 */
class WidgetGroupError extends Error {
  constructor (code, message) {
    super(message)
    this.code = code
    this.name = 'WidgetGroupError'
  }
}

// ============================================================
// 校验方法
// ============================================================

/**
 * 校验 widget_type 是否为合法的小部件类型
 * @param {string} widgetType
 * @throws {WidgetGroupError} 当类型非法时
 */
function assertValidWidgetType (widgetType) {
  if (!widgetType || typeof widgetType !== 'string') {
    throw new WidgetGroupError('INVALID_WIDGET_TYPE', '小部件类型不能为空')
  }
  if (!widgetRegistry.isValidType(widgetType)) {
    throw new WidgetGroupError('INVALID_WIDGET_TYPE', `未知小部件类型: ${widgetType}`)
  }
}

/**
 * 校验成员数量未超过上限
 * @param {number} count
 * @throws {WidgetGroupError}
 */
function assertMemberCount (count) {
  if (count > MAXIMUM_MEMBER_COUNT) {
    throw new WidgetGroupError(
      'TOO_MANY_MEMBERS',
      `分组成员数不能超过 ${MAXIMUM_MEMBER_COUNT} 个`
    )
  }
}

/**
 * 校验小部件是否未被其他分组占用
 * @param {string} widgetType
 * @param {string|null} excludeGroupId - 排除的分组 ID（更新场景）
 * @throws {WidgetGroupError}
 */
function assertMemberAvailable (widgetType, excludeGroupId = null) {
  const existing = widgetGroupDao.findByMember(widgetType)
  if (existing && existing.id !== excludeGroupId) {
    throw new WidgetGroupError(
      'MEMBER_ALREADY_GROUPED',
      `小部件 ${widgetType} 已属于分组 ${existing.id}`
    )
  }
}

/**
 * 校验小部件实例存在（widgets 表中有记录）
 * @param {string} widgetType
 * @throws {WidgetGroupError}
 */
function assertWidgetExists (widgetType) {
  const widget = widgetDao.getByType(widgetType)
  if (!widget) {
    throw new WidgetGroupError(
      'WIDGET_NOT_FOUND',
      `小部件 ${widgetType} 不存在，请先创建`
    )
  }
}

// ============================================================
// 查询方法
// ============================================================

/**
 * 列出所有分组
 * @returns {object[]}
 */
function list () {
  return widgetGroupDao.list()
}

/**
 * 按 ID 查询分组
 * @param {string} id
 * @returns {object|null}
 */
function getById (id) {
  return widgetGroupDao.getById(id)
}

/**
 * 按成员 widget_type 查询所属分组
 * @param {string} widgetType
 * @returns {object|null}
 */
function getByMember (widgetType) {
  return widgetGroupDao.findByMember(widgetType)
}

// ============================================================
// 创建 / 更新 / 删除
// ============================================================

/**
 * 创建分组
 * @param {object} data - { name?, member_ids, active_member?, ...位置/样式字段 }
 * @returns {object} 创建的分组
 */
function create (data) {
  if (!data || !Array.isArray(data.member_ids) || data.member_ids.length < 2) {
    throw new WidgetGroupError(
      'INVALID_MEMBERS',
      '分组至少需要 2 个成员'
    )
  }
  assertMemberCount(data.member_ids.length)
  // 校验每个成员类型合法且未被占用
  for (const widgetType of data.member_ids) {
    assertValidWidgetType(widgetType)
    assertMemberAvailable(widgetType)
  }
  // 校验成员唯一
  const uniqueMembers = [...new Set(data.member_ids)]
  if (uniqueMembers.length !== data.member_ids.length) {
    throw new WidgetGroupError('DUPLICATE_MEMBERS', '分组成员存在重复')
  }
  // active_member 必须在 member_ids 中
  const activeMember = data.active_member || data.member_ids[0]
  if (!uniqueMembers.includes(activeMember)) {
    throw new WidgetGroupError(
      'INVALID_ACTIVE_MEMBER',
      '活跃成员必须在分组成员列表中'
    )
  }
  return widgetGroupDao.create({ ...data, member_ids: uniqueMembers, active_member: activeMember })
}

/**
 * 更新分组配置
 * @param {string} id
 * @param {object} data
 * @returns {object|null}
 */
function update (id, data) {
  const existing = widgetGroupDao.getById(id)
  if (!existing) {
    throw new WidgetGroupError('GROUP_NOT_FOUND', `分组 ${id} 不存在`)
  }
  // 若更新 member_ids，需校验
  if (Array.isArray(data.member_ids)) {
    if (data.member_ids.length < 2) {
      throw new WidgetGroupError('INVALID_MEMBERS', '分组至少需要 2 个成员')
    }
    assertMemberCount(data.member_ids.length)
    for (const widgetType of data.member_ids) {
      assertValidWidgetType(widgetType)
      // 排除当前分组自身
      assertMemberAvailable(widgetType, id)
    }
    const uniqueMembers = [...new Set(data.member_ids)]
    if (uniqueMembers.length !== data.member_ids.length) {
      throw new WidgetGroupError('DUPLICATE_MEMBERS', '分组成员存在重复')
    }
    data = { ...data, member_ids: uniqueMembers }
    // 若 active_member 不在新的 member_ids 中，重置为第一个
    const activeMember = data.active_member || existing.active_member
    if (!uniqueMembers.includes(activeMember)) {
      data.active_member = uniqueMembers[0]
    }
  }
  return widgetGroupDao.update(id, data)
}

/**
 * 删除分组（解散，不删除成员小部件自身的记录）
 * @param {string} id
 * @returns {boolean}
 */
function dissolve (id) {
  const existing = widgetGroupDao.getById(id)
  if (!existing) {
    throw new WidgetGroupError('GROUP_NOT_FOUND', `分组 ${id} 不存在`)
  }
  return widgetGroupDao.del(id)
}

// ============================================================
// 合并 / 加入 / 分离
// ============================================================

/**
 * 合并两个小部件为新的分组
 * @param {object} params - { sourceWidgetType, targetWidgetType, name?, ...位置/样式字段 }
 * @returns {object} 创建的分组
 */
function merge (params) {
  const { sourceWidgetType, targetWidgetType } = params
  if (!sourceWidgetType || !targetWidgetType) {
    throw new WidgetGroupError('INVALID_PARAMS', '需要提供 sourceWidgetType 和 targetWidgetType')
  }
  if (sourceWidgetType === targetWidgetType) {
    throw new WidgetGroupError('INVALID_PARAMS', '不能合并相同的小部件')
  }
  assertValidWidgetType(sourceWidgetType)
  assertValidWidgetType(targetWidgetType)
  assertWidgetExists(sourceWidgetType)
  assertWidgetExists(targetWidgetType)
  // 若两者都已在同一分组，直接返回该分组
  const sourceGroup = widgetGroupDao.findByMember(sourceWidgetType)
  const targetGroup = widgetGroupDao.findByMember(targetWidgetType)
  if (sourceGroup && targetGroup && sourceGroup.id === targetGroup.id) {
    return sourceGroup
  }
  // 若任一已被分到其他分组，拒绝（需先分离）
  if (sourceGroup) {
    throw new WidgetGroupError(
      'MEMBER_ALREADY_GROUPED',
      `小部件 ${sourceWidgetType} 已属于分组 ${sourceGroup.id}，请先分离`
    )
  }
  if (targetGroup) {
    throw new WidgetGroupError(
      'MEMBER_ALREADY_GROUPED',
      `小部件 ${targetWidgetType} 已属于分组 ${targetGroup.id}，请先分离`
    )
  }
  // 创建新分组，源小部件作为活跃成员
  return widgetGroupDao.create({
    name: params.name || '',
    member_ids: [sourceWidgetType, targetWidgetType],
    active_member: sourceWidgetType,
    position_x: params.position_x,
    position_y: params.position_y,
    width: params.width,
    height: params.height,
    navigation_style: params.navigation_style,
    title_display_mode: params.title_display_mode,
    chrome_mode: params.chrome_mode,
    collapse_behavior: params.collapse_behavior
  })
}

/**
 * 将小部件加入已有分组
 * @param {object} params - { groupId, widgetType }
 * @returns {object} 更新后的分组
 */
function join (params) {
  const { groupId, widgetType } = params
  if (!groupId || !widgetType) {
    throw new WidgetGroupError('INVALID_PARAMS', '需要提供 groupId 和 widgetType')
  }
  assertValidWidgetType(widgetType)
  assertWidgetExists(widgetType)
  const group = widgetGroupDao.getById(groupId)
  if (!group) {
    throw new WidgetGroupError('GROUP_NOT_FOUND', `分组 ${groupId} 不存在`)
  }
  if (group.member_ids.includes(widgetType)) {
    // 已是成员，直接返回
    return group
  }
  assertMemberCount(group.member_ids.length + 1)
  assertMemberAvailable(widgetType, groupId)
  const newMembers = [...group.member_ids, widgetType]
  return widgetGroupDao.update(groupId, { member_ids: newMembers })
}

/**
 * 从分组分离成员
 * 分离后若分组只剩 1 个成员，自动解散（保留最后一个独立小部件）
 * @param {object} params - { groupId, widgetType }
 * @returns {object|null} 分离后的分组（若已解散则返回 null）
 */
function detach (params) {
  const { groupId, widgetType } = params
  if (!groupId || !widgetType) {
    throw new WidgetGroupError('INVALID_PARAMS', '需要提供 groupId 和 widgetType')
  }
  const group = widgetGroupDao.getById(groupId)
  if (!group) {
    throw new WidgetGroupError('GROUP_NOT_FOUND', `分组 ${groupId} 不存在`)
  }
  if (!group.member_ids.includes(widgetType)) {
    throw new WidgetGroupError(
      'MEMBER_NOT_IN_GROUP',
      `小部件 ${widgetType} 不属于分组 ${groupId}`
    )
  }
  const remaining = group.member_ids.filter(m => m !== widgetType)
  // 剩余成员不足 2 个，解散分组
  if (remaining.length < 2) {
    widgetGroupDao.del(groupId)
    logger.info('WidgetGroupService', `分组 ${groupId} 分离 ${widgetType} 后成员不足 2 个，已自动解散`)
    return null
  }
  // 更新成员列表；若分离的是活跃成员，重置活跃成员为剩余第一个
  const updateData = { member_ids: remaining }
  if (group.active_member === widgetType) {
    updateData.active_member = remaining[0]
  }
  return widgetGroupDao.update(groupId, updateData)
}

/**
 * 切换分组的活跃成员
 * @param {object} params - { groupId, widgetType }
 * @returns {object} 更新后的分组
 */
function switchMember (params) {
  const { groupId, widgetType } = params
  if (!groupId || !widgetType) {
    throw new WidgetGroupError('INVALID_PARAMS', '需要提供 groupId 和 widgetType')
  }
  const group = widgetGroupDao.getById(groupId)
  if (!group) {
    throw new WidgetGroupError('GROUP_NOT_FOUND', `分组 ${groupId} 不存在`)
  }
  if (!group.member_ids.includes(widgetType)) {
    throw new WidgetGroupError(
      'MEMBER_NOT_IN_GROUP',
      `小部件 ${widgetType} 不属于分组 ${groupId}`
    )
  }
  if (group.active_member === widgetType) {
    // 已是活跃成员，无需切换
    return group
  }
  return widgetGroupDao.setActiveMember(groupId, widgetType)
}

// ============================================================
// 拖放命中测试（WidgetGroupHitTest）
// 判断拖放位置是否命中某个分组区域，用于拖放合并决策
// ============================================================

/**
 * 标题栏高度（像素）
 * 对应 WidgetHeader.vue 中 --widget-header-height 默认值 46px
 * 命中此区域视为标题栏命中（header），下方视为内容区域（body）
 */
const HEADER_HEIGHT = 46

/**
 * 拖放命中测试：判断拖放位置是否命中某个小部件窗口区域
 * @param {object} payload { sourceWidgetType, targetBounds, pointerX, pointerY }
 *   - sourceWidgetType: 源小部件类型（拖拽起始小部件，排除自身）
 *   - targetBounds: 当前拖拽预览 bounds（可选，未提供时仅用 pointer 命中测试）
 *   - pointerX: 鼠标 X 屏幕坐标
 *   - pointerY: 鼠标 Y 屏幕坐标
 * @returns {object} { hit: boolean, targetWidgetType: string|null, zone: 'header'|'body'|'none' }
 */
function hitTest (payload) {
  if (!payload || typeof payload.pointerX !== 'number' || typeof payload.pointerY !== 'number') {
    return { hit: false, targetWidgetType: null, zone: 'none' }
  }
  const { sourceWidgetType, pointerX, pointerY } = payload
  // 1. 获取所有已启用小部件的窗口 bounds
  const allBounds = getWidgetWindowManager().getAllWidgetBounds()
  // 2. 遍历检查 pointerX/pointerY 是否在某个小部件窗口的 bounds 内
  for (const { widgetType, bounds } of allBounds) {
    // 4. 排除源小部件自身
    if (widgetType === sourceWidgetType) continue
    const insideX = pointerX >= bounds.x && pointerX <= bounds.x + bounds.width
    const insideY = pointerY >= bounds.y && pointerY <= bounds.y + bounds.height
    if (insideX && insideY) {
      // 3. 判断命中区域：标题栏区域 = 'header'，内容区域 = 'body'
      const zone = (pointerY - bounds.y) <= HEADER_HEIGHT ? 'header' : 'body'
      return { hit: true, targetWidgetType: widgetType, zone }
    }
  }
  // 5. 未命中任何小部件
  return { hit: false, targetWidgetType: null, zone: 'none' }
}

// ============================================================
// 分组切换请求协调（防抖 + 排队）
// 处理滚轮/手势等高频切换请求，避免快速切换导致的动画抖动
// ============================================================

/**
 * 切换请求队列（防抖 + 排队）
 * @type {Array<{widgetType: string, direction: string, timestamp: number}>}
 */
let switchRequestQueue = []
/**
 * 是否正在处理切换请求
 * @type {boolean}
 */
let isProcessingSwitch = false
/**
 * 切换防抖间隔（毫秒）
 * 150ms 内的多次请求合并为一次
 */
const SWITCH_DEBOUNCE_MS = 150
/**
 * 防抖定时器
 * @type {NodeJS.Timeout|null}
 */
let switchDebounceTimer = null

/**
 * 请求切换到分组中的下一个/上一个成员
 * @param {string} widgetType 当前小部件类型
 * @param {string} direction 'next' | 'prev'
 * @returns {Promise<void>}
 */
async function requestSwitch (widgetType, direction) {
  if (!widgetType || (direction !== 'next' && direction !== 'prev')) {
    logger.warn('WidgetGroupService', `requestSwitch 参数无效: widgetType=${widgetType}, direction=${direction}`)
    return
  }
  // 1. 加入队列
  switchRequestQueue.push({ widgetType, direction, timestamp: Date.now() })
  // 2. 防抖：150ms 内的多次请求合并为一次
  if (switchDebounceTimer) {
    clearTimeout(switchDebounceTimer)
  }
  return new Promise(resolve => {
    switchDebounceTimer = setTimeout(async () => {
      switchDebounceTimer = null
      await processSwitchQueue()
      resolve()
    }, SWITCH_DEBOUNCE_MS)
  })
}

/**
 * 处理切换请求队列
 * 依次处理队列中的请求，每次处理最新的请求（合并防抖后的最终方向）
 */
async function processSwitchQueue () {
  if (isProcessingSwitch || switchRequestQueue.length === 0) return
  isProcessingSwitch = true
  try {
    // 取出队列中所有待处理请求，按 widgetType 分组
    // 同一 widgetType 的连续 next/prev 请求合并为一次切换
    const pending = switchRequestQueue.splice(0)
    // 处理最后一个请求（防抖合并后通常只剩最后一个有意义的方向）
    const lastRequest = pending[pending.length - 1]
    if (!lastRequest) return
    await executeSwitch(lastRequest.widgetType, lastRequest.direction)
  } catch (error) {
    logger.error('WidgetGroupService', `处理切换队列失败: ${error.message}`)
  } finally {
    isProcessingSwitch = false
    // 5. 处理完成后继续处理队列中的下一个请求
    if (switchRequestQueue.length > 0) {
      await processSwitchQueue()
    }
  }
}

/**
 * 执行单次切换
 * @param {string} widgetType 当前小部件类型
 * @param {string} direction 'next' | 'prev'
 */
async function executeSwitch (widgetType, direction) {
  // 3. 获取当前分组，找到下一个/上一个成员
  const group = widgetGroupDao.findByMember(widgetType)
  if (!group || !Array.isArray(group.member_ids) || group.member_ids.length < 2) {
    logger.debug('WidgetGroupService', `requestSwitch: 小部件 ${widgetType} 不属于任何分组或分组成员不足 2 个`)
    return
  }
  const currentIndex = group.member_ids.indexOf(widgetType)
  if (currentIndex < 0) return
  // 计算目标成员索引（不循环，到达边界时不切换）
  const delta = direction === 'next' ? 1 : -1
  const targetIndex = currentIndex + delta
  if (targetIndex < 0 || targetIndex >= group.member_ids.length) {
    logger.debug('WidgetGroupService', `requestSwitch: 已到达分组 ${group.id} 的${direction === 'next' ? '末尾' : '开头'}成员`)
    return
  }
  const targetWidgetType = group.member_ids[targetIndex]
  if (group.active_member === targetWidgetType) {
    // 目标已是活跃成员，无需切换
    return
  }
  // 更新分组的活跃成员
  widgetGroupDao.setActiveMember(group.id, targetWidgetType)
  // 4. 通过 IPC 通知前端切换显示对应成员小部件
  notifySwitchToFront(group.id, widgetType, targetWidgetType, direction)
}

/**
 * 通知前端切换显示对应成员小部件
 * 向主窗口和所有小部件窗口广播切换事件
 * @param {string} groupId 分组 ID
 * @param {string} fromWidgetType 切换前的小部件类型
 * @param {string} toWidgetType 切换后的小部件类型
 * @param {string} direction 切换方向
 */
function notifySwitchToFront (groupId, fromWidgetType, toWidgetType, direction) {
  const payload = { groupId, fromWidgetType, toWidgetType, direction }
  try {
    // 通知主窗口（用于更新分组导航 UI）
    const mainWin = getWindowManager().getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('widget-group:switched', payload)
    }
  } catch (error) {
    logger.warn('WidgetGroupService', `通知主窗口切换失败: ${error.message}`)
  }
  try {
    // 通知所有小部件窗口（用于同步导航状态）
    const wwm = getWidgetWindowManager()
    const types = wwm.getWidgetWindowTypes ? wwm.getWidgetWindowTypes() : []
    for (const type of types) {
      const win = wwm.getWidgetWindow(type)
      if (win && !win.isDestroyed()) {
        win.webContents.send('widget-group:switched', payload)
      }
    }
  } catch (error) {
    logger.warn('WidgetGroupService', `通知小部件窗口切换失败: ${error.message}`)
  }
}

/**
 * 清空切换请求队列（用于应用退出或分组解散时）
 */
function clearSwitchQueue () {
  switchRequestQueue = []
  if (switchDebounceTimer) {
    clearTimeout(switchDebounceTimer)
    switchDebounceTimer = null
  }
  isProcessingSwitch = false
}

// ============================================================
// 窗口外观模式（WidgetChromeMode）
// 5 种模式：System / Standard / Compact / Overlay / Hidden
// ============================================================

/**
 * 窗口外观模式枚举
 * @readonly
 */
const CHROME_MODE = Object.freeze({
  System: 'System',
  Standard: 'Standard',
  Compact: 'Compact',
  Overlay: 'Overlay',
  Hidden: 'Hidden'
})

/**
 * 窗口外观分类
 * Interactive：交互类小部件（便签/任务等）
 * Display：展示类小部件（天气/系统监控等）
 * @readonly
 */
const CHROME_CATEGORY = Object.freeze({
  Interactive: 'Interactive',
  Display: 'Display'
})

/**
 * 窗口外观模式工具方法
 */
const CHROME_MODE_METADATA_KEY = 'ChromeMode'

/**
 * 将模式转换为设置值字符串
 * @param {string} mode CHROME_MODE 枚举值
 * @returns {string}
 */
function chromeModeToSettingValue (mode) {
  switch (mode) {
    case CHROME_MODE.Compact: return CHROME_MODE.Compact
    case CHROME_MODE.Overlay: return CHROME_MODE.Overlay
    case CHROME_MODE.Hidden: return CHROME_MODE.Hidden
    case CHROME_MODE.System: return CHROME_MODE.System
    default: return CHROME_MODE.Standard
  }
}

/**
 * 归一化模式字符串
 * @param {string|null|undefined} value 原始值
 * @param {string} fallback 默认值（缺省 Standard）
 * @param {boolean} allowSystem 是否允许 System（缺省 false，System 视为未覆盖）
 * @returns {string} CHROME_MODE 枚举值
 */
function normalizeChromeMode (value, fallback = CHROME_MODE.Standard, allowSystem = false) {
  const validModes = [
    CHROME_MODE.System,
    CHROME_MODE.Standard,
    CHROME_MODE.Compact,
    CHROME_MODE.Overlay,
    CHROME_MODE.Hidden
  ]
  if (typeof value === 'string' && validModes.includes(value)) {
    if (!allowSystem && value === CHROME_MODE.System) {
      return fallback
    }
    return value
  }
  return fallback
}

/**
 * 归一化设置值字符串
 * @param {string|null|undefined} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeChromeSettingValue (value, fallback = CHROME_MODE.Standard) {
  return chromeModeToSettingValue(normalizeChromeMode(value, fallback))
}

/**
 * 从小部件元数据读取覆盖模式
 * @param {object} widget 小部件配置（含 metadata 字段）
 * @returns {string} CHROME_MODE 枚举值（无覆盖时返回 System）
 */
function getChromeOverrideMode (widget) {
  if (!widget || !widget.metadata) return CHROME_MODE.System
  const value = widget.metadata[CHROME_MODE_METADATA_KEY]
  return normalizeChromeMode(value, CHROME_MODE.System, true)
}

/**
 * 写入小部件元数据覆盖模式
 * System 视为清除覆盖
 * @param {object} widget 小部件配置（含 metadata 字段）
 * @param {string} mode CHROME_MODE 枚举值
 */
function setChromeOverrideMode (widget, mode) {
  if (!widget) return
  if (!widget.metadata) widget.metadata = {}
  if (mode === CHROME_MODE.System) {
    delete widget.metadata[CHROME_MODE_METADATA_KEY]
    return
  }
  widget.metadata[CHROME_MODE_METADATA_KEY] = chromeModeToSettingValue(mode)
}

/**
 * 窗口外观模式解析器
 * 优先级：小部件覆盖 → 全局设置（按 Display/Interactive 分类）→ 描述符默认
 * @param {object} widget 小部件配置
 * @param {object} descriptor 小部件内容描述符
 *   - chromeCategory: CHROME_CATEGORY 值
 *   - defaultChromeMode: 默认模式
 *   - canUseOverlayChrome: 是否支持 Overlay
 *   - canHideChrome: 是否支持 Hidden
 * @param {object} globalSettings 全局设置
 *   - interactiveWidgetChromeMode: 交互类全局模式
 *   - displayWidgetChromeMode: 展示类全局模式
 * @returns {string} CHROME_MODE 枚举值
 */
function resolveChromeMode (widget, descriptor, globalSettings) {
  const overrideMode = getChromeOverrideMode(widget)
  if (overrideMode !== CHROME_MODE.System) {
    return coerceAllowedChromeMode(overrideMode, descriptor)
  }
  const settings = globalSettings || {}
  const globalValue = descriptor && descriptor.chromeCategory === CHROME_CATEGORY.Display
    ? settings.displayWidgetChromeMode
    : settings.interactiveWidgetChromeMode
  const globalMode = normalizeChromeMode(globalValue, descriptor?.defaultChromeMode || CHROME_MODE.Standard)
  return coerceAllowedChromeMode(globalMode, descriptor)
}

/**
 * 将模式强制约束到描述符允许的范围
 * @param {string} mode
 * @param {object} descriptor
 * @returns {string}
 */
function coerceAllowedChromeMode (mode, descriptor) {
  if (!descriptor) return mode
  switch (mode) {
    case CHROME_MODE.Overlay:
      return descriptor.canUseOverlayChrome ? mode : (descriptor.defaultChromeMode || CHROME_MODE.Standard)
    case CHROME_MODE.Hidden:
      if (descriptor.canHideChrome) return mode
      return descriptor.canUseOverlayChrome ? CHROME_MODE.Overlay : (descriptor.defaultChromeMode || CHROME_MODE.Standard)
    case CHROME_MODE.System:
      return descriptor.defaultChromeMode || CHROME_MODE.Standard
    default:
      return mode
  }
}

// ============================================================
// 分组窗口外观策略（WidgetGroupChromePolicy）
// 定义分组标题栏不变量：仅 Standard/Compact 可作为分组共享外观
// ============================================================

/**
 * 分组 chrome 校验失败参与者
 * @readonly
 */
const CHROME_PARTICIPANT = Object.freeze({
  None: 'None',
  Source: 'Source',
  Target: 'Target',
  Group: 'Group'
})

/**
 * 分组 chrome 拒绝原因
 * @readonly
 */
const CHROME_REJECTION_REASON = Object.freeze({
  None: 'None',
  EffectiveModeIsUnresolved: 'EffectiveModeIsUnresolved',
  OverlayChromeCannotBeGrouped: 'OverlayChromeCannotBeGrouped',
  HiddenChromeCannotBeGrouped: 'HiddenChromeCannotBeGrouped',
  UnsupportedChromeMode: 'UnsupportedChromeMode'
})

/**
 * 判断模式是否可作为分组共享外观
 * @param {string} mode
 * @returns {boolean}
 */
function isSupportedGroupChromeMode (mode) {
  return mode === CHROME_MODE.Standard || mode === CHROME_MODE.Compact
}

/**
 * 构造允许的 chrome 决策
 * @param {string} mode
 * @returns {object}
 */
function allowedChromeDecision (mode) {
  return {
    isAllowed: true,
    groupMode: mode,
    rejectedParticipant: CHROME_PARTICIPANT.None,
    rejectionReason: CHROME_REJECTION_REASON.None,
    rejectedMode: null
  }
}

/**
 * 构造拒绝的 chrome 决策
 * @param {string} participant
 * @param {string} reason
 * @param {string} mode
 * @returns {object}
 */
function rejectedChromeDecision (participant, reason, mode) {
  return {
    isAllowed: false,
    groupMode: null,
    rejectedParticipant: participant,
    rejectionReason: reason,
    rejectedMode: mode
  }
}

/**
 * 评估合并参与者是否可加入分组
 * Standard/Compact/Overlay/Hidden 均允许（Overlay/Hidden 临时采用分组外观）
 * System 视为未解析，拒绝
 * @param {string} effectiveMode
 * @param {string} participant
 * @returns {object}
 */
function evaluateMergeChromeParticipant (effectiveMode, participant) {
  switch (effectiveMode) {
    case CHROME_MODE.Standard:
    case CHROME_MODE.Compact:
    case CHROME_MODE.Overlay:
    case CHROME_MODE.Hidden:
      return allowedChromeDecision(effectiveMode)
    case CHROME_MODE.System:
      return rejectedChromeDecision(
        participant,
        CHROME_REJECTION_REASON.EffectiveModeIsUnresolved,
        effectiveMode
      )
    default:
      return rejectedChromeDecision(
        participant,
        CHROME_REJECTION_REASON.UnsupportedChromeMode,
        effectiveMode
      )
  }
}

/**
 * 评估合并两个小部件时的分组 chrome 决策
 * 目标窗口拥有最终表面，目标模式优先；若目标不可用则用源；否则降级 Standard
 * @param {string} sourceEffectiveMode
 * @param {string} targetEffectiveMode
 * @returns {object} chrome 决策
 */
function evaluateChromeMerge (sourceEffectiveMode, targetEffectiveMode) {
  const sourceDecision = evaluateMergeChromeParticipant(sourceEffectiveMode, CHROME_PARTICIPANT.Source)
  if (!sourceDecision.isAllowed) return sourceDecision
  const targetDecision = evaluateMergeChromeParticipant(targetEffectiveMode, CHROME_PARTICIPANT.Target)
  if (!targetDecision.isAllowed) return targetDecision
  if (isSupportedGroupChromeMode(targetEffectiveMode)) {
    return allowedChromeDecision(targetEffectiveMode)
  }
  if (isSupportedGroupChromeMode(sourceEffectiveMode)) {
    return allowedChromeDecision(sourceEffectiveMode)
  }
  return allowedChromeDecision(CHROME_MODE.Standard)
}

/**
 * 评估请求的分组共享模式是否合法
 * @param {string} requestedMode
 * @returns {object}
 */
function evaluateGroupChromeMode (requestedMode) {
  let rejectionReason
  switch (requestedMode) {
    case CHROME_MODE.Standard:
    case CHROME_MODE.Compact:
      rejectionReason = CHROME_REJECTION_REASON.None
      break
    case CHROME_MODE.System:
      rejectionReason = CHROME_REJECTION_REASON.EffectiveModeIsUnresolved
      break
    case CHROME_MODE.Overlay:
      rejectionReason = CHROME_REJECTION_REASON.OverlayChromeCannotBeGrouped
      break
    case CHROME_MODE.Hidden:
      rejectionReason = CHROME_REJECTION_REASON.HiddenChromeCannotBeGrouped
      break
    default:
      rejectionReason = CHROME_REJECTION_REASON.UnsupportedChromeMode
      break
  }
  if (rejectionReason === CHROME_REJECTION_REASON.None) {
    return allowedChromeDecision(requestedMode)
  }
  return rejectedChromeDecision(CHROME_PARTICIPANT.Group, rejectionReason, requestedMode)
}

/**
 * 归一化持久化的分组 chrome 模式
 * 旧 System/Overlay/Hidden 及未知值统一迁移为 Standard
 * @param {string|null|undefined} persistedValue
 * @returns {string} CHROME_MODE 枚举值
 */
function normalizePersistedGroupChromeMode (persistedValue) {
  const parsed = normalizeChromeMode(persistedValue, null, true)
  if (parsed === null) return CHROME_MODE.Standard
  return isSupportedGroupChromeMode(parsed) ? parsed : CHROME_MODE.Standard
}

/**
 * 归一化持久化分组 chrome 设置值
 * @param {string|null|undefined} persistedValue
 * @returns {string}
 */
function normalizePersistedGroupChromeValue (persistedValue) {
  return chromeModeToSettingValue(normalizePersistedGroupChromeMode(persistedValue))
}

// ============================================================
// 分组导航样式 / 标题显示模式（WidgetGroupNavigationStyles / TitleDisplayModes）
// ============================================================

/**
 * 分组导航样式常量
 * @readonly
 */
const NAVIGATION_STYLE = Object.freeze({
  FollowDefault: 'FollowDefault',
  Auto: 'Auto',
  Tabs: 'Tabs',
  Stack: 'Stack'
})

/**
 * 分组标题显示模式常量
 * @readonly
 */
const TITLE_DISPLAY_MODE = Object.freeze({
  FollowDefault: 'FollowDefault',
  IconAndText: 'IconAndText',
  IconOnly: 'IconOnly',
  TextOnly: 'TextOnly'
})

/**
 * 归一化导航样式
 * @param {string|null|undefined} value
 * @param {boolean} allowFollowDefault 是否允许 FollowDefault
 * @returns {string}
 */
function normalizeNavigationStyle (value, allowFollowDefault) {
  switch (value) {
    case NAVIGATION_STYLE.FollowDefault:
      return allowFollowDefault ? NAVIGATION_STYLE.FollowDefault : NAVIGATION_STYLE.Auto
    case NAVIGATION_STYLE.Tabs: return NAVIGATION_STYLE.Tabs
    case NAVIGATION_STYLE.Stack: return NAVIGATION_STYLE.Stack
    default: return NAVIGATION_STYLE.Auto
  }
}

/**
 * 解析最终生效的导航样式
 * @param {string|null|undefined} groupValue 分组级覆盖
 * @param {string|null|undefined} defaultValue 全局默认
 * @returns {string}
 */
function resolveNavigationStyle (groupValue, defaultValue) {
  const normalized = normalizeNavigationStyle(groupValue, true)
  return normalized === NAVIGATION_STYLE.FollowDefault
    ? normalizeNavigationStyle(defaultValue, false)
    : normalized
}

/**
 * 归一化标题显示模式
 * @param {string|null|undefined} value
 * @param {boolean} allowFollowDefault
 * @returns {string}
 */
function normalizeTitleDisplayMode (value, allowFollowDefault) {
  switch (value) {
    case TITLE_DISPLAY_MODE.FollowDefault:
      return allowFollowDefault ? TITLE_DISPLAY_MODE.FollowDefault : TITLE_DISPLAY_MODE.IconAndText
    case TITLE_DISPLAY_MODE.IconOnly: return TITLE_DISPLAY_MODE.IconOnly
    case TITLE_DISPLAY_MODE.TextOnly: return TITLE_DISPLAY_MODE.TextOnly
    default: return TITLE_DISPLAY_MODE.IconAndText
  }
}

/**
 * 解析最终生效的标题显示模式
 * @param {string|null|undefined} groupValue
 * @param {string|null|undefined} defaultValue
 * @returns {string}
 */
function resolveTitleDisplayMode (groupValue, defaultValue) {
  const normalized = normalizeTitleDisplayMode(groupValue, true)
  return normalized === TITLE_DISPLAY_MODE.FollowDefault
    ? normalizeTitleDisplayMode(defaultValue, false)
    : normalized
}

// ============================================================
// 分组导航交互策略（WidgetGroupNavigationInteractionPolicy）
// 纯决策规则：方向锁定、边缘阻尼、手势提交、滚轮步进、位置轨道
// ============================================================

/**
 * 导航交互常量
 * @readonly
 */
const NAV_INTERACTION = Object.freeze({
  DirectionLockDistance: 7,
  GestureCommitDistance: 56,
  GestureCommitVelocity: 520,
  WheelStep: 120,
  WheelGestureQuietPeriodMs: 220
})

/**
 * 解析最终生效的导航样式（Auto → Tabs/Stack）
 * Auto 模式下：成员数 ≤ 3 且可用宽度 ≥ 240 → Tabs，否则 Stack
 * @param {string|null|undefined} requestedStyle
 * @param {number} memberCount
 * @param {number} availableWidth
 * @returns {string}
 */
function resolveEffectiveNavigationStyle (requestedStyle, memberCount, availableWidth) {
  const requested = normalizeNavigationStyle(requestedStyle, false)
  if (requested !== NAVIGATION_STYLE.Auto) return requested
  return memberCount <= 3 && availableWidth >= 240
    ? NAVIGATION_STYLE.Tabs
    : NAVIGATION_STYLE.Stack
}

/**
 * 判断是否应锁定垂直方向
 * @param {number} deltaX
 * @param {number} deltaY
 * @returns {boolean}
 */
function shouldLockVertical (deltaX, deltaY) {
  return Math.abs(deltaY) >= NAV_INTERACTION.DirectionLockDistance &&
    Math.abs(deltaY) > Math.abs(deltaX) * 1.2
}

/**
 * 应用边缘阻尼
 * 在首/尾成员时继续滚动仅以 35% 速度，营造橡皮筋效果
 * @param {number} deltaY
 * @param {number} activeIndex
 * @param {number} memberCount
 * @returns {number}
 */
function applyEdgeDamping (deltaY, activeIndex, memberCount) {
  const beyondStart = activeIndex === 0 && deltaY > 0
  const beyondEnd = activeIndex === memberCount - 1 && deltaY < 0
  return (beyondStart || beyondEnd) ? deltaY * 0.35 : deltaY
}

/**
 * 判断是否应提交手势（切换成员）
 * @param {boolean} cancelled
 * @param {boolean} directionLocked
 * @param {number} deltaY
 * @param {number} elapsedMs 经过的毫秒数
 * @returns {boolean}
 */
function shouldCommitGesture (cancelled, directionLocked, deltaY, elapsedMs) {
  const seconds = Math.max(0.001, elapsedMs / 1000)
  const velocity = deltaY / seconds
  return !cancelled &&
    directionLocked &&
    (Math.abs(deltaY) >= NAV_INTERACTION.GestureCommitDistance ||
      Math.abs(velocity) >= NAV_INTERACTION.GestureCommitVelocity)
}

/**
 * 解析相对目标索引
 * @param {number} activeIndex 当前活跃成员索引
 * @param {number} memberCount 成员总数
 * @param {number} delta 偏移量（正/负）
 * @param {boolean} wrap 是否循环
 * @returns {{ ok: boolean, targetIndex: number }}
 */
function tryResolveRelativeTarget (activeIndex, memberCount, delta, wrap = false) {
  if (delta === 0 || memberCount <= 0 || activeIndex < 0 || activeIndex >= memberCount) {
    return { ok: false, targetIndex: -1 }
  }
  const targetIndex = activeIndex + Math.sign(delta)
  if (targetIndex >= 0 && targetIndex < memberCount) {
    return { ok: true, targetIndex }
  }
  if (!wrap) return { ok: false, targetIndex: -1 }
  return { ok: true, targetIndex: targetIndex < 0 ? memberCount - 1 : 0 }
}

/**
 * 消费一个滚轮步进
 * 反向输入时清空累加器，避免惯性反向被吞掉
 * @param {number} accumulator 当前累加器
 * @param {number} wheelDelta 滚轮 delta
 * @returns {{ consumed: boolean, direction: number, accumulator: number }}
 */
function tryConsumeWheelStep (accumulator, wheelDelta) {
  let acc = accumulator
  if (acc !== 0 && Math.sign(acc) !== Math.sign(wheelDelta)) {
    acc = 0
  }
  acc += wheelDelta
  if (Math.abs(acc) < NAV_INTERACTION.WheelStep) {
    return { consumed: false, direction: 0, accumulator: acc }
  }
  const direction = acc < 0 ? 1 : -1
  return { consumed: true, direction, accumulator: 0 }
}

/**
 * 观察滚轮手势边界
 * 同方向连续滚动视为一个手势，方向反转或静止超阈值则开启新手势
 * @param {number} lastObservedAt 上次观察时间戳（ms）
 * @param {number} lastObservedDirection 上次方向（-1/1）
 * @param {number} observedAt 当前时间戳
 * @param {number} direction 当前方向
 * @returns {{ startsNewGesture: boolean, lastObservedAt: number, lastObservedDirection: number }}
 */
function observeWheelGesture (lastObservedAt, lastObservedDirection, observedAt, direction) {
  if (direction !== -1 && direction !== 1) {
    return { startsNewGesture: false, lastObservedAt, lastObservedDirection }
  }
  const sinceObserved = observedAt - lastObservedAt
  const startsNewGesture = lastObservedAt === 0 ||
    direction !== lastObservedDirection ||
    sinceObserved < 0 ||
    sinceObserved >= NAV_INTERACTION.WheelGestureQuietPeriodMs
  return {
    startsNewGesture,
    lastObservedAt: observedAt,
    lastObservedDirection: direction
  }
}

/**
 * 解析紧凑标题栏位置轨道槽位
 * 2-3 成员一对一映射；更多成员暴露滚动 3 槽窗口，活跃成员位于前/中/后
 * @param {number} activeIndex
 * @param {number} memberCount
 * @returns {Array<{ memberIndex: number, isActive: boolean }>}
 */
function resolvePositionRailSlots (activeIndex, memberCount) {
  if (memberCount < 2) return []
  const resolvedActiveIndex = Math.max(0, Math.min(activeIndex, memberCount - 1))
  const visibleCount = Math.min(3, memberCount)
  const startIndex = memberCount <= visibleCount
    ? 0
    : Math.max(0, Math.min(resolvedActiveIndex - 1, memberCount - visibleCount))
  const slots = []
  for (let slotIndex = 0; slotIndex < visibleCount; slotIndex++) {
    const memberIndex = startIndex + slotIndex
    slots.push({
      memberIndex,
      isActive: memberIndex === resolvedActiveIndex
    })
  }
  return slots
}

// ============================================================
// 堆叠分组服务（WidgetStackGroupingService）
// 按类型/日期/自定义规则将文件项分组为堆叠
// ============================================================

/**
 * 堆叠分类枚举
 * @readonly
 */
const STACK_CATEGORY = Object.freeze({
  Folders: 'Folders',
  Applications: 'Applications',
  Documents: 'Documents',
  Images: 'Images',
  Videos: 'Videos',
  Audio: 'Audio',
  Archives: 'Archives',
  Other: 'Other',
  Today: 'Today',
  Yesterday: 'Yesterday',
  PreviousSevenDays: 'PreviousSevenDays',
  PreviousThirtyDays: 'PreviousThirtyDays',
  Earlier: 'Earlier'
})

/**
 * 应用程序扩展名集合
 */
const APPLICATION_EXTENSIONS = new Set([
  '.exe', '.msi', '.msix', '.appx', '.appref-ms', '.bat', '.cmd', '.ps1'
])

/**
 * 文档扩展名集合
 */
const DOCUMENT_EXTENSIONS = new Set([
  '.txt', '.md', '.rtf', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.odt', '.ods', '.odp', '.json', '.xml', '.html', '.htm'
])

/**
 * 图片扩展名集合
 */
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.heic', '.heif', '.svg'
])

/**
 * 视频扩展名集合
 */
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.mov', '.avi', '.wmv', '.webm', '.m4v', '.flv'
])

/**
 * 音频扩展名集合
 */
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.wma'
])

/**
 * 压缩包扩展名集合
 */
const ARCHIVE_EXTENSIONS = new Set([
  '.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.cab', '.iso'
])

/**
 * 文件堆叠分组依据
 * @readonly
 */
const FILE_STACK_GROUP_BY = Object.freeze({
  Type: 'Type',
  DateAdded: 'DateAdded',
  DateModified: 'DateModified',
  Custom: 'Custom'
})

/**
 * 文件堆叠排序依据
 * @readonly
 */
const FILE_STACK_ORDER_BY = Object.freeze({
  Default: 'Default',
  Name: 'Name',
  DateAdded: 'DateAdded',
  DateModified: 'DateModified'
})

/**
 * 未匹配项处理策略
 * @readonly
 */
const FILE_STACK_UNMATCHED = Object.freeze({
  Other: 'Other',
  Loose: 'Loose'
})

/**
 * 归一化分组依据
 * @param {string|null|undefined} value
 * @returns {string}
 */
function normalizeFileStackGroupBy (value) {
  switch (value) {
    case FILE_STACK_GROUP_BY.DateAdded: return FILE_STACK_GROUP_BY.DateAdded
    case FILE_STACK_GROUP_BY.DateModified: return FILE_STACK_GROUP_BY.DateModified
    case FILE_STACK_GROUP_BY.Custom: return FILE_STACK_GROUP_BY.Custom
    default: return FILE_STACK_GROUP_BY.Type
  }
}

/**
 * 归一化排序依据
 * @param {string|null|undefined} value
 * @returns {string}
 */
function normalizeFileStackOrderBy (value) {
  switch (value) {
    case FILE_STACK_ORDER_BY.Name: return FILE_STACK_ORDER_BY.Name
    case FILE_STACK_ORDER_BY.DateAdded: return FILE_STACK_ORDER_BY.DateAdded
    case FILE_STACK_ORDER_BY.DateModified: return FILE_STACK_ORDER_BY.DateModified
    default: return FILE_STACK_ORDER_BY.Default
  }
}

/**
 * 归一化未匹配策略
 * @param {string|null|undefined} value
 * @returns {string}
 */
function normalizeFileStackUnmatchedBehavior (value) {
  return value === FILE_STACK_UNMATCHED.Loose
    ? FILE_STACK_UNMATCHED.Loose
    : FILE_STACK_UNMATCHED.Other
}

/**
 * 获取扩展名（小写）
 * @param {string} path
 * @returns {string}
 */
function getExtension (path) {
  if (!path || typeof path !== 'string') return ''
  const idx = path.lastIndexOf('.')
  if (idx < 0) return ''
  return path.slice(idx).toLowerCase()
}

/**
 * 解析 Shell Kind 到堆叠分类
 * @param {string|null|undefined} shellKind
 * @returns {string|null}
 */
function resolveShellKindCategory (shellKind) {
  if (!shellKind || typeof shellKind !== 'string') return null
  switch (shellKind.trim().toLowerCase()) {
    case 'folder': return STACK_CATEGORY.Folders
    case 'program': return STACK_CATEGORY.Applications
    case 'document': return STACK_CATEGORY.Documents
    case 'picture': return STACK_CATEGORY.Images
    case 'video': return STACK_CATEGORY.Videos
    case 'music': return STACK_CATEGORY.Audio
    default: return null
  }
}

/**
 * 解析日期到堆叠分类
 * @param {Date|number|string} value 日期值
 * @param {Date} today 今日 0 时
 * @returns {string}
 */
function resolveDateCategory (value, today) {
  if (!value) return STACK_CATEGORY.Earlier
  const date = new Date(value)
  if (isNaN(date.getTime())) return STACK_CATEGORY.Earlier
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (dayStart >= todayStart) return STACK_CATEGORY.Today
  const diffDays = Math.round((todayStart - dayStart) / 86400000)
  if (diffDays <= 1) return STACK_CATEGORY.Yesterday
  if (diffDays <= 7) return STACK_CATEGORY.PreviousSevenDays
  if (diffDays <= 30) return STACK_CATEGORY.PreviousThirtyDays
  return STACK_CATEGORY.Earlier
}

/**
 * 解析单个项的堆叠分类
 * @param {object} item 文件项 { path, isFolder, isShortcut, shellKind, addedAt, lastModified }
 * @param {string} normalizedGroupBy 归一化后的分组依据
 * @param {Date} today
 * @returns {string}
 */
function resolveStackCategory (item, normalizedGroupBy, today) {
  if (normalizedGroupBy === FILE_STACK_GROUP_BY.DateAdded) {
    return resolveDateCategory(item.addedAt, today)
  }
  if (normalizedGroupBy === FILE_STACK_GROUP_BY.DateModified) {
    return resolveDateCategory(item.lastModified, today)
  }
  if (item.isFolder) return STACK_CATEGORY.Folders
  const shellCategory = resolveShellKindCategory(item.shellKind)
  if (shellCategory) return shellCategory
  if (item.isShortcut) return STACK_CATEGORY.Applications
  const ext = getExtension(item.path)
  if (APPLICATION_EXTENSIONS.has(ext)) return STACK_CATEGORY.Applications
  if (DOCUMENT_EXTENSIONS.has(ext)) return STACK_CATEGORY.Documents
  if (IMAGE_EXTENSIONS.has(ext)) return STACK_CATEGORY.Images
  if (VIDEO_EXTENSIONS.has(ext)) return STACK_CATEGORY.Videos
  if (AUDIO_EXTENSIONS.has(ext)) return STACK_CATEGORY.Audio
  if (ARCHIVE_EXTENSIONS.has(ext)) return STACK_CATEGORY.Archives
  return STACK_CATEGORY.Other
}

/**
 * 获取分类排序权重
 * @param {string} category
 * @returns {number}
 */
function getStackCategoryOrder (category) {
  switch (category) {
    case STACK_CATEGORY.Folders: return 0
    case STACK_CATEGORY.Applications: return 1
    case STACK_CATEGORY.Documents: return 2
    case STACK_CATEGORY.Images: return 3
    case STACK_CATEGORY.Videos: return 4
    case STACK_CATEGORY.Audio: return 5
    case STACK_CATEGORY.Archives: return 6
    case STACK_CATEGORY.Other: return 7
    case STACK_CATEGORY.Today: return 10
    case STACK_CATEGORY.Yesterday: return 11
    case STACK_CATEGORY.PreviousSevenDays: return 12
    case STACK_CATEGORY.PreviousThirtyDays: return 13
    default: return 14
  }
}

/**
 * 排序堆叠成员
 * @param {Array<{ item: object, index: number }>} members
 * @param {string} orderBy
 * @returns {object[]} 排序后的 item 数组
 */
function orderStackMembers (members, orderBy) {
  const copy = members.slice()
  switch (orderBy) {
    case FILE_STACK_ORDER_BY.Name:
      copy.sort((a, b) => {
        const nameA = (a.item.name || '').toLowerCase()
        const nameB = (b.item.name || '').toLowerCase()
        if (nameA < nameB) return -1
        if (nameA > nameB) return 1
        return a.index - b.index
      })
      break
    case FILE_STACK_ORDER_BY.DateAdded:
      copy.sort((a, b) => {
        const timeA = new Date(a.item.addedAt || 0).getTime()
        const timeB = new Date(b.item.addedAt || 0).getTime()
        if (timeB !== timeA) return timeB - timeA
        return a.index - b.index
      })
      break
    case FILE_STACK_ORDER_BY.DateModified:
      copy.sort((a, b) => {
        const timeA = new Date(a.item.lastModified || 0).getTime()
        const timeB = new Date(b.item.lastModified || 0).getTime()
        if (timeB !== timeA) return timeB - timeA
        return a.index - b.index
      })
      break
    default:
      copy.sort((a, b) => a.index - b.index)
      break
  }
  return copy.map(entry => entry.item)
}

/**
 * 构造自定义规则匹配器
 * @param {Array<object>|null} customRules
 * @returns {Array<{ rule: object, index: number, extensions: Set<string> }>}
 */
function buildCustomRuleMatchers (customRules) {
  if (!Array.isArray(customRules)) return []
  const matchers = []
  customRules.forEach((rule, index) => {
    if (!rule) return
    const extensions = new Set()
    if (Array.isArray(rule.extensions)) {
      for (const ext of rule.extensions) {
        if (typeof ext === 'string' && ext.trim()) {
          extensions.add(ext.toLowerCase())
        }
      }
    }
    if (extensions.size > 0) {
      matchers.push({ rule, index, extensions })
    }
  })
  return matchers
}

/**
 * 按自定义规则分组
 * @param {Array<{ item: object, index: number }>} indexedItems
 * @param {Array<object>|null} customRules
 * @param {string|null|undefined} unmatchedBehavior
 * @param {string} orderBy
 * @returns {Array<object>} 堆叠分组数组
 */
function groupByCustomRules (indexedItems, customRules, unmatchedBehavior, orderBy) {
  const matchers = buildCustomRuleMatchers(customRules)
  const matches = new Map(matchers.map(m => [m.index, []]))
  const unmatched = []
  for (const entry of indexedItems) {
    const ext = getExtension(entry.item.path)
    let matched = null
    for (const matcher of matchers) {
      if (matcher.extensions.has(ext)) {
        matched = matcher
        break
      }
    }
    if (matched) {
      matches.get(matched.index).push(entry)
    } else {
      unmatched.push(entry)
    }
  }
  const groups = []
  for (const matcher of matchers) {
    const members = matches.get(matcher.index)
    if (!members || members.length === 0) continue
    const displayName = (!matcher.rule.name || !matcher.rule.name.trim())
      ? Array.from(matcher.extensions).join(', ')
      : matcher.rule.name.trim()
    groups.push({
      category: STACK_CATEGORY.Other,
      items: orderStackMembers(members, orderBy),
      stackKey: `Custom:${matcher.rule.id || matcher.index}`,
      displayName,
      canStack: true,
      forceStack: false
    })
  }
  if (normalizeFileStackUnmatchedBehavior(unmatchedBehavior) === FILE_STACK_UNMATCHED.Other) {
    if (unmatched.length > 0) {
      groups.push({
        category: STACK_CATEGORY.Other,
        items: orderStackMembers(unmatched, orderBy),
        stackKey: 'Custom:Other',
        displayName: null,
        canStack: true,
        forceStack: false
      })
    }
  } else {
    for (const entry of unmatched) {
      groups.push({
        category: STACK_CATEGORY.Other,
        items: [entry.item],
        stackKey: `Loose:${entry.index}:${entry.item.path}`,
        displayName: null,
        canStack: false,
        forceStack: false
      })
    }
  }
  return groups
}

/**
 * 堆叠分组主入口
 * @param {object[]} items 文件项数组
 * @param {string|null|undefined} groupBy 分组依据
 * @param {Date|null|undefined} now 当前时间（缺省 new Date()）
 * @param {string|null|undefined} orderBy 排序依据
 * @param {Array<object>|null} customRules 自定义规则（仅 Custom 模式生效）
 * @param {string|null|undefined} unmatchedBehavior 未匹配策略
 * @returns {Array<object>} 堆叠分组数组
 */
function groupStackItems (items, groupBy, now, orderBy, customRules, unmatchedBehavior) {
  const normalized = normalizeFileStackGroupBy(groupBy)
  const normalizedOrder = normalizeFileStackOrderBy(orderBy)
  const today = (now instanceof Date ? now : new Date())
  const indexedItems = (Array.isArray(items) ? items : []).map((item, index) => ({ item, index }))
  if (normalized === FILE_STACK_GROUP_BY.Custom) {
    return groupByCustomRules(indexedItems, customRules, unmatchedBehavior, normalizedOrder)
  }
  const groups = new Map()
  for (const entry of indexedItems) {
    const category = resolveStackCategory(entry.item, normalized, today)
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category).push(entry)
  }
  const result = []
  for (const [category, members] of groups) {
    result.push({
      category,
      items: orderStackMembers(members, normalizedOrder),
      stackKey: null,
      displayName: null,
      canStack: true,
      forceStack: false
    })
  }
  result.sort((a, b) => getStackCategoryOrder(a.category) - getStackCategoryOrder(b.category))
  return result
}

/**
 * 计算堆叠项的有效 key
 * @param {object} group 堆叠分组
 * @returns {string}
 */
function getStackEffectiveKey (group) {
  return group.stackKey || group.category
}

/**
 * 创建堆叠项视图模型
 * @param {object} options
 * @returns {object}
 */
function createStackItem (options) {
  const members = Array.isArray(options.members) ? options.members : []
  const isExpanded = !!options.isExpanded
  return {
    category: options.category || STACK_CATEGORY.Other,
    stackKey: options.stackKey || options.category || STACK_CATEGORY.Other,
    get isManual () { return typeof this.stackKey === 'string' && this.stackKey.startsWith('Manual:') },
    members,
    name: options.name || '',
    summary: options.summary || '',
    automationState: options.automationState || '',
    collapseText: options.collapseText || '',
    isExpanded,
    get previewOne () { return this.members[0] },
    get previewTwo () { return this.members[Math.min(1, this.members.length - 1)] },
    get previewThree () { return this.members[Math.min(2, this.members.length - 1)] },
    get thirdPreviewVisible () { return this.members.length >= 3 },
    get countText () { return String(this.members.length) },
    get collapsedPreviewVisible () { return !this.isExpanded },
    get expandedAnchorVisible () { return this.isExpanded },
    get chevronGlyph () { return this.isExpanded ? '\uE70E' : '\uE70D' },
    tileWidth: options.tileWidth || 0,
    tileHeight: options.tileHeight || 0,
    tileMargin: options.tileMargin || { top: 0, right: 0, bottom: 0, left: 0 },
    tilePadding: options.tilePadding || { top: 0, right: 0, bottom: 0, left: 0 },
    previewSize: options.previewSize || 0,
    previewItemSize: options.previewItemSize || 0,
    labelMaxWidth: options.labelMaxWidth || 0,
    labelFontSize: options.labelFontSize || 0,
    listMargin: options.listMargin || { top: 0, right: 0, bottom: 0, left: 0 },
    listPadding: options.listPadding || { top: 0, right: 0, bottom: 0, left: 0 },
    listIconSize: options.listIconSize || 0
  }
}

// ============================================================
// 窗口菜单 / 分组菜单构建器（WidgetChromeMenuBuilder / WidgetGroupMenuBuilder）
// 生成菜单数据结构（不直接创建 UI 控件），由前端按需渲染
// ============================================================

/**
 * 悬停按钮动作常量
 * @readonly
 */
const HOVER_ACTION = Object.freeze({
  LockPosition: 'LockPosition',
  LockSize: 'LockSize',
  Add: 'Add',
  Delete: 'Delete',
  More: 'More'
})

/**
 * 支持的悬停按钮动作列表
 * @readonly
 */
const SUPPORTED_HOVER_ACTIONS = Object.freeze([
  HOVER_ACTION.LockPosition,
  HOVER_ACTION.LockSize,
  HOVER_ACTION.Add,
  HOVER_ACTION.Delete,
  HOVER_ACTION.More
])

/**
 * 解析悬停按钮动作设置值
 * @param {string|null|undefined} value 逗号分隔的动作字符串
 * @returns {Set<string>}
 */
function parseHoverButtonActions (value) {
  const result = new Set()
  if (typeof value !== 'string' || !value.trim()) return result
  for (const part of value.split(',')) {
    const action = part.trim()
    if (SUPPORTED_HOVER_ACTIONS.includes(action)) {
      result.add(action)
    }
  }
  return result
}

/**
 * 尝试更新悬停按钮动作设置值
 * 启用动作时添加，禁用时移除；返回更新后的字符串
 * @param {string|null|undefined} currentValue
 * @param {string} action 动作名
 * @param {boolean} enable 启用或禁用
 * @returns {{ ok: boolean, updatedValue: string }}
 */
function tryUpdateHoverButtonAction (currentValue, action, enable) {
  if (!SUPPORTED_HOVER_ACTIONS.includes(action)) {
    return { ok: false, updatedValue: currentValue || '' }
  }
  const selected = parseHoverButtonActions(currentValue)
  if (enable) selected.add(action)
  else selected.delete(action)
  // 保持 SUPPORTED_HOVER_ACTIONS 顺序
  const ordered = SUPPORTED_HOVER_ACTIONS.filter(a => selected.has(a))
  return { ok: true, updatedValue: ordered.join(',') }
}

/**
 * 判断动作是否可切换
 * @param {string|null|undefined} value
 * @param {string} action
 * @returns {boolean}
 */
function canToggleHoverButtonAction (value, action) {
  // 至少保留一个动作；More 不可移除（始终显示）
  if (action === HOVER_ACTION.More) return false
  const selected = parseHoverButtonActions(value)
  if (!selected.has(action)) return true
  // 已选中，禁用时检查是否会清空
  return selected.size > 1
}

/**
 * 构建 chrome 模式菜单数据
 * @param {object} options
 *   - widget: 小部件配置
 *   - descriptor: 内容描述符
 *   - isGrouped: 是否处于分组
 *   - groupChromeMode: 分组共享 chrome 模式
 *   - hoverButtonActions: 悬停按钮动作设置值
 * @returns {object} 菜单数据
 */
function buildChromeMenu (options) {
  const widget = options.widget || {}
  const descriptor = options.descriptor || {}
  const isGrouped = !!options.isGrouped
  const selectedMode = isGrouped
    ? normalizeChromeMode(options.groupChromeMode, CHROME_MODE.Standard)
    : getChromeOverrideMode(widget)
  const allModes = [
    CHROME_MODE.System,
    CHROME_MODE.Standard,
    CHROME_MODE.Compact,
    CHROME_MODE.Overlay,
    CHROME_MODE.Hidden
  ]
  const modeItems = []
  for (const mode of allModes) {
    // 非分组时按描述符能力过滤
    if (!isGrouped && mode === CHROME_MODE.Hidden && !descriptor.canHideChrome) continue
    if (!isGrouped && mode === CHROME_MODE.Overlay && !descriptor.canUseOverlayChrome) continue
    const isEnabled = !isGrouped || isSupportedGroupChromeMode(mode)
    modeItems.push({
      mode,
      isChecked: selectedMode === mode,
      isEnabled,
      lockHint: !isEnabled ? 'Widget.Group.ChromeLocked' : null
    })
  }
  // 悬停按钮子菜单
  const hoverValue = options.hoverButtonActions
  const hoverItems = SUPPORTED_HOVER_ACTIONS.map(action => ({
    action,
    isChecked: parseHoverButtonActions(hoverValue).has(action),
    isEnabled: canToggleHoverButtonAction(hoverValue, action)
  }))
  return {
    titleKey: 'Widget.ChromeMode.Title',
    modeItems,
    titleButtonsTitleKey: 'Widget.TitleButtons.Title',
    hoverItems
  }
}

/**
 * 构建分组菜单数据
 * @param {object} options
 *   - widget: 当前小部件配置
 *   - group: 所属分组（null 表示未分组）
 *   - joinTargets: 可加入的目标列表 [{ targetWidgetId, displayName, memberCount, canJoin, rejectionReasonKey }]
 *   - defaultNavigationStyle: 全局默认导航样式
 *   - defaultTitleDisplayMode: 全局默认标题显示模式
 *   - defaultWheelSwitchEnabled: 全局默认滚轮开关
 *   - defaultHoverSwitchEnabled: 全局默认悬停开关
 * @returns {object} 菜单数据
 */
function buildGroupMenu (options) {
  const widget = options.widget || {}
  const group = options.group || null
  const joinTargets = Array.isArray(options.joinTargets) ? options.joinTargets : []
  const joinItems = joinTargets.map(target => ({
    targetWidgetId: target.targetWidgetId,
    text: target.memberCount > 1
      ? `${target.displayName} (${target.memberCount})`
      : target.displayName,
    isEnabled: !!target.canJoin,
    rejectionHint: (!target.canJoin && target.rejectionReasonKey) ? target.rejectionReasonKey : null
  }))
  const result = {
    joinTitleKey: 'Widget.Group.Join',
    joinEnabled: joinItems.length > 0,
    joinItems
  }
  if (!group) return result
  // 分组控制菜单
  const navigationItems = [
    NAVIGATION_STYLE.FollowDefault,
    NAVIGATION_STYLE.Auto,
    NAVIGATION_STYLE.Tabs,
    NAVIGATION_STYLE.Stack
  ].map(style => ({
    style,
    isChecked: normalizeNavigationStyle(group.navigationStyle, true) === style
  }))
  const titleItems = [
    TITLE_DISPLAY_MODE.FollowDefault,
    TITLE_DISPLAY_MODE.IconAndText,
    TITLE_DISPLAY_MODE.IconOnly,
    TITLE_DISPLAY_MODE.TextOnly
  ].map(style => ({
    style,
    isChecked: normalizeTitleDisplayMode(group.titleDisplayMode, true) === style
  }))
  const wheelItems = [null, true, false].map(value => ({
    value,
    isChecked: group.wheelSwitchEnabled === value
  }))
  const hoverItems = [null, true, false].map(value => ({
    value,
    isChecked: group.hoverSwitchEnabled === value
  }))
  result.groupControl = {
    navigationTitleKey: 'Widget.Group.NavigationStyle',
    navigationItems,
    titleStyleTitleKey: 'Widget.Group.TitleDisplayMode',
    titleItems,
    wheelTitleKey: 'Widget.Group.WheelSwitch',
    wheelItems,
    hoverTitleKey: 'Widget.Group.HoverSwitch',
    hoverItems,
    dissolveTitleKey: 'Widget.Group.Dissolve',
    removeTitleKey: 'Widget.Group.RemoveCurrent'
  }
  return result
}

// ============================================================
// 分组切换请求协调器（WidgetGroupSwitchRequestCoordinator）
// 跟踪每个分组的最新切换请求，新请求取消旧请求；不同分组互不干扰
// ============================================================

/**
 * 分组切换请求
 */
class WidgetGroupSwitchRequest {
  constructor (groupId, targetWidgetId, origin) {
    this.groupId = groupId
    this.targetWidgetId = targetWidgetId
    this.origin = origin || 'Programmatic'
    this._cancelled = false
    this._completed = false
    this._disposed = false
  }

  cancel () {
    if (this._disposed) return
    this._cancelled = true
  }

  get isCancelled () {
    return this._cancelled
  }

  complete () {
    if (this._disposed) return
    this._completed = true
  }

  get isCompleted () {
    return this._completed
  }

  dispose () {
    this._disposed = true
  }

  get isDisposed () {
    return this._disposed
  }
}

/**
 * 分组切换请求协调器
 */
class WidgetGroupSwitchRequestCoordinator {
  constructor () {
    this._currentRequests = new Map()
  }

  /**
   * 开始新请求，取消同分组旧请求
   * @param {string} groupId
   * @param {string} targetWidgetId
   * @param {string} [origin]
   * @returns {WidgetGroupSwitchRequest}
   */
  begin (groupId, targetWidgetId, origin) {
    if (!groupId || !targetWidgetId) {
      throw new Error('groupId 和 targetWidgetId 不能为空')
    }
    const previous = this._currentRequests.get(groupId) || null
    const request = new WidgetGroupSwitchRequest(groupId, targetWidgetId, origin)
    this._currentRequests.set(groupId, request)
    if (previous) {
      previous.cancel()
      previous.dispose()
    }
    return request
  }

  /**
   * 判断请求是否为当前请求
   * @param {WidgetGroupSwitchRequest} request
   * @returns {boolean}
   */
  isCurrent (request) {
    if (!request) return false
    const current = this._currentRequests.get(request.groupId)
    return current === request
  }

  /**
   * 判断目标是否为当前请求目标
   * @param {string} groupId
   * @param {string} targetWidgetId
   * @returns {boolean}
   */
  isCurrentTarget (groupId, targetWidgetId) {
    if (!groupId || !targetWidgetId) return false
    const current = this._currentRequests.get(groupId)
    return !!current && current.targetWidgetId === targetWidgetId
  }

  /**
   * 完成请求
   * @param {WidgetGroupSwitchRequest} request
   */
  complete (request) {
    if (!request) return
    const current = this._currentRequests.get(request.groupId)
    if (current === request) {
      this._currentRequests.delete(request.groupId)
    }
    request.complete()
    request.dispose()
  }

  /**
   * 取消分组当前请求
   * @param {string} groupId
   */
  cancel (groupId) {
    if (!groupId) return
    const request = this._currentRequests.get(groupId)
    if (request) {
      this._currentRequests.delete(groupId)
      request.cancel()
      request.dispose()
    }
  }

  /**
   * 取消所有请求
   */
  cancelAll () {
    for (const request of this._currentRequests.values()) {
      request.cancel()
      request.dispose()
    }
    this._currentRequests.clear()
  }
}

// ============================================================
// 首次运行引导工厂（WidgetFirstRunGuideFactory）
// 为新建小部件注入可编辑的引导内容（用户可随时修改/删除）
// ============================================================

/**
 * 判断是否应为快速捕获注入引导
 * @param {object} data 快速捕获存储数据 { items: [] }
 * @returns {boolean}
 */
function shouldSeedQuickCaptureGuide (data) {
  if (!data || !Array.isArray(data.items)) return true
  return data.items.length === 0
}

/**
 * 构造快速捕获引导内容
 * @returns {{ title: string, body: string }}
 */
function createQuickCaptureGuide () {
  return {
    title: '快速捕获引导',
    body: '在这里随手记录想法、待办或灵感。\n\n- 按 Enter 新建条目\n- 支持 Markdown 格式\n- 条目自动保存'
  }
}

/**
 * 判断是否应为待办注入引导
 * @param {object} data 待办存储数据 { items: [] }
 * @returns {boolean}
 */
function shouldSeedTodoGuide (data) {
  if (!data || !Array.isArray(data.items)) return true
  return data.items.length === 0
}

/**
 * 构造待办引导项
 * @returns {object} 待办项
 */
function createTodoGuide () {
  const now = new Date().toISOString()
  return {
    text: '欢迎使用待办&规划',
    notes: '点击下方步骤逐项完成，或添加自己的步骤',
    createdAt: now,
    updatedAt: now,
    sortOrder: 0,
    steps: [
      { text: '完成第一项任务', sortOrder: 0 },
      { text: '为任务设置截止日期', sortOrder: 1 },
      { text: '将大任务拆解为小步骤', sortOrder: 2 }
    ]
  }
}

/**
 * 确保快速捕获引导存在（幂等）
 * @param {object} quickCaptureService 快速捕获服务（需提供 getData / addDetailedItem 方法）
 * @returns {Promise<boolean>} 是否注入了引导
 */
async function ensureQuickCaptureGuide (quickCaptureService) {
  if (!quickCaptureService) return false
  const data = await quickCaptureService.getData()
  if (!shouldSeedQuickCaptureGuide(data)) return false
  const { title, body } = createQuickCaptureGuide()
  await quickCaptureService.addDetailedItem(title, body, 'Default', 'Markdown')
  return true
}

/**
 * 确保待办引导存在（幂等）
 * @param {object} todoStore 待办存储（需提供 load / save 方法）
 * @returns {Promise<boolean>} 是否注入了引导
 */
async function ensureTodoGuide (todoStore) {
  if (!todoStore) return false
  const data = await todoStore.load()
  if (!shouldSeedTodoGuide(data)) return false
  data.items = data.items || []
  data.items.push(createTodoGuide())
  await todoStore.save(data)
  return true
}

module.exports = {
  // 现有业务方法
  MAXIMUM_MEMBER_COUNT,
  WidgetGroupError,
  // 查询
  list,
  getById,
  getByMember,
  // 写操作
  create,
  update,
  dissolve,
  merge,
  join,
  detach,
  switchMember,
  // 窗口外观模式
  CHROME_MODE,
  CHROME_CATEGORY,
  CHROME_MODE_METADATA_KEY,
  chromeModeToSettingValue,
  normalizeChromeMode,
  normalizeChromeSettingValue,
  getChromeOverrideMode,
  setChromeOverrideMode,
  resolveChromeMode,
  coerceAllowedChromeMode,
  // 分组窗口外观策略
  CHROME_PARTICIPANT,
  CHROME_REJECTION_REASON,
  isSupportedGroupChromeMode,
  evaluateChromeMerge,
  evaluateGroupChromeMode,
  normalizePersistedGroupChromeMode,
  normalizePersistedGroupChromeValue,
  // 导航样式 / 标题显示模式
  NAVIGATION_STYLE,
  TITLE_DISPLAY_MODE,
  normalizeNavigationStyle,
  resolveNavigationStyle,
  normalizeTitleDisplayMode,
  resolveTitleDisplayMode,
  // 导航交互策略
  NAV_INTERACTION,
  resolveEffectiveNavigationStyle,
  shouldLockVertical,
  applyEdgeDamping,
  shouldCommitGesture,
  tryResolveRelativeTarget,
  tryConsumeWheelStep,
  observeWheelGesture,
  resolvePositionRailSlots,
  // 堆叠分组
  STACK_CATEGORY,
  FILE_STACK_GROUP_BY,
  FILE_STACK_ORDER_BY,
  FILE_STACK_UNMATCHED,
  APPLICATION_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  ARCHIVE_EXTENSIONS,
  normalizeFileStackGroupBy,
  normalizeFileStackOrderBy,
  normalizeFileStackUnmatchedBehavior,
  resolveStackCategory,
  getStackCategoryOrder,
  groupStackItems,
  getStackEffectiveKey,
  createStackItem,
  // 菜单构建
  HOVER_ACTION,
  SUPPORTED_HOVER_ACTIONS,
  parseHoverButtonActions,
  tryUpdateHoverButtonAction,
  canToggleHoverButtonAction,
  buildChromeMenu,
  buildGroupMenu,
  // 切换请求协调器
  WidgetGroupSwitchRequest,
  WidgetGroupSwitchRequestCoordinator,
  // 拖放命中测试
  HEADER_HEIGHT,
  hitTest,
  // 分组切换请求协调（防抖 + 排队）
  SWITCH_DEBOUNCE_MS,
  requestSwitch,
  clearSwitchQueue,
  // 首次运行引导
  shouldSeedQuickCaptureGuide,
  createQuickCaptureGuide,
  shouldSeedTodoGuide,
  createTodoGuide,
  ensureQuickCaptureGuide,
  ensureTodoGuide
}