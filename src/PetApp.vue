<!--
  桌宠根组件
  职责：
  - 根容器 .pet-root（透明背景，撑满窗口）
  - 角色用 absolute 固定在底部，位置不随工具栏/气泡显隐而移动
  - 工具栏/气泡用 absolute 定位在角色上方，不影响角色位置
  - 悬停检测绑定在角色区域上（非整个窗口），避免透明区域误触发
  - 支持双形象切换：熊猫（cat）/ 机器人（robot）
  - 状态管理：currentState、currentReminder、isPaused、alwaysOnTop、currentCharacter
  - 拖拽：mousedown 启动拖拽，mousemove 用 rAF 节流，mouseup 结束
  - 暗色模式：读取 app-store 主题，应用 html.dark class
  - 智能气泡消息系统：
    · 鼓励消息/自定义名言（定时随机显示，间隔可配置）
    · 健康提醒（连续活跃超 60/90 分钟触发，影响桌宠状态）
    · 待办提醒（未来 1 小时内到期的便签）
    · 欢迎回来（用户从空闲恢复活跃时显示）
    · 优先级：健康提醒 > 待办提醒 > 鼓励消息/自定义名言
-->
<template>
  <el-config-provider :locale="zhCn">
    <div
      class="pet-root"
      ref="petRootRef"
      :style="{ '--pet-bubble-font-size': appStore.petBubbleFontSize + 'px' }"
      @mouseenter="handleRootMouseEnter"
      @mouseleave="handleRootMouseLeave"
    >
    <!-- 提醒气泡：absolute 在角色上方（z-index 最高） -->
    <PetBubble
      ref="petBubbleRef"
      v-if="bubbleVisible"
      class="pet-root__bubble"
      :reminder="currentReminder"
      :visible="bubbleVisible"
      :max-width="bubbleMaxWidth"
      :max-lines="bubbleMaxLines"
      :style="{ bottom: bubbleBottom + 'px', transform: bubbleTransform, opacity: bubbleOpacity }"
      @dismiss="handleBubbleDismiss"
      @click="handleBubbleClick"
      @resize="handleBubbleResize"
      @resize-start="handleBubbleResizeStart"
      @resize-end="handleBubbleResizeEnd"
    />

    <!-- 悬停工具栏：absolute 在角色上方 -->
    <!-- 不再单独绑定 mouseenter/mouseleave，由 pet-root 统一处理 -->
    <PetToolbar
      ref="petToolbarRef"
      v-if="toolbarVisible"
      class="pet-root__toolbar"
      :is-paused="isPaused"
      :always-on-top="alwaysOnTop"
      :character="currentCharacter"
      :chat-active="chatPanelVisible"
      :key-tracker-enabled="keyTrackerEnabled"
      :style="{ bottom: toolbarBottom + 'px', transform: toolbarTransform, opacity: toolbarOpacity }"
      @hide="handleHide"
      @toggle-pause="handleTogglePause"
      @view-reminders="handleViewReminders"
      @toggle-always-on-top="handleToggleAlwaysOnTop"
      @switch-character="handleSwitchCharacter"
      @toggle-chat="handleToggleChat"
      @toggle-key-tracker="handleToggleKeyTracker"
    />

    <PetChatPanel
      ref="petChatPanelRef"
      v-if="chatPanelVisible"
      class="pet-root__chat-panel"
      :messages="chatMessages"
      :streaming="chatStreaming"
      :system-prompt="chatSystemPrompt"
      :meta-prompt="chatMetaPrompt"
      :streaming-content="chatStreamingContent"
      :streaming-thinking="chatStreamingThinking"
      :generating="promptGenerating"
      :injected-context="lastInjectedContext"
      :opacity="chatPanelOpacity"
      :style="{ bottom: chatPanelBottom + 'px', transform: panelTransform }"
      @send="handleChatSend"
      @clear="handleChatClear"
      @update-prompt="handleUpdatePrompt"
      @generate-prompt="handleGeneratePrompt"
      @reset-prompt="handleResetPrompt"
      @update-meta-prompt="handleUpdateMetaPrompt"
      @reset-meta-prompt="handleResetMetaPrompt"
      @update-opacity="handleUpdateChatOpacity"
      @close="handleToggleChat"

    />

    <!-- 桌宠角色：absolute 固定在底部，位置始终不变 -->
    <!-- 不再单独绑定 mouseenter/mouseleave，由 pet-root 统一处理 -->
    <div
      v-if="configLoaded"
      class="pet-root__character"
      :style="{ width: characterSize + 'px', height: characterSize + 'px', bottom: characterBottom + 'px' }"
      @mousedown="handleMouseDown"
    >
      <PetCharacter v-if="currentCharacter === 'cat'" :state="currentState" />
      <PetRobot v-else-if="currentCharacter === 'robot'" :state="currentState" />
      <PetOrb v-else-if="currentCharacter === 'orb'" :state="currentState" />
      <PetDNA v-else :state="currentState" />
    </div>
    </div>
  </el-config-provider>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import PetCharacter from '@/components/pet/PetCharacter.vue'
import PetRobot from '@/components/pet/PetRobot.vue'
import PetOrb from '@/components/pet/PetOrb.vue'
import PetDNA from '@/components/pet/PetDNA.vue'
import PetToolbar from '@/components/pet/PetToolbar.vue'
import PetBubble from '@/components/pet/PetBubble.vue'
import PetChatPanel from '@/components/pet/PetChatPanel.vue'
import { useAppStore } from '@/stores/app-store'
import { on, petApi, activityApi, noteApi, systemApi, chatApi, aiApi, healthApi, todoApi, taskApi } from '@/utils/ipc-client'
import {
  PET_ASSISTANT_SESSION_TITLE,
  KEY_PET_AI_SYSTEM_PROMPT,
  KEY_PET_AI_META_PROMPT,
  KEY_PET_AI_AUTO_CHAT,
  KEY_PET_AI_AUTO_CHAT_INTERVAL,
  KEY_PET_AI_AUTO_CHAT_THINKING,
  KEY_PET_AI_AUTO_CHAT_THINKING_EFFORT,
  DEFAULT_PET_AI_SYSTEM_PROMPT,
  PROMPT_GENERATION_META_PROMPT,
  buildContextMessage,
  buildGenerationContext,
  buildAutoChatInstruction
} from '@/utils/pet-ai-prompt'

// 引入桌宠专用样式（含 CSS 自定义属性与暗色模式覆盖）
import '@/assets/styles/pet.scss'

// ============================================================
// 常量
// ============================================================

// 提醒气泡自动消失时长（毫秒）
const BUBBLE_AUTO_DISMISS_MS = 8000

// 鼓励消息自动消失时长（毫秒）
const ENCOURAGEMENT_DISMISS_MS = 6000

// 鼓励消息最小间隔（毫秒，5 分钟）
const ENCOURAGEMENT_MIN_INTERVAL_MS = 5 * 60 * 1000

// 鼓励消息最大间隔（毫秒，15 分钟）
const ENCOURAGEMENT_MAX_INTERVAL_MS = 15 * 60 * 1000

// 活动状态监控间隔（毫秒，1 分钟）
const ACTIVITY_MONITOR_INTERVAL_MS = 60 * 1000

// 连续活跃触发健康提醒的阈值（秒）
const HEALTH_REMINDER_THRESHOLD_60_MIN = 60 * 60   // 60 分钟
const HEALTH_REMINDER_THRESHOLD_90_MIN = 90 * 60   // 90 分钟

// 活动统计分析提醒间隔（毫秒，2 小时）
const ANALYTICS_REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000

// 健康提醒限频间隔（毫秒，30 分钟内最多触发一次）
const HEALTH_REMINDER_MIN_INTERVAL_MS = 30 * 60 * 1000

// 待办提醒检查间隔（毫秒，15 分钟）
const TODO_CHECK_INTERVAL_MS = 15 * 60 * 1000

// 待办提醒提前量（毫秒，未来 1 小时内到期的待办）
const TODO_LOOKAHEAD_MS = 60 * 60 * 1000

// 待办提醒限频间隔（毫秒，10 分钟内最多触发一次）
const TODO_REMINDER_MIN_INTERVAL_MS = 10 * 60 * 1000

// 鼓励消息池：随机展示一条，给用户加油打气
const ENCOURAGEMENT_MESSAGES = Object.freeze([
  '加油！你做得很好',
  '记得喝水哦，保持水分',
  '休息一下眼睛吧，看看远处',
  '坐久了站起来活动活动',
  '今天也是元气满满的一天',
  '深呼吸，放松一下',
  '你正在变得越来越好',
  '别忘了按时吃饭呀',
  '保持微笑，世界更美好',
  '累了就歇会儿，别硬撑',
  '专注当下，未来可期',
  '给自己一个小小的奖励吧'
])

// 智能气泡配置键名（存储在 app_settings 表）
const KEY_ENCOURAGEMENT_ENABLED = 'pet_encouragement_enabled'   // 鼓励气泡开关，默认 '1'
const KEY_ENCOURAGEMENT_INTERVAL = 'pet_encouragement_interval' // 鼓励气泡频率（分钟），默认 '10'
const KEY_CUSTOM_QUOTES = 'pet_custom_quotes'                   // 自定义名言，每行一条
const KEY_BUBBLE_MAX_WIDTH = 'pet_bubble_max_width'             // 气泡最大宽度（px），默认 '320'
const KEY_BUBBLE_MAX_LINES = 'pet_bubble_max_lines'             // 气泡内容最大行数，默认 '5'

// 气泡最大宽度范围（px）
// 上限 780px：略小于窗口固定宽度 800px，留 20px 余量给手柄和边距
const BUBBLE_MAX_WIDTH_MIN = 240
const BUBBLE_MAX_WIDTH_MAX = 780
const BUBBLE_MAX_WIDTH_DEFAULT = 320

// 气泡内容最大行数范围
const BUBBLE_MAX_LINES_MIN = 2
const BUBBLE_MAX_LINES_MAX = 20
const BUBBLE_MAX_LINES_DEFAULT = 5

// 悬停工具栏显隐延迟（毫秒）：mouseleave 后延迟隐藏，避免鼠标抖动闪烁
const TOOLBAR_HIDE_DELAY_MS = 200

// 桌宠状态枚举
const STATE = Object.freeze({
  IDLE: 'idle',
  REMINDING: 'reminding',
  HAPPY: 'happy',
  SLEEPING: 'sleeping'
})

// 桌宠形象枚举
const CHARACTER = Object.freeze({
  CAT: 'cat',
  ROBOT: 'robot',
  ORB: 'orb',
  DNA: 'dna'
})

// ============================================================
// 响应式状态
// ============================================================

// 应用全局 Store（用于读取主题配置）
const appStore = useAppStore()

// 当前桌宠状态
const currentState = ref(STATE.IDLE)

// 当前提醒对象 { id, type, title, body, timestamp }
const currentReminder = ref(null)

// 气泡是否可见
const bubbleVisible = ref(false)

// 气泡最大宽度（px，支持拖拽调整，范围 [240, 780]，持久化到 app_settings）
// 窗口固定 800px，气泡最大 780px 留 20px 余量，拖拽时窗口不变
const bubbleMaxWidth = ref(BUBBLE_MAX_WIDTH_DEFAULT)

// 气泡内容最大行数（支持上拉调整，范围 [2, 20]，持久化到 app_settings）
const bubbleMaxLines = ref(BUBBLE_MAX_LINES_DEFAULT)

// 是否暂停健康提醒
const isPaused = ref(false)

// 是否置顶
const alwaysOnTop = ref(true)

// 气泡临时置顶标记：非置顶时显示气泡临时提升图层，气泡消失后恢复
const bubbleTempTopped = ref(false)

// 键盘连击追踪是否启用
const keyTrackerEnabled = ref(true)

// 气泡显示/消失时处理临时置顶
watch(bubbleVisible, (visible) => {
  if (visible) {
    if (!alwaysOnTop.value) {
      bubbleTempTopped.value = true
      petApi.tempAlwaysOnTop(true).catch(() => {})
    }
  } else if (bubbleTempTopped.value) {
    bubbleTempTopped.value = false
    petApi.tempAlwaysOnTop(false).catch(() => {})
  }
})

// 工具栏是否可见（悬停控制）
const toolbarVisible = ref(false)

// 当前桌宠形象（cat / robot）
const currentCharacter = ref(CHARACTER.CAT)

// 配置是否已加载完成（避免启动时先显示默认熊猫再闪烁切换到机器人）
const configLoaded = ref(false)

// 桌宠角色尺寸（80-200，默认 130）
const characterSize = ref(130)

// AI 对话框透明度（0.3-1，从桌宠配置读取，由面板滑杆控制并持久化）
const chatPanelOpacity = ref(1)

// 窗口高度（用于边缘检测）
const windowHeight = ref(window.innerHeight)

// 窗口在屏幕中的 x 坐标（用于水平边缘检测，拖拽时实时更新）
const windowScreenX = ref(window.screenX)
// 屏幕可用宽度（排除任务栏）
const screenAvailWidth = ref(window.screen.availWidth)
// 窗口在屏幕中的 y 坐标（用于垂直边缘检测，拖拽时实时更新）
const windowScreenY = ref(window.screenY)
// 屏幕可用高度（排除任务栏）
const screenAvailHeight = ref(window.screen.availHeight)
// 窗口所在显示器的工作区（多显示器支持，由主进程推送）
// 初始用 window.screen 近似（主屏 workArea），主进程创建窗口后会推送准确值
const workArea = ref({
  x: window.screen.availLeft || 0,
  y: window.screen.availTop || 0,
  width: window.screen.availWidth,
  height: window.screen.availHeight
})

