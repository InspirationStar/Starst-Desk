// ============================================================
// Starst Desk 渲染进程入口（Vue 3 应用）
// 职责：创建 Vue 应用实例，注册 Pinia/Router/Element Plus，挂载到 #app
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

// 应用根组件
import App from './App.vue'
// 路由配置
import router from './router'
// 全局样式
import './assets/styles/global.scss'

// 创建 Vue 应用实例
const app = createApp(App)

// 注册 Pinia 状态管理
app.use(createPinia())

// 注册 Vue Router 路由
app.use(router)

// 全局注册 ElConfigProvider（用于在根组件中配置 Element Plus locale）
app.component('ElConfigProvider', ElConfigProvider)

// 全局注册 Element Plus 图标组件
// 后续可在模板中直接使用 <el-icon><Edit /></el-icon>
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// 挂载应用到 DOM 节点 #app
app.mount('#app')