<!--
  桌面小部件根组件
  职责：
  - 读取 URL query 参数 type，根据 type 动态挂载对应小部件组件
  - 包裹 CapsuleContainer 处理胶囊折叠/展开
  - 缺失 type 参数时显示占位提示
  - 全局错误处理
  - 监听 widget:material-changed 事件，按材质切换 html 上的 widget-material-* class
  - 挂载 WidgetSnapGuide 吸附高亮引导组件
  - 读取 collapseBehavior 配置并传递给子组件
-->
<template>
  <el-config-provider :locale="zhCn">
    <div class="widget-root" ref="widgetRootRef">
      <!-- 已识别的小部件类型：动态渲染对应组件 -->
      <component
        :is="currentComponent"
        v-if="currentComponent"
      />

      <!-- 未知或缺失 type 参数：占位提示 -->
      <div v-else class="widget-placeholder">
        <el-icon class="widget-placeholder__icon"><Warning /></el-icon>
        <p class="widget-placeholder__text">
          {{ widgetType ? `未知的小部件类型：${widgetType}` : '缺少小部件类型参数' }}
        </p>
      </div>

      <!-- 吸附高亮引导线：拖拽吸附时在窗口边缘显示呼吸高亮线 -->
      <WidgetSnapGuide />
    </div>
  </el-config-provider>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Warning } from '@element-plus/icons-vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import NoteWidget from '@/views/widgets/NoteWidget.vue'
import TaskWidget from '@/views/widgets/TaskWidget.vue'
import HealthWidget from '@/views/widgets/HealthWidget.vue'
import TodoWidget from '@/components/widgets/TodoWidget.vue'
import FileWidget from '@/components/widgets/FileWidget.vue'

import WeatherWidget from '@/components/widgets/WeatherWidget.vue'
import MusicWidget from '@/components/widgets/MusicWidget.vue'
import DesktopOrganizer from '@/components/widgets/DesktopOrganizer.vue'
import SystemMonitorWidget from '@/components/widgets/SystemMonitorWidget.vue'

import TagsWidget from '@/views/widgets/TagsWidget.vue'
import SearchWidget from '@/views/widgets/SearchWidget.vue'
import ProductivityWidget from '@/views/widgets/ProductivityWidget.vue'

import WidgetSnapGuide from '@/components/WidgetSnapGuide.vue'
import { useAppStore } from '@/stores/app-store'
import { invoke, on, systemApi, widgetApi } from '@/utils/ipc-client'

import '@/assets/styles/widget.scss'

// 应用全局 Store（用于读取主题配置）
const appStore = useAppStore()

// 从 URL query 参数读取小部件类型（note / task / health / todo）
const widgetType = new URLSearchParams(window.location.search).get('type')

// 小部件类型 → 组件映射表
const componentMap = {
  note: NoteWidget,
  task: TaskWidget,
  health: HealthWidget,
  todo: TodoWidget,
  file: FileWidget,

  weather: WeatherWidget,
  music: MusicWidget,
  'desktop-organizer': DesktopOrganizer,
  'system-monitor': SystemMonitorWidget,

  tags: TagsWidget,
  search: SearchWidget,
  productivity: ProductivityWidget
}

// 当前激活的小部件组件
const currentComponent = computed(() => componentMap[widgetType] || null)

// 合法材质列表（与主进程 widget:material-changed payload 对齐）
// 3 种材质：default（不透明）/ mica（云母，backdrop-filter 透明）/ acrylic（亚克力，backdrop-filter 透明）
// 材质值映射：default→widget-material-default, mica→widget-material-mica, acrylic→widget-material-acrylic
const VALID_MATERIALS = ['default', 'mica', 'acrylic']

// 当前材质（用于回退应用到根元素 class）
const currentMaterial = ref('default')

// 折叠行为配置（expanded / click / smart）
const collapseBehavior = ref('click')

// widget:material-changed 事件取消监听函数
let unsubscribeMaterialChanged = null

// app:setting-changed 事件取消监听函数（用于同步外观设置变化，如强调色）
let unsubscribeSettingChanged = null

// .widget-root 元素引用（用于 ResizeObserver 监听内容尺寸变化）
const widgetRootRef = ref(null)

// ResizeObserver 实例（监听 .widget-root 内容尺寸变化，通知主进程自适应窗口大小）
let resizeObserver = null

// 上次通知主进程的尺寸（用于判断变化是否超过阈值，避免循环触发）
let lastNotifiedWidth = 0
let lastNotifiedHeight = 0

// ResizeObserver 防抖定时器句柄
let resizeDebounceTimer = null

// 'app:theme-changed' 事件处理函数引用（用于卸载时移除监听）
let onThemeChanged = null

