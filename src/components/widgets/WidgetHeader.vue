<!--
  小部件头部组件
  职责：显示标题+图标，提供完整操作按钮组（位置锁/大小锁/置顶/添加/更多/关闭/折叠）与拖拽区域
    - 标题栏高度 46px，内边距 14px 7px 12px 5px
    - 悬停/按下使用半透明颜色，动画 83ms faster
    - 按钮组（位置锁/大小锁/置顶/添加/更多/关闭）默认 Opacity:0，鼠标进入标题栏时淡入 Opacity:1（167ms fast）
    - 折叠按钮（CollapseButton）单独始终显示，不参与淡入
    - 关闭按钮使用 SystemFillColorCritical（红色）
    - WidgetInputMetrics：输入指标（高度/按钮/图标/内边距）
    - WidgetTitleBarMetrics：标题栏度量（图标/文字/按钮/行高/内边距，支持 Compact/Standard）
    - WidgetTitleIconMode + WidgetTitleIconKind：标题图标模式与种类
    - WidgetActionIconHelper：操作图标锁定状态切换
    - WidgetChromeMode：窗口外观模式（System/Standard/Compact/Overlay/Hidden）
    - WidgetFirstRunGuideFactory：首次运行引导提示徽标
  Props:
    - title: 头部标题
    - icon: Element Plus 图标组件（已解析的组件对象）
    - isCapsule: 当前是否为胶囊形态
    - isPositionLocked: 是否锁定位置
    - isSizeLocked: 是否锁定尺寸
    - showAddButton: 是否显示添加按钮（NoteWidget/TaskWidget 可启用）
    - isAlwaysOnTop: 是否置顶
    - chromeMode: 窗口外观模式（'System' | 'Standard' | 'Compact' | 'Overlay' | 'Hidden'）
    - titleIconMode: 标题图标模式（'FilledMono' | 'LineMono' | 'Color' | 'Hidden' | 'TextLabel'）
    - titleIconKind: 标题图标种类（'Default' | 'ManagedStorage' | ... ）
    - textSize: 文字字号（用于计算 InputMetrics / TitleBarMetrics，缺省 14）
    - firstRunGuide: 首次运行引导提示文本（非空时在标题左侧显示徽标）
    - displayName: 自定义显示名称（重命名功能），非空时替代 title 显示
    - collapseBehavior: 当前折叠行为模式（expanded / click / smart）
    - hasGroup: 是否在分组中（控制分组操作菜单项的禁用状态）
  Emits:
    - toggle-capsule: 用户点击折叠按钮（payload: 切换后的目标胶囊态）
    - close: 用户点击关闭按钮（隐藏小部件，非销毁）
    - toggle-position-lock: 用户点击位置锁按钮
    - toggle-size-lock: 用户点击大小锁按钮
    - add: 用户点击添加按钮
    - more: 用户选择更多菜单项（payload: command 字符串）
    - reset-position: 用户选择"重置位置"
    - toggle-always-on-top: 用户点击置顶按钮（置顶/取消置顶）
    - dismiss-guide: 用户关闭首次运行引导徽标
    - rename: 用户重命名小部件（payload: 新名称字符串）
    - change-collapse-behavior: 用户切换折叠行为（payload: 行为模式字符串）
    - group-merge: 用户选择"合并到分组"
    - group-detach: 用户选择"从分组分离"
    - group-dissolve: 用户选择"解散分组"
    - open-settings: 用户选择"小部件设置"
    - disable: 用户选择"禁用小部件"
