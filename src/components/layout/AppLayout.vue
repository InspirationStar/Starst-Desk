<!--
  主布局组件
  职责：左侧固定侧边栏（可折叠）+ 右侧内容区
  - 侧边栏宽度：展开 200px / 折叠 64px
  - 顶部标题栏：显示当前页面标题与折叠按钮
  - 内容区使用 <router-view /> 渲染当前页面
  - 整体 flex 布局，高度 100vh
-->
<template>
  <div class="app-layout">
    <!-- 左侧侧边栏 -->
    <aside class="app-layout__sidebar" :class="{ 'is-collapsed': collapsed }">
      <side-nav />
    </aside>

    <!-- 右侧主区域 -->
    <div class="app-layout__main">
      <!-- 顶部标题栏 -->
      <header class="app-layout__header">
        <div class="app-layout__header-left">
          <!-- 折叠/展开按钮 -->
          <el-icon class="app-layout__collapse-btn" @click="appStore.toggleSidebar">
            <Fold v-if="!collapsed" />
            <Expand v-else />
          </el-icon>
          <!-- 当前页面标题 -->
          <h1 class="app-layout__title">{{ pageTitle }}</h1>
        </div>
        <div class="app-layout__header-right">
          <!-- 主题快速切换 -->
          <el-tooltip :content="themeTooltip" placement="bottom">
            <el-icon class="app-layout__theme-btn" @click="toggleTheme">
              <Sunny v-if="appStore.isDark" />
              <Moon v-else />
            </el-icon>
          </el-tooltip>
        </div>
      </header>

      <!-- 内容区：渲染当前路由页面 -->
      <main class="app-layout__content" :class="{ 'is-fullscreen': isFullscreen }">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Fold, Expand, Sunny, Moon } from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app-store'
import SideNav from './SideNav.vue'

// 路由实例
const route = useRoute()
// 应用全局状态
const appStore = useAppStore()

// 侧边栏折叠状态
const collapsed = computed(() => appStore.sidebarCollapsed)

// 当前页面标题（取路由 meta.title）
const pageTitle = computed(() => route.meta?.title || 'Starst Desk')

// 当前路由是否要求全屏内容区（去掉 padding，让页面自行控制边距）
const isFullscreen = computed(() => !!route.meta?.fullscreen)

// 主题切换提示文案
const themeTooltip = computed(() => {
  const themeMap = { light: '浅色', dark: '深色', auto: '跟随系统' }
  return `当前主题：${themeMap[appStore.theme] || '浅色'}（点击切换）`
})

/**
 * 主题快速切换：在浅色/深色之间切换
 */
function toggleTheme () {
  const next = appStore.isDark ? 'light' : 'dark'
  appStore.setTheme(next)
}
</script>

<style scoped lang="scss">
.app-layout {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: var(--app-bg, #f5f7fa);


  // 左侧侧边栏
  &__sidebar {
    flex-shrink: 0;
    width: 200px;
    transition: width 0.28s ease;
    overflow: hidden;

    // 折叠状态
    &.is-collapsed {
      width: 64px;
    }
  }

  // 右侧主区域
  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  // 顶部标题栏
  &__header {
    flex-shrink: 0;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    background: var(--app-header-bg, #ffffff);
    border-bottom: 1px solid var(--app-header-border, #ebeef5);
  }

  &__header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__collapse-btn {
    font-size: 18px;
    color: var(--app-text-regular, #606266);
    cursor: pointer;
    transition: color 0.2s;

    &:hover {
      color: var(--el-color-primary, #409eff);
    }
  }

  &__title {
    font-size: 16px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0;
  }

  &__header-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  &__theme-btn {
    font-size: 18px;
    color: var(--app-text-regular, #606266);
    cursor: pointer;
    transition: color 0.2s;

    &:hover {
      color: #e6a23c;
    }
  }

  // 内容区
  &__content {
    flex: 1;
    overflow: auto;
    padding: 16px;
    // 始终为滚动条预留轨道空间，避免切换 tab/页面时滚动条出现/消失
    // 导致内容区宽度变化而产生水平晃动
    scrollbar-gutter: stable;

    // 全屏内容区：去掉 padding 并改为定位上下文，
    // 让页面根元素通过 position: absolute; inset: 0 撑满整个内容区，
    // 彻底避免 flex/百分比高度在嵌套布局中解析为 auto 导致内容溢出窗口
    &.is-fullscreen {
      padding: 0;
      overflow: hidden;
      position: relative;
    }
  }
}

// 页面切换淡入淡出动画
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.2s ease;
}

.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

// 深色主题下的布局样式
html.dark .app-layout {
  --app-bg: #1d1e1f;
  --app-header-bg: #252627;
  --app-header-border: #414243;
  --app-text-primary: #e5eaf3;
  --app-text-regular: #cfd3dc;
  --app-text-secondary: #a3a6ad;
  --app-bg-secondary: #262727;

  // 主题切换按钮 hover 暗色适配（浅警告色）
  .app-layout__theme-btn:hover {
    color: #ebb563;
  }
}
</style>
