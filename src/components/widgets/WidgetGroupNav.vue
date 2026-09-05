<!--
  小部件分组导航组件
  职责：嵌入 WidgetHeader 标题区域，在分组成员间切换活跃成员
    - 三种导航样式（NavigationStyle）：
      · stack：标题栏显示当前成员名 + 下拉箭头，点击下拉显示成员列表
      · auto：同 stack，但额外支持滚轮切换
      · tabs：标题栏显示所有成员为扁平 Tab 标签
    - 交互：
      · 点击成员名/Tab 切换活跃成员
      · 滚轮切换（wheelSwitchEnabled）：鼠标滚轮在标题栏滚动切换成员
      · Ctrl+Tab 循环切换：监听键盘事件
      · 右键菜单：分离成员、解散分组、导航样式切换
  Props:
    - group: 分组对象（包含 memberIds / activeMemberId / navigationStyle 等字段）
    - activeMember: 当前活跃成员 widgetType
    - memberLabels: 成员标签映射 { widgetType: 显示名 }
    - compact: 是否紧凑模式（嵌入标题栏时为 true）
  Emits:
    - switch-member: 切换成员（payload: widgetType）
    - detach: 分离当前成员（payload: widgetType）
    - dissolve: 解散分组（payload: groupId）
    - update-style: 更新导航样式（payload: { navigationStyle }）
-->
<template>
  <div
    class="widget-group-nav"
    :class="[
      `widget-group-nav--${navigationStyle}`,
      { 'widget-group-nav--compact': compact }
    ]"
    @wheel="handleWheel"
    @keydown.tab.prevent="handleCtrlTab"
    @contextmenu.prevent="handleContextMenu"
  >
    <!-- Stack / Auto 样式：当前成员名 + 下拉箭头 -->
    <el-dropdown
      v-if="navigationStyle === 'stack' || navigationStyle === 'auto'"
      trigger="click"
      placement="bottom-start"
      :max-height="280"
      @command="handleMemberCommand"
    >
      <div class="widget-group-nav__current" :title="activeLabel">
        <span class="widget-group-nav__current-name">{{ activeLabel }}</span>
        <el-icon class="widget-group-nav__arrow"><ArrowDown /></el-icon>
      </div>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="member in memberList"
            :key="member"
            :command="member"
            :class="{ 'is-active': member === activeMember }"
          >
            <el-icon v-if="member === activeMember" class="widget-group-nav__check"><Check /></el-icon>
            <span>{{ memberLabels[member] || member }}</span>
          </el-dropdown-item>
          <el-dropdown-item divided disabled command="__separator__">
            <span class="widget-group-nav__hint">滚轮/Ctrl+Tab 切换</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <!-- Tabs 样式：扁平 Tab 标签 -->
    <div
      v-else-if="navigationStyle === 'tabs'"
      class="widget-group-nav__tabs"
      role="tablist"
    >
      <button
        v-for="member in memberList"
        :key="member"
        type="button"
        class="widget-group-nav__tab"
        :class="{ 'is-active': member === activeMember }"
        role="tab"
        :title="memberLabels[member] || member"
        @click.stop="handleMemberClick(member)"
        @mouseenter="handleTabHover(member)"
      >
        <span class="widget-group-nav__tab-name">{{ memberLabels[member] || member }}</span>
      </button>
    </div>

    <!-- 右键菜单：分离当前成员、解散分组、导航样式切换 -->
    <div
      v-if="contextMenuVisible"
      class="widget-group-nav__context-menu"
      :style="{ left: contextMenuPos.x + 'px', top: contextMenuPos.y + 'px' }"
      @click.stop
    >
      <div class="widget-group-nav__menu-item" @click="handleDetachCurrent">
        <el-icon><CircleClose /></el-icon>
        <span>分离当前成员</span>
      </div>
      <div class="widget-group-nav__menu-item widget-group-nav__menu-item--danger" @click="handleDissolve">
        <el-icon><Delete /></el-icon>
        <span>解散分组</span>
      </div>
      <div class="widget-group-nav__menu-divider"></div>
      <div class="widget-group-nav__menu-label">导航样式</div>
      <div
        v-for="opt in navigationStyleOptions"
        :key="opt.value"
        class="widget-group-nav__menu-item"
        :class="{ 'is-checked': navigationStyle === opt.value }"
        @click="handleStyleChange(opt.value)"
      >
        <el-icon v-if="navigationStyle === opt.value"><Check /></el-icon>
        <span>{{ opt.label }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ArrowDown, Check, CircleClose, Delete } from '@element-plus/icons-vue'

const props = defineProps({
  // 分组对象
  group: {
    type: Object,
    required: true
  },
  // 当前活跃成员 widgetType
  activeMember: {
    type: String,
    default: ''
  },
  // 成员标签映射 { widgetType: 显示名 }
  memberLabels: {
    type: Object,
    default: () => ({})
  },
  // 是否紧凑模式（嵌入标题栏时为 true）
  compact: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits([
  'switch-member',
  'detach',
  'dissolve',
  'update-style'
])

// 导航样式选项
const navigationStyleOptions = [
  { value: 'stack', label: '堆叠' },
  { value: 'auto', label: '自动' },
  { value: 'tabs', label: '标签页' }
]

// 右键菜单状态
const contextMenuVisible = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })

/**
 * 当前导航样式（默认 stack）
 */
const navigationStyle = computed(() => {
  const style = props.group?.navigationStyle
  // follow-default 视为 stack（具体策略由上层应用默认值，此处兜底）
  if (!style || style === 'follow-default') return 'stack'
  return style
})

/**
 * 成员列表（widgetType 数组）
 */
const memberList = computed(() => {
  const ids = props.group?.memberIds
  return Array.isArray(ids) ? ids : []
})

/**
 * 当前活跃成员的显示标签
 */
const activeLabel = computed(() => {
  const active = props.activeMember || props.group?.activeMemberId || ''
  return props.memberLabels[active] || active || ''
})

/**
 * 滚轮切换是否启用
 * wheelSwitchEnabled 为 null 时跟随默认：auto 样式启用，其他禁用
 */
const wheelEnabled = computed(() => {
  const explicit = props.group?.wheelSwitchEnabled
  if (explicit === true || explicit === false) return explicit
  // 跟随默认：auto 启用滚轮
  return navigationStyle.value === 'auto'
})

/**
 * 悬停切换是否启用（仅 tabs 样式生效）
 */
const hoverEnabled = computed(() => {
  const explicit = props.group?.hoverSwitchEnabled
  if (explicit === true || explicit === false) return explicit
  // 默认禁用，避免误触
  return false
})

/**
 * 切换到指定成员
 * @param {string} widgetType 目标成员 widgetType
 */
function switchTo (widgetType) {
  if (!widgetType || widgetType === props.activeMember) return
  if (!memberList.value.includes(widgetType)) return
  emit('switch-member', widgetType)
}

/**
 * 处理下拉菜单命令
 * @param {string} command 成员 widgetType 或特殊命令
 */
function handleMemberCommand (command) {
  if (!command || command === '__separator__') return
  switchTo(command)
}

/**
 * 处理 Tab 标签点击
 */
function handleMemberClick (member) {
  switchTo(member)
}

/**
 * 处理 Tab 标签悬停（仅 hoverEnabled 时切换）
 */
function handleTabHover (member) {
  if (!hoverEnabled.value) return
  switchTo(member)
}

/**
 * 滚轮切换：向下滚动切换到下一个成员，向上滚动切换到上一个
 * 仅在 wheelEnabled 时生效
 */
function handleWheel (event) {
  if (!wheelEnabled.value) return
  // 阻止页面滚动
  event.preventDefault()
  const list = memberList.value
  if (list.length < 2) return
  const currentIndex = list.indexOf(props.activeMember)
  if (currentIndex === -1) return
  // deltaY > 0 表示向下滚动，切换到下一个
  const direction = event.deltaY > 0 ? 1 : -1
  const nextIndex = (currentIndex + direction + list.length) % list.length
  switchTo(list[nextIndex])
}

/**
 * Ctrl+Tab 循环切换到下一个成员
 */
function handleCtrlTab (event) {
  // 仅响应 Ctrl+Tab
  if (!event.ctrlKey) return
  const list = memberList.value
  if (list.length < 2) return
  const currentIndex = list.indexOf(props.activeMember)
  if (currentIndex === -1) return
  // Shift+Tab 反向
  const direction = event.shiftKey ? -1 : 1
  const nextIndex = (currentIndex + direction + list.length) % list.length
  switchTo(list[nextIndex])
}

/**
 * 右键菜单：显示自定义上下文菜单
 */
function handleContextMenu (event) {
  contextMenuVisible.value = true
  contextMenuPos.value = { x: event.clientX, y: event.clientY }
}

/**
 * 关闭右键菜单
 */
function closeContextMenu () {
  contextMenuVisible.value = false
}

/**
 * 分离当前成员
 */
function handleDetachCurrent () {
  closeContextMenu()
  emit('detach', props.activeMember)
}

/**
 * 解散分组
 */
function handleDissolve () {
  closeContextMenu()
  emit('dissolve', props.group?.id)
}

/**
 * 切换导航样式
 */
function handleStyleChange (style) {
  closeContextMenu()
  if (style === navigationStyle.value) return
  emit('update-style', { navigationStyle: style })
}

/**
 * 全局点击/键盘事件：关闭右键菜单
 */
function handleGlobalClick () {
  if (contextMenuVisible.value) closeContextMenu()
}

function handleGlobalKeydown (event) {
  if (event.key === 'Escape' && contextMenuVisible.value) {
    closeContextMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick, true)
  document.addEventListener('keydown', handleGlobalKeydown, true)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick, true)
  document.removeEventListener('keydown', handleGlobalKeydown, true)
})