-->
<template>
  <div
    class="widget-header"
    :class="[
      `widget-header--${effectiveChromeMode.toLowerCase()}`,
      { 'widget-header--icon-hidden': resolvedTitleIconMode === 'Hidden' }
    ]"
    :style="headerStyleVars"
    @mousedown="handleMouseDown"
  >
    <!-- 左侧：拖拽手柄 + 图标 + 标题 -->
    <div class="widget-header__left">
      <drag-handle class="widget-header__drag" />
      <!-- 标题图标：根据 titleIconMode 决定显隐/单色/彩色/文本标签 -->
      <el-icon
        v-if="icon && resolvedTitleIconMode !== 'Hidden' && resolvedTitleIconMode !== 'TextLabel'"
        class="widget-header__icon"
        :class="{
          'widget-header__icon--mono': resolvedTitleIconMode === 'FilledMono' || resolvedTitleIconMode === 'LineMono',
          'widget-header__icon--color': resolvedTitleIconMode === 'Color'
        }"
      >
        <component :is="icon" />
      </el-icon>
      <!-- 文本标签模式：用首字符替代图标 -->
      <span
        v-else-if="resolvedTitleIconMode === 'TextLabel' && title"
        class="widget-header__icon-text"
      >{{ title.charAt(0) }}</span>
      <!-- 标题文字：重命名模式下显示输入框，否则显示 displayName || title -->
      <input
        v-if="isRenaming"
        ref="renameInputEl"
        v-model="renameInput"
        class="widget-header__title-input"
        type="text"
        maxlength="32"
        @keydown.enter="commitRename"
        @keydown.esc="cancelRename"
        @blur="commitRename"
      />
      <span v-else class="widget-header__title">{{ displayName || title }}</span>
      <!-- 首次运行引导徽标：紧贴标题右侧，可关闭 -->
      <el-tooltip
        v-if="firstRunGuide"
        :content="firstRunGuide"
        placement="bottom"
        :show-after="200"
      >
        <button
          class="widget-header__guide-badge"
          @click.stop="$emit('dismiss-guide')"
          aria-label="关闭引导提示"
        >
          <el-icon><InfoFilled /></el-icon>
        </button>
      </el-tooltip>
    </div>

    <!-- Hidden 模式下隐藏整个操作区（仅保留折叠按钮） -->
    <div class="widget-header__actions" v-if="effectiveChromeMode !== 'Hidden'">
      <div class="widget-header__hover-actions">
        <!-- 位置锁 PositionLockButton：锁定/解锁位置 -->
        <el-tooltip
          :content="isPositionLocked ? '解锁位置' : '锁定位置'"
          placement="bottom"
          :show-after="300"
        >
          <button
            v-show="showPositionLockBtn"
            class="widget-header__btn"
            :class="{ 'is-locked': isPositionLocked }"
            @click="$emit('toggle-position-lock')"
          >
            <el-icon><Aim /></el-icon>
          </button>
        </el-tooltip>

        <!-- 大小锁 SizeLockButton：锁定/解锁尺寸 -->
        <el-tooltip
          :content="isSizeLocked ? '解锁尺寸' : '锁定尺寸'"
          placement="bottom"
          :show-after="300"
        >
          <button
            v-show="showSizeLockBtn"
            class="widget-header__btn"
            :class="{ 'is-locked': isSizeLocked }"
            @click="$emit('toggle-size-lock')"
          >
            <el-icon><ScaleToOriginal /></el-icon>
          </button>
        </el-tooltip>

        <!-- 置顶 AlwaysOnTopButton：独立按钮，未置顶灰色，置顶高亮（复用 is-locked class） -->
        <el-tooltip
          :content="isAlwaysOnTop ? '取消置顶' : '置顶'"
          placement="bottom"
          :show-after="300"
        >
          <button
            v-show="showAlwaysOnTopBtn"
            class="widget-header__btn"
            :class="{ 'is-locked': isAlwaysOnTop }"
            @click="$emit('toggle-always-on-top')"
          >
            <el-icon><Top /></el-icon>
          </button>
        </el-tooltip>

        <!-- 添加 AddButton：添加新项（便签/任务等），通过 showAddButton 控制显隐 -->
        <el-tooltip
          v-if="showAddButton && showAddBtn"
          content="新建"
          placement="bottom"
          :show-after="300"
        >
          <button
            class="widget-header__btn"
            @click="$emit('add')"
          >
            <el-icon><Plus /></el-icon>
          </button>
        </el-tooltip>

        <el-dropdown
          trigger="click"
          placement="bottom-end"
          @command="handleMoreCommand"
        >
          <button class="widget-header__btn" title="更多">
            <el-icon><More /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <!-- 1. 重命名（Common.Rename） -->
              <el-dropdown-item command="rename">重命名</el-dropdown-item>

              <!-- 2. 折叠行为（WidgetCollapseMenuBuilder） -->
              <el-dropdown-item divided disabled>折叠行为</el-dropdown-item>
              <el-dropdown-item
                v-for="opt in collapseBehaviorOptions"
                :key="opt.value"
                :command="'collapse-behavior:' + opt.value"
              >
                <el-icon v-if="collapseBehavior === opt.value"><Check /></el-icon>
                <span>{{ opt.label }}</span>
              </el-dropdown-item>

              <!-- 3. 分组操作（WidgetGroupMenuBuilder） -->
              <el-dropdown-item divided command="group-merge">合并到分组</el-dropdown-item>
              <el-dropdown-item command="group-detach" :disabled="!hasGroup">从分组分离</el-dropdown-item>
              <el-dropdown-item command="group-dissolve" :disabled="!hasGroup">解散分组</el-dropdown-item>

              <!-- 4. 窗口外观（WidgetChromeMode） -->
              <el-dropdown-item divided disabled>窗口外观</el-dropdown-item>
              <el-dropdown-item
                v-for="mode in chromeModeOptions"
                :key="mode.value"
                :command="'chrome-mode:' + mode.value"
              >
                <el-icon v-if="effectiveChromeMode === mode.value"><Check /></el-icon>
                <span>{{ mode.label }}</span>
              </el-dropdown-item>

              <!-- 5. 小部件设置（WidgetSettingsMenuHelper） -->
              <el-dropdown-item divided command="open-settings">小部件设置</el-dropdown-item>

              <!-- 6. 禁用小部件（disableWidget） -->
              <el-dropdown-item divided command="disable">禁用小部件</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-tooltip content="隐藏" placement="bottom" :show-after="300">
          <button
            class="widget-header__btn widget-header__btn--close"
            @click="$emit('close')"
          >
            <el-icon><Close /></el-icon>
          </button>
        </el-tooltip>
      </div>

      <!-- 折叠 CollapseButton：折叠为胶囊，单独始终显示（不参与悬停淡入） -->
      <el-tooltip
        :content="isCapsule ? '展开' : '折叠为胶囊'"
        placement="bottom"
        :show-after="300"
      >
        <button
          class="widget-header__btn"
          @click.stop="handleToggleCapsuleClick"
        >
          <el-icon>
            <Fold v-if="!isCapsule" />
            <Expand v-else />
          </el-icon>
        </button>
      </el-tooltip>
    </div>
    <!-- Hidden 模式下仅保留折叠按钮（极简外观） -->
    <div class="widget-header__actions" v-else>
      <el-tooltip
        :content="isCapsule ? '展开' : '折叠为胶囊'"
        placement="bottom"
        :show-after="300"
      >
        <button
          class="widget-header__btn"
          @click.stop="handleToggleCapsuleClick"
        >
          <el-icon>
            <Fold v-if="!isCapsule" />
            <Expand v-else />
          </el-icon>
        </button>
      </el-tooltip>
    </div>

    <!-- 合并到分组选择器弹窗：列出所有已启用小部件（排除自身），选择后 emit group-merge -->
    <el-dialog
      v-model="showMergeDialog"
      title="合并到分组"
      width="300px"
      append-to-body
    >
      <el-select
        v-model="mergeTarget"
        placeholder="选择目标小部件"
        style="width: 100%"
      >
        <el-option
          v-for="w in availableWidgetsForMerge"
          :key="w.widget_type"
          :label="w.title || w.display_name || w.widget_type"
          :value="w.widget_type"
        />
      </el-select>
      <template #footer>
        <el-button @click="showMergeDialog = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!mergeTarget"
          @click="confirmMerge"
        >合并</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import {
  Fold,
  Expand,
  Close,

  Aim,
  ScaleToOriginal,
  Plus,
  More,
  Top,
  Check,
  InfoFilled
} from '@element-plus/icons-vue'
import DragHandle from './DragHandle.vue'
import { widgetApi } from '@/utils/ipc-client'

