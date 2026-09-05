<!--
  引导步骤：任务流与功能部件选择
  职责：文件拖放练习、小部件显隐练习、功能部件启用选择
  - SetupTaskStep3: 文件练习状态
  - SetupTaskStep4: 可见性练习状态
  - SetupTaskStep5: 功能部件开关同步
  - SynchronizeFeatureTogglesFromSettings: 从设置同步开关状态
-->
<template>
  <div class="step-task-flow">
    <h3 class="step-title">功能部件选择</h3>
    <p class="step-desc">选择需要启用的桌面小部件，可随时在小部件管理页面修改。</p>

    <!-- 功能部件开关网格 -->
    <div class="feature-toggle-grid">
      <div
        v-for="item in featureWidgets"
        :key="item.kind"
        class="feature-toggle-card"
        :class="{ 'feature-toggle-card--enabled': item.enabled }"
      >
        <div class="feature-toggle-card__info">
          <el-icon class="feature-toggle-card__icon"><component :is="item.icon" /></el-icon>
          <div class="feature-toggle-card__text">
            <div class="feature-toggle-card__title">{{ item.title }}</div>
            <div class="feature-toggle-card__desc">{{ item.desc }}</div>
          </div>
        </div>
        <el-switch v-model="item.enabled" @change="handleToggleChange(item)" />
      </div>
    </div>

    <!-- 操作提示 -->
    <div class="task-hints">
      <div class="task-hint">
        <el-icon class="task-hint__icon"><InfoFilled /></el-icon>
        <div class="task-hint__text">
          <strong>文件拖放：</strong>将文件拖到桌面小部件上可快速导入
        </div>
      </div>
      <div class="task-hint">
        <el-icon class="task-hint__icon"><InfoFilled /></el-icon>
        <div class="task-hint__text">
          <strong>显隐切换：</strong>使用全局热键或托盘菜单可快速切换所有小部件显隐
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  List, EditPen, Search, Sunny, Headset, Grid, InfoFilled
} from '@element-plus/icons-vue'
import { widgetApi, systemApi } from '@/utils/ipc-client'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({
      todo: true,
      quickCapture: true,
      search: false,
      weather: false,
      music: false,
      glance: false
    })
  }
})

const emit = defineEmits(['update:modelValue'])

const featureWidgets = reactive([
  { kind: 'todo', title: '待办小部件', desc: '桌面待办事项快捷查看', icon: List, enabled: true },
  { kind: 'quick-capture', title: '随记便笺', desc: '快速记录灵感与备忘', icon: EditPen, enabled: true },
  { kind: 'search', title: '全局搜索', desc: '快捷搜索文件与应用', icon: Search, enabled: false },
  { kind: 'weather', title: '天气小部件', desc: '实时天气与预报', icon: Sunny, enabled: false },
  { kind: 'music', title: '音乐小部件', desc: '桌面音乐播放控制', icon: Headset, enabled: false },
  { kind: 'glance', title: '概览小部件', desc: '日程与待办汇总', icon: Grid, enabled: false }
])

/**
 * 同步配置到父组件
 */
function syncToParent () {
  const result = {}
  featureWidgets.forEach(w => {
    result[w.kind] = w.enabled
  })
  emit('update:modelValue', result)
}

/**
 * 功能部件开关切换
 */
async function handleToggleChange (item) {
  try {
    if (item.enabled) {
      // 启用：创建小部件
      await widgetApi.create(item.kind)
    } else {
      // 禁用：删除小部件
      await widgetApi.delete(item.kind)
    }
  } catch (err) {
    // IPC 失败时回退开关状态
    item.enabled = !item.enabled
    ElMessage.error(`${item.title}设置失败：${err.message}`)
    return
  }
  syncToParent()
}

/**
 * 从已加载的小部件列表同步开关状态
 */
async function syncFromWidgetList () {
  try {
    const list = await widgetApi.list()
    const widgets = Array.isArray(list) ? list : (list?.list || [])
    const enabledMap = {}
    widgets.forEach(w => {
      enabledMap[w.widget_type] = Number(w.is_enabled) === 1
    })
    featureWidgets.forEach(item => {
      if (item.kind in enabledMap) {
        item.enabled = enabledMap[item.kind]
      }
    })
  } catch {
    // 忽略：使用默认值
  }
}

// 初始化
onMounted(() => {
  // 从 props 同步初始状态
  if (props.modelValue) {
    featureWidgets.forEach(item => {
      if (item.kind in props.modelValue) {
        item.enabled = props.modelValue[item.kind]
      }
    })
  }
  // 从主进程同步实际状态
  syncFromWidgetList()
})
</script>

<style scoped lang="scss">
.step-task-flow {
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
}

// 功能部件开关网格
.feature-toggle-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.feature-toggle-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px;
  border: 1px solid var(--app-border, #ebeef5);
  border-radius: 8px;
  background: var(--app-bg-primary, #ffffff);
  transition: border-color 0.2s, box-shadow 0.2s;

  &:hover {
    border-color: var(--el-color-primary, #409eff);
  }

  &--enabled {
    border-color: var(--el-color-primary, #409eff);
    box-shadow: 0 0 0 1px var(--el-color-primary, #409eff) inset;
  }

  &__info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__icon {
    font-size: 22px;
    color: var(--el-color-primary, #409eff);
    flex-shrink: 0;
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
  }

  &__desc {
    font-size: 11px;
    color: var(--app-text-secondary, #909399);
    margin-top: 2px;
  }
}

// 操作提示
.task-hints {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--app-bg-secondary, #f5f7fa);
  font-size: 13px;
  color: var(--app-text-regular, #606266);

  &__icon {
    color: var(--el-color-primary, #409eff);
    flex-shrink: 0;
    margin-top: 2px;
  }

  &__text {
    line-height: 1.5;
  }
}

// 暗色主题
html.dark {
  .feature-toggle-card {
    background: var(--app-bg-secondary, #262727);
  }
}
</style>