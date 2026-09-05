<!--
  灵动岛根组件
  职责：
  - 根容器 .island-root（透明背景，撑满窗口）
  - 监听 island:show 事件，将通知加入队列
  - 监听 island:hide 事件，清空队列并隐藏
  - 监听 island:focus-update 事件，更新专注计时器
  - 通知队列：多个通知同时展示，各自独立计时、独立消失
  - 专注模式下持续显示计时器，不自动隐藏
  - 使用 transition 动画从顶部向下滑入（translateY -100% → 0）
  - Fluent Design 风格：圆角 12px、半透明背景、微妙阴影
-->
<template>
  <el-config-provider :locale="zhCn">
    <div class="island-root">
      <IslandContainer
        :queue="queue"
        :focus-state="focusState"
        @dismiss="handleDismiss"
        @action="handleAction"
      />
    </div>
  </el-config-provider>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import IslandContainer from '@/components/island/IslandContainer.vue'
import { on, send } from '@/utils/ipc-client'
import { useAppStore } from '@/stores/app-store'

// 引入灵动岛专用样式
import '@/assets/styles/island.scss'

// 应用主题 store（灵动岛窗口独立于主窗口，需自行读取主题并应用 html.dark 类）
const appStore = useAppStore()

// ============================================================
// 响应式状态
// ============================================================

// 通知队列：同时展示所有项，各自独立计时、独立消失
// 每项结构：{ id, type, title, body, icon, duration, action }
const queue = ref([])

// 专注模式状态：{ active, taskName, remainingMs, totalMs }
const focusState = ref({ active: false, taskName: '', remainingMs: 0, totalMs: 0 })

// 通知自增 ID
let notifySeq = 0

// 事件监听取消函数
let unsubscribeShow = null
let unsubscribeHide = null
let unsubscribeFocusUpdate = null
let unsubscribeSettingChanged = null

// ============================================================
// 主题初始化
// ============================================================

/**
 * 初始化主题：读取 app_setting 中的主题配置并应用到 DOM
 * 灵动岛窗口独立于主窗口，需要自行读取主题并应用 html.dark 类
 */
async function initTheme () {
  try {
    await appStore.init()
  } catch (err) {
    // 主题加载失败时回退到浅色模式
    console.warn('[IslandApp] 主题初始化失败，使用默认浅色模式:', err.message)
  }
}

/**
 * 处理应用设置变化事件
 * 当用户在设置页面修改主题/强调色后，实时同步到灵动岛窗口
 * @param {Object} payload - { key, value }
 */
function handleSettingChanged (payload) {
  if (!payload || typeof payload !== 'object') return

  // 主题变化：同步应用 dark class（灵动岛窗口独立，需自行应用主题）
  if (payload.key === 'theme') {
    appStore.syncTheme(payload.value)
    return
  }

  // 强调色变化：同步应用 CSS 变量
  if (payload.key === 'accent_color') {
    appStore.syncAccentColor(payload.value)
    return
  }
}

// ============================================================
// 事件处理
// ============================================================

/**
 * 处理 island:show 事件
 * 将通知加入队列尾部
 * @param {Object} payload - { type, title, body, icon, duration, action }
 */
function handleShow (payload) {
  if (!payload || typeof payload !== 'object') return
  const item = {
    id: ++notifySeq,
    type: payload.type || 'info',
    title: payload.title || '',
    body: payload.body || '',
    icon: payload.icon || null,
    duration: typeof payload.duration === 'number' ? payload.duration : 5000,
    action: payload.action || null,
    extraData: payload.extraData || null
  }
  queue.value.push(item)
}

/**
 * 处理 island:hide 事件
 * 清空队列，立即隐藏所有通知
 */
function handleHide () {
  queue.value = []
}

/**
 * 处理 island:focus-update 事件
 * 更新专注计时器状态
 * @param {Object} state - { active, taskName, remainingMs, totalMs }
 */
function handleFocusUpdate (state) {
  if (!state || typeof state !== 'object') return
  focusState.value = {
    active: !!state.active,
    taskName: state.taskName || '',
    remainingMs: typeof state.remainingMs === 'number' ? state.remainingMs : 0,
    totalMs: typeof state.totalMs === 'number' ? state.totalMs : 0
  }
}

/**
 * 处理通知消失（自动或手动）
 * @param {number} id - 通知 ID
 */
function handleDismiss (id) {
  const idx = queue.value.findIndex(item => item.id === id)
  if (idx !== -1) {
    queue.value.splice(idx, 1)
  }
  // 队列清空后通知主进程隐藏灵动岛窗口（任务型卡片不自动隐藏，需主动关闭）
  if (queue.value.length === 0) {
    try { send('island:hide') } catch (e) { /* 忽略 */ }
  }
}