// ============================================================
// ============================================================

/**
 * 窗口外观模式枚举
 */
const CHROME_MODE = Object.freeze({
  System: 'System',
  Standard: 'Standard',
  Compact: 'Compact',
  Overlay: 'Overlay',
  Hidden: 'Hidden'
})

/**
 * 标题图标模式枚举
 */
const TITLE_ICON_MODE = Object.freeze({
  FilledMono: 'FilledMono',
  LineMono: 'LineMono',
  Color: 'Color',
  Hidden: 'Hidden',
  TextLabel: 'TextLabel'
})

/**
 * 标题图标种类枚举
 */
const TITLE_ICON_KIND = Object.freeze({
  Default: 'Default',
  ManagedStorage: 'ManagedStorage',
  MappedFolder: 'MappedFolder',
  QuickCapture: 'QuickCapture',
  Todo: 'Todo',
  Music: 'Music',
  Weather: 'Weather',
  Glance: 'Glance',
  Tags: 'Tags',
  Search: 'Search',
  SystemMonitor: 'SystemMonitor'
})

/**
 * 图标种类对应的本地化标签 key
 */
const TITLE_ICON_KIND_LABEL_KEYS = {
  [TITLE_ICON_KIND.ManagedStorage]: 'WidgetTitleIcon.Label.ManagedStorage',
  [TITLE_ICON_KIND.MappedFolder]: 'WidgetTitleIcon.Label.MappedFolder',
  [TITLE_ICON_KIND.QuickCapture]: 'WidgetTitleIcon.Label.QuickCapture',
  [TITLE_ICON_KIND.Todo]: 'WidgetTitleIcon.Label.Todo',
  [TITLE_ICON_KIND.Music]: 'WidgetTitleIcon.Label.Music',
  [TITLE_ICON_KIND.Weather]: 'WidgetTitleIcon.Label.Weather',
  [TITLE_ICON_KIND.Glance]: 'Glance.Title',
  [TITLE_ICON_KIND.Tags]: 'WidgetTitleIcon.Label.Tags',
  [TITLE_ICON_KIND.Search]: 'WidgetTitleIcon.Label.Search',
  [TITLE_ICON_KIND.SystemMonitor]: 'WidgetTitleIcon.Label.SystemMonitor',
  [TITLE_ICON_KIND.Default]: 'WidgetTitleIcon.Label.Default'
}

/**
 * 图标种类对应的彩色资源名
 */
const TITLE_ICON_KIND_COLOR_ASSETS = {
  [TITLE_ICON_KIND.ManagedStorage]: 'managed-storage',
  [TITLE_ICON_KIND.MappedFolder]: 'mapped-folder',
  [TITLE_ICON_KIND.QuickCapture]: 'quick-capture',
  [TITLE_ICON_KIND.Todo]: 'todo',
  [TITLE_ICON_KIND.Music]: 'music',
  [TITLE_ICON_KIND.Weather]: 'weather',
  [TITLE_ICON_KIND.Glance]: 'glance',
  [TITLE_ICON_KIND.Tags]: 'tags',
  [TITLE_ICON_KIND.Search]: 'search',
  [TITLE_ICON_KIND.SystemMonitor]: 'system-monitor',
  [TITLE_ICON_KIND.Default]: 'default'
}

/**
 * 归一化标题图标模式
 * @param {string|null|undefined} value
 * @returns {string} TITLE_ICON_MODE 枚举值（缺省 Color）
 */
function normalizeTitleIconMode (value) {
  const valid = Object.values(TITLE_ICON_MODE)
  return (typeof value === 'string' && valid.includes(value)) ? value : TITLE_ICON_MODE.Color
}

/**
 * 归一化标题图标种类
 * @param {string|null|undefined} value
 * @returns {string}
 */
function normalizeTitleIconKind (value) {
  const valid = Object.values(TITLE_ICON_KIND)
  return (typeof value === 'string' && valid.includes(value)) ? value : TITLE_ICON_KIND.Default
}

/**
 * 由 widgetKind 映射到标题图标种类
 * @param {string} widgetKind
 * @returns {string}
 */
function titleIconKindFromWidgetKind (widgetKind) {
  switch (widgetKind) {
    case 'file': return TITLE_ICON_KIND.ManagedStorage
    case 'quick-capture': return TITLE_ICON_KIND.QuickCapture
    case 'todo': return TITLE_ICON_KIND.Todo
    case 'music': return TITLE_ICON_KIND.Music
    case 'weather': return TITLE_ICON_KIND.Weather
    case 'glance': return TITLE_ICON_KIND.Glance
    case 'tags': return TITLE_ICON_KIND.Tags
    case 'search': return TITLE_ICON_KIND.Search
    case 'system-monitor': return TITLE_ICON_KIND.SystemMonitor
    default: return TITLE_ICON_KIND.Default
  }
}

// ============================================================
// WidgetInputMetrics：输入指标
// 根据文字字号计算输入框高度、按钮尺寸、图标尺寸、内边距
// ============================================================

/**
 * 最小文字字号
 */
const MIN_TEXT_SIZE = 12

/**
 * 计算输入指标
 * @param {number} textSize 文字字号
 * @returns {{ height: number, buttonSize: number, actionIconSize: number, padding: { horizontal: number, vertical: number } }}
 */
function computeInputMetrics (textSize) {
  const normalizedTextSize = Math.max(MIN_TEXT_SIZE, textSize)
  const height = Math.max(30, Math.min(34, Math.round((normalizedTextSize + 30) * 0.7)))
  const buttonSize = height
  const actionIconSize = Math.max(11, Math.min(14, Math.round(normalizedTextSize * 0.92)))
  const horizontal = Math.max(11, Math.min(14, Math.round(normalizedTextSize * 0.95)))
  const vertical = Math.max(5, Math.min(7, Math.round(normalizedTextSize * 0.42)))
  return {
    height,
    buttonSize,
    actionIconSize,
    padding: { horizontal, vertical }
  }
}