// 面板/气泡估算高度（用于边缘检测初始值，后续由 ResizeObserver 更新）
const CHAT_PANEL_EST_HEIGHT = 420
const BUBBLE_EST_HEIGHT = 200
// 面板/气泡估算宽度（用于水平边缘检测初始值，后续由 ResizeObserver 更新）
const CHAT_PANEL_EST_WIDTH = 520
const BUBBLE_EST_WIDTH = 320
// 工具栏估算宽高（固定布局，不需要 ResizeObserver）
const TOOLBAR_EST_WIDTH = 210
const TOOLBAR_EST_HEIGHT = 40

// ResizeObserver 用于获取面板/气泡/工具栏实际渲染高度和宽度
let chatPanelResizeObs = null
let bubbleResizeObs = null
let toolbarResizeObs = null

// 面板和气泡的实际渲染高度和宽度
const chatPanelActualHeight = ref(CHAT_PANEL_EST_HEIGHT)
const bubbleActualHeight = ref(BUBBLE_EST_HEIGHT)
const chatPanelActualWidth = ref(CHAT_PANEL_EST_WIDTH)
const bubbleActualWidth = ref(BUBBLE_EST_WIDTH)
// 工具栏的实际渲染高度和宽度（ResizeObserver 更新）
const toolbarActualHeight = ref(TOOLBAR_EST_HEIGHT)
const toolbarActualWidth = ref(TOOLBAR_EST_WIDTH)

/**
 * 计算安全的 bottom 值，确保面板/气泡不超出窗口顶部
 * @param {number} defaultBottom - 默认 bottom（characterSize + offset）
 * @param {number} actualHeight - 面板/气泡实际渲染高度
 * @returns {number} 安全的 bottom 值
 */
function safeBottom (defaultBottom, actualHeight) {
  // 如果 defaultBottom + actualHeight 超过窗口高度，减少 bottom
  if (actualHeight > 0 && defaultBottom + actualHeight > windowHeight.value) {
    // 不低于工具栏位置（角色上方），否则遮挡工具栏
    const minBottom = PET_CHARACTER_BOTTOM + characterSize.value + 10
    return Math.max(minBottom, windowHeight.value - actualHeight)
  }
  return defaultBottom
}

// ============================================================
// 垂直屏幕边缘检测（对称于水平 horizontalOffset）
// 窗口顶部移出屏幕（windowScreenY < 0）时，角色上方的气泡/工具栏会跟着出屏，
// 此时将浮动元素翻转到角色下方显示，保证它们仍在屏幕内可见
// ============================================================

// 角色距窗口底部的固定距离（预留下方空间，翻转时气泡/工具栏显示在此区域）
// 角色 bottom 固定不变，用户视觉上角色位置不跳动
const PET_CHARACTER_BOTTOM = 250

// 浮动元素间距（翻转前后一致）
const FLOAT_GAP = 4

// 窗口顶部超出屏幕顶部的像素数（0 = 未超出）
const topOverflow = computed(() => Math.max(0, -windowScreenY.value))

// 翻转前气泡正常 bottom（工具栏上方紧挨着，间距 FLOAT_GAP）
const normalBubbleBottomRaw = computed(() =>
  PET_CHARACTER_BOTTOM + characterSize.value + 10 + toolbarActualHeight.value + FLOAT_GAP
)

// 是否激活"顶部翻转"：当气泡顶部真正超出屏幕顶部时才翻转
const isFlippedUp = computed(() => {
  if (topOverflow.value <= 0) return false
  // 气泡正常 bottom（safeBottom 调整后的实际值）
  const normalBubbleBottom = safeBottom(normalBubbleBottomRaw.value, bubbleActualHeight.value)
  // 气泡顶部在屏幕中的 y 坐标 < 0 即超出屏幕顶部
  const bubbleTopScreenY = windowScreenY.value + windowHeight.value - normalBubbleBottom - bubbleActualHeight.value
  return bubbleTopScreenY < 0
})

// 角色 bottom 固定，不随翻转变化（用户要求角色位置不跳动）
const characterBottom = computed(() => PET_CHARACTER_BOTTOM)

// 气泡安全 bottom（顶部翻转时翻转到角色下方，在小按钮下方紧挨着）
const bubbleBottom = computed(() => {
  if (isFlippedUp.value) {
    // 翻转：小按钮在角色下方，气泡在小按钮下方，间距 FLOAT_GAP
    const toolbarBottomFlipped = characterBottom.value - toolbarActualHeight.value - FLOAT_GAP
    return Math.max(4, toolbarBottomFlipped - bubbleActualHeight.value - FLOAT_GAP)
  }
  return safeBottom(normalBubbleBottomRaw.value, bubbleActualHeight.value)
})

// 工具栏 bottom（正常在角色上方；顶部翻转时在角色下方，紧贴角色底部）
const toolbarBottom = computed(() => {
  if (isFlippedUp.value) {
    return characterBottom.value - toolbarActualHeight.value - FLOAT_GAP
  }
  return PET_CHARACTER_BOTTOM + characterSize.value + 10
})

// AI 对话面板安全 bottom（参与顶部翻转，翻转时位于气泡下方，不遮挡气泡）
const chatPanelBottom = computed(() => {
  if (isFlippedUp.value) {
    // 翻转顺序：角色 → 工具栏 → 气泡 → AI对话框（对话框在最下方）
    // 关键：锚点必须用气泡"理论 bottom"（未钳制值），不能用 bubbleBottom.value
    //   因为气泡被 Math.max(4,...) 钳到贴底后，面板基于贴底值计算会与气泡重叠遮挡
    //   用未钳值可保证面板始终在气泡下方正确相对位移，即使面板超出窗口也不遮挡气泡
    const toolbarBottomFlipped = characterBottom.value - toolbarActualHeight.value - FLOAT_GAP
    const bubbleBottomFlippedRaw = toolbarBottomFlipped - bubbleActualHeight.value - FLOAT_GAP
    const anchorBottom = bubbleVisible.value
      ? bubbleBottomFlippedRaw
      : toolbarBottomFlipped
    return anchorBottom - chatPanelActualHeight.value - FLOAT_GAP
  }
  // 正常：气泡可见时面板在气泡上方（不遮挡气泡）；否则原工具栏上方位置
  // 不用 safeBottom：safeBottom 会把面板压到完整可见但在气泡下方，违背"在气泡上方"
  //   面板顶部可能超出窗口被裁剪，但位置关系正确（在气泡上方），可通过工具栏 AI 按钮关闭
  if (bubbleVisible.value) {
    return bubbleBottom.value + bubbleActualHeight.value + FLOAT_GAP
  }
  return safeBottom(PET_CHARACTER_BOTTOM + characterSize.value + 54, chatPanelActualHeight.value)
})

/**
 * 计算指定宽度元素的水平偏移量，确保不超出屏幕左右边缘
 * 浮动元素居中在窗口内（left:50%; translateX(-50%)），通过偏移反向补偿
 * 钳制偏移量保证元素不超出窗口边界：避免被窗口矩形裁剪另一侧（桌宠超出屏幕 a 像素时
 *   对话框不应"另一侧消失 a 像素"），超出屏幕部分由屏幕自然裁剪（跟随桌宠探出）
 * @param {number} elementWidth - 元素 border-box 宽度
 * @returns {number} 水平偏移像素值（正=向右，负=向左）
 */
function computeHorizontalOffset (elementWidth) {
  if (elementWidth <= 0) return 0
  const winX = windowScreenX.value
  const wa = workArea.value
  const availLeft = wa.x
  const availRight = wa.x + wa.width

  // 用 outerWidth（含边框）计算中心点，与 workArea 坐标系一致
  const outerW = window.outerWidth
  const centerX = winX + outerW / 2
  // 元素左右边缘（不含 offset）
  const elementLeft = centerX - elementWidth / 2
  const elementRight = centerX + elementWidth / 2

  let offset = 0
  // 左边缘超出屏幕左侧：向右偏移
  if (elementLeft < availLeft) {
    offset = availLeft - elementLeft
  } else if (elementRight > availRight) {
    // 右边缘超出屏幕右侧：向左偏移
    offset = availRight - elementRight
  }

  // 钳制偏移量：保证元素不超出窗口边界，避免被窗口矩形裁剪另一侧
  // 元素居中时左边缘距窗口左边 (outerW - elementWidth)/2，偏移不超过此值
  const maxOffset = (outerW - elementWidth) / 2
  if (offset > maxOffset) offset = maxOffset
  if (offset < -maxOffset) offset = -maxOffset
  return offset
}

// 各浮动元素独立的水平偏移 transform（宽度不同，偏移量独立计算）
const bubbleTransform = computed(() => `translateX(calc(-50% + ${computeHorizontalOffset(bubbleActualWidth.value)}px))`)
const toolbarTransform = computed(() => `translateX(calc(-50% + ${computeHorizontalOffset(toolbarActualWidth.value)}px))`)
const panelTransform = computed(() => `translateX(calc(-50% + ${computeHorizontalOffset(chatPanelActualWidth.value)}px))`)

/**
 * 窗口尺寸变化处理：更新 windowHeight，触发 chatPanelBottom/bubbleBottom 重算
 */
function handleWindowResize () {
  windowHeight.value = window.innerHeight

  screenAvailWidth.value = window.screen.availWidth
  screenAvailHeight.value = window.screen.availHeight
  windowScreenX.value = window.screenX
  windowScreenY.value = window.screenY
}



/**
 * 窗口获得焦点：若处于穿透状态，重新设置 forward:true
 * Electron 可能在失焦/恢复后丢失 forward 转发，导致 mousemove 不再被转发
 */
function handleWindowFocus () {
  if (mouseIgnoring) {
    petApi.setIgnoreMouseEvents(true).catch(() => {})
  }
  // 清除可能卡死的 mousePassRafId
  if (mousePassRafId !== null) {
    cancelAnimationFrame(mousePassRafId)
    mousePassRafId = null
  }
}

/**
 * 窗口失焦：强制重置拖拽状态（防止 mouseup 丢失导致 isDragging 卡死）
 */
function handleWindowBlur () {
  if (isDragging) {
    console.warn('[PetApp] 窗口失焦时仍在拖拽，强制重置拖拽状态')
    if (dragWatchdogTimer) {
      clearTimeout(dragWatchdogTimer)
      dragWatchdogTimer = null
    }
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId)
      dragRafId = null
    }
    petApi.dragEnd().catch(() => {})
    isDragging = false
    windowScreenX.value = window.screenX
    windowScreenY.value = window.screenY
    window.removeEventListener('mousemove', handleDragMove)
    window.removeEventListener('mouseup', handleDragEnd)
  }
}

/**
 * 为面板、气泡和工具栏设置 ResizeObserver，监听实际渲染宽高变化
 */
function setupResizeObservers () {
  // 监听 AI 对话面板（用 offsetWidth/offsetHeight 获取 border-box 尺寸，含 padding/border）
  // 注意：元素是 v-if 条件渲染，每次显示时 DOM 节点是全新的，必须先 disconnect 旧 observer
  // 否则旧 observer 残留导致新节点不被观察，尺寸保持旧值，位置计算错位
  const panelEl = petChatPanelRef.value?.$el
  if (chatPanelResizeObs) {
    chatPanelResizeObs.disconnect()
    chatPanelResizeObs = null
  }
  if (panelEl) {
    chatPanelActualHeight.value = panelEl.offsetHeight
    chatPanelActualWidth.value = panelEl.offsetWidth
    chatPanelResizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chatPanelActualHeight.value = entry.target.offsetHeight
        chatPanelActualWidth.value = entry.target.offsetWidth
      }
    })
    chatPanelResizeObs.observe(panelEl)
  }

  // 监听气泡
  const bubbleEl = petBubbleRef.value?.$el
  if (bubbleResizeObs) {
    bubbleResizeObs.disconnect()
    bubbleResizeObs = null
  }
  if (bubbleEl) {
    bubbleActualHeight.value = bubbleEl.offsetHeight
    bubbleActualWidth.value = bubbleEl.offsetWidth
    bubbleResizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        bubbleActualHeight.value = entry.target.offsetHeight
        bubbleActualWidth.value = entry.target.offsetWidth
      }
    })
    bubbleResizeObs.observe(bubbleEl)
  }

  // 监听工具栏
  const toolbarEl = petToolbarRef.value?.$el
  if (toolbarResizeObs) {
    toolbarResizeObs.disconnect()
    toolbarResizeObs = null
  }
  if (toolbarEl) {
    toolbarActualHeight.value = toolbarEl.offsetHeight
    toolbarActualWidth.value = toolbarEl.offsetWidth
    toolbarResizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        toolbarActualHeight.value = entry.target.offsetHeight
        toolbarActualWidth.value = entry.target.offsetWidth
      }
    })
    toolbarResizeObs.observe(toolbarEl)
  }
}

/**
 * 清理 ResizeObserver
 */
function teardownResizeObservers () {
  if (chatPanelResizeObs) {
    chatPanelResizeObs.disconnect()
    chatPanelResizeObs = null
  }
  if (bubbleResizeObs) {
    bubbleResizeObs.disconnect()
    bubbleResizeObs = null
  }
  if (toolbarResizeObs) {
    toolbarResizeObs.disconnect()
    toolbarResizeObs = null
  }
}

// ============================================================
// 气泡/工具栏透明度
// ============================================================
const bubbleOpacity = ref(1.0)
const toolbarOpacity = ref(1.0)
const KEY_BUBBLE_OPACITY = 'pet_bubble_opacity'
const KEY_TOOLBAR_OPACITY = 'pet_toolbar_opacity'

// ============================================================
// AI 对话状态
// ============================================================

// AI 对话面板是否可见
const chatPanelVisible = ref(false)

// AI 对话消息列表 [{ id, role: 'user'|'assistant', content }]
const chatMessages = ref([])

// 是否正在生成回复
const chatStreaming = ref(false)

// 流式生成中的实时内容
const chatStreamingContent = ref('')

