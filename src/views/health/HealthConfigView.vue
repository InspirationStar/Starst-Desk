<!--
  健康提醒配置页
  使用 el-tabs 标签页整合六大子模块
  顶部显示各模块启用状态总览
-->
<template>
  <div class="health-config-view">
    <!-- 页面标题 + 统计入口 -->
    <header class="page-header">
      <div class="page-header__text">
        <h2 class="page-title">健康提醒</h2>
        <p class="page-subtitle">管理六大健康提醒子模块，养成良好生活习惯</p>
      </div>
      <el-button
        type="primary"
        plain
        :icon="TrendCharts"
        class="page-header__stats-btn"
        @click="$router.push('/health/stats')"
      >
        统计仪表盘
      </el-button>
    </header>

    <!-- 各模块启用状态总览 -->
    <el-card class="overview-card" shadow="never">
      <template #header>
        <div class="overview-header">
          <span class="overview-header__title">模块状态总览</span>
          <span class="overview-header__hint">点击卡片可快速切换至对应配置</span>
        </div>
      </template>

      <div class="module-status-grid">
        <div
          v-for="module in moduleList"
          :key="module.type"
          class="module-status-card"
          :class="{
            enabled: isModuleEnabled(module.type),
            active: activeTab === module.type
          }"
          :style="moduleStyle(module)"
          @click="activeTab = module.type"
        >
          <span class="module-status-card__accent" />
          <div class="module-icon">{{ module.icon }}</div>
          <div class="module-name">{{ module.name }}</div>
          <div class="module-status">
            <span class="status-dot" :class="{ on: isModuleEnabled(module.type) }" />
            <span class="status-text">{{ isModuleEnabled(module.type) ? '运行中' : '未启用' }}</span>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 子模块标签页 -->
    <div class="tabs-section" v-loading="loading">
      <el-tabs v-model="activeTab" class="module-tabs">
        <el-tab-pane name="water">
          <template #label>
            <span class="tab-label">💧 喝水</span>
          </template>
          <WaterPanel />
        </el-tab-pane>

        <el-tab-pane name="sedentary">
          <template #label>
            <span class="tab-label">🪑🤸 久坐伸展</span>
          </template>
          <SedentaryPanel />
        </el-tab-pane>

        <el-tab-pane name="eye">
          <template #label>
            <span class="tab-label">👁️ 护眼</span>
          </template>
          <EyePanel />
        </el-tab-pane>

        <el-tab-pane name="sleep">
          <template #label>
            <span class="tab-label">😴 睡眠</span>
          </template>
          <SleepPanel />
        </el-tab-pane>

        <el-tab-pane name="diet">
          <template #label>
            <span class="tab-label">🍽️ 饮食</span>
          </template>
          <DietPanel />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { TrendCharts } from '@element-plus/icons-vue'
import { useHealthStore } from '@/stores/health-store'

// 子模块组件
import WaterPanel from './WaterPanel.vue'
import SedentaryPanel from './SedentaryPanel.vue'
import EyePanel from './EyePanel.vue'
import SleepPanel from './SleepPanel.vue'
import DietPanel from './DietPanel.vue'

const healthStore = useHealthStore()

// 当前激活的标签页（默认第一个标签：喝水）
const activeTab = ref('water')
const loading = ref(false)

// 五大子模块列表（子需求8：久坐和伸展合并为"久坐伸展"）
// color 用于卡片色条与图标背景，与 ReminderWindow 类型色条保持一致
const moduleList = [
  { type: 'water', name: '喝水', icon: '💧', color: '#4cc2ff' },
  { type: 'sedentary', name: '久坐伸展', icon: '🪑', color: '#f5a623' },
  { type: 'eye', name: '护眼', icon: '👁️', color: '#9b59b6' },
  { type: 'sleep', name: '睡眠', icon: '😴', color: '#5c6bc0' },
  { type: 'diet', name: '饮食', icon: '🍽️', color: '#67c23a' }
]

/**
 * 判断模块是否启用
 */
function isModuleEnabled (moduleType) {
  return healthStore.isModuleEnabled(moduleType)
}

/**
 * hex 转 rgba 字符串
 */