// ============================================================
// WidgetTitleBarMetrics：标题栏度量
// 根据图标尺寸/文字尺寸/chrome 模式计算标题栏各项度量
// ============================================================

/**
 * Fluent 图标原生尺寸
 */
const FLUENT_ACTION_ICON_NATIVE_SIZE = 20

/**
 * Fluent 图标视觉缩放系数
 */
const FLUENT_ACTION_ICON_VISUAL_SCALE = 0.7

/**
 * Compact 模式下额外的图标缩放系数
 */
const COMPACT_ACTION_ICON_VISUAL_SCALE = 0.7

/**
 * 计算标题栏度量
 * @param {number} titleIconSize 标题图标尺寸
 * @param {number} titleTextSize 标题文字尺寸
 * @param {boolean} includeInnerPadding 是否包含内边距
 * @param {string} chromeMode CHROME_MODE 枚举值
 * @returns {object} 标题栏度量
 */
function computeTitleBarMetrics (titleIconSize, titleTextSize, includeInnerPadding, chromeMode = CHROME_MODE.Standard) {
  const compact = chromeMode === CHROME_MODE.Compact
  const maxTextSize = 24
  const resolvedIconSize = compact
    ? Math.max(10, Math.min(15, Math.round(titleIconSize * 0.88)))
    : Math.max(11, Math.min(18, Math.round(titleIconSize)))
  const resolvedTextSize = compact
    ? Math.max(MIN_TEXT_SIZE, Math.min(maxTextSize, Math.round(titleTextSize)))
    : Math.max(12, Math.min(18, Math.round(titleTextSize) - 1))
  const buttonSize = compact
    ? Math.max(22, Math.min(28, resolvedIconSize + 10))
    : Math.max(24, Math.min(34, resolvedIconSize + 14))
  const actionIconSize = compact
    ? Math.max(9, Math.min(13, resolvedIconSize - 2))
    : Math.max(10, Math.min(15, resolvedIconSize - 3))
  const rowHeight = compact
    ? Math.max(30, Math.min(36, resolvedIconSize + 22))
    : Math.max(36, Math.min(50, resolvedIconSize + 28))
  const innerPadding = includeInnerPadding
    ? computeInnerPadding(resolvedIconSize, compact)
    : { horizontal: 0, top: 0, bottom: 0 }
  return {
    titleIconSize: resolvedIconSize,
    titleTextSize: resolvedTextSize,
    actionButtonSize: buttonSize,
    actionIconSize,
    rowHeight,
    innerPadding
  }
}

/**
 * 计算标题栏内边距
 * @param {number} titleIconSize
 * @param {boolean} compact
 * @returns {{ horizontal: number, top: number, bottom: number }}
 */
function computeInnerPadding (titleIconSize, compact) {
  const horizontal = Math.max(8, Math.min(16, Math.round(titleIconSize * (compact ? 0.72 : 0.9))))
  const top = Math.max(3, Math.min(10, Math.round(titleIconSize * (compact ? 0.32 : 0.5))))
  const bottom = Math.max(3, Math.min(8, Math.round(titleIconSize * (compact ? 0.28 : 0.35))))
  return { horizontal, top, bottom: bottom, right: Math.max(0, horizontal - 2) }
}

/**
 * 计算操作图标的目标尺寸
 * @param {object} metrics 标题栏度量
 * @returns {number}
 */
function computeActionIconSize (metrics) {
  const compact = metrics.rowHeight <= 36
  const visualScale = compact
    ? FLUENT_ACTION_ICON_VISUAL_SCALE * COMPACT_ACTION_ICON_VISUAL_SCALE
    : FLUENT_ACTION_ICON_VISUAL_SCALE * 0.9
  return Math.max(
    compact ? 10 : 12,
    Math.min(
      FLUENT_ACTION_ICON_NATIVE_SIZE,
      Math.round(Math.min(FLUENT_ACTION_ICON_NATIVE_SIZE, metrics.actionButtonSize - 4) * visualScale)
    )
  )
}

/**
 * 计算标题栏外边距
 * @param {string} chromeMode
 * @returns {{ horizontal: number, top: number, right: number, bottom: number }}
 */
function computeOuterPadding (chromeMode) {
  return chromeMode === CHROME_MODE.Compact
    ? { horizontal: 12, top: 4, right: 10, bottom: 4 }
    : { horizontal: 14, top: 7, right: 12, bottom: 5 }
}

// ============================================================
// WidgetActionIconHelper：操作图标锁定状态辅助
// 根据锁定状态决定常规/填充图标的可见性
// ============================================================

/**
 * 计算锁定图标对的状态
 * @param {boolean} isPositionLocked
 * @param {boolean} isSizeLocked
 * @returns {{ positionRegular: boolean, positionFilled: boolean, sizeRegular: boolean, sizeFilled: boolean }}
 */
function computeLockIconStates (isPositionLocked, isSizeLocked) {
  return {
    positionRegular: !isPositionLocked,
    positionFilled: isPositionLocked,
    sizeRegular: !isSizeLocked,
    sizeFilled: isSizeLocked
  }
}

