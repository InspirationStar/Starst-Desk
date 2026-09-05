<!--
  引导步骤：功能介绍
  职责：展示核心功能与桌面小部件概览
-->
<template>
  <div class="step-features">
    <h3 class="step-title">核心功能</h3>
    <p class="step-desc">Starst Desk 提供六大核心功能与九种桌面小部件，点击托盘图标可快速访问。</p>

    <!-- 核心功能卡片网格 -->
    <div class="feature-grid">
      <div
        v-for="feature in features"
        :key="feature.title"
        class="feature-card"
      >
        <el-icon class="feature-card__icon"><component :is="feature.icon" /></el-icon>
        <div class="feature-card__info">
          <div class="feature-card__title">{{ feature.title }}</div>
          <div class="feature-card__desc">{{ feature.desc }}</div>
        </div>
      </div>
    </div>

    <el-divider />

    <!-- 桌面小部件概览 -->
    <h4 class="section-subtitle">桌面小部件</h4>
    <div class="widget-grid">
      <div
        v-for="widget in widgets"
        :key="widget.title"
        class="widget-card"
      >
        <el-icon class="widget-card__icon"><component :is="widget.icon" /></el-icon>
        <span class="widget-card__name">{{ widget.title }}</span>
      </div>
    </div>

    <!-- 托盘入口提示 -->
    <p class="step-tip">
      <el-icon><InfoFilled /></el-icon>
      点击系统托盘图标可显示/隐藏所有小部件，右键打开菜单
    </p>
  </div>
</template>

<script setup>
import {
  EditPen, List, AlarmClock, Lightning, FirstAidKit, ChatDotRound, DataAnalysis,
  Folder, Edit, Sunny, Headset, Grid, InfoFilled
} from '@element-plus/icons-vue'

// 核心功能列表
const features = [
  { title: '便签提醒', desc: '创建带提醒的便签，支持颜色标签和置顶', icon: EditPen },
  { title: '待办&规划', desc: '待办事项管理，支持截止日期和重复规则', icon: List },
  { title: '定时任务', desc: '单次/重复任务，支持多种动作', icon: Lightning },
  { title: '健康提醒', desc: '六大健康模块智能提醒', icon: FirstAidKit },
  { title: 'AI 对话', desc: '多模型 AI 对话，支持流式响应', icon: ChatDotRound },
  { title: '活动统计', desc: '键鼠活动统计和空闲检测', icon: DataAnalysis }
]

const widgets = [
  { title: '便签', icon: EditPen },
  { title: '任务', icon: AlarmClock },
  { title: '健康', icon: FirstAidKit },
  { title: '待办', icon: List },
  { title: '文件', icon: Folder },
  { title: '随记', icon: Edit },
  { title: '天气', icon: Sunny },
  { title: '音乐', icon: Headset },
  { title: '桌面整理', icon: Grid }
]
</script>

<style scoped lang="scss">
.step-features {
  .step-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0 0 8px;
  }

  .step-desc {
    font-size: 14px;
    color: var(--app-text-regular, #606266);
    margin: 0 0 20px;
    line-height: 1.6;
  }

  .section-subtitle {
    font-size: 16px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0 0 12px;
  }

  .step-tip {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 16px;
    font-size: 13px;
    color: var(--el-color-primary, #409eff);
  }
}

// 核心功能卡片网格
.feature-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.feature-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--app-border, #ebeef5);
  border-radius: 8px;
  background: var(--app-bg-primary, #ffffff);
  transition: border-color 0.2s, box-shadow 0.2s;

  &:hover {
    border-color: var(--el-color-primary, #409eff);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  &__icon {
    font-size: 24px;
    color: var(--el-color-primary, #409eff);
    flex-shrink: 0;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin-bottom: 4px;
  }

  &__desc {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    line-height: 1.5;
  }
}

// 桌面小部件网格
.widget-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.widget-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--app-border, #ebeef5);
  border-radius: 8px;
  background: var(--app-bg-primary, #ffffff);
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--el-color-primary, #409eff);
  }

  &__icon {
    font-size: 28px;
    color: var(--el-color-primary, #409eff);
  }

  &__name {
    font-size: 13px;
    color: var(--app-text-primary, #303133);
  }
}

// 暗色主题
html.dark {
  .feature-card,
  .widget-card {
    background: var(--app-bg-secondary, #262727);
  }
}
</style>