// 流式生成中的思考过程（推理模型 DeepSeek-R1 / Claude thinking / o1 等，与正式回复分离）
const chatStreamingThinking = ref('')

// 最近一次注入的上下文（供 PetChatPanel 展示）
const lastInjectedContext = ref('')

// 系统提示词
const chatSystemPrompt = ref(DEFAULT_PET_AI_SYSTEM_PROMPT)

// 提示词生成 meta-prompt（提示词的提示词，可编辑持久化）
const chatMetaPrompt = ref(PROMPT_GENERATION_META_PROMPT)

// 提示词生成中
const promptGenerating = ref(false)

// AI 自动对话状态
const autoChatEnabled = ref(false)
const autoChatInterval = ref(30)
// 自动对话深度思考配置（从设置加载，控制自动对话是否启用推理模式及强度）
const autoChatThinkingEnabled = ref(false)
const autoChatThinkingEffort = ref('high')
let autoChatTimer = null
// 标记当前是否为自动对话（用于 handleStreamEnd 时将回复显示到气泡）
let isAutoChatting = false

// 常驻 AI 会话 ID
let petAssistantSessionId = null

// AI 对话消息自增 ID
let chatMsgSeq = 0

// .pet-root 元素引用（用于 ResizeObserver）
const petRootRef = ref(null)
// .pet-chat-panel、.pet-bubble、.pet-toolbar 元素引用（用于 ResizeObserver 获取实际宽高）
const petChatPanelRef = ref(null)
const petBubbleRef = ref(null)
const petToolbarRef = ref(null)

// ============================================================
// 智能气泡消息系统状态
// ============================================================

// 自定义名言数组（从配置读取，每行一条）
const customQuotes = ref([])

// 鼓励消息开关（从配置读取，默认开启）
const encouragementEnabled = ref(true)

// 鼓励消息间隔（分钟，从配置读取，默认 10 分钟）
const encouragementInterval = ref(10)

// ============================================================
// 内部变量（非响应式）
// ============================================================

// 气泡自动消失定时器
let bubbleDismissTimer = null

// 气泡宽度持久化防抖定时器
let bubbleResizeTimer = null

// 鼓励消息定时器（随机间隔触发）
let encouragementTimer = null

// 鼓励消息自增 id（用于 PetBubble 的 reminder.id）
let encouragementSeq = 0

// 是否正在显示鼓励消息（用于区分健康提醒，控制关闭按钮行为）
// 语义：true 表示当前气泡由前端生成（非 pet:reminder 事件），无需通知主进程 dismiss
let isShowingEncouragement = false

// 工具栏隐藏延迟定时器
let toolbarHideTimer = null

// rAF 节流状态：拖拽 move 时每帧最多发送一次
let dragRafId = null
let lastMoveX = 0
let lastMoveY = 0

// 鼠标按下起始坐标与时间，用于区分点击与拖拽
let mouseDownX = 0
let mouseDownY = 0
let mouseDownTime = 0

// 活动状态监控定时器（每分钟查询一次活动状态）
let activityMonitorTimer = null
let lastAnalyticsReminderTime = 0

// 待办提醒检查定时器（每 15 分钟检查一次）
let todoCheckTimer = null

// 启动活动状态监控（首次延迟 30 秒）
function startActivityMonitor () {
  if (activityMonitorTimer !== null) return
  activityMonitorTimer = setTimeout(function tick () {
    checkActivityStatus()
    activityMonitorTimer = setTimeout(tick, ACTIVITY_MONITOR_INTERVAL_MS)
  }, 30 * 1000)
}

// 停止活动状态监控
function stopActivityMonitor () {
  if (activityMonitorTimer !== null) {
    clearTimeout(activityMonitorTimer)
    activityMonitorTimer = null
  }
}

// 启动待办提醒检查（首次延迟 2 分钟）
function startTodoCheck () {
  if (todoCheckTimer !== null) return
  todoCheckTimer = setTimeout(function tick () {
    checkTodoReminders()
    todoCheckTimer = setTimeout(tick, TODO_CHECK_INTERVAL_MS)
  }, 2 * 60 * 1000)
}

// 停止待办提醒检查
function stopTodoCheck () {
  if (todoCheckTimer !== null) {
    clearTimeout(todoCheckTimer)
    todoCheckTimer = null
  }
}

// 窗口显隐时动态启停轮询，避免隐藏后空转
function handleVisibilityChange () {
  if (document.visibilityState === 'visible') {
    startActivityMonitor()
    startTodoCheck()
    scheduleNextEncouragement()
    scheduleAutoChat()
  } else {
    stopActivityMonitor()
    stopTodoCheck()
    // 停止鼓励消息和 AI 自动对话，避免隐藏后空转 AI 调用
    if (encouragementTimer !== null) {
      clearTimeout(encouragementTimer)
      encouragementTimer = null
    }
    if (autoChatTimer !== null) {
      clearTimeout(autoChatTimer)
      autoChatTimer = null
    }
  }
}

// 上次健康提醒触发时间戳（用于限频）
let lastHealthReminderTime = 0

// 上次待办提醒触发时间戳（用于限频）
let lastTodoReminderTime = 0

// 上次活动状态（用于检测状态变化，如 idle → active）
let lastActivityStatus = null

// 最近一次 collectContext 收集到的 params（供自动对话指令推导使用）
let lastCollectedParams = {}


// 事件监听取消函数
let unsubscribeReminder = null
let unsubscribePausedChanged = null
let unsubscribeConfigChanged = null
let unsubscribeForceDismiss = null
let unsubscribeSmartBubbleConfigChanged = null
let unsubscribeStreamStart = null
let unsubscribeStreamChunk = null
let unsubscribeStreamEnd = null
let unsubscribeStreamError = null
let unsubscribeWorkArea = null
let unsubscribeMessagesChanged = null


// 'app:theme-changed' 事件处理函数引用
let onThemeChanged = null

// ============================================================
// 主题初始化
// ============================================================

/**
 * 初始化主题：读取 app_setting 中的主题配置并应用到 DOM
 * 桌宠窗口独立于主窗口，需要自行读取主题并应用 html.dark 类
 */
async function initTheme () {
  try {
    await appStore.init()
  } catch (err) {
    // 主题加载失败时回退到浅色模式
    console.warn('[PetApp] 主题初始化失败，使用默认浅色模式:', err.message)
  }
}

// ============================================================
// 配置加载
// ============================================================

/**
 * 加载桌宠配置并初始化状态
 * 配置由主进程 pet:get-config 返回：{ enabled, alwaysOnTop, x, y, width, height, remindersPaused, character }
 */
async function loadConfig () {
  try {
    const config = await petApi.getConfig()
    if (config && typeof config === 'object') {
      alwaysOnTop.value = !!config.alwaysOnTop
      isPaused.value = !!config.remindersPaused
      if (config.character === 'robot' || config.character === 'cat' || config.character === 'orb' || config.character === 'dna') {
        currentCharacter.value = config.character
      }
      if (typeof config.characterSize === 'number' && config.characterSize >= 60 && config.characterSize <= 300) {
        characterSize.value = config.characterSize
      }
      if (typeof config.chatPanelOpacity === 'number' && config.chatPanelOpacity >= 0.3 && config.chatPanelOpacity <= 1) {
        chatPanelOpacity.value = config.chatPanelOpacity
      }
      keyTrackerEnabled.value = !!config.keyTrackerEnabled
    }
  } catch (err) {
    // 配置加载失败时使用默认值
    console.warn('[PetApp] 加载桌宠配置失败，使用默认值:', err.message)
  } finally {
    configLoaded.value = true
  }
}

// ============================================================
// 事件处理
// ============================================================

/**
 * 处理收到的健康提醒事件
 * 切换到 reminding 状态，显示气泡，8 秒后自动回到 idle
 * @param {Object} reminder 提醒对象 { id, type, title, body, timestamp }
 */
function handleReminder (reminder) {
  if (!reminder || !reminder.id) return

  // 暂停状态下不显示提醒（与主进程协调，但渲染层也做防御）
  if (isPaused.value) return

  // 健康提醒显示时停止鼓励消息定时器，避免冲突
  if (encouragementTimer !== null) {
    clearTimeout(encouragementTimer)
    encouragementTimer = null
  }
  isShowingEncouragement = false

  // 设置当前提醒并显示气泡
  currentReminder.value = reminder
  bubbleVisible.value = true
  currentState.value = STATE.REMINDING

  // 清除上一次的自动消失定时器
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
  }
  // 8 秒后自动回到 idle 状态
  bubbleDismissTimer = setTimeout(() => {
    dismissBubble()
    // 健康提醒消失后恢复鼓励消息定时器
    scheduleNextEncouragement()
  }, BUBBLE_AUTO_DISMISS_MS)
}

/**
 * 处理提醒暂停状态变化事件
 * @param {Object} data { paused }
 */
function handlePausedChanged (data) {
  if (data && typeof data === 'object') {
    isPaused.value = !!data.paused
  }
}

/**
 * 处理配置变化事件
 * @param {Object} changedFields 变化的配置字段
 */
function handleConfigChanged (changedFields) {
  if (!changedFields || typeof changedFields !== 'object') return
  if ('alwaysOnTop' in changedFields) {
    // 外部修改置顶配置，清除临时置顶标记
    bubbleTempTopped.value = false
    alwaysOnTop.value = !!changedFields.alwaysOnTop
  }
  if ('remindersPaused' in changedFields) {
    isPaused.value = !!changedFields.remindersPaused
  }
  if ('character' in changedFields) {
    const c = changedFields.character
    if (c === 'cat' || c === 'robot' || c === 'orb' || c === 'dna') {
      currentCharacter.value = c
    }
  }
  if ('characterSize' in changedFields) {
    const s = changedFields.characterSize
    if (typeof s === 'number' && s >= 60 && s <= 300) {
      characterSize.value = s
    }
  }
  if ('chatPanelOpacity' in changedFields) {
    const o = changedFields.chatPanelOpacity
    if (typeof o === 'number' && o >= 0.3 && o <= 1) {
      chatPanelOpacity.value = o
    }
  }
  if ('keyTrackerEnabled' in changedFields) {
    keyTrackerEnabled.value = !!changedFields.keyTrackerEnabled
  }
}

/**
 * 处理智能气泡配置变化事件
 * 当用户在设置页面修改自定义名言后，实时更新桌宠气泡内容
 * @param {Object} payload 配置变化数据 { key, value }
 */
function handleSmartBubbleConfigChanged (payload) {
  if (!payload || typeof payload !== 'object') return

  // 主题变化：同步应用 dark class（桌宠窗口独立，需自行应用主题）
  if (payload.key === 'theme') {
    appStore.syncTheme(payload.value)
    return
  }

  // 强调色变化：同步应用 CSS 变量
  if (payload.key === 'accent_color') {
    appStore.syncAccentColor(payload.value)
    return
  }

  // 桌宠气泡字体大小变化：同步状态（气泡组件通过 store 读取并应用）
  if (payload.key === 'pet_bubble_font_size') {
    appStore.syncPetBubbleFontSize(payload.value)
    return
  }

  // 自定义名言变化
  if (payload.key === KEY_CUSTOM_QUOTES && typeof payload.value === 'string') {
    customQuotes.value = payload.value
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
    console.log('[PetApp] 自定义名言已更新')
  }

  // 鼓励开关变化
  if (payload.key === KEY_ENCOURAGEMENT_ENABLED) {
    encouragementEnabled.value = payload.value === '1' || payload.value === 'true'
  }

  // 鼓励间隔变化
  if (payload.key === KEY_ENCOURAGEMENT_INTERVAL) {
    const num = parseInt(payload.value, 10)
    if (!isNaN(num) && num > 0) {
      encouragementInterval.value = num
    }
  }

  // AI 自动对话开关变化
  if (payload.key === KEY_PET_AI_AUTO_CHAT) {
    autoChatEnabled.value = payload.value === '1' || payload.value === 'true'
    scheduleAutoChat()
  }

  // AI 自动对话间隔变化
  if (payload.key === KEY_PET_AI_AUTO_CHAT_INTERVAL) {
    const num = parseInt(payload.value, 10)
    if (!isNaN(num) && num > 0) {
      autoChatInterval.value = num
      scheduleAutoChat()
    }
  }

  // AI 自动对话深度思考开关变化
  if (payload.key === KEY_PET_AI_AUTO_CHAT_THINKING) {
    autoChatThinkingEnabled.value = payload.value === '1' || payload.value === 'true'
  }

  // AI 自动对话思考强度变化
  if (payload.key === KEY_PET_AI_AUTO_CHAT_THINKING_EFFORT) {
    if (payload.value && ['low', 'medium', 'high', 'max'].includes(payload.value)) {
      autoChatThinkingEffort.value = payload.value
    }
  }

  // 气泡透明度变化
  if (payload.key === KEY_BUBBLE_OPACITY) {
    const num = parseFloat(payload.value)
    if (!isNaN(num) && num > 0 && num <= 1) bubbleOpacity.value = num
  }

  // 工具栏透明度变化
  if (payload.key === KEY_TOOLBAR_OPACITY) {
    const num = parseFloat(payload.value)
    if (!isNaN(num) && num > 0 && num <= 1) toolbarOpacity.value = num
  }
}

// ============================================================
// 鼓励消息（定时随机显示，给用户加油打气）
// ============================================================

/**

 * 调度下一次鼓励消息
 * 优先使用配置的 encouragementInterval（分钟），加 ±20% 随机抖动避免过于规律
 * 若配置未加载（<=0），回退到 [5, 15] 分钟随机间隔
 */