const props = defineProps({
  // 头部标题
  title: {
    type: String,
    default: ''
  },
  // Element Plus 图标组件（已解析的组件对象）
  icon: {
    type: [Object, Function],
    default: null
  },
  // 当前是否为胶囊形态
  isCapsule: {
    type: Boolean,
    default: false
  },
  // 是否锁定位置
  isPositionLocked: {
    type: Boolean,
    default: false
  },
  // 是否锁定尺寸
  isSizeLocked: {
    type: Boolean,
    default: false
  },
  // 是否显示添加按钮（NoteWidget/TaskWidget 可启用）
  showAddButton: {
    type: Boolean,
    default: false
  },
  // 是否置顶
  isAlwaysOnTop: {
    type: Boolean,
    default: false
  },
  // 窗口外观模式（System/Standard/Compact/Overlay/Hidden）
  chromeMode: {
    type: String,
    default: 'System'
  },
  // 标题图标模式（FilledMono/LineMono/Color/Hidden/TextLabel）
  titleIconMode: {
    type: String,
    default: 'Color'
  },
  // 标题图标种类（Default/ManagedStorage/MappedFolder/...）
  titleIconKind: {
    type: String,
    default: 'Default'
  },
  // 文字字号（用于计算 InputMetrics / TitleBarMetrics，缺省 14）
  textSize: {
    type: Number,
    default: 14
  },
  // 首次运行引导提示文本（非空时在标题左侧显示徽标）
  firstRunGuide: {
    type: String,
    default: ''
  },
  // 自定义显示名称（重命名功能），非空时替代 title 显示
  // 对应 widgets 表 display_name 字段
  displayName: {
    type: String,
    default: ''
  },
  // 当前折叠行为模式（expanded / click / smart）
  // 对应 widgets 表 collapse_behavior 字段
  collapseBehavior: {
    type: String,
    default: 'click'
  },
  // 是否在分组中（控制分组操作菜单项的禁用状态）
  hasGroup: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'toggle-capsule',
  'close',
  'toggle-position-lock',
  'toggle-size-lock',
  'add',
  'more',
  'reset-position',
  'toggle-always-on-top',
  'dismiss-guide',
  'change-chrome-mode',
  'rename',
  'change-collapse-behavior',
  'group-merge',
  'group-detach',
  'group-dissolve',
  'open-settings',
  'disable'
])

// ============================================================
// 窄窗口按钮自适应：窗口不够宽时逐步隐藏次要按钮，避免按钮重叠/超出窗口
// 按钮优先级（从低到高隐藏）：位置锁 → 大小锁 → 置顶 → 添加
// 始终保留：更多、关闭、折叠（核心操作不可裁切）
// 阈值基于按钮 28px + gap 2px + 标题最小 60px + padding 26px
// ============================================================
const headerWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 320)
let headerResizeHandler = null

// 按钮显隐阈值：窗口宽度低于此值时隐藏对应按钮
const SHOW_POSITION_LOCK_THRESHOLD = 264  // 隐藏位置锁
const SHOW_SIZE_LOCK_THRESHOLD = 234      // 隐藏大小锁
const SHOW_ALWAYS_ON_TOP_THRESHOLD = 204  // 隐藏置顶
const SHOW_ADD_THRESHOLD = 174            // 隐藏添加

const showPositionLockBtn = computed(() => headerWidth.value >= SHOW_POSITION_LOCK_THRESHOLD)
const showSizeLockBtn = computed(() => headerWidth.value >= SHOW_SIZE_LOCK_THRESHOLD)
const showAlwaysOnTopBtn = computed(() => headerWidth.value >= SHOW_ALWAYS_ON_TOP_THRESHOLD)
const showAddBtn = computed(() => headerWidth.value >= SHOW_ADD_THRESHOLD)

onMounted(() => {
  headerWidth.value = window.innerWidth
  headerResizeHandler = () => { headerWidth.value = window.innerWidth }
  window.addEventListener('resize', headerResizeHandler)
})

onUnmounted(() => {
  if (headerResizeHandler) {
    window.removeEventListener('resize', headerResizeHandler)
    headerResizeHandler = null
  }
})

// ============================================================
// ============================================================

/**
 * 实际生效的 chrome 模式
 * System 视为 Standard（由上层解析后传入，此处兜底）
 */
const effectiveChromeMode = computed(() => {
  const mode = props.chromeMode
  if (mode === CHROME_MODE.System) return CHROME_MODE.Standard
  return Object.values(CHROME_MODE).includes(mode) ? mode : CHROME_MODE.Standard
})

/**
 * 是否紧凑模式
 */
const isCompact = computed(() => effectiveChromeMode.value === CHROME_MODE.Compact)

/**
 * 归一化后的标题图标模式
 */
const resolvedTitleIconMode = computed(() => normalizeTitleIconMode(props.titleIconMode))

/**
 * 归一化后的标题图标种类
 */
const resolvedTitleIconKind = computed(() => normalizeTitleIconKind(props.titleIconKind))

/**
 * 输入指标（用于内部输入框样式，由上层按需读取）
 */
const inputMetrics = computed(() => computeInputMetrics(props.textSize))

/**
 * 标题栏度量
 */
const titleBarMetrics = computed(() =>
  computeTitleBarMetrics(
    props.textSize,
    props.textSize,
    true,
    effectiveChromeMode.value
  )
)

/**
 * 操作图标目标尺寸
 */
const actionIconSize = computed(() => computeActionIconSize(titleBarMetrics.value))

/**
 * 标题栏外边距
 */
const outerPadding = computed(() => computeOuterPadding(effectiveChromeMode.value))

/**
 * 锁定图标对的状态
 */
const lockIconStates = computed(() =>
  computeLockIconStates(props.isPositionLocked, props.isSizeLocked)
)

/**
 * 标题栏 CSS 变量样式对象
 */
const headerStyleVars = computed(() => ({
  '--widget-header-row-height': `${titleBarMetrics.value.rowHeight}px`,
  '--widget-header-button-size': `${titleBarMetrics.value.actionButtonSize}px`,
  '--widget-header-action-icon-size': `${actionIconSize.value}px`,
  '--widget-header-title-icon-size': `${titleBarMetrics.value.titleIconSize}px`,
  '--widget-header-title-font-size': `${titleBarMetrics.value.titleTextSize}px`,
  '--widget-header-padding-h': `${outerPadding.value.horizontal}px`,
  '--widget-header-padding-top': `${outerPadding.value.top}px`,
  '--widget-header-padding-right': `${outerPadding.value.right}px`,
  '--widget-header-padding-bottom': `${outerPadding.value.bottom}px`
}))

