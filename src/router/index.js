// ============================================================
// Vue Router 路由配置
// 使用懒加载（动态 import）按需加载页面，减小初始包体积
// 每个路由通过 meta.title / meta.icon 描述页面元信息
// ============================================================

import { createRouter, createWebHashHistory } from 'vue-router'

// 路由定义
const routes = [
  {
    path: '/',
    name: 'home',
    redirect: '/notes'
  },
  {
    path: '/notes',
    name: 'notes',
    component: () => import('@/views/notes/NoteListView.vue'),
    meta: { title: '便签提醒', icon: 'EditPen' }
  },
  {
    path: '/todo',
    name: 'todo',
    component: () => import('@/views/todo/TodoDashboard.vue'),
    meta: { title: '待办&规划', icon: 'List' }
  },
  {
    path: '/todo/list',
    name: 'todo-list',
    component: () => import('@/views/todo/TodoListView.vue'),
    meta: { title: '今日任务', icon: 'List' }
  },
  {
    path: '/todo/groups',
    name: 'todo-groups',
    component: () => import('@/views/todo/GroupListView.vue'),
    meta: { title: '任务流', icon: 'List' }
  },
  {
    path: '/todo/projects',
    name: 'todo-projects',
    component: () => import('@/views/todo/ProjectListView.vue'),
    meta: { title: '项目', icon: 'List' }
  },
  {
    path: '/todo/focus',
    name: 'todo-focus',
    component: () => import('@/views/todo/FocusStartPage.vue'),
    meta: { title: '专注模式', icon: 'List' }
  },
  {
    path: '/todo/focus/session',
    name: 'todo-focus-session',
    component: () => import('@/views/todo/FocusSessionPage.vue'),
    meta: { title: '专注会话', icon: 'List' }
  },
  {
    path: '/todo/focus/guard',
    name: 'todo-focus-guard',
    component: () => import('@/views/todo/FocusGuardSettings.vue'),
    meta: { title: '专注护盾', icon: 'List' }
  },
  {
    path: '/todo/plan',
    name: 'todo-plan',
    component: () => import('@/views/todo/PlanGeneratorView.vue'),
    meta: { title: 'AI 规划', icon: 'List' }
  },
  {
    path: '/todo/achievements',
    name: 'todo-achievements',
    component: () => import('@/views/todo/AchievementView.vue'),
    meta: { title: '成就', icon: 'List' }
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('@/views/tasks/TaskListView.vue'),
    meta: { title: '定时任务', icon: 'AlarmClock' }
  },
  {
    path: '/health',
    name: 'health',
    component: () => import('@/views/health/HealthConfigView.vue'),
    meta: { title: '健康提醒', icon: 'FirstAidKit' }
  },
  {
    path: '/health/stats',
    name: 'health-stats',
    component: () => import('@/views/health/HealthStatsView.vue'),
    meta: { title: '健康统计', icon: 'DataAnalysis' }
  },
  {
    path: '/ai-chat',
    name: 'ai-chat',
    component: () => import('@/views/ai-chat/ChatView.vue'),
    // fullscreen: 内容区去掉 padding，让对话界面占满整个内容区
    meta: { title: 'AI 对话', icon: 'ChatDotRound', fullscreen: true }
  },
  {
    path: '/ai-chat/config',
    name: 'ai-chat-config',
    component: () => import('@/views/ai-chat/AIConfigView.vue'),
    meta: { title: 'AI 模型配置', icon: 'Setting', fullscreen: true }
  },
  {
    path: '/ai-chat/assets',
    name: 'ai-chat-assets',
    component: () => import('@/views/ai-chat/MediaAssetsView.vue'),
    meta: { title: '资产盒子', icon: 'Picture', fullscreen: true }
  },
  {
    path: '/widgets/settings',
    name: 'widget-settings',
    component: () => import('@/views/settings/WidgetSettingsView.vue'),
    meta: { title: '小部件管理', icon: 'Grid' }
  },
  {
    path: '/pet/settings',
    name: 'pet-settings',
    component: () => import('@/views/pet/PetSettingsView.vue'),
    meta: { title: '桌宠配置', icon: 'Pointer' }
  },
  {
    path: '/activity/stats',
    name: 'activity-stats',
    component: () => import('@/views/activity/ActivityStatsView.vue'),
    meta: { title: '活动统计', icon: 'DataAnalysis' }
  },
  {
    // 全局搜索弹窗
    path: '/search',
    name: 'search',
    component: () => import('@/views/search/SearchPopupView.vue'),
    meta: { title: '全局搜索', icon: 'Search', fullscreen: true }
  },
  {
    // 新手引导
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/views/onboarding/OnboardingView.vue'),
    meta: { title: '新手引导', icon: 'Guide' }
  },
  {
    // 发布说明
    path: '/release-notes',
    name: 'release-notes',
    component: () => import('@/views/settings/ReleaseNotesView.vue'),
    meta: { title: '发布说明', icon: 'Document' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/settings/SettingsView.vue'),
    meta: { title: '应用设置', icon: 'Setting' }
  },
  {
    path: '/island/settings',
    name: 'island-settings',
    component: () => import('@/views/island/IslandSettingsView.vue'),
    meta: { title: '灵动岛配置', icon: 'Monitor' }
  },
  {
    // 404 兜底：未匹配的路由重定向到便签页
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    redirect: '/notes'
  }
]

// 创建路由实例
// 使用 hash 模式：Electron file:// 协议加载本地文件，hash 模式无需服务端配合
const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 全局前置守卫：设置窗口标题
router.beforeEach((to, from) => {
  if (to.meta.title) {
    document.title = `${to.meta.title} - Starst Desk`
  }
})

// 全局错误守卫：懒加载失败时提示
router.onError((error) => {
  console.error('[Router] 路由加载错误:', error)
})

export default router