function scheduleNextEncouragement () {
  // 清理已有定时器
  if (encouragementTimer !== null) {
    clearTimeout(encouragementTimer)
    encouragementTimer = null
  }

  let delay
  const configuredMinutes = encouragementInterval.value
  if (configuredMinutes && configuredMinutes > 0) {
    // 配置间隔 ±20% 随机抖动
    const base = configuredMinutes * 60 * 1000
    const jitter = base * 0.2
    delay = base - jitter + Math.floor(Math.random() * (2 * jitter))
  } else {
    // 回退：[5, 15] 分钟随机
    delay = ENCOURAGEMENT_MIN_INTERVAL_MS +
      Math.floor(Math.random() * (ENCOURAGEMENT_MAX_INTERVAL_MS - ENCOURAGEMENT_MIN_INTERVAL_MS))
  }

  encouragementTimer = setTimeout(async () => {
    encouragementTimer = null
    // 用户离开/空闲/锁屏时跳过本次鼓励（休息中不打扰），调度下一次
    if (await isUserAway()) {
      scheduleNextEncouragement()
      return
    }
    showEncouragementMessage()
  }, delay)
}

/**
 * 显示一条鼓励消息
 * 暂停状态或正在显示健康提醒时不显示，并调度下一次
 * 鼓励消息开关关闭时不显示，并调度下一次
 * @param {boolean} [force=false] 强制显示，绕过 encouragementEnabled 开关检查（点击桌宠触发时使用）
 */
function showEncouragementMessage (force) {
  // 鼓励消息开关关闭时不显示（force=true 时绕过此检查）
  if (!force && !encouragementEnabled.value) {
    scheduleNextEncouragement()
    return
  }
  // 暂停状态下不显示鼓励消息（force=true 时也绕过，因为用户主动点击）
  if (!force && isPaused.value) {
    scheduleNextEncouragement()
    return
  }
  // 正在显示健康提醒时不显示鼓励消息（force=true 时绕过，允许切换新消息）
  if (!force && currentState.value === STATE.REMINDING) {
    scheduleNextEncouragement()
    return
  }

  // 如果正在显示气泡，先清除旧定时器，避免旧 timer 干扰新消息
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
    bubbleDismissTimer = null
  }
  if (encouragementTimer !== null) {
    clearTimeout(encouragementTimer)
    encouragementTimer = null
  }

  // 构造鼓励消息对象，复用 PetBubble 的 reminder prop 结构
  encouragementSeq += 1
  // 判断是否选中自定义名言（决定 type 为 quote 还是 encouragement）
  const quotes = customQuotes.value && customQuotes.value.length > 0
    ? customQuotes.value
    : []
  const pool = ENCOURAGEMENT_MESSAGES.concat(quotes)
  const idx = Math.floor(Math.random() * pool.length)
  const message = pool[idx]
  const isQuote = idx >= ENCOURAGEMENT_MESSAGES.length

  currentReminder.value = {
    id: `encouragement-${encouragementSeq}`,
    type: isQuote ? 'quote' : 'encouragement',
    title: message,
    body: '',
    timestamp: Date.now()
  }
  bubbleVisible.value = true
  currentState.value = STATE.HAPPY
  isShowingEncouragement = true

  // 清除上一次的自动消失定时器
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
  }
  // 6 秒后自动消失
  bubbleDismissTimer = setTimeout(() => {
    dismissBubble()
    // 消失后调度下一次鼓励消息
    scheduleNextEncouragement()
  }, ENCOURAGEMENT_DISMISS_MS)
}

// ============================================================
// 智能气泡消息系统
// 根据用户活动状态显示健康提醒、待办提醒、欢迎回来等消息
// 优先级：健康提醒 > 待办提醒 > 鼓励消息/自定义名言
// ============================================================

/**
 * 加载智能气泡配置：鼓励开关、鼓励间隔、自定义名言
 * 配置存储在 app_settings 表，通过 systemApi.getSetting 读取
 */
async function loadSmartBubbleConfig () {
  // 鼓励开关
  try {
    const res = await systemApi.getSetting(KEY_ENCOURAGEMENT_ENABLED)
    if (res?.value !== null && res?.value !== undefined) {
      encouragementEnabled.value = res.value === '1' || res.value === 'true'
    }
  } catch (err) {
    // 键不存在时使用默认值，忽略错误
  }

  // 鼓励间隔
  try {
    const res = await systemApi.getSetting(KEY_ENCOURAGEMENT_INTERVAL)
    if (res?.value !== null && res?.value !== undefined) {
      const num = parseInt(res.value, 10)
      if (!isNaN(num) && num > 0) encouragementInterval.value = num
    }
  } catch (err) {
    // 忽略
  }

  // 自定义名言（每行一条，解析为数组）
  try {
    const res = await systemApi.getSetting(KEY_CUSTOM_QUOTES)
    if (res?.value !== null && res?.value !== undefined && typeof res.value === 'string') {
      customQuotes.value = res.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
    }
  } catch (err) {
    // 忽略
  }

  // 气泡最大宽度（拖拽调整后持久化的值）
  try {
    const res = await systemApi.getSetting(KEY_BUBBLE_MAX_WIDTH)
    if (res?.value !== null && res?.value !== undefined) {
      const w = parseInt(res.value, 10)
      if (!isNaN(w) && w >= BUBBLE_MAX_WIDTH_MIN && w <= BUBBLE_MAX_WIDTH_MAX) {
        bubbleMaxWidth.value = w
      }
    }
  } catch (err) {
    // 键不存在时使用默认值，忽略错误
  }

  // 气泡内容最大行数（上拉调整后持久化的值）
  try {
    const res = await systemApi.getSetting(KEY_BUBBLE_MAX_LINES)
    if (res?.value !== null && res?.value !== undefined) {
      const l = parseInt(res.value, 10)
      if (!isNaN(l) && l >= BUBBLE_MAX_LINES_MIN && l <= BUBBLE_MAX_LINES_MAX) {
        bubbleMaxLines.value = l
      }
    }
  } catch (err) {
    // 键不存在时使用默认值，忽略错误
  }
}

/**
 * 检查活动状态并触发相应消息
 * 每分钟调用 activityApi.getCurrentStatus() 获取当前活动状态
 * - 连续活跃超 60 分钟：显示"该休息一下了"健康提醒
 * - 连续活跃超 90 分钟：显示"久坐对身体不好"健康提醒
 * - 从空闲/离开恢复活跃：显示"欢迎回来"鼓励消息
 * - 健康提醒每 30 分钟最多触发一次（限频）
 */
async function checkActivityStatus () {
  try {
    const status = await activityApi.getCurrentStatus()
    if (!status || typeof status !== 'object') return

    const now = Date.now()
    const isActive = !status.isIdle && !status.isAway && !status.isLocked

    // 检测从空闲/离开恢复活跃：显示欢迎回来鼓励消息
    if (lastActivityStatus && isActive &&
        (lastActivityStatus.isIdle || lastActivityStatus.isAway)) {
      showWelcomeBackMessage()
    }

    // 健康提醒：连续活跃时间过长（限频 30 分钟）
    if (isActive && status.continuousActiveSeconds >= HEALTH_REMINDER_THRESHOLD_60_MIN) {
      if (now - lastHealthReminderTime >= HEALTH_REMINDER_MIN_INTERVAL_MS) {
        if (status.continuousActiveSeconds >= HEALTH_REMINDER_THRESHOLD_90_MIN) {
          showHealthReminder('久坐对身体不好，起来活动活动吧', '活动一下，让身体放松放松')
        } else {
          showHealthReminder('该休息一下了', '你已经连续使用电脑很久了，休息一下吧')
        }
        lastHealthReminderTime = now
      }
    }

    // 活动统计分析提醒（每 2 小时触发一次，仅活跃时，休息中不打扰）
    if (isActive && now - lastAnalyticsReminderTime >= ANALYTICS_REMINDER_INTERVAL_MS) {
      try {
        const summary = await activityApi.getSummary()
        if (summary && summary.days && summary.days.length > 0) {
          const today = summary.days[summary.days.length - 1]
          if (today && today.totalActiveSeconds > 0) {
            const hours = Math.round(today.totalActiveSeconds / 3600 * 10) / 10

            showAnalyticsMessage('今日活动统计', `活跃 ${hours} 小时，离开 ${today.breakCount || 0} 分钟`)
            lastAnalyticsReminderTime = now
          }
        }
      } catch (e) {
        console.warn('[PetApp] 获取活动统计失败:', e.message)
      }
    }

    // 记录本次活动状态，供下次比较
    lastActivityStatus = status
  } catch (err) {
    console.warn('[PetApp] 获取活动状态失败:', err.message)
  }
}

/**
 * 显示健康提醒（连续使用电脑太久）
 * 桌宠进入 reminding 状态，8 秒后自动回到 idle
 * 健康提醒显示时暂停鼓励消息定时器
 * @param {string} title 提醒标题
 * @param {string} body  提醒正文
 */
function showHealthReminder (title, body) {
  // 健康提醒显示时停止鼓励消息定时器，避免冲突
  if (encouragementTimer !== null) {
    clearTimeout(encouragementTimer)
    encouragementTimer = null
  }
  isShowingEncouragement = true // 前端生成，无需通知主进程 dismiss

  encouragementSeq += 1
  currentReminder.value = {
    id: `health-activity-${encouragementSeq}`,
    type: 'health',
    title,
    body,
    timestamp: Date.now()
  }
  bubbleVisible.value = true
  currentState.value = STATE.REMINDING

  // 清除上一次的自动消失定时器
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
  }
  // 8 秒后自动回到 idle 状态
  bubbleDismissTimer = setTimeout(() => {
    dismissBubble()
    // 健康提醒消失后恢复鼓励消息定时器
    scheduleNextEncouragement()
  }, BUBBLE_AUTO_DISMISS_MS)
}

/**
 * 显示用户活动气泡（当前用户在干啥）
 * 桌宠进入 happy 状态，6 秒后自动回到 idle
 * @param {string} activity 活动描述
 * @param {string} detail 活动详情
 */
function showActivityMessage (activity, detail) {
  // 正在显示健康提醒时不覆盖
  if (currentState.value === STATE.REMINDING) return

  // 停止鼓励消息定时器
  if (encouragementTimer !== null) {
    clearTimeout(encouragementTimer)
    encouragementTimer = null
  }

  encouragementSeq += 1
  currentReminder.value = {
    id: `activity-${encouragementSeq}`,
    type: 'activity',
    title: activity,
    body: detail || '',
    timestamp: Date.now()
  }
  bubbleVisible.value = true
  currentState.value = STATE.HAPPY
  isShowingEncouragement = true

  // 清除上一次的自动消失定时器
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
  }
  // 6 秒后自动消失
  bubbleDismissTimer = setTimeout(() => {
    dismissBubble()
    // 消失后调度下一次鼓励消息
    scheduleNextEncouragement()
  }, ENCOURAGEMENT_DISMISS_MS)
}

/**
 * 显示数据分析气泡
 * 桌宠进入 happy 状态，6 秒后自动回到 idle
 * @param {string} title 分析标题
 * @param {string} analysis 分析结果
 */
function showAnalyticsMessage (title, analysis) {
  // 正在显示健康提醒时不覆盖
  if (currentState.value === STATE.REMINDING) return

  // 停止鼓励消息定时器
  if (encouragementTimer !== null) {
    clearTimeout(encouragementTimer)
    encouragementTimer = null
  }

  encouragementSeq += 1
  currentReminder.value = {
    id: `analytics-${encouragementSeq}`,
    type: 'analytics',
    title,
    body: analysis || '',
    timestamp: Date.now()
  }
  bubbleVisible.value = true
  currentState.value = STATE.HAPPY
  isShowingEncouragement = true

  // 清除上一次的自动消失定时器
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
  }
  // 6 秒后自动消失
  bubbleDismissTimer = setTimeout(() => {
    dismissBubble()
    // 消失后调度下一次鼓励消息
    scheduleNextEncouragement()
  }, ENCOURAGEMENT_DISMISS_MS)
}

/**
 * 显示欢迎回来鼓励消息（用户从空闲/离开恢复活跃）
 * 桌宠进入 happy 状态，6 秒后自动回到 idle
 */
function showWelcomeBackMessage () {
  // 正在显示健康提醒时不覆盖
  if (currentState.value === STATE.REMINDING) return

  encouragementSeq += 1
  currentReminder.value = {
    id: `welcome-back-${encouragementSeq}`,
    type: 'encouragement',
    title: '欢迎回来！',
    body: '',
    timestamp: Date.now()
  }
  bubbleVisible.value = true
  currentState.value = STATE.HAPPY
  isShowingEncouragement = true

  // 清除上一次的自动消失定时器
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
  }
  // 6 秒后自动消失
  bubbleDismissTimer = setTimeout(() => {
    dismissBubble()
  }, ENCOURAGEMENT_DISMISS_MS)
}

/**
 * 检查待办提醒：查询未来 1 小时内到期的未完成便签
 * 每 15 分钟检查一次，10 分钟内最多触发一次（限频）
 * 暂停状态下不检查
 */
async function checkTodoReminders () {
  // 暂停状态下不检查待办
  if (isPaused.value) return
  // 正在显示健康提醒时不覆盖
  if (currentState.value === STATE.REMINDING) return

  // 限频：10 分钟内最多触发一次
  const now = Date.now()
  if (now - lastTodoReminderTime < TODO_REMINDER_MIN_INTERVAL_MS) return

  try {
    const from = dayjs().format('YYYY-MM-DD HH:mm:ss')
    const to = dayjs().add(TODO_LOOKAHEAD_MS, 'millisecond').format('YYYY-MM-DD HH:mm:ss')
    const result = await noteApi.getUpcomingReminders(from, to)
    if (result && result.list && result.list.length > 0) {
      // 取最近到期的便签
      const note = result.list[0]
      showTodoReminder(note)
      lastTodoReminderTime = now
    }
  } catch (err) {
    console.warn('[PetApp] 查询待办提醒失败:', err.message)
  }
}

/**

 * 显示待办提醒气泡
 */
