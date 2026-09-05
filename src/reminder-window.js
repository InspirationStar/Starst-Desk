// ============================================================
// 提醒窗口入口
// 职责：创建 Vue 应用并挂载到 #reminder-app
// ============================================================

import { createApp } from 'vue'
import ReminderWindow from './components/reminder/ReminderWindow.vue'
import '@/assets/styles/reminder.scss'

// 创建应用
const app = createApp(ReminderWindow)

// 挂载
app.mount('#reminder-app')