/**
 * 应用材质 class 到 html 元素
 * 策略：优先用 html class 以便 CSS 变量全局生效
 * 移除其他材质 class，添加当前材质 class
 * 支持 3 种材质：default/mica/acrylic
 * 材质值映射：default→widget-material-default, mica→widget-material-mica, acrylic→widget-material-acrylic
 * @param {string} material 材质名（'default'|'mica'|'acrylic'）
 */
function applyMaterialClass (material) {
  // 防御性校验：非法材质回退到 default
  const next = VALID_MATERIALS.includes(material) ? material : 'default'
  currentMaterial.value = next
  const classList = document.documentElement.classList
  // 移除所有材质 class
  VALID_MATERIALS.forEach((m) => classList.remove(`widget-material-${m}`))
  // 添加当前材质 class
  classList.add(`widget-material-${next}`)
}

/**
 * 初始化主题：读取 app_setting 中的主题配置并应用到 DOM
 * 小部件窗口独立于主窗口，需要自行读取主题并应用 html.dark 类
 */
async function initTheme () {
  try {
    await appStore.init()
  } catch (err) {
    // 主题加载失败时回退到浅色模式
    console.warn('[WidgetApp] 主题初始化失败，使用默认浅色模式:', err.message)
  }
}

/**
 * 初始化材质：通过 IPC 获取当前窗口材质并应用 class
 * 失败时回退到 default
 */
async function initMaterial () {
  try {
    // widgetApi.getMaterial() 返回 { material: 'mica' } 对象，需解构出 material 字段
    // 与 WidgetSettingsView.vue 的写法保持一致，避免把对象整体传给 applyMaterialClass
    const result = await widgetApi.getMaterial()
    applyMaterialClass(result?.material || 'default')
  } catch (err) {
    // 获取材质失败时回退到 default
    console.warn('[WidgetApp] 材质初始化失败，使用默认 default:', err.message)
    applyMaterialClass('default')
  }
}

/**
 * 初始化折叠行为：通过 IPC 获取当前小部件的 collapse_behavior 配置
 * 失败时回退到 click
 */
async function initCollapseBehavior () {
  try {
    const result = await widgetApi.getCollapseBehavior(widgetType)
    if (result && ['expanded', 'click', 'smart'].includes(result.behavior)) {
      collapseBehavior.value = result.behavior
    }
  } catch (err) {
    // 获取折叠行为失败时回退到 click
    console.warn('[WidgetApp] 折叠行为初始化失败，使用默认 click:', err.message)
    collapseBehavior.value = 'click'
  }
}

/**
 * 通知主进程根据内容尺寸调整窗口大小
 * 优先使用 widgetApi.resizeToContent（由 ipc-client 模块提供），
 * 若暂未定义则回退到直接 invoke('widget:resize-to-content')
 * @param {number} width 内容宽度
 * @param {number} height 内容高度
 */
async function notifyResizeToContent (width, height) {
  try {
    if (typeof widgetApi.resizeToContent === 'function') {
      await widgetApi.resizeToContent(widgetType, { width, height })
    } else {
      await invoke('widget:resize-to-content', { widgetType, width, height })
    }
  } catch (err) {
    console.warn('[WidgetApp] 通知窗口尺寸自适应失败:', err.message)
  }
}

/**
 * 处理 ResizeObserver 观测到的内容尺寸变化
 * 防抖 100ms，仅当尺寸变化超过 4px 才通知主进程，避免循环触发
 * @param {ResizeObserverEntry[]} entries 观测条目
 */
function handleResize (entries) {
  // 清除上一次防抖定时器
  if (resizeDebounceTimer !== null) {
    clearTimeout(resizeDebounceTimer)
  }
  // 防抖 100ms 后处理，避免高频回调抖动
  resizeDebounceTimer = setTimeout(() => {
    resizeDebounceTimer = null
    const entry = entries[0]
    if (!entry) return
    const { width, height } = entry.contentRect
    // 仅当宽高尺寸变化任一超过 4px 才通知，避免窗口 resize 导致内容 resize 的循环触发
    if (Math.abs(width - lastNotifiedWidth) < 4 && Math.abs(height - lastNotifiedHeight) < 4) {
      return
    }
    lastNotifiedWidth = width
    lastNotifiedHeight = height
    notifyResizeToContent(width, height)
  }, 100)
}

