// ============================================================
// 小部件头部按钮操作 Composable
// 统一封装 WidgetHeader 位置锁/大小锁/重置位置/置顶按钮的事件处理
// 以及"更多"菜单的重命名/折叠行为/分组操作/小部件设置/禁用小部件处理
// 用法：
//   const { isPositionLocked, isSizeLocked, isAlwaysOnTop,
//           handleTogglePositionLock, ... } = useWidgetHeaderActions('todo')
// ============================================================
import { ref } from 'vue'
import { widgetApi, widgetGroupApi, on } from '@/utils/ipc-client'

/**
 * 小部件头部按钮操作
 * @param {string} widgetType 小部件类型
 */
export function useWidgetHeaderActions (widgetType) {
  // 位置锁状态
  const isPositionLocked = ref(false)
  // 大小锁状态
  const isSizeLocked = ref(false)
  // 置顶状态
  const isAlwaysOnTop = ref(false)
  // 自定义显示名称（重命名功能）
  const displayName = ref('')
  // 是否在分组中
  const hasGroup = ref(false)
  // 窗口外观模式（System/Standard/Compact/Overlay/Hidden）
  const chromeMode = ref('Standard')
  // 锁状态订阅取消函数
  let unsubscribeLocks = null

  /**
   * 切换位置锁
   */
  async function handleTogglePositionLock () {
    try {
      await widgetApi.togglePositionLock(widgetType)
    } catch (err) {
      console.error(`[WidgetHeader] 切换位置锁失败:`, err.message)
    }
  }

  /**
   * 切换大小锁
   */
  async function handleToggleSizeLock () {
    try {
      await widgetApi.toggleSizeLock(widgetType)
    } catch (err) {
      console.error(`[WidgetHeader] 切换大小锁失败:`, err.message)
    }
  }

  /**
   * 重置位置到默认
   */
  async function handleResetPosition () {
    try {
      await widgetApi.resetPosition(widgetType)
    } catch (err) {
      console.error(`[WidgetHeader] 重置位置失败:`, err.message)
    }
  }

  /**
   * 切换置顶
   */
  async function handleToggleAlwaysOnTop () {
    console.log('[handleToggleAlwaysOnTop] 按钮点击, widgetType =', widgetType)
    try {
      await widgetApi.toggleAlwaysOnTop(widgetType)
    } catch (err) {
      console.error(`[WidgetHeader] 切换置顶失败:`, err.message)
    }
  }

  /**
   * @param {string} newName 新显示名称
   */
  async function handleRename (newName) {
    try {
      await widgetApi.rename(widgetType, newName)
      displayName.value = newName
    } catch (err) {
      console.error(`[WidgetHeader] 重命名失败:`, err.message)
    }
  }

  /**
   * @param {string} behavior 折叠行为模式（expanded / click / smart）
   */
  async function handleChangeCollapseBehavior (behavior) {
    try {
      await widgetApi.setCollapseBehavior(widgetType, behavior)
    } catch (err) {
      console.error(`[WidgetHeader] 切换折叠行为失败:`, err.message)
    }
  }

  /**
   * 最小可行方案：仅前端会话内生效，不持久化到数据库
   * 重启后恢复默认 Standard 模式
   * @param {string} mode 窗口外观模式（System/Standard/Compact/Overlay/Hidden）
   */
  function handleChangeChromeMode (mode) {
    chromeMode.value = mode
  }

  /**
   * @param {string} targetWidgetType 目标小部件类型（合并到此小部件所在分组或新建分组）
   */
  async function handleGroupMerge (targetWidgetType) {
    try {
      await widgetGroupApi.merge(widgetType, targetWidgetType)
      hasGroup.value = true
    } catch (err) {
      console.error(`[WidgetHeader] 合并到分组失败:`, err.message)
    }
  }

  /**
   */
  async function handleGroupDetach () {
    try {
      const group = await widgetGroupApi.getByMember(widgetType)
      if (group && group.id) {
        await widgetGroupApi.detach(group.id, widgetType)
        hasGroup.value = false
      }
    } catch (err) {
      console.error(`[WidgetHeader] 从分组分离失败:`, err.message)
    }
  }

  /**
   */
  async function handleGroupDissolve () {
    try {
      const group = await widgetGroupApi.getByMember(widgetType)
      if (group && group.id) {
        await widgetGroupApi.delete(group.id)
        hasGroup.value = false
      }
    } catch (err) {
      console.error(`[WidgetHeader] 解散分组失败:`, err.message)
    }
  }

  /**
   */
  function handleOpenSettings () {
    try {
      widgetApi.openSettings(widgetType)
    } catch (err) {
      console.error(`[WidgetHeader] 打开设置页失败:`, err.message)
    }
  }

  /**
   */
  async function handleDisable () {
    try {
      await widgetApi.hide(widgetType)
    } catch (err) {
      console.error(`[WidgetHeader] 禁用小部件失败:`, err.message)
    }
  }

  /**
   * 加载小部件配置（读取锁状态、display_name、分组状态）
   */
  async function loadLockState () {
    try {
      const result = await widgetApi.get(widgetType)
      // widget:get 返回 { widget: {...} }，兼容直接返回 widget 对象的情况
      const config = result?.widget || result
      if (config) {
        isPositionLocked.value = !!Number(config.position_lock)
        isSizeLocked.value = !!Number(config.size_lock)
        isAlwaysOnTop.value = !!Number(config.always_on_top)
        // 读取自定义显示名称
        if (config.display_name) {
          displayName.value = config.display_name
        }
      }
    } catch (err) {
      console.warn(`[WidgetHeader] 读取锁状态失败:`, err.message)
    }
  }

  /**
   * 加载分组状态（是否在分组中）
   */
  async function loadGroupState () {
    try {
      const group = await widgetGroupApi.getByMember(widgetType)
      hasGroup.value = !!(group && group.id)
    } catch (err) {
      // 查询分组失败不阻塞组件加载
      hasGroup.value = false
    }
  }

  /**
   * 订阅主进程锁状态变化广播
   * @returns {Function} 取消订阅函数
   */
  function subscribeLocksChanged () {
    unsubscribeLocks = on('widget:locks-changed', (data) => {
      console.log('[subscribeLocksChanged] 收到事件:', data, '当前 widgetType =', widgetType)
      if (data && data.widgetType === widgetType) {
        if (data.positionLock !== undefined) isPositionLocked.value = !!data.positionLock
        if (data.sizeLock !== undefined) isSizeLocked.value = !!data.sizeLock
        if (data.alwaysOnTop !== undefined) isAlwaysOnTop.value = !!data.alwaysOnTop
        console.log('[subscribeLocksChanged] 状态已更新:', {
          isPositionLocked: isPositionLocked.value,
          isSizeLocked: isSizeLocked.value,
          isAlwaysOnTop: isAlwaysOnTop.value
        })
      }
    })
    return unsubscribeLocks
  }

  /**
   * 清理订阅（组件卸载时调用）
   */
  function cleanupLocks () {
    if (typeof unsubscribeLocks === 'function') {
      unsubscribeLocks()
      unsubscribeLocks = null
    }
  }

  return {
    isPositionLocked,
    isSizeLocked,
    isAlwaysOnTop,
    displayName,
    hasGroup,
    chromeMode,
    handleTogglePositionLock,
    handleToggleSizeLock,
    handleResetPosition,
    handleToggleAlwaysOnTop,
    handleRename,
    handleChangeCollapseBehavior,
    handleChangeChromeMode,
    handleGroupMerge,
    handleGroupDetach,
    handleGroupDissolve,
    handleOpenSettings,
    handleDisable,
    loadLockState,
    loadGroupState,
    subscribeLocksChanged,
    cleanupLocks
  }
}