// 当组件外部 group 变化时，关闭右键菜单
watch(() => props.group?.id, () => {
  closeContextMenu()
})
</script>

<style scoped lang="scss">
.widget-group-nav {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  user-select: none;

  // ============ Stack / Auto 样式 ============
  &__current {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: var(--widget-radius-small, 4px);
    cursor: pointer;
    color: var(--widget-text, #1A1A1A);
    font-size: var(--widget-font-title, 14px);
    font-weight: 500;
    transition: background var(--widget-motion-faster, 83ms) ease;
    max-width: 160px;

    &:hover {
      background: var(--widget-title-hover, rgba(0, 0, 0, 0.06));
    }

    &:active {
      background: var(--widget-title-pressed, rgba(0, 0, 0, 0.10));
    }
  }

  &__current-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__arrow {
    font-size: 12px;
    color: var(--widget-text-secondary, #5A5A5A);
    flex-shrink: 0;
  }

  &__check {
    margin-right: 4px;
    color: var(--el-color-primary, #409eff);
  }

  &__hint {
    font-size: 11px;
    color: var(--widget-text-tertiary, #909399);
  }

  // ============ Tabs 样式 ============
  &__tabs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;

    // 隐藏滚动条
    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__tab {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border: none;
    background: transparent;
    border-radius: var(--widget-radius-small, 4px);
    cursor: pointer;
    color: var(--widget-text-secondary, #5A5A5A);
    font-size: var(--widget-font-title, 14px);
    transition: background var(--widget-motion-faster, 83ms) ease,
                color var(--widget-motion-faster, 83ms) ease;
    white-space: nowrap;
    max-width: 100px;

    &-name {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    &:hover {
      background: var(--widget-title-hover, rgba(0, 0, 0, 0.06));
      color: var(--widget-text, #1A1A1A);
    }

    &.is-active {
      color: var(--widget-text, #1A1A1A);
      font-weight: 600;
      background: var(--widget-title-open, rgba(0, 0, 0, 0.04));
    }
  }

  // ============ 紧凑模式 ============
  &--compact {
    .widget-group-nav__current {
      padding: 1px 4px;
      max-width: 120px;
    }

    .widget-group-nav__tab {
      padding: 1px 6px;
      max-width: 80px;
    }
  }

  // ============ 右键菜单 ============
  &__context-menu {
    position: fixed;
    z-index: 9999;
    min-width: 160px;
    padding: 4px 0;
    background: var(--el-bg-color, #ffffff);
    border: 1px solid var(--el-border-color-light, #dcdfe6);
    border-radius: var(--widget-radius-medium, 6px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  }

  &__menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 13px;
    color: var(--el-text-color-regular, #606266);
    transition: background var(--widget-motion-faster, 83ms) ease;

    .el-icon {
      font-size: 14px;
    }

    &:hover {
      background: var(--el-fill-color-light, #f5f7fa);
    }

    &.is-checked {
      color: var(--el-color-primary, #409eff);
      font-weight: 500;
    }

    &--danger {
      color: var(--el-color-danger, #f56c6c);

      &:hover {
        background: rgba(245, 108, 108, 0.10);
      }
    }
  }

  &__menu-divider {
    height: 1px;
    margin: 4px 0;
    background: var(--el-border-color-lighter, #ebeef5);
  }

  &__menu-label {
    padding: 4px 12px;
    font-size: 11px;
    color: var(--el-text-color-secondary, #909399);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
}

// ============ 暗色模式适配 ============
html.dark .widget-group-nav {
  &__current {
    color: var(--widget-text, #F5F5F5);

    &:hover {
      background: var(--widget-title-hover, rgba(255, 255, 255, 0.07));
    }

    &:active {
      background: var(--widget-title-pressed, rgba(255, 255, 255, 0.12));
    }
  }

  &__arrow {
    color: var(--widget-text-secondary, #A5A5A5);
  }

  &__hint {
    color: var(--widget-text-tertiary, #8A8A8A);
  }

  &__tab {
    color: var(--widget-text-secondary, #A5A5A5);

    &:hover {
      background: var(--widget-title-hover, rgba(255, 255, 255, 0.07));
      color: var(--widget-text, #F5F5F5);
    }

    &.is-active {
      color: var(--widget-text, #F5F5F5);
      background: var(--widget-title-open, rgba(255, 255, 255, 0.10));
    }
  }

  &__context-menu {
    background: var(--el-bg-color, #1f1f1f);
    border-color: var(--el-border-color-light, #3a3a3a);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  &__menu-item {
    color: var(--el-text-color-regular, #cfd3dc);

    &:hover {
      background: var(--el-fill-color-light, rgba(255, 255, 255, 0.06));
    }

    &--danger {
      color: var(--el-color-danger, #f56c6c);

      &:hover {
        background: rgba(245, 108, 108, 0.16);
      }
    }
  }

  &__menu-divider {
    background: var(--el-border-color-lighter, #2a2a2a);
  }

  &__menu-label {
    color: var(--el-text-color-secondary, #8d9095);
  }
}
</style>