onMounted(async () => {
  // 串行初始化：先主题后材质，确保 html.dark class 先就位再应用材质 class，避免瞬态
  // 若并行调用，材质 class 应用时 dark class 可能尚未就位，导致深色模式下首帧闪烁
  await initTheme()
  await initMaterial()
  await initCollapseBehavior()

  // 订阅材质变化事件：主进程切换材质时推送 { widgetType, material }
  unsubscribeMaterialChanged = on('widget:material-changed', (data) => {
    if (data && typeof data === 'object') {
      // 仅处理本小部件类型的事件（widgetType 为空时也接受，主进程广播场景）
      if (!data.widgetType || data.widgetType === widgetType) {
        applyMaterialClass(data.material)
      }
    } else if (typeof data === 'string') {
      // 兼容直接推送材质字符串的场景
      applyMaterialClass(data)
    }
  })

  // 订阅应用设置变化事件：主进程广播外观设置变化（如强调色）
  // payload: { key, value }，当 key 为 accent_color 时同步应用到 DOM
  unsubscribeSettingChanged = on('app:setting-changed', (data) => {
    if (!data || typeof data !== 'object') return
    if (data.key === 'accent_color' && typeof data.value === 'string') {
      // 仅同步状态与 DOM，不重复持久化（避免循环）
      appStore.syncAccentColor(data.value)
    }
  })

  // 监听主题变化事件：主题切换后重算材质 class，确保材质 class 与 dark class 协同
  // app-store 的 applyThemeToDom 切换 dark class 后会派发 'app:theme-changed'
  // 此处重新应用当前材质 class，触发材质选择器（含 dark 交集）重新命中与字体颜色重算
  onThemeChanged = () => {
    applyMaterialClass(currentMaterial.value)
  }
  window.addEventListener('app:theme-changed', onThemeChanged)

  // ResizeObserver：监听 .widget-root 内容尺寸变化，通知主进程自适应窗口大小
  // 优先使用 ref 引用，回退到 querySelector 以兼容未挂载 ref 的场景
  const rootEl = widgetRootRef.value || document.querySelector('.widget-root')
  if (rootEl && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(rootEl)
    // 记入初始尺寸，避免首次回调误判为变化触发多余通知
    const rect = rootEl.getBoundingClientRect()
    lastNotifiedWidth = rect.width
    lastNotifiedHeight = rect.height
  }
})

onUnmounted(() => {
  // 清理材质变化监听
  if (typeof unsubscribeMaterialChanged === 'function') {
    unsubscribeMaterialChanged()
    unsubscribeMaterialChanged = null
  }
  // 清理设置变化监听
  if (typeof unsubscribeSettingChanged === 'function') {
    unsubscribeSettingChanged()
    unsubscribeSettingChanged = null
  }
  // 清理主题变化监听
  if (typeof onThemeChanged === 'function') {
    window.removeEventListener('app:theme-changed', onThemeChanged)
    onThemeChanged = null
  }
  // 清理 ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  // 清理防抖定时器
  if (resizeDebounceTimer !== null) {
    clearTimeout(resizeDebounceTimer)
    resizeDebounceTimer = null
  }
})
</script>

<style scoped lang="scss">
.widget-root {
  width: 100%;
  height: 100%;
  // 关键：必须使用 transparent，让 Mica 透过（不能有不透明背景覆盖）
  // 使用 !important 确保不会被其他样式覆盖
  background: transparent !important;
  border-radius: var(--widget-radius-large, 8px);
  // 厚度/颜色由 CSS 变量控制，支持四档厚度+三种颜色模式
  border: var(--widget-border-thickness, 1.2px) solid var(--widget-border-color, rgba(0, 0, 0, 0.12));
  overflow: hidden;
  // 主文字颜色
  color: var(--widget-text, #1A1A1A);
  // 文字抗锯齿
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  // 主题切换过渡
  transition: background var(--widget-motion-normal, 250ms) ease,
              color var(--widget-motion-normal, 250ms) ease;
}

// 占位提示样式
.widget-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--widget-spacing-lg, 16px);
  color: var(--widget-text-secondary, #5A5A5A);

  &__icon {
    font-size: 32px;
    margin-bottom: var(--widget-spacing-sm, 8px);
    color: var(--widget-text-secondary, #5A5A5A);
  }

  &__text {
    font-size: var(--widget-font-caption, 12px);
    text-align: center;
    margin: 0;
    color: var(--widget-text-secondary, #5A5A5A);
  }
}

// 暗色模式适配：CSS 变量已在 widget.scss 中通过 html.dark 覆盖
// 此处仅补充占位提示在深色模式下的回退
// 注意：不使用 box-shadow，避免相邻小部件之间出现阴影串扰
html.dark .widget-root {
  color: var(--widget-text, #F5F5F5);

  .widget-placeholder {
    color: var(--widget-text-secondary, #A5A5A5);

    &__icon,
    &__text {
      color: var(--widget-text-secondary, #A5A5A5);
    }
  }
}
</style>