function showTodoReminder (note) {
  isShowingEncouragement = true // 前端生成，无需通知主进程 dismiss

  encouragementSeq += 1
  // 格式化到期时间用于正文展示
  let bodyText = note.body || ''
  if (note.reminder_time) {
    const timeStr = dayjs(note.reminder_time).format('HH:mm')
    bodyText = bodyText ? `${bodyText}（${timeStr} 到期）` : `${timeStr} 到期`
  }

  currentReminder.value = {
    id: `todo-${encouragementSeq}`,
    type: 'todo',
    title: note.title || '有待办事项即将到期',
    body: bodyText,
    timestamp: Date.now()
  }
  bubbleVisible.value = true
  currentState.value = STATE.REMINDING

  // 清除上一次的自动消失定时器
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
  }
  // 8 秒后自动回到 idle 状态
  bubbleDismissTimer = setTimeout(() => {
    dismissBubble()
    // 待办提醒消失后恢复鼓励消息定时器
    scheduleNextEncouragement()
  }, BUBBLE_AUTO_DISMISS_MS)
}

// ============================================================
// 气泡交互
// ============================================================

/**
 * 关闭气泡并回到 idle 状态
 */
function dismissBubble () {
  bubbleVisible.value = false
  currentState.value = STATE.IDLE
  isShowingEncouragement = false
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
    bubbleDismissTimer = null
  }
}

/**
 * 用户点击气泡关闭按钮
 */
function handleBubbleDismiss (reminder) {
  // 仅健康提醒需要通知主进程；鼓励消息无需 dismiss
  if (reminder && reminder.id && !isShowingEncouragement) {
    petApi.dismissReminder(reminder.id).catch((err) => {
      console.warn('[PetApp] 关闭提醒失败:', err.message)
    })
  }
  dismissBubble()
  // 用户主动关闭后，调度下一次鼓励消息
  scheduleNextEncouragement()
}

/**
 * 用户点击气泡主体：打开健康提醒详情
 */
function handleBubbleClick () {
  // 切换到 happy 状态作为反馈
  currentState.value = STATE.HAPPY
  // 1.5 秒后回到 idle
  setTimeout(() => {
    if (currentState.value === STATE.HAPPY) {
      currentState.value = STATE.IDLE
    }
  }, 1500)
  dismissBubble()
  // 用户主动点击后，调度下一次鼓励消息
  scheduleNextEncouragement()
}

/**
 * 气泡拖拽调整大小：更新 bubbleMaxWidth / bubbleMaxLines 并防抖持久化到 app_settings
 * 窗口宽度固定 800px，拖拽气泡时仅调整气泡 max-width，不调用 resizeToContent
 *   桌宠窗口大小不变，角色位置保持不变，避免拖拽气泡时桌宠看起来在动
 * @param {Object} data - { width?: number, lines?: number }
 */
function handleBubbleResize (data) {
  if (!data || typeof data !== 'object') return

  // 宽度变化：仅更新气泡最大宽度，不调整窗口大小
  if (data.width !== undefined) {
    bubbleMaxWidth.value = data.width
    // 窗口固定 800px，足够容纳气泡最大 780px，无需 resizeToContent
  }

  // 行数变化：更新气泡内容最大行数（窗口高度不变）
  if (data.lines !== undefined) {
    bubbleMaxLines.value = data.lines
  }

  // 防抖持久化：500ms 内多次拖拽只保存最终值
  if (bubbleResizeTimer !== null) {
    clearTimeout(bubbleResizeTimer)
  }
  bubbleResizeTimer = setTimeout(() => {
    bubbleResizeTimer = null
    if (data.width !== undefined) {
      systemApi.setSetting(KEY_BUBBLE_MAX_WIDTH, String(bubbleMaxWidth.value)).catch((err) => {
        console.warn('[PetApp] 保存气泡宽度失败:', err.message)
      })
    }
    if (data.lines !== undefined) {
      systemApi.setSetting(KEY_BUBBLE_MAX_LINES, String(bubbleMaxLines.value)).catch((err) => {
        console.warn('[PetApp] 保存气泡行数失败:', err.message)
      })
    }
  }, 500)
}

/**
 * 气泡拖拽开始：清除自动消失定时器，避免拖拽过程中气泡被自动关闭
 */
function handleBubbleResizeStart () {
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
    bubbleDismissTimer = null
  }
}

/**
 * 气泡拖拽结束：重新设置自动消失定时器
 * 拖拽后给用户更长的阅读时间（统一 8 秒），避免刚拖完就消失
 */
function handleBubbleResizeEnd () {
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
  }
  bubbleDismissTimer = setTimeout(() => {
    dismissBubble()
    // 消失后调度下一次鼓励消息
    scheduleNextEncouragement()
  }, BUBBLE_AUTO_DISMISS_MS)
}

// ============================================================
// 鼠标穿透控制
// setIgnoreMouseEvents(true, { forward: true }) 让透明区域鼠标穿透到下方应用
// mousemove 仍被转发到渲染进程，用于检测鼠标是否进入交互元素
// 鼠标进入角色/工具栏/气泡 → 恢复响应（setIgnoreMouseEvents(false)）
// 鼠标离开交互区域 → 恢复穿透（setIgnoreMouseEvents(true, { forward: true })）
// ============================================================

// 当前鼠标穿透状态：true = 穿透（忽略），false = 响应
let mouseIgnoring = true
// mousemove rAF 节流 id
let mousePassRafId = null
// rAF 调度时间戳（用于超时保护，防止 rAF 因窗口失焦/后台不触发而短路）
let mousePassRafTime = 0
// rAF 超时阈值：超过此时间未执行则强制清除
const MOUSE_PASS_RAF_TIMEOUT = 200
// 缓存的 mousemove 事件
let lastPassEvent = null

/**
 * 检测鼠标是否在任何交互元素（角色/工具栏/气泡）上
 * 用 elementFromPoint 精准识别：.pet-root 设了 pointer-events:none，
 * 透明区域返回 null，只有 pointer-events:auto 的交互元素会返回
 * 增加容错：尝试多个点（中心点和边缘点）以提高检测可靠性
 * @param {number} x clientX
 * @param {number} y clientY
 * @returns {boolean}
 */
function isMouseOnInteractive (x, y) {
  try {
    // 主要检测点
    const el = document.elementFromPoint(x, y)
    if (el && el.closest('.pet-root__character, .pet-root__toolbar, .pet-root__bubble, .pet-root__chat-panel')) {
      return true
    }
    // 容错检测：尝试周围几个点（应对高 DPI 或透明区域边缘）
    const offsets = [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, -2], [-2, 2], [2, 2]]
    for (const [dx, dy] of offsets) {
      const el2 = document.elementFromPoint(x + dx, y + dy)
      if (el2 && el2.closest('.pet-root__character, .pet-root__toolbar, .pet-root__bubble, .pet-root__chat-panel')) {
        return true
      }
    }
    return false
  } catch (e) {
    // elementFromPoint 在高 DPI / 跨显示器场景可能抛出异常
    return false
  }
}

/**
 * 全局 mousemove 处理：检测鼠标是否在交互元素上，动态切换鼠标穿透状态
 * 用 rAF 节流，避免高频 mousemove 导致性能问题
 * 增加防抖：mouseleave 后立即强制启用鼠标响应，避免短暂无响应
 */
let lastMouseEnterTime = 0
let pendingForceEnableTimer = null
// 拖拽中锁定穿透状态，防止 handleRootMouseLeave 在拖拽期间恢复穿透
let isDragging = false
// 拖拽看门狗定时器（防止 mouseup 丢失导致 isDragging 永久卡死）
let dragWatchdogTimer = null
const DRAG_WATCHDOG_MS = 30000 // 30 秒超时

function handleGlobalMouseMove (event) {
  lastPassEvent = event
  // 记录最后一次 mouseenter 时间，用于强制激活
  lastMouseEnterTime = Date.now()

  // 超时保护：rAF 挂起超过 200ms 未执行则强制清除
  // 防止窗口失焦/后台时 rAF 不触发导致 mousePassRafId 永久非 null，短路所有 mousemove
  if (mousePassRafId !== null && Date.now() - mousePassRafTime > MOUSE_PASS_RAF_TIMEOUT) {
    cancelAnimationFrame(mousePassRafId)
    mousePassRafId = null
  }
  if (mousePassRafId !== null) return
  mousePassRafTime = Date.now()
  mousePassRafId = requestAnimationFrame(() => {
    mousePassRafId = null
    const e = lastPassEvent
    if (!e) return

    // 拖拽中不切换穿透状态，避免拖拽中断
    if (isDragging) return

    const interactive = isMouseOnInteractive(e.clientX, e.clientY)

    if (interactive) {
      // 鼠标在交互区域：直接显示工具栏（不依赖 mouseenter，因 pointer-events:none 可能不触发）
      if (toolbarHideTimer !== null) {
        clearTimeout(toolbarHideTimer)
        toolbarHideTimer = null
      }
      toolbarVisible.value = true

      if (mouseIgnoring) {
        // 鼠标进入交互区域 → 恢复响应
        mouseIgnoring = false
        petApi.setIgnoreMouseEvents(false).catch(() => {})
        // 清除上次挂起的强制激活定时器
        if (pendingForceEnableTimer) {
          clearTimeout(pendingForceEnableTimer)
          pendingForceEnableTimer = null
        }
      }
    } else if (!mouseIgnoring) {
      // 鼠标离开交互区域 → 恢复穿透
      mouseIgnoring = true
      petApi.setIgnoreMouseEvents(true).catch(() => {})
    }
  })
}

// ============================================================
// 工具栏交互
// ============================================================

/**
 * 隐藏桌宠
 */
function handleHide () {
  petApi.hide().catch((err) => {
    console.warn('[PetApp] 隐藏桌宠失败:', err.message)
  })
}

/**
 * 暂停 / 继续提醒
 */
function handleTogglePause () {
  const action = isPaused.value ? petApi.resumeReminders() : petApi.pauseReminders()
  action.catch((err) => {
    console.warn('[PetApp] 切换提醒暂停状态失败:', err.message)
  })
}

/**
 * 查看今日提醒
 * 查询今日到期便签，通过气泡显示提醒摘要
 * 有提醒：显示提醒标题和内容，类型为 todo
 * 无提醒：显示"今日暂无提醒"，类型为 encouragement
 */
async function handleViewReminders () {
  // 清除所有可能干扰的定时器，避免旧 timer 立即关闭新气泡
  if (encouragementTimer !== null) {
    clearTimeout(encouragementTimer)
    encouragementTimer = null
  }
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
    bubbleDismissTimer = null
  }
  // 标记为前端生成的消息，dismiss 时不通知主进程
  isShowingEncouragement = true

  try {
    // 查询今日到期便签（00:00:00 ~ 23:59:59）
    const from = dayjs().startOf('day').format('YYYY-MM-DD HH:mm:ss')
    const to = dayjs().endOf('day').format('YYYY-MM-DD HH:mm:ss')
    const result = await noteApi.getUpcomingReminders(from, to)
    if (result && result.list && result.list.length > 0) {
      const note = result.list[0]
      const count = result.list.length
      // 先设置 currentReminder，再设置 bubbleVisible，确保气泡渲染时数据已就绪
      currentReminder.value = {
        id: `todo-view-${Date.now()}`,
        type: 'todo',
        title: count > 1 ? `今日有 ${count} 条提醒` : '今日提醒',
        body: note.title || note.body || note.content || '',
        timestamp: Date.now()
      }
    } else {
      currentReminder.value = {
        id: `no-reminder-${Date.now()}`,
        type: 'encouragement',
        title: '今日暂无提醒',
        body: '可以放松一下啦',
        timestamp: Date.now()
      }
    }
    bubbleVisible.value = true
    currentState.value = STATE.REMINDING
    bubbleDismissTimer = setTimeout(() => { dismissBubble() }, BUBBLE_AUTO_DISMISS_MS)
  } catch (err) {
    console.warn('[PetApp] 查询今日提醒失败:', err.message)
    // 直接构造消息显示，不走 showEncouragementMessage 的检查逻辑（避免 REMINDING 状态被拦截）
    encouragementSeq += 1
    currentReminder.value = {
      id: `encouragement-${encouragementSeq}`,
      type: 'encouragement',
      title: '今日暂无提醒',
      body: '可以放松一下啦',
      timestamp: Date.now()
    }
    bubbleVisible.value = true
    currentState.value = STATE.HAPPY
    bubbleDismissTimer = setTimeout(() => { dismissBubble() }, BUBBLE_AUTO_DISMISS_MS)
  }
}

/**
 * 切换置顶
 */
function handleToggleAlwaysOnTop () {
  // 用户手动切换置顶，清除临时置顶标记
  bubbleTempTopped.value = false
  const next = !alwaysOnTop.value
  petApi.setAlwaysOnTop(next).catch((err) => {
    console.warn('[PetApp] 切换置顶失败:', err.message)
  })
  // 乐观更新，主进程会通过 config-changed 事件确认
  alwaysOnTop.value = next
}

/**
 * 切换键盘连击追踪
 */
function handleToggleKeyTracker () {
  const next = !keyTrackerEnabled.value
  petApi.updateConfig({ keyTrackerEnabled: next }).catch((err) => {
    console.warn('[PetApp] 切换键盘追踪失败:', err.message)
  })
  keyTrackerEnabled.value = next
}

/**
  * 切换桌宠形象（熊猫 ↔ 机器人）
 */
function handleSwitchCharacter () {
  const next = currentCharacter.value === CHARACTER.CAT
    ? CHARACTER.ROBOT
    : currentCharacter.value === CHARACTER.ROBOT
      ? CHARACTER.ORB
      : currentCharacter.value === CHARACTER.ORB
        ? CHARACTER.DNA
        : CHARACTER.CAT
  currentCharacter.value = next
  // 持久化到主进程
  petApi.updateConfig({ character: next }).catch((err) => {
    console.warn('[PetApp] 切换形象失败:', err.message)
  })
  // 切换时播放 happy 动画作为反馈
  currentState.value = STATE.HAPPY
  setTimeout(() => {
    if (currentState.value === STATE.HAPPY) {
      currentState.value = STATE.IDLE
    }
  }, 1200)
}