/**
 * 处理通知操作按钮点击
 * @param {Object} payload - { id, action }
 */
function handleAction (payload) {
  // 通过 IPC 通知主进程执行 action（如健康提醒的"已喝水"/"已休息"记录）
  // 净化 payload：将 Vue reactive Proxy 转为纯普通对象
  // Electron 结构化克隆算法无法克隆 Proxy，会报 "An object could not be cloned."
  try {
    const cleanPayload = payload ? JSON.parse(JSON.stringify(payload)) : payload
    send('island:action', cleanPayload)
  } catch (e) {
    console.error('[IslandApp] 发送 action 失败', e)
  }
  // 操作后立即消失
  if (payload && typeof payload.id === 'number') {
    handleDismiss(payload.id)
  }
}

// ============================================================
// 生命周期
// ============================================================

onMounted(() => {
  // 初始化主题（异步，不阻塞事件监听注册）
  initTheme()

  // 监听灵动岛事件
  unsubscribeShow = on('island:show', handleShow)
  unsubscribeHide = on('island:hide', handleHide)
  unsubscribeFocusUpdate = on('island:focus-update', handleFocusUpdate)

  // 监听应用设置变化（主题/强调色实时同步）
  unsubscribeSettingChanged = on('app:setting-changed', handleSettingChanged)
})

onUnmounted(() => {
  // 清理事件监听
  if (unsubscribeShow) unsubscribeShow()
  if (unsubscribeHide) unsubscribeHide()
  if (unsubscribeFocusUpdate) unsubscribeFocusUpdate()
  if (unsubscribeSettingChanged) unsubscribeSettingChanged()
})
</script>

<style lang="scss">
// 主题 CSS 变量定义（确保随组件加载，不依赖 island.scss 的 import）
// 亮色主题（默认）：白色背景 + 明显边框 + 强阴影
:root {
  --island-card-bg: rgba(255, 255, 255, 0.96);
  --island-card-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), 0 2px 4px rgba(0, 0, 0, 0.15);
  --island-card-border: 1px solid rgba(0, 0, 0, 0.15);
  --island-text-primary: rgba(0, 0, 0, 0.88);
  --island-text-title: rgba(0, 0, 0, 0.92);
  --island-text-secondary: rgba(0, 0, 0, 0.55);
  --island-text-tertiary: rgba(0, 0, 0, 0.38);
  --island-action-bg: rgba(0, 0, 0, 0.06);
  --island-action-bg-hover: rgba(0, 0, 0, 0.1);
  --island-close-color: rgba(0, 0, 0, 0.45);
  --island-close-color-hover: rgba(0, 0, 0, 0.75);
  --island-close-bg-hover: rgba(0, 0, 0, 0.06);
  --island-progress-bg: rgba(0, 0, 0, 0.08);
  --island-skip-bg: rgba(0, 0, 0, 0.04);
  --island-skip-bg-hover: rgba(0, 0, 0, 0.08);
  --island-skip-color: rgba(0, 0, 0, 0.5);
  --island-skip-color-hover: rgba(0, 0, 0, 0.8);
}

// 暗色主题覆盖
html.dark {
  --island-card-bg: rgba(32, 32, 32, 0.92);
  --island-card-shadow: 0 4px 16px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.12);
  --island-card-border: none;
  --island-text-primary: rgba(255, 255, 255, 0.92);
  --island-text-title: rgba(255, 255, 255, 0.95);
  --island-text-secondary: rgba(255, 255, 255, 0.72);
  --island-text-tertiary: rgba(255, 255, 255, 0.5);
  --island-action-bg: rgba(255, 255, 255, 0.12);
  --island-action-bg-hover: rgba(255, 255, 255, 0.2);
  --island-close-color: rgba(255, 255, 255, 0.55);
  --island-close-color-hover: rgba(255, 255, 255, 0.85);
  --island-close-bg-hover: rgba(255, 255, 255, 0.1);
  --island-progress-bg: rgba(255, 255, 255, 0.12);
  --island-skip-bg: rgba(255, 255, 255, 0.08);
  --island-skip-bg-hover: rgba(255, 255, 255, 0.15);
  --island-skip-color: rgba(255, 255, 255, 0.6);
  --island-skip-color-hover: rgba(255, 255, 255, 0.9);
}

.island-root {
  width: 100%;
  height: 100%;
  background: transparent;
  // 让卡片在窗口内居中
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
</style>