/**
 * 窗口外观模式下拉选项
 * Hidden/Overlay 在分组场景下可能被禁用，此处暂全开放
 */
const chromeModeOptions = computed(() => [
  { value: CHROME_MODE.System, label: '跟随系统', enabled: true },
  { value: CHROME_MODE.Standard, label: '标准', enabled: true },
  { value: CHROME_MODE.Compact, label: '紧凑', enabled: true },
  { value: CHROME_MODE.Overlay, label: '覆盖', enabled: true },
  { value: CHROME_MODE.Hidden, label: '隐藏', enabled: true }
])

/**
 * 折叠行为下拉选项
 * - expanded: 不折叠（始终展开）
 * - click: 点击折叠
 * - smart: 智能折叠（悬停展开）
 */
const collapseBehaviorOptions = [
  { value: 'expanded', label: '不折叠（始终展开）' },
  { value: 'click', label: '点击折叠' },
  { value: 'smart', label: '智能折叠（悬停展开）' }
]

// ============================================================
// 重命名内联编辑状态
// ============================================================
const isRenaming = ref(false)
const renameInput = ref('')
const renameInputEl = ref(null)

/**
 * 开始重命名：进入内联编辑模式
 */
function startRename () {
  renameInput.value = props.displayName || props.title
  isRenaming.value = true
  nextTick(() => {
    if (renameInputEl.value) {
      renameInputEl.value.focus()
      renameInputEl.value.select()
    }
  })
}

/**
 * 确认重命名：回车或失焦时保存
 */
function commitRename () {
  if (!isRenaming.value) return
  const trimmed = renameInput.value.trim()
  isRenaming.value = false
  // 值未变化则不保存
  if (trimmed === (props.displayName || props.title)) return
  emit('rename', trimmed)
}

/**
 * 取消重命名：ESC 时放弃编辑
 */
function cancelRename () {
  isRenaming.value = false
  renameInput.value = ''
}

// 防抖：防止双击折叠按钮导致状态切换两次（折叠→展开），300ms 内忽略第二次切换
let lastToggleCapsuleTime = 0
const TOGGLE_CAPSULE_DEBOUNCE_MS = 300

/**
 * 折叠按钮点击处理（带防抖）
 */
function handleToggleCapsuleClick () {
  const now = Date.now()
  if (now - lastToggleCapsuleTime < TOGGLE_CAPSULE_DEBOUNCE_MS) return
  lastToggleCapsuleTime = now
  emit('toggle-capsule', !props.isCapsule)
}

/**
 * 更多菜单命令处理：根据 command 派发对应事件
 * 同时 emit 通用 'more' 事件，便于上层统一监听
 * @param {string} command 下拉菜单项 command 标识
 */
function handleMoreCommand (command) {
  if (command === 'rename') {
    startRename()
  } else if (command === 'reset-position') {
    emit('reset-position')
  } else if (command === 'toggle-position-lock') {
    emit('toggle-position-lock')
  } else if (command === 'toggle-size-lock') {
    emit('toggle-size-lock')
  } else if (command === 'toggle-always-on-top') {
    emit('toggle-always-on-top')
  } else if (command.startsWith('chrome-mode:')) {
    const mode = command.slice('chrome-mode:'.length)
    emit('change-chrome-mode', mode)
  } else if (command.startsWith('collapse-behavior:')) {
    const behavior = command.slice('collapse-behavior:'.length)
    emit('change-collapse-behavior', behavior)
  } else if (command === 'group-merge') {
    openMergeDialog()
  } else if (command === 'group-detach') {
    emit('group-detach')
  } else if (command === 'group-dissolve') {
    emit('group-dissolve')
  } else if (command === 'open-settings') {
    emit('open-settings')
  } else if (command === 'disable') {
    emit('disable')
  }
  // 通用 more 事件，携带 command 供上层按需处理
  emit('more', command)
}

// 从 URL query 参数读取小部件类型（与 WidgetApp.vue 一致）
const widgetType = new URLSearchParams(window.location.search).get('type')

// ============================================================
// 合并到分组弹窗状态
// ============================================================
const showMergeDialog = ref(false)
const mergeTarget = ref('')
const availableWidgetsForMerge = ref([])

/**
 * 打开合并到分组弹窗：加载所有已启用小部件（排除自身）
 */
async function openMergeDialog () {
  mergeTarget.value = ''
  try {
    const all = await widgetApi.list()
    const list = Array.isArray(all) ? all : (all?.list || [])
    availableWidgetsForMerge.value = list.filter(w => w.widget_type !== widgetType)
  } catch (err) {
    console.error('[WidgetHeader] 加载可用小部件列表失败:', err.message)
    availableWidgetsForMerge.value = []
  }
  showMergeDialog.value = true
}

/**
 * 确认合并：emit group-merge 事件（payload: 目标小部件类型），关闭弹窗
 */
function confirmMerge () {
  if (!mergeTarget.value) return
  emit('group-merge', mergeTarget.value)
  showMergeDialog.value = false
}

// rAF 节流状态：拖拽 move 时每帧最多发送一次，避免高频 IPC 消息淹没主进程
let rafId = null
let lastMoveX = 0
let lastMoveY = 0
// 拖拽阈值（像素）：鼠标移动超过此距离才开始拖拽，避免单击被误判为拖拽
const DRAG_THRESHOLD = 5
// 拖拽起始坐标（用于阈值判断）
let dragStartX = 0
let dragStartY = 0
// 是否已超过阈值开始真正的拖拽（false 时为待定单击/拖拽）
let dragActive = false

/**
 * 鼠标按下：记录起始坐标，添加全局 mousemove/mouseup 监听
 * 不立即调用 dragStart，等移动超过 DRAG_THRESHOLD 后才开始拖拽
 * 这样单击（无移动或移动 < 阈值）不会被误判为拖拽，click 事件正常触发
 */