// ============================================================
// AI 对话功能
// ============================================================

/**
 * 初始化常驻 AI 助手会话
 * 查找已有的 __pet_assistant__ 会话，不存在则创建
 * 加载自定义提示词（如有）
 */
async function initPetAssistant () {
  // 加载自定义提示词
  try {
    const res = await systemApi.getSetting(KEY_PET_AI_SYSTEM_PROMPT)
    if (res?.value !== null && res?.value !== undefined && res.value) {
      chatSystemPrompt.value = res.value
    }
  } catch (err) {
    // 使用默认提示词
  }

  // 加载自定义 meta-prompt（提示词的提示词）
  try {
    const metaRes = await systemApi.getSetting(KEY_PET_AI_META_PROMPT)
    if (metaRes?.value !== null && metaRes?.value !== undefined && metaRes.value) {
      chatMetaPrompt.value = metaRes.value
    }
  } catch (err) {
    // 使用默认 meta-prompt
  }

  // 统一入口：查找或创建桌宠助手常驻会话
  try {
    const result = await chatApi.ensurePetAssistantSession({
      system_prompt: chatSystemPrompt.value
    })
    if (result?.session?.id) {
      petAssistantSessionId = result.session.id
      // 加载已有消息
      if (result.messages?.length) {
        chatMessages.value = result.messages.map(m => ({
          id: m.id || `msg-${++chatMsgSeq}`,
          role: m.role || (m.is_user ? 'user' : 'assistant'),
          content: m.content || ''
        })).filter(m => m.content)
      }
    } else {
      console.warn('[PetApp] 无可用 AI 模型配置，桌宠 AI 对话不可用')
    }
  } catch (err) {
    console.warn('[PetApp] 初始化 AI 助手会话失败:', err.message)
  }
}

/**
 * 切换 AI 对话面板显隐
 */
function handleToggleChat () {
  chatPanelVisible.value = !chatPanelVisible.value
  // 打开面板时确保工具栏不隐藏
  if (chatPanelVisible.value) {
    handleMouseEnter()
  }
}

/**
 * 更新 AI 对话框透明度并持久化到桌宠配置
 * @param {number} opacity - 透明度（0.3-1）
 */
function handleUpdateChatOpacity (opacity) {
  if (typeof opacity !== 'number' || opacity < 0.3 || opacity > 1) return
  chatPanelOpacity.value = opacity
  petApi.updateConfig({ chatPanelOpacity: opacity }).catch(() => {})
}

/**
 * 收集上下文信息（去敏感化）
 * 并行获取活动统计、健康数据、最近对话、待办/便签/定时任务/鼓励词条，拼接为上下文文本
 * @returns {Promise<string>}
 */
async function collectContext () {
  try {
    const [statusRes, summaryRes] = await Promise.all([
      activityApi.getCurrentStatus().catch(() => null),
      activityApi.getSummary(1).catch(() => null)
    ])

    const params = {}
    if (statusRes?.status) {
      params.activityStatus = statusRes.status
    }
    if (summaryRes?.summary && summaryRes.summary.length > 0) {
      params.activitySummary = summaryRes.summary[summaryRes.summary.length - 1]
    }

    // 时间段分布（去敏感化：只传各时段活跃时长，不传应用名/窗口标题/操作内容）
    try {
      const distRes = await activityApi.getTimeDistribution().catch(() => null)
      if (distRes?.distribution) {
        params.timeDistribution = distRes.distribution
      }
    } catch (e) {
      // 时间段分布获取失败不影响对话
    }

    // 活跃应用类别（去敏感化：只传类别+时长，不传具体应用名）
    try {
      const catRes = await activityApi.getAppCategories().catch(() => null)
      if (catRes?.categories && Array.isArray(catRes.categories)) {
        params.appCategories = catRes.categories
      }
    } catch (e) {
      // 应用类别获取失败不影响对话
    }

    // 最近7天活跃趋势（去敏感化：只传日期+活跃时长，不含应用名/操作内容）
    try {
      const recentRes = await activityApi.getSummary(7).catch(() => null)
      if (recentRes?.summary && Array.isArray(recentRes.summary)) {
        params.recentActivity = recentRes.summary.map(s => ({
          date: s.date,
          activeSeconds: s.totalActiveSeconds || 0
        }))
      }
    } catch (e) {
      // 7天趋势获取失败不影响对话
    }

    // 健康数据（去敏感化：只取汇总数字）
    try {
      const today = dayjs().format('YYYY-MM-DD')
      const healthRes = await healthApi.getStats({ date: today })
      if (healthRes?.stats) {
        params.healthStats = {
          waterCount: healthRes.stats.waterCount,
          sedentaryMinutes: healthRes.stats.sedentaryMinutes,
          sleepHours: healthRes.stats.sleepHours
        }
      }
    } catch (e) {
      // 健康数据获取失败不影响对话
    }

    // 注：对话历史由 chat-channels 按 token 预算传完整历史给 API，此处不再重复注入 recentMessages

    // 待办规划（去敏感化：只取标题+截止时间，不含内容详情/附件）
    try {
      const todoRes = await todoApi.list({ filter: { status: 'active' }, page: 1, size: 5 }).catch(() => null)
      if (todoRes?.list && Array.isArray(todoRes.list)) {
        params.todos = todoRes.list
          .filter(t => Number(t.is_enabled) === 1)
          .slice(0, 5)
          .map(t => ({
            title: t.title,
            dueDate: t.due_date || null
          }))
      }
    } catch (e) {
      // 待办获取失败不影响对话
    }

    // 即将到期便签（去敏感化：只取标题+提醒时间，不含正文）
    try {
      const fromIso = dayjs().toISOString()
      const toIso = dayjs().add(24, 'hour').toISOString()
      const noteRes = await noteApi.getUpcomingReminders(fromIso, toIso).catch(() => null)
      if (noteRes?.list && Array.isArray(noteRes.list)) {
        params.upcomingNotes = noteRes.list.slice(0, 3).map(n => ({
          title: n.title,
          remindTime: n.reminder_time || null
        }))
      }
    } catch (e) {
      // 便签获取失败不影响对话
    }

    // 今日定时任务（去敏感化：只取任务名+执行时间，不含命令详情）
    try {
      const taskRes = await taskApi.list({ is_enabled: 1, page: 1, size: 20 }).catch(() => null)
      if (taskRes?.list && Array.isArray(taskRes.list)) {
        params.scheduledTasks = pickTodayTasks(taskRes.list, 3)
      }
    } catch (e) {
      // 定时任务获取失败不影响对话
    }

    // 鼓励词条样本（让 AI 了解用户偏好的鼓励风格）
    try {
      params.encouragementSamples = pickEncouragementSamples(3)
    } catch (e) {
      // 鼓励词条收集失败不影响对话
    }

    // 暴露本次收集的 params，供自动对话指令推导使用
    lastCollectedParams = params

    return buildContextMessage(params)
  } catch (err) {
    return ''
  }
}

// 从定时任务列表中筛选今日待执行任务（去敏感化：只取 name + 执行时间）
function pickTodayTasks (tasks, maxCount) {
  const now = dayjs()
  const todayDate = now.date()
  const todayDay = now.day() // 0=周日
  const result = []
  for (const t of tasks) {
    if (Number(t.is_enabled) !== 1) continue
    const executeTime = parseTaskExecuteTime(t, todayDate, todayDay)
    if (!executeTime) continue
    result.push({ name: t.name, executeTime })
    if (result.length >= maxCount) break
  }
  return result
}

// 解析任务的今日执行时间（返回今日 ISO 字符串或 null），无法判定今日执行则返回 null
function parseTaskExecuteTime (task, todayDate, todayDay) {
  const config = task.schedule_config
  if (!config || typeof config !== 'object') return null
  try {
    const now = dayjs()
    if (task.task_type === 'one_shot') {
      const due = config.due_time
      if (!due) return null
      const d = dayjs(due)
      if (d.isSame(now, 'day')) return d.toISOString()
      return null
    }
    if (task.task_type === 'recurring') {
      const time = config.time || {}
      const hour = time.hour ?? 9
      const minute = time.minute ?? 0
      if (config.type === 'daily') {
        return now.hour(hour).minute(minute).second(0).millisecond(0).toISOString()
      }
      if (config.type === 'weekly') {
        if (config.day_of_week === todayDay) {
          return now.hour(hour).minute(minute).second(0).millisecond(0).toISOString()
        }
        return null
      }
      if (config.type === 'monthly') {
        if (config.day_of_month === todayDate) {
          return now.hour(hour).minute(minute).second(0).millisecond(0).toISOString()
        }
        return null
      }
    }
  } catch (e) {
    return null
  }
  return null
}

// 随机选取鼓励词条样本（仅内置；自定义名言属敏感内容，不注入 AI 上下文）
function pickEncouragementSamples (maxCount) {
  const builtin = [...ENCOURAGEMENT_MESSAGES]
  const result = []
  for (let i = 0; i < maxCount && builtin.length > 0; i++) {
    const idx = Math.floor(Math.random() * builtin.length)
    result.push(builtin.splice(idx, 1)[0])
  }
  return result
}

// 从活动状态推导用户状态（用于自动对话指令）
function deriveUserStatus (status) {
  if (!status) return ''
  if (status.isIdle) return 'idle'
  if (status.isAway) return 'away'
  const mins = (status.continuousActiveSeconds || 0) / 60
  // 连续活跃超 60 分钟视为久坐
  if (mins >= 60) return 'sedentary'
  return 'active'
}

// 判断是否有临近截止的待办（今日内到期或已过期未完成）
function hasUrgentTodo (todos) {
  if (!Array.isArray(todos) || todos.length === 0) return false
  const endOfToday = dayjs().endOf('day')
  return todos.some(t => {
    if (!t.dueDate) return false
    const due = dayjs(t.dueDate)
    return due.isValid() && due.isBefore(endOfToday)
  })
}

/**
 * 发送 AI 对话消息
 * 注入上下文 → 保存用户消息 → 触发 AI 生成 → 流式接收
 * @param {string} content - 用户输入文本
 * @param {Array} attachments - 附件列表
 * @param {string} thinkingEffort - 思考模式强度（''=关闭，low/medium/high/max）
 */
async function handleChatSend (content, attachments, thinkingEffort) {
  if (!petAssistantSessionId) {
    console.warn('[PetApp] AI 助手会话未初始化')
    return
  }

  // 添加用户消息到列表（含附件）
  chatMsgSeq += 1
  chatMessages.value.push({
    id: `chat-user-${chatMsgSeq}`,
    role: 'user',
    content,
    attachments: attachments || []
  })

  // 收集上下文（不拼接到 user 消息中，改为通过 generate options 注入）
  let petContext = ''
  try {
    petContext = await collectContext() || ''
    lastInjectedContext.value = petContext
  } catch (e) {
    lastInjectedContext.value = ''
  }

  chatStreaming.value = true
  chatStreamingContent.value = ''
  chatStreamingThinking.value = ''

  try {
    // 保存用户消息到后端（只保存用户输入，不含上下文，含附件）
    await chatApi.sendMessage({
      session_id: petAssistantSessionId,
      content,
      attachments: attachments && attachments.length > 0 ? attachments : undefined
    })

    // 触发 AI 流式生成，上下文通过 options 注入
    // 手动对话：思考模式由面板下拉决定（thinkingEffort 非空时启用推理）
    await chatApi.generateMessage({
      session_id: petAssistantSessionId,
      options: {
        pet_context: petContext || undefined,
        enable_thinking: thinkingEffort ? true : false,
        reasoning_effort: thinkingEffort || undefined
      }
    })
  } catch (err) {
    console.error('[PetApp] AI 对话发送失败:', err.message)
    chatStreaming.value = false
    chatStreamingContent.value = ''
    chatStreamingThinking.value = ''
    // 显示错误消息
    chatMsgSeq += 1
    chatMessages.value.push({
      id: `chat-error-${chatMsgSeq}`,
      role: 'assistant',
      content: `发送失败：${err.message}`
    })
  }
}

/**
 * 清空 AI 对话消息记录
 * 删除后端所有消息，清空前端列表
 */
async function handleChatClear () {
  if (!petAssistantSessionId) return
  try {
    // 批量清空会话所有消息（后端 chat:message:clear-by-session）
    await chatApi.clearMessagesBySession(petAssistantSessionId)
    chatMessages.value = []
    console.log('[PetApp] AI 对话记录已清空')
  } catch (err) {
    console.warn('[PetApp] 清空对话记录失败:', err.message)
  }
}

/**
 * 更新系统提示词并持久化
 */
async function handleUpdatePrompt (prompt) {
  chatSystemPrompt.value = prompt
  try {
    await systemApi.setSetting(KEY_PET_AI_SYSTEM_PROMPT, prompt)
    // 更新会话的 system_prompt
    if (petAssistantSessionId) {
      await chatApi.updateSession({
        id: petAssistantSessionId,
        system_prompt: prompt
      })
    }
    console.log('[PetApp] AI 提示词已更新')
  } catch (err) {
    console.warn('[PetApp] 保存提示词失败:', err.message)
  }
}

/**
 * 恢复默认提示词
 */
function handleResetPrompt () {
  chatSystemPrompt.value = DEFAULT_PET_AI_SYSTEM_PROMPT
  handleUpdatePrompt(DEFAULT_PET_AI_SYSTEM_PROMPT)
}

/**
 * 更新 meta-prompt（生成规范）并持久化
 * meta-prompt 不是会话的 system_prompt，只需存 setting，不调 chatApi.updateSession
 */