function hexToRgba (hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 模块卡片样式：注入主题色 CSS 变量
 */
function moduleStyle (module) {
  return {
    '--module-color': module.color,
    '--module-color-soft': hexToRgba(module.color, 0.12),
    '--module-color-soft-strong': hexToRgba(module.color, 0.22)
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await healthStore.fetchConfigs()
  } catch (error) {
    console.error('加载健康配置失败:', error.message)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped lang="scss">
.health-config-view {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

// ============================================================
// 页头
// ============================================================
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  &__text {
    min-width: 0;
  }

  .page-title {
    margin: 0 0 4px 0;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: var(--el-text-color-primary);
  }

  .page-subtitle {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }

  &__stats-btn {
    flex-shrink: 0;
    margin-bottom: 2px;
    height: 36px;
    border-radius: 10px;
    font-weight: 500;
  }
}

// ============================================================
// 模块状态总览
// ============================================================
.overview-card {
  margin-bottom: 16px;
  border-radius: 12px;

  :deep(.el-card__header) {
    padding: 14px 20px;
  }

  :deep(.el-card__body) {
    padding: 18px 20px;
  }
}

.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  &__title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-primary);

    &::before {
      content: '';
      width: 3px;
      height: 14px;
      border-radius: 2px;
      background: var(--el-color-primary);
    }
  }

  &__hint {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

.module-status-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.module-status-card {
  --module-color: #409eff;
  --module-color-soft: rgba(64, 158, 255, 0.12);
  --module-color-soft-strong: rgba(64, 158, 255, 0.22);
  position: relative;
  flex: 1 1 20%;
  min-width: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;

  // 顶部主题色条
  &__accent {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--module-color);
    opacity: 0.45;
    transition: opacity 0.2s ease;
  }

  .module-icon {
    font-size: 28px;
    width: 52px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 14px;
    background: var(--module-color-soft);
    transition: background 0.2s ease;
  }

  .module-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .module-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--el-text-color-secondary);

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--el-text-color-placeholder);
      transition: background 0.2s, box-shadow 0.2s;

      &.on {
        background: #67c23a;
        box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.15);
      }
    }
  }

  &:hover {
    transform: translateY(-2px);
    border-color: var(--module-color);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);

    .module-status-card__accent {
      opacity: 1;
    }
  }

  &.enabled {
    background: var(--module-color-soft);
  }

  // 当前激活 tab 对应卡片高亮（用 inset shadow 模拟彩色边框，不受全局边框 !important 影响）
  &.active {
    border-color: var(--module-color);
    box-shadow: 0 0 0 1px var(--module-color) inset, 0 8px 20px rgba(0, 0, 0, 0.06);

    .module-status-card__accent {
      opacity: 1;
    }
  }
}

// ============================================================
// 标签页（line 风格，更通透紧凑）
// ============================================================
.tabs-section {
  :deep(.el-tabs__header) {
    margin: 0 0 16px 0;
  }

  :deep(.el-tabs__nav-wrap::after) {
    height: 1px;
  }

  :deep(.el-tabs__item) {
    font-size: 14px;
    font-weight: 500;
    padding: 0 18px;
    height: 40px;
  }

  :deep(.el-tabs__active-bar) {
    height: 3px;
    border-radius: 2px;
  }
}

.tab-label {
  font-size: 14px;
}

// ============================================================
// 暗色模式适配
// 注意：global.scss 已对 .module-status-card 做边框/enabled 背景/模块名颜色的
// !important 覆盖，此处不重复设置这些属性，仅补充新元素的暗色适配
// ============================================================
html.dark {
  // 模块图标背景：浅色 12% 在深底过淡，暗色改用 22%
  .module-status-card .module-icon {
    background: var(--module-color-soft-strong);
  }

  // 统计按钮：plain primary 在暗色下 hover 字体会变暗，显式覆盖为亮色保证对比度
  .page-header__stats-btn.el-button.is-plain.el-button--primary {
    color: #79bbff;
    background-color: rgba(64, 158, 255, 0.1);
    border-color: rgba(64, 158, 255, 0.4);

    &:hover,
    &:focus {
      color: #a0cfff;
      background-color: rgba(64, 158, 255, 0.2);
      border-color: rgba(64, 158, 255, 0.6);
    }

    &:active {
      color: #b3d8ff;
    }
  }
}
</style>