function handleMouseDown (event) {
  // 仅响应左键
  if (event.button !== 0) return
  // 排除操作按钮区域（所有按钮不触发拖拽）
  if (event.target.closest('.widget-header__actions')) return
  // 阻止默认行为（文本选择等），但不阻止冒泡（让 click 事件正常传播）
  event.preventDefault()

  // 记入起始坐标，但不立即调用 dragStart
  dragStartX = event.screenX
  dragStartY = event.screenY
  dragActive = false

  // 添加全局监听（passive 提升滚动性能）
  window.addEventListener('mousemove', handleMouseMove, { passive: true })
  window.addEventListener('mouseup', handleMouseUp, { passive: true })
}

/**
 * 鼠标移动：使用 requestAnimationFrame 节流发送 drag:move
 * 移动距离超过 DRAG_THRESHOLD 才开始拖拽（首次超过阈值时调用 dragStart）
 * 每帧最多发送一次 IPC 消息，平衡流畅度与性能
 */
function handleMouseMove (event) {
  // 未超过阈值时不开始拖拽
  if (!dragActive) {
    const dx = event.screenX - dragStartX
    const dy = event.screenY - dragStartY
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
    // 超过阈值，开始真正的拖拽
    dragActive = true
    widgetApi.dragStart(widgetType, dragStartX, dragStartY)
  }

  lastMoveX = event.screenX
  lastMoveY = event.screenY
  // 已有挂起的 rAF 则跳过，避免重复调度
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    widgetApi.dragMove(widgetType, lastMoveX, lastMoveY)
  })
}

/**
 * 鼠标释放：结束拖拽，清理全局监听与 rAF
 * 仅在已超过阈值（dragActive=true）时才通知主进程结束拖拽
 * 单击（未超过阈值）不触发 dragEnd，让 click 事件正常传播
 */
function handleMouseUp () {
  // 取消可能挂起的 rAF
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  // 仅在已开始拖拽时通知主进程结束
  if (dragActive) {
    widgetApi.dragEnd(widgetType)
  }
  dragActive = false
  // 移除全局监听
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
}

// 组件卸载时清理：防止拖拽中途组件被销毁导致监听泄漏
onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
})
</script>