async function handleUpdateMetaPrompt (prompt) {
  chatMetaPrompt.value = prompt
  try {
    await systemApi.setSetting(KEY_PET_AI_META_PROMPT, prompt)
    console.log('[PetApp] 生成规范已更新')
  } catch (err) {
    console.warn('[PetApp] 保存生成规范失败:', err.message)
  }
}

/**
 * 恢复默认 meta-prompt（生成规范）
 */
function handleResetMetaPrompt () {
  chatMetaPrompt.value = PROMPT_GENERATION_META_PROMPT
  handleUpdateMetaPrompt(PROMPT_GENERATION_META_PROMPT)
}

/**
 * 让 AI 根据用户需求生成提示词
 * 向当前会话发送一条特殊消息，要求 AI 生成新的提示词
 * 同时注入最近对话记录作为背景，使生成的提示词更贴合用户习惯
 */
async function handleGeneratePrompt (requirement) {
  if (!petAssistantSessionId) {
    console.warn('[PetApp] AI 助手会话未初始化')
    return
  }
  promptGenerating.value = true
  try {
    // 获取最近5条对话记录作为上下文
    const recentHistory = chatMessages.value.slice(-5).map(m => ({
      role: m.role,
      content: m.content
    }))
    const generationContext = buildGenerationContext(recentHistory)

    const generatePrompt = `${chatMetaPrompt.value}

${generationContext}

【用户需求】${requirement}

请直接输出提示词内容，不要包含其他说明、不要用代码块包裹。`

    await chatApi.sendMessage({
      session_id: petAssistantSessionId,
      content: generatePrompt
    })

    const result = await chatApi.generateMessage({
      session_id: petAssistantSessionId
    })

    // 等待流式完成（通过轮询 streaming 状态）
    const maxWait = 30000
    const start = Date.now()
    while (chatStreaming.value && Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 200))
    }

    // 取最后一条 assistant 消息作为生成的提示词
    const lastMsg = chatMessages.value[chatMessages.value.length - 1]
    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
      await handleUpdatePrompt(lastMsg.content.trim())
    }
  } catch (err) {
    console.warn('[PetApp] AI 生成提示词失败:', err.message)
  } finally {
    promptGenerating.value = false
  }
}

/**
 * AI 流式事件处理
 */
function handleStreamStart (payload) {
  if (!payload || payload.session_id !== petAssistantSessionId) return
  chatStreaming.value = true
  chatStreamingContent.value = ''
  chatStreamingThinking.value = ''
  // 同步显示气泡，流式实时更新（自动对话和用户主动对话都显示）
  if (isAutoChatting) {
    if (encouragementTimer !== null) {
      clearTimeout(encouragementTimer)
      encouragementTimer = null
    }
    isShowingEncouragement = false
  }
  encouragementSeq += 1
  currentReminder.value = {
    id: `ai-stream-${encouragementSeq}`,
    type: 'ai',
    title: 'AI 回应',
    body: '思考中...',
    timestamp: Date.now()
  }
  bubbleVisible.value = true
  currentState.value = STATE.HAPPY
}

function handleStreamChunk (payload) {
  if (!payload || payload.session_id !== petAssistantSessionId) return
  // 思考过程与正式回复分离接收（推理模型）
  chatStreamingContent.value = payload.contentAccumulated || payload.accumulated || ''
  chatStreamingThinking.value = payload.thinkingAccumulated || ''
  // 实时更新气泡内容（只显示正式回复，不显示思考过程，气泡空间小）
  if (chatStreamingContent.value && currentReminder.value && currentReminder.value.type === 'ai') {
    currentReminder.value.body = chatStreamingContent.value
  }
}

function handleStreamEnd (payload) {
  if (!payload || payload.session_id !== petAssistantSessionId) return
  const content = payload.content || chatStreamingContent.value
  if (content) {
    chatMsgSeq += 1
    chatMessages.value.push({
      id: `chat-ai-${chatMsgSeq}`,
      role: 'assistant',
      content
    })
  }
  chatStreaming.value = false
  chatStreamingContent.value = ''
  chatStreamingThinking.value = ''

  // 确保气泡显示最终完整内容，8 秒后消失
  if (content) {
    if (isAutoChatting) {
      isAutoChatting = false
      // 清理 AI 自动对话定时器
      if (autoChatTimer !== null) {
        clearTimeout(autoChatTimer)
        autoChatTimer = null
      }
    }
    // 确保气泡显示最终完整内容（流式过程中已实时更新，这里做最终校正）
    if (currentReminder.value && currentReminder.value.type === 'ai') {
      currentReminder.value.body = content
    }
    bubbleVisible.value = true
    currentState.value = STATE.HAPPY
    // 8 秒后自动消失
    if (bubbleDismissTimer !== null) {
      clearTimeout(bubbleDismissTimer)
    }
    bubbleDismissTimer = setTimeout(() => {
      dismissBubble()
      scheduleNextEncouragement()
    }, BUBBLE_AUTO_DISMISS_MS)
  }
  // 调度下一次自动对话（仅在流式真正结束后才重新计时）
  scheduleAutoChat()
}

function handleStreamError (payload) {
  if (!payload || payload.session_id !== petAssistantSessionId) return
  chatStreaming.value = false
  const errMsg = payload?.error || '生成失败'
  chatMsgSeq += 1
  chatMessages.value.push({
    id: `chat-err-${chatMsgSeq}`,
    role: 'assistant',
    content: `抱歉，出了点问题：${errMsg}`
  })
  // 自动对话失败时重置标志，并重新调度下一次自动对话（避免定时器停摆）
  isAutoChatting = false
  // 流式出错时清理气泡，避免卡在"思考中..."
  if (currentReminder.value && currentReminder.value.type === 'ai') {
    dismissBubble()
  }
  scheduleAutoChat()
}



// ============================================================
// AI 自动对话（定时调用 AI，将回复显示到气泡）
// ============================================================

/**
 * 加载自动对话配置
 */
async function loadAutoChatConfig () {
  try {
    const { value: enabled } = await systemApi.getSetting(KEY_PET_AI_AUTO_CHAT)
    autoChatEnabled.value = enabled === '1' || enabled === 'true'
    const { value: interval } = await systemApi.getSetting(KEY_PET_AI_AUTO_CHAT_INTERVAL)
    const num = parseInt(interval, 10)
    if (!isNaN(num) && num > 0) {
      autoChatInterval.value = num
    }
    // 加载自动对话深度思考配置
    const { value: thinkingEnabled } = await systemApi.getSetting(KEY_PET_AI_AUTO_CHAT_THINKING)
    autoChatThinkingEnabled.value = thinkingEnabled === '1' || thinkingEnabled === 'true'
    const { value: thinkingEffort } = await systemApi.getSetting(KEY_PET_AI_AUTO_CHAT_THINKING_EFFORT)
    if (thinkingEffort && ['low', 'medium', 'high', 'max'].includes(thinkingEffort)) {
      autoChatThinkingEffort.value = thinkingEffort
    }
  } catch (e) {
    // 使用默认值
  }
}

/**
 * 调度下一次自动对话
 */
/**
 * 检查用户是否处于离开/空闲/锁屏状态（休息中，不宜打扰）
 * @returns {Promise<boolean>}
 */
async function isUserAway () {
  try {
    const status = await activityApi.getCurrentStatus()
    if (!status) return false
    return !!(status.isIdle || status.isAway || status.isLocked)
  } catch (e) {
    return false // 获取失败不阻断，保守地继续
  }
}

function scheduleAutoChat () {
  if (autoChatTimer !== null) {
    clearTimeout(autoChatTimer)
    autoChatTimer = null
  }
  if (!autoChatEnabled.value) return
  const delay = autoChatInterval.value * 60 * 1000
  autoChatTimer = setTimeout(() => {
    autoChatTimer = null
    performAutoChat()
  }, delay)
}

/**
 * 执行自动对话：向 AI 发送主动关心消息，将回复显示到气泡
 */
async function performAutoChat () {
  if (!petAssistantSessionId || isPaused.value || chatStreaming.value) {
    scheduleAutoChat()
    return
  }
  // 正在显示健康提醒时不触发自动对话
  if (currentState.value === STATE.REMINDING) {
    scheduleAutoChat()
    return
  }
  // 用户离开/空闲/锁屏时暂停自动对话（休息中不打扰）
  if (await isUserAway()) {
    scheduleAutoChat()
    return
  }

  isAutoChatting = true

  try {
    // 收集上下文（不拼接到 user 消息中，改为通过 generate options 注入）
    let petContext = ''
    try {
      petContext = await collectContext() || ''
      lastInjectedContext.value = petContext
    } catch (e) {
      lastInjectedContext.value = ''
    }

    // 自动对话：不保存 user 消息到数据库（不在历史会话中显示），
    // 通过 user_message 传递给 AI，上下文通过 pet_context 注入
    // 指令按时段+用户状态轮换回复方向，避免每次都只关心/提醒导致回复雷同
    const userMessage = buildAutoChatInstruction({
      hour: new Date().getHours(),
      userStatus: deriveUserStatus(lastCollectedParams.activityStatus),
      hasUrgentTodo: hasUrgentTodo(lastCollectedParams.todos)
    })

    await chatApi.generateMessage({
      session_id: petAssistantSessionId,
      options: {
        user_message: userMessage,
        pet_context: petContext || undefined,
        // 自动对话：思考模式由桌宠配置控制（autoChatThinkingEnabled + autoChatThinkingEffort）
        enable_thinking: autoChatThinkingEnabled.value,
        reasoning_effort: autoChatThinkingEnabled.value ? (autoChatThinkingEffort.value || undefined) : undefined
      }
    })
  } catch (err) {
    console.warn('[PetApp] 自动对话失败:', err.message)
    isAutoChatting = false
    scheduleAutoChat()
  }
}

// ============================================================
// 悬停处理（统一在 pet-root 上管理，避免子元素之间事件冲突）
// ============================================================

/**
 * 鼠标进入 pet-root 区域：显示工具栏，确保鼠标响应已启用
 */
function handleRootMouseEnter () {
  if (mouseIgnoring) {
    mouseIgnoring = false
    petApi.setIgnoreMouseEvents(false).catch(() => {})
  }
  if (toolbarHideTimer !== null) {
    clearTimeout(toolbarHideTimer)
    toolbarHideTimer = null
  }
  toolbarVisible.value = true
}

/**
 * 鼠标离开 pet-root 区域：延迟隐藏工具栏，恢复穿透
 */
function handleRootMouseLeave () {
  if (toolbarHideTimer !== null) {
    clearTimeout(toolbarHideTimer)
  }
  toolbarHideTimer = setTimeout(() => {
    toolbarVisible.value = false
    toolbarHideTimer = null
    if (!mouseIgnoring) {
      mouseIgnoring = true
      petApi.setIgnoreMouseEvents(true).catch(() => {})
    }
  }, TOOLBAR_HIDE_DELAY_MS)
}

/**
 * 鼠标进入：显示工具栏，并确保鼠标响应已启用（兼容旧调用方）
 */
function handleMouseEnter () {
  handleRootMouseEnter()
  isDragging = false
}

/**
 * 鼠标离开：延迟隐藏工具栏（兼容旧调用方）
 */
function handleMouseLeave () {
  // 拖拽中不触发鼠标离开逻辑
  if (isDragging) return
  handleRootMouseLeave()
}

// ============================================================
// 拖拽处理（参考 WidgetHeader.vue 的拖拽实现）
// ============================================================

/**
 * 鼠标按下：启动 IPC 拖拽，添加全局 mousemove/mouseup 监听
 * 主进程通过 win.setBounds 控制窗口移动
 * 同时记录起始坐标与时间，用于在 mouseup 时区分点击与拖拽
 */
function handleMouseDown (event) {
  // 仅响应左键
  if (event.button !== 0) return
  // 阻止默认行为
  event.preventDefault()

  // 记录起始坐标与时间，用于区分点击和拖拽
  mouseDownX = event.screenX
  mouseDownY = event.screenY
  mouseDownTime = Date.now()
  // 不立即进入拖拽模式：等 mousemove 超过阈值才 dragStart
  // 避免单击/长按被误判为拖拽，导致窗口移动吞掉光圈/闪动反馈
  isDragging = false

  // 添加全局监听（passive 提升滚动性能）
  window.addEventListener('mousemove', handleDragMove, { passive: true })
  window.addEventListener('mouseup', handleDragEnd, { passive: true })
}

/**
 * 鼠标移动：首次超过 5px 阈值才进入拖拽模式并 dragStart
 * 之后使用 requestAnimationFrame 节流发送 drag:move
 */
function handleDragMove (event) {
  lastMoveX = event.screenX
  lastMoveY = event.screenY
  // 首次移动超过阈值才进入拖拽模式（避免单击误判为拖拽）
  if (!isDragging) {
    const dx = Math.abs(event.screenX - mouseDownX)
    const dy = Math.abs(event.screenY - mouseDownY)
    if (dx < 5 && dy < 5) return // 未超过阈值，不拖拽
    // 超过阈值，进入拖拽模式
    isDragging = true
    // 启动看门狗：30 秒后若仍在拖拽，强制结束（防止 mouseup 丢失导致 isDragging 卡死）
    if (dragWatchdogTimer) clearTimeout(dragWatchdogTimer)
    dragWatchdogTimer = setTimeout(() => {
      dragWatchdogTimer = null
      if (isDragging) {
        console.warn('[PetApp] 拖拽看门狗触发：强制结束拖拽')
        handleDragEnd(null)
      }
    }, DRAG_WATCHDOG_MS)
    // 通知主进程开始拖拽（传入按下时的屏幕坐标作为起始参考点）
    petApi.dragStart(mouseDownX, mouseDownY)
  }
  // 已有挂起的 rAF 则跳过，避免重复调度
  if (dragRafId !== null) return
  dragRafId = requestAnimationFrame(() => {
    dragRafId = null
    petApi.dragMove(lastMoveX, lastMoveY)
    // 实时更新窗口屏幕坐标，触发水平/垂直边缘检测重算
    windowScreenX.value = window.screenX
    windowScreenY.value = window.screenY
  })
}

