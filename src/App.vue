<template>
  <!--
    Starst Desk 根组件
    职责：
    - 挂载主布局（AppLayout：侧边栏 + 内容区）
    - 全局挂载提醒弹窗（ReminderPopup：监听主进程 reminder:popup 推送）
    - 应用初始化（读取主题等配置）
    - 全局错误处理
  -->
  <el-config-provider :locale="zhCn">
    <div class="app-root">
      <!-- 主布局：侧边栏 + 内容区 -->
      <app-layout />

      <!-- 全局提醒弹窗：监听主进程 reminder:popup 推送 -->
      <reminder-popup />

    </div>
  </el-config-provider>
</template>

<script setup>
import { onMounted, onUnmounted, onErrorCaptured } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import AppLayout from '@/components/layout/AppLayout.vue'
import ReminderPopup from '@/components/common/ReminderPopup.vue'

import { useAppStore } from '@/stores/app-store'
import { on } from '@/utils/ipc-client'

// 应用全局状态
const appStore = useAppStore()
const router = useRouter()

// app:setting-changed 事件取消监听函数（用于同步其他窗口的外观设置变化，如强调色）
let unsubscribeSettingChanged = null
// navigate-to-widget-settings 事件取消监听函数（小部件窗口请求打开设置页）
let unsubscribeNavigateWidgetSettings = null
// app:navigate 事件取消监听函数（小部件窗口请求主窗口导航）
let unsubscribeAppNavigate = null

// 全局错误捕获：组件渲染期间抛出的错误在此统一处理
onErrorCaptured((err, instance, info) => {
  console.error('[App] 组件错误:', err, info)
  ElMessage.error(`应用发生错误：${err.message || '未知错误'}`)
  // 返回 false 阻止错误继续向上传播
  return false
})

// 应用挂载时初始化全局配置（主题、侧边栏折叠等）
onMounted(async () => {
  try {
    await appStore.init()
  } catch (err) {
    console.error('[App] 初始化失败:', err)
    ElMessage.warning('应用配置加载失败，使用默认设置')
  }

  // 订阅应用设置变化事件：主进程广播外观设置变化（如强调色）
  // payload: { key, value }，当 key 为 accent_color 时同步应用到 DOM
  // 场景：小部件窗口或其他窗口修改强调色后，主窗口需同步更新
  unsubscribeSettingChanged = on('app:setting-changed', (data) => {
    if (!data || typeof data !== 'object') return
    if (data.key === 'accent_color' && typeof data.value === 'string') {
      // 仅同步状态与 DOM，不重复持久化（避免循环）
      appStore.syncAccentColor(data.value)
    }
  })

  // 订阅小部件打开设置页事件：小部件窗口通过"更多 > 小部件设置"请求打开设置页
  // payload: { widgetType }，路由到小部件管理页并定位到对应小部件
  unsubscribeNavigateWidgetSettings = on('navigate-to-widget-settings', (data) => {
    if (!data || !data.widgetType) return
    router.push({
      name: 'widget-settings',
      query: { type: data.widgetType }
    })
  })

  // 订阅 app:navigate 事件：小部件窗口请求主窗口导航到指定路由
  // payload: { path, query }，使用 vue-router 进行导航
  unsubscribeAppNavigate = on('app:navigate', (data) => {
    if (!data || !data.path) return
    router.push({ path: data.path, query: data.query || {} })
  })

  // 全局未捕获的 Promise 异常
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[App] 未处理的 Promise 异常:', event.reason)
    ElMessage.error(`操作失败：${event.reason?.message || '未知错误'}`)
  })

  // 全局运行时错误
  window.addEventListener('error', (event) => {
    console.error('[App] 运行时错误:', event.error)
    ElMessage.error(`发生错误：${event.message || '未知错误'}`)
  })
})

onUnmounted(() => {
  // 清理设置变化监听
  if (typeof unsubscribeSettingChanged === 'function') {
    unsubscribeSettingChanged()
    unsubscribeSettingChanged = null
  }
  // 清理小部件设置页导航监听
  if (typeof unsubscribeNavigateWidgetSettings === 'function') {
    unsubscribeNavigateWidgetSettings()
    unsubscribeNavigateWidgetSettings = null
  }
  // 清理 app:navigate 监听
  if (typeof unsubscribeAppNavigate === 'function') {
    unsubscribeAppNavigate()
    unsubscribeAppNavigate = null
  }
})
</script>

<style scoped lang="scss">
.app-root {
  width: 100%;
  height: 100%;
}
</style>