<style scoped lang="scss">
.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  // 通过 headerStyleVars 注入 CSS 变量，支持 Compact/Standard 模式切换
  height: var(--widget-header-row-height, var(--widget-header-height, 46px));
  padding:
    var(--widget-header-padding-top, 7px)
    var(--widget-header-padding-right, 12px)
    var(--widget-header-padding-bottom, 5px)
    var(--widget-header-padding-h, 14px);
  background: transparent;
  // 溢出隐藏：防止按钮组在窄窗口下超出窗口右边界
  overflow: hidden;
  // 使用 color-mix 将 divider 颜色与透明混合，等效 Opacity:0.62，且自动适配暗色变量
  border-bottom: 1px solid color-mix(in srgb, var(--widget-divider, #D0D0D0) 62%, transparent);
  // 拖拽由 mousedown 手动处理（IPC 模式），不再使用 -webkit-app-region: drag
  cursor: grab;

  // ============ Chrome 模式变体 ============
  &--compact {
    // 紧凑模式下分割线更淡
    border-bottom-color: color-mix(in srgb, var(--widget-divider, #D0D0D0) 40%, transparent);
  }

  // Overlay 模式：覆盖式标题栏，悬停时才显示分割线
  &--overlay {
    border-bottom-color: transparent;
    transition: border-bottom-color var(--widget-motion-fast, 167ms) ease;

    &:hover {
      border-bottom-color: color-mix(in srgb, var(--widget-divider, #D0D0D0) 62%, transparent);
    }
  }

  // Hidden 模式：极简标题栏，无分割线
  &--hidden {
    border-bottom: none;
  }

  // 图标隐藏模式：标题左侧无图标
  &--icon-hidden {
    .widget-header__icon,
    .widget-header__icon-text {
      display: none;
    }
  }

  &__left {
    display: flex;
    align-items: center;
    gap: var(--widget-spacing-xs, 4px);
    flex: 1;
    min-width: 0;
    // 标题区域最小宽度：确保标题文字至少显示几个字符，避免被按钮组完全挤掉
    // 图标 ~16px + 间距 4px + 标题至少 ~40px = 60px
    min-width: 60px;
  }

  &__drag {
    flex-shrink: 0;
  }

  &__icon {
    font-size: var(--widget-header-title-icon-size, var(--widget-font-title, 14px));
    color: var(--widget-text-secondary, #5A5A5A);
    flex-shrink: 0;

    // 单色模式（FilledMono / LineMono）：使用次要文字色
    &--mono {
      color: var(--widget-text-secondary, #5A5A5A);
    }

    // 彩色模式：使用主题色（具体颜色由 titleIconKind 决定，此处用 primary 兜底）
    &--color {
      color: var(--el-color-primary, #409EFF);
    }
  }

  // 文本标签模式：用首字符替代图标
  &__icon-text {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--widget-header-title-icon-size, 14px);
    height: var(--widget-header-title-icon-size, 14px);
    font-size: var(--widget-header-title-font-size, 12px);
    font-weight: 600;
    color: var(--widget-text-secondary, #5A5A5A);
    flex-shrink: 0;
    border-radius: var(--widget-radius-small, 4px);
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }

  // __left gap 已提供 4px，兄弟选择器再补 4px 凑足 8px
  &__icon + &__title,
  &__icon-text + &__title {
    margin-left: var(--widget-spacing-xs, 4px);
  }

  &__title {
    font-size: var(--widget-header-title-font-size, var(--widget-font-title, 14px));
    font-weight: 500;
    color: var(--widget-text, #1A1A1A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__title-input {
    font-size: var(--widget-header-title-font-size, var(--widget-font-title, 14px));
    font-weight: 500;
    color: var(--widget-text, #1A1A1A);
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--el-color-primary, #409EFF);
    border-radius: var(--widget-radius-small, 4px);
    outline: none;
    padding: 0 4px;
    margin: 0;
    max-width: 160px;
    height: 20px;
    line-height: 20px;
    flex-shrink: 1;
    min-width: 0;
  }

  &__guide-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-left: 6px;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: 50%;
    cursor: pointer;
    color: var(--el-color-primary, #409EFF);
    transition: background var(--widget-motion-faster, 83ms) ease;

    .el-icon {
      font-size: 14px;
    }

    &:hover {
      background: rgba(64, 158, 255, 0.12);
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 2px;
    // 允许按钮区域压缩：窗口不够宽时优先压缩悬停按钮组，保证折叠按钮始终可见
    flex-shrink: 1;
    min-width: 0;
    // 溢出隐藏：防止按钮超出窗口右边界
    overflow: hidden;
    // 按钮区域不参与拖拽（mousedown 中通过 closest 排除）
    cursor: default;
  }

  // 默认 Opacity:0，鼠标进入标题栏时 Opacity:1（167ms fast 淡入）
  &__hover-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    // 允许悬停按钮组压缩：窗口不够宽时溢出的按钮被裁切，折叠按钮始终完整显示
    flex-shrink: 1;
    min-width: 0;
    // 溢出隐藏：超出按钮区域的按钮不显示，避免与标题/窗口边界重叠
    overflow: hidden;
    transition: opacity var(--widget-motion-fast, 167ms) ease;
  }

  // 鼠标进入标题栏或按钮组聚焦时，悬停按钮组淡入显示
  &:hover &__hover-actions,
  &:focus-within &__hover-actions {
    opacity: 1;
  }

  // 尺寸由 TitleBarMetrics 计算，圆角 4px，透明背景
  &__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--widget-header-button-size, 24px);
    height: var(--widget-header-button-size, 24px);
    min-width: var(--widget-header-button-size, 24px);
    min-height: var(--widget-header-button-size, 24px);
    padding: 0;
    border: none;
    background: transparent;
    border-radius: var(--widget-radius-small, 4px);
    cursor: pointer;
    color: var(--widget-text-secondary, #5A5A5A);
    transition: background var(--widget-motion-faster, 83ms) ease,
                color var(--widget-motion-faster, 83ms) ease;

    .el-icon {
      // 操作图标尺寸由 ApplyActionIcon 计算
      font-size: var(--widget-header-action-icon-size, var(--widget-font-title, 14px));
    }

    &:hover {
      background: var(--widget-title-hover, rgba(0, 0, 0, 0.06));
      color: var(--widget-text, #1A1A1A);
    }

    &:active {
      background: var(--widget-title-pressed, rgba(0, 0, 0, 0.10));
    }

    // 锁定激活态：使用主题色（蓝色）让锁定/置顶状态更醒目
    &.is-locked {
      color: var(--el-color-primary, #409EFF);
      background: rgba(64, 158, 255, 0.08);
    }
  }

  // flex-shrink: 0 确保窗口不够宽时关闭按钮始终完整可见，不被 overflow 裁切
  &__btn--close {
    flex-shrink: 0;
    color: var(--el-color-danger, #F56C6C);

    &:hover {
      // 红色淡背景，保持危险语义
      background: rgba(245, 108, 108, 0.10);
      color: var(--el-color-danger, #F56C6C);
    }

    &:active {
      background: rgba(245, 108, 108, 0.18);
    }
  }

  // 菜单项锁定提示
  &__menu-hint {
    margin-left: 4px;
    color: var(--el-text-color-secondary, #909399);
    font-size: 12px;
  }
}

// 暗色模式适配：CSS 变量已在 widget.scss 中通过 html.dark 覆盖
// 此处保留兼容性回退，确保在变量未加载时仍有合理表现
html.dark .widget-header {
  border-bottom-color: color-mix(in srgb, var(--widget-divider, #3C3C3C) 62%, transparent);

  &--compact {
    border-bottom-color: color-mix(in srgb, var(--widget-divider, #3C3C3C) 40%, transparent);
  }

  &--overlay {
    border-bottom-color: transparent;

    &:hover {
      border-bottom-color: color-mix(in srgb, var(--widget-divider, #3C3C3C) 62%, transparent);
    }
  }

  &__icon {
    color: var(--widget-text-secondary, #A5A5A5);

    &--mono {
      color: var(--widget-text-secondary, #A5A5A5);
    }

    &--color {
      color: var(--el-color-primary, #409EFF);
    }
  }

  &__icon-text {
    color: var(--widget-text-secondary, #A5A5A5);
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
  }

  &__title {
    color: var(--widget-text, #F5F5F5);
  }

  &__title-input {
    color: var(--widget-text, #F5F5F5);
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.07));
    border-color: var(--el-color-primary, #409EFF);
  }

  &__guide-badge {
    color: var(--el-color-primary, #409EFF);

    &:hover {
      background: rgba(64, 158, 255, 0.18);
    }
  }

  &__btn {
    color: var(--widget-text-secondary, #A5A5A5);

    &:hover {
      background: var(--widget-title-hover, rgba(255, 255, 255, 0.07));
      color: var(--widget-text, #F5F5F5);
    }

    &:active {
      background: var(--widget-title-pressed, rgba(255, 255, 255, 0.12));
    }

    &.is-locked {
      color: var(--el-color-primary, #409EFF);
      background: rgba(64, 158, 255, 0.12);
    }
  }

  // 暗色模式关闭按钮：红色在深色背景下仍清晰可辨
  &__btn--close {
    color: var(--el-color-danger, #F56C6C);

    &:hover {
      background: rgba(245, 108, 108, 0.14);
      color: var(--el-color-danger, #F56C6C);
    }

    &:active {
      background: rgba(245, 108, 108, 0.22);
    }
  }

  &__menu-hint {
    color: var(--el-text-color-secondary, #8d9095);
  }
}
</style>
