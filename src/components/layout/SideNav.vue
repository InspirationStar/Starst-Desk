<!--
  侧边导航组件
  职责：渲染左侧菜单，支持路由跳转、当前项高亮、折叠模式
  使用 Element Plus el-menu（vertical + router 模式）
  底部显示版本号
-->
<template>
  <div class="side-nav" :class="{ 'is-collapsed': collapsed }">
    <!-- 顶部 Logo 区域 -->
    <div class="side-nav__header">
      <div class="side-nav__logo">
        <el-icon class="side-nav__logo-icon"><Star /></el-icon>
        <span v-show="!collapsed" class="side-nav__logo-text">Starst Desk</span>
      </div>
    </div>

    <!-- 菜单区域 -->
    <el-scrollbar class="side-nav__menu-wrap">
      <el-menu
        ref="menuRef"
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        router
        unique-opened
        class="side-nav__menu"
      >
        <!-- 全局搜索 -->
        <el-menu-item index="/search">
          <el-icon><Search /></el-icon>
          <template #title>全局搜索</template>
        </el-menu-item>

        <!-- 便签提醒 -->
        <el-menu-item index="/notes">
          <el-icon><EditPen /></el-icon>
          <template #title>便签提醒</template>
        </el-menu-item>

        <!-- 待办&规划（含子菜单，点击标题默认进入总览） -->
        <el-sub-menu index="/todo-group">
          <template #title>
            <el-icon><List /></el-icon>
            <span @click.stop="navigateTo('/todo', '/todo-group')">待办&规划</span>
          </template>
          <el-menu-item index="/todo">总览</el-menu-item>
          <el-menu-item index="/todo/list">今日任务</el-menu-item>
          <el-menu-item index="/todo/groups">任务流</el-menu-item>
          <el-menu-item index="/todo/projects">项目</el-menu-item>
          <el-menu-item index="/todo/focus">专注模式</el-menu-item>
          <el-menu-item index="/todo/plan">AI 规划</el-menu-item>
          <el-menu-item index="/todo/achievements">成就</el-menu-item>
        </el-sub-menu>

        <!-- 定时任务 -->
        <el-menu-item index="/tasks">
          <el-icon><Lightning /></el-icon>
          <template #title>定时任务</template>
        </el-menu-item>

        <!-- 健康提醒（含子菜单，点击标题默认进入健康统计） -->
        <el-sub-menu index="/health">
          <template #title>
            <el-icon><FirstAidKit /></el-icon>
            <span @click.stop="navigateTo('/health/stats', '/health')">健康提醒</span>
          </template>
          <el-menu-item index="/health/stats">健康统计</el-menu-item>
          <el-menu-item index="/health">提醒配置</el-menu-item>
        </el-sub-menu>

        <!-- AI 对话（含子菜单，点击标题默认进入对话窗口） -->
        <el-sub-menu index="/ai-chat">
          <template #title>
            <el-icon><ChatDotRound /></el-icon>
            <span @click.stop="navigateTo('/ai-chat', '/ai-chat')">AI 对话</span>
          </template>
          <el-menu-item index="/ai-chat">对话窗口</el-menu-item>
          <el-menu-item index="/ai-chat/config">模型配置</el-menu-item>
          <el-menu-item index="/ai-chat/assets">资产盒子</el-menu-item>
        </el-sub-menu>

        <!-- 小部件管理 -->
        <el-menu-item index="/widgets/settings">
          <el-icon><Grid /></el-icon>
          <template #title>小部件管理</template>
        </el-menu-item>

        <!-- 桌宠配置 -->
        <el-menu-item index="/pet/settings">
          <el-icon><Pointer /></el-icon>
          <template #title>桌宠配置</template>
        </el-menu-item>

        <!-- 灵动岛配置 -->
        <el-menu-item index="/island/settings">
          <el-icon><Monitor /></el-icon>
          <template #title>灵动岛配置</template>
        </el-menu-item>

        <!-- 活动统计 -->
        <el-menu-item index="/activity/stats">
          <el-icon><DataAnalysis /></el-icon>
          <template #title>活动统计</template>
        </el-menu-item>

        <!-- 应用设置 -->
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <template #title>应用设置</template>

        </el-menu-item>
      </el-menu>
    </el-scrollbar>

    <!-- 底部版本号 -->
    <div class="side-nav__footer">
      <span v-show="!collapsed" class="side-nav__version">v{{ version }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Star,
  EditPen,
  List,
  Lightning,
  FirstAidKit,
  ChatDotRound,
  Setting,
  Grid,
  Pointer,
  DataAnalysis,

  Search,
  Monitor
} from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app-store'

// 路由实例：用于计算当前激活菜单
const route = useRoute()
const router = useRouter()
// 应用全局状态
const appStore = useAppStore()

// 侧边栏折叠状态
const collapsed = computed(() => appStore.sidebarCollapsed)

// 当前激活菜单：使用路由路径
const activeMenu = computed(() => route.path)

// 应用版本号
const version = computed(() => appStore.version)

// 菜单实例引用：用于手动展开/折叠子菜单
const menuRef = ref(null)

/**
 * 点击子菜单标题时导航到默认页面并展开对应子菜单
 * @param {string} path 默认路由路径（第一个子项）
 * @param {string} subMenuIndex 子菜单的 index，用于手动展开
 */
function navigateTo (path, subMenuIndex) {
  router.push(path)
  // 阻止冒泡后 el-menu 不会自动展开，手动展开对应子菜单
  if (subMenuIndex) {
    nextTick(() => {
      menuRef.value?.open(subMenuIndex)
    })
  }
}
</script>

<style scoped lang="scss">
.side-nav {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--side-nav-bg, #ffffff);
  border-right: 1px solid var(--side-nav-border, #ebeef5);
  transition: width 0.28s ease;
  user-select: none;

  // 顶部 Logo 区域
  &__header {
    flex-shrink: 0;
    height: 56px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    border-bottom: 1px solid var(--side-nav-border, #ebeef5);
  }

  &__logo {
    display: flex;
    align-items: center;
    gap: 10px;
    overflow: hidden;
  }

  &__logo-icon {
    font-size: 24px;
    color: #409eff;
    flex-shrink: 0;
  }

  &__logo-text {
    font-size: 16px;
    font-weight: 600;
    color: var(--side-nav-text, #303133);
    white-space: nowrap;
  }

  // 菜单区域
  &__menu-wrap {
    flex: 1;
    overflow: hidden;
  }

  &__menu {
    border-right: none;

    // 折叠状态下居中显示图标
    &.el-menu--collapse {
      width: 64px;
    }
  }

  // 底部版本号
  &__footer {
    flex-shrink: 0;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    border-top: 1px solid var(--side-nav-border, #ebeef5);
  }

  &__version {
    font-size: 12px;
    color: var(--side-nav-text-secondary, #909399);
  }

  // 折叠状态下隐藏 Logo 文字
  &.is-collapsed {
    .side-nav__header {
      justify-content: center;
      padding: 0;
    }
  }
}

// 深色主题下的侧边栏样式
html.dark .side-nav {
  --side-nav-bg: #1d1e1f;
  --side-nav-border: #414243;
  --side-nav-text: #e5eaf3;
  --side-nav-text-secondary: #a3a6ad;

  // Logo 图标主色暗色适配
  .side-nav__logo-icon {
    color: #66b1ff;
  }
}
</style>
