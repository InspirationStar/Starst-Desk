// ============================================================
// Starst Desk 灵动岛渲染进程入口（轻量 Vue 应用）
// 职责：创建独立于主应用与小部件的 Vue 实例，注册 Pinia + Element Plus，挂载到 #island-app
// 不加载主应用路由、侧边栏，保持灵动岛窗口体积最小
// 运行环境：浏览器（ES modules），禁止直接访问 Node API
// ============================================================

// 抑制 ResizeObserver loop 无害警告（须在任何 ResizeObserver 实例化前调用）
import { suppressResizeObserverError } from './utils/suppress-resize-error.js'
suppressResizeObserverError()

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { ElConfigProvider } from 'element-plus'

// Element Plus 暗色主题 CSS 变量（html.dark 时生效）
import 'element-plus/theme-chalk/dark/css-vars.css'

// 灵动岛根组件
import IslandApp from './IslandApp.vue'
// 全局样式（复用主应用的变量与暗色模式样式）
import './assets/styles/global.scss'

// 创建 Vue 应用实例
const app = createApp(IslandApp)

// 注册 Pinia 状态管理
app.use(createPinia())

// 全局注册 ElConfigProvider（用于在根组件中配置 Element Plus locale）
app.component('ElConfigProvider', ElConfigProvider)

// 全局注册 Element Plus 图标组件
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// 全局错误捕获：灵动岛渲染期间抛出的错误统一处理
app.config.errorHandler = (err, _instance, info) => {
  console.error('[Island] 组件错误:', err, info)
}

// 挂载应用到 DOM 节点 #island-app
app.mount('#island-app')