/**
 * 鼠标释放：结束拖拽，清理全局监听与 rAF
 * 若移动距离 < 5px 且时间 < 300ms，视为点击，显示一条随机鼓励气泡消息
 */
function handleDragEnd (event) {
  // 清除拖拽看门狗
  if (dragWatchdogTimer) {
    clearTimeout(dragWatchdogTimer)
    dragWatchdogTimer = null
  }
  // 取消可能挂起的 rAF
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId)
    dragRafId = null
  }
  // 只有真正进入拖拽模式才通知主进程结束（避免单击误触发 dragEnd）
  if (isDragging) {
    petApi.dragEnd()
  }
  isDragging = false
  // 拖拽结束后更新窗口屏幕坐标，确保面板/气泡偏移准确
  windowScreenX.value = window.screenX
  windowScreenY.value = window.screenY
  // 移除全局监听
  window.removeEventListener('mousemove', handleDragMove)
  window.removeEventListener('mouseup', handleDragEnd)

  // 检测是否为点击（移动距离 < 5px 且时间 < 300ms）
  if (event) {
    const dx = Math.abs(event.screenX - mouseDownX)
    const dy = Math.abs(event.screenY - mouseDownY)
    const dt = Date.now() - mouseDownTime
    if (dx < 5 && dy < 5 && dt < 300) {
      handlePetClick()
    }
  }
}

/**
 * 桌宠点击处理
 * 总是显示一条新的随机鼓励消息（切换内容，不关闭气泡）
 */
function handlePetClick () {
  // 总是显示新的随机鼓励消息（force=true 绕过开关检查，点击总是显示）
  showEncouragementMessage(true)
}

// ============================================================

// 生命周期
// ============================================================

onMounted(async () => {
  // 串行初始化：先主题后配置，确保 html.dark class 先就位
  await initTheme()
  await loadConfig()

  // 加载智能气泡配置（鼓励开关、间隔、自定义名言）
  await loadSmartBubbleConfig()

  // 订阅提醒事件
  unsubscribeReminder = on('pet:reminder', handleReminder)
  // 订阅暂停状态变化事件
  unsubscribePausedChanged = on('pet:reminders-paused-changed', handlePausedChanged)
  // 订阅配置变化事件
  unsubscribeConfigChanged = on('pet:config-changed', handleConfigChanged)
  // 订阅强制解除提醒事件（灵动岛确认完成后触发）
  unsubscribeForceDismiss = on('pet:force-dismiss-reminder', () => {
    dismissBubble()
    // 灵动岛确认完成后桌宠窗口已失焦，setIgnoreMouseEvents(true,{forward:true}) 的
    // forward 转发可能失效，mousemove 不再被转发，穿透状态卡死导致点击无反应。
    // 主动恢复鼠标响应打破死锁，后续由 handleGlobalMouseMove 根据鼠标位置自动纠正穿透
    if (mouseIgnoring) {
      mouseIgnoring = false
      petApi.setIgnoreMouseEvents(false).catch(() => {})
    }
    scheduleNextEncouragement()
  })

  // 监听主题变化事件
  onThemeChanged = () => {
    // 主题切换后无需额外操作，CSS 变量会自动通过 html.dark 选择器更新
  }
  window.addEventListener('app:theme-changed', onThemeChanged)

  // 监听智能气泡配置变化（自定义名言、鼓励开关、鼓励间隔）
  // 当用户在设置页面修改配置后，实时更新桌宠气泡内容
  unsubscribeSmartBubbleConfigChanged = on('app:setting-changed', handleSmartBubbleConfigChanged)

  // 初始化 AI 助手会话（异步，不阻塞桌宠启动）
  initPetAssistant().catch((err) => {
    console.warn('[PetApp] AI 助手初始化失败:', err.message)
  })

  // 加载气泡/工具栏透明度配置
  try {
    const bubbleRes = await systemApi.getSetting(KEY_BUBBLE_OPACITY)
    if (bubbleRes?.value !== null && bubbleRes?.value !== undefined) {
      const num = parseFloat(bubbleRes.value)
      if (!isNaN(num) && num > 0 && num <= 1) bubbleOpacity.value = num
    }
    const toolbarRes = await systemApi.getSetting(KEY_TOOLBAR_OPACITY)
    if (toolbarRes?.value !== null && toolbarRes?.value !== undefined) {
      const num = parseFloat(toolbarRes.value)
      if (!isNaN(num) && num > 0 && num <= 1) toolbarOpacity.value = num
    }
  } catch (err) {
    // 使用默认值
  }

  // 订阅 AI 流式事件
  unsubscribeStreamStart = on('ai:stream:start', handleStreamStart)
  unsubscribeStreamChunk = on('ai:stream:chunk', handleStreamChunk)
  unsubscribeStreamEnd = on('ai:stream:end', handleStreamEnd)
  unsubscribeStreamError = on('ai:stream:error', handleStreamError)

  // 监听消息变更事件（跨窗口同步：AI 对话页面操作时刷新桌宠对话框）
  unsubscribeMessagesChanged = on('chat:messages-changed', async (payload) => {
    if (!payload || payload.session_id !== petAssistantSessionId) return
    // 流式生成中不刷新（流式结束后本地已更新）
    if (chatStreaming.value) return
    try {
      const result = await chatApi.listMessages(petAssistantSessionId)
      if (result?.list) {
        chatMessages.value = result.list.map(m => ({
          id: m.id || `msg-${++chatMsgSeq}`,
          role: m.role || (m.is_user ? 'user' : 'assistant'),
          content: m.content || ''
        })).filter(m => m.content)
      }
    } catch (e) {
      // 忽略加载失败
    }
  })

  // 监听主进程推送的窗口所在显示器 workArea（多显示器边缘检测）
  unsubscribeWorkArea = on('pet:work-area', (wa) => {
    if (wa && typeof wa.x === 'number' && typeof wa.width === 'number') {
      workArea.value = wa
    }
  })

  // 监听主界面 AI 对话回复同步事件（主界面 ChatView AI 对话完成时推送）


  // 启动鼓励消息定时器（随机间隔后显示第一条）
  scheduleNextEncouragement()

  // 加载 AI 自动对话配置并启动定时器
  loadAutoChatConfig().then(() => {
    scheduleAutoChat()
  }).catch(() => {})

  // 注册全局 mousemove 监听：动态切换鼠标穿透状态
  // setIgnoreMouseEvents(true, { forward: true }) 时 mousemove 仍被转发
  document.addEventListener('mousemove', handleGlobalMouseMove)

  // 启动活动状态监控定时器（每分钟检查一次）
  // 首次延迟 30 秒执行，避免启动时立即触发
  startActivityMonitor()
  // 启动待办提醒检查定时器（每 15 分钟检查一次）
  // 首次延迟 2 分钟执行，避免启动时与活动状态检查冲突
  startTodoCheck()

  // 桌宠窗口隐藏时停止轮询，显示时恢复（避免隐藏后空转）
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // 监听窗口尺寸变化，更新 windowHeight 用于边缘检测
  window.addEventListener('resize', handleWindowResize)

  // 窗口获得焦点：若处于穿透状态，重新设置 forward:true
  // Electron 可能在失焦/恢复后丢失 forward 转发，导致 mousemove 不再被转发
  window.addEventListener('focus', handleWindowFocus)
  // 窗口失焦：强制重置拖拽状态（防止 mouseup 丢失导致 isDragging 卡死）
  window.addEventListener('blur', handleWindowBlur)

  // 等待 DOM 渲染后设置 ResizeObserver
  nextTick(() => {
    setTimeout(setupResizeObservers, 100)
  })

  // 浮动元素显示时重新设置 ResizeObserver（工具栏/气泡/面板是 v-if 条件渲染）
  watch(toolbarVisible, (v) => { if (v) nextTick(() => setupResizeObservers()) })
  watch(bubbleVisible, (v) => { if (v) nextTick(() => setupResizeObservers()) })
  watch(chatPanelVisible, (v) => { if (v) nextTick(() => setupResizeObservers()) })
})

onUnmounted(() => {
  // 清理事件监听
  if (typeof unsubscribeReminder === 'function') {
    unsubscribeReminder()
    unsubscribeReminder = null
  }
  if (typeof unsubscribePausedChanged === 'function') {
    unsubscribePausedChanged()
    unsubscribePausedChanged = null
  }
  if (typeof unsubscribeConfigChanged === 'function') {
    unsubscribeConfigChanged()
    unsubscribeConfigChanged = null
  }
  if (typeof unsubscribeForceDismiss === 'function') {
    unsubscribeForceDismiss()
    unsubscribeForceDismiss = null
  }
  // 清理智能气泡配置变化监听
  if (typeof unsubscribeSmartBubbleConfigChanged === 'function') {
    unsubscribeSmartBubbleConfigChanged()
    unsubscribeSmartBubbleConfigChanged = null
  }
  // 清理 AI 流式事件监听
  if (typeof unsubscribeStreamStart === 'function') {
    unsubscribeStreamStart()
    unsubscribeStreamStart = null
  }
  if (typeof unsubscribeStreamChunk === 'function') {
    unsubscribeStreamChunk()
    unsubscribeStreamChunk = null
  }
  if (typeof unsubscribeStreamEnd === 'function') {
    unsubscribeStreamEnd()
    unsubscribeStreamEnd = null
  }
  if (typeof unsubscribeStreamError === 'function') {
    unsubscribeStreamError()
    unsubscribeStreamError = null
  }
  if (typeof unsubscribeMessagesChanged === 'function') {
    unsubscribeMessagesChanged()
    unsubscribeMessagesChanged = null
  }
  // 清理 workArea 监听
  if (typeof unsubscribeWorkArea === 'function') {
    unsubscribeWorkArea()
    unsubscribeWorkArea = null
  }
  // 清理主界面 AI 回复监听

  // 清理主题变化监听
  if (typeof onThemeChanged === 'function') {
    window.removeEventListener('app:theme-changed', onThemeChanged)
    onThemeChanged = null
  }
  // 清理定时器
  if (bubbleDismissTimer !== null) {
    clearTimeout(bubbleDismissTimer)
    bubbleDismissTimer = null
  }
  if (bubbleResizeTimer !== null) {
    clearTimeout(bubbleResizeTimer)
    bubbleResizeTimer = null
  }
  if (encouragementTimer !== null) {
    clearTimeout(encouragementTimer)
    encouragementTimer = null
  }
  if (autoChatTimer !== null) {
    clearTimeout(autoChatTimer)
    autoChatTimer = null
  }
  if (toolbarHideTimer !== null) {
    clearTimeout(toolbarHideTimer)
    toolbarHideTimer = null
  }
  // 清理活动状态监控定时器
  stopActivityMonitor()
  // 清理待办提醒检查定时器
  stopTodoCheck()
  // 清理 visibilitychange 监听
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  // 清理拖拽全局监听与 rAF
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId)
    dragRafId = null
  }
  if (dragWatchdogTimer) {
    clearTimeout(dragWatchdogTimer)
    dragWatchdogTimer = null
  }
  window.removeEventListener('mousemove', handleDragMove)
  window.removeEventListener('mouseup', handleDragEnd)

  // 清理鼠标穿透监听与 rAF
  document.removeEventListener('mousemove', handleGlobalMouseMove)
  if (mousePassRafId !== null) {
    cancelAnimationFrame(mousePassRafId)
    mousePassRafId = null
  }

  // 清理窗口尺寸监听
  window.removeEventListener('resize', handleWindowResize)
  // 清理窗口焦点/失焦监听
  window.removeEventListener('focus', handleWindowFocus)
  window.removeEventListener('blur', handleWindowBlur)

  // 清理 ResizeObserver
  teardownResizeObservers()
})
</script>

<style scoped lang="scss">
.pet-root {
  // 撑满整个窗口，作为 absolute 定位的参照容器
  position: relative;
  width: 100%;
  height: 100%;
  // 透明背景（已在 pet.scss 中通过 !important 设置，此处显式声明便于维护）
  background: transparent !important;

  // 熊猫/机器人角色：absolute 固定在底部，位置始终不变
  // 工具栏/气泡显隐不影响角色位置（它们也是 absolute，脱离文档流）
  // pointer-events: auto 确保角色响应鼠标（.pet-root 设为 none 让透明区域穿透）
  &__character {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
    // 顶部翻转时 bottom 平滑过渡，避免角色突然跳动
    transition: bottom var(--pet-motion-fast, 167ms) ease;

    cursor: grab;
    z-index: 1;
    pointer-events: auto;
  }

  // 悬停工具栏：absolute 在角色正上方
  // bottom 由 inline style 动态控制：正常 characterSize + 10px；顶部翻转时贴窗口底部
  &__toolbar {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    // 顶部翻转时 bottom 平滑过渡
    transition: bottom var(--pet-motion-fast, 167ms) ease;
    z-index: 2;
    pointer-events: auto;
  }

  // 提醒气泡：absolute 在工具栏上方
  // bottom 由 inline style 动态控制：characterSize + 54px
  &__bubble {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    pointer-events: auto;
  }

  // AI 对话面板：absolute 在工具栏上方
  // bottom 由 inline style 动态控制：characterSize + 54px
  &__chat-panel {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    pointer-events: auto;
  }
}

// 暗色模式适配：CSS 变量已在 pet.scss 中通过 html.dark 覆盖
// 此处保留兼容性回退
html.dark .pet-root {
  color: var(--pet-text, #F5F5F5);
}
</style>
