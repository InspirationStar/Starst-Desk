<!--
  新手引导视图

    Step 0 - 功能介绍（Features + IntroAnimations）
    Step 1 - 外观设置（Appearance）
    Step 2 - 热键与存储（Hotkey + Storage + DesktopOrganization）
    Step 3 - 任务流与完成（TaskFlow + Completion）

  通过路由 /onboarding 访问，或首次启动自动跳转
  完成后标记 onboarding_completed 并跳转主界面
-->
<template>
  <div class="onboarding-view" :class="{ 'onboarding-view--compact': isCompact }">
    <!-- 入场动画遮罩 -->
    <intro-overlay
      :visible="showIntro"
      @completed="handleIntroCompleted"
    />

    <!-- 品牌头部 -->
    <div class="onboarding-header">
      <div class="brand-logo">
        <div class="brand-logo__layer brand-logo__layer--1" />
        <div class="brand-logo__layer brand-logo__layer--2" />
        <div class="brand-logo__layer brand-logo__layer--3" />
      </div>
      <h1 class="onboarding-title">欢迎使用 Starst Desk</h1>
      <p class="onboarding-subtitle">Windows 11 桌面助手应用</p>
    </div>

    <!-- 步骤进度指示 -->
    <div class="onboarding-progress">
      <div class="progress-dots">
        <span
          v-for="index in stepCount"
          :key="index"
          class="progress-dot"
          :class="{ 'progress-dot--active': index - 1 === activeStep }"
        />
      </div>
      <span class="step-counter">{{ String(activeStep + 1).padStart(2, '0') }} / {{ String(stepCount).padStart(2, '0') }}</span>
    </div>

    <!-- 步骤内容区 -->
    <div class="onboarding-content" :class="{ 'onboarding-content--animating': isAnimating }">
      <transition :name="transitionName" mode="out-in">
        <!-- Step 0：功能介绍 -->
        <div v-if="activeStep === 0" key="features" class="step-panel">
          <step-features />
        </div>

        <!-- Step 1：外观设置 -->
        <div v-else-if="activeStep === 1" key="appearance" class="step-panel">
          <step-appearance v-model="config.appearance" />
        </div>

        <!-- Step 2：热键与存储 -->
        <div v-else-if="activeStep === 2" key="hotkey-storage" class="step-panel">
          <step-hotkey v-model="config.dailyUse" />
          <el-divider />
          <step-storage v-model="config.storage" />
          <el-divider />
          <step-desktop-organization
            :storage-path="config.storage.storagePath"
            @change-path="handleChangeStoragePath"
          />
        </div>

        <!-- Step 3：任务流与完成 -->
        <div v-else-if="activeStep === 3" key="task-completion" class="step-panel">
          <step-task-flow v-model="config.featureWidgets" />
          <el-divider />
          <step-completion
            :enabled-widgets="enabledWidgetsSummary"
            :appearance="config.appearance"
            :daily-use="config.dailyUse"
            :storage="config.storage"
          />
        </div>
      </transition>
    </div>

    <!-- 底部导航 -->
    <div class="onboarding-footer">
      <el-button
        v-if="activeStep > 0"
        :disabled="isAnimating"
        @click="handleBack"
      >
        上一步
      </el-button>
      <el-button
        v-if="activeStep < stepCount - 1"
        type="primary"
        :disabled="isAnimating"
        @click="handleNext"
      >
        下一步
      </el-button>
      <el-button
        v-if="activeStep === stepCount - 1"
        type="primary"
        :disabled="isAnimating"
        @click="handleFinish"
      >
        开始使用
      </el-button>
      <el-button text @click="handleSkip">跳过引导</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { systemApi } from '@/utils/ipc-client'

import IntroOverlay from './components/intro-overlay.vue'
import StepFeatures from './components/step-features.vue'
import StepAppearance from './components/step-appearance.vue'
import StepHotkey from './components/step-hotkey.vue'
import StepStorage from './components/step-storage.vue'
import StepDesktopOrganization from './components/step-desktop-organization.vue'
import StepTaskFlow from './components/step-task-flow.vue'
import StepCompletion from './components/step-completion.vue'

const router = useRouter()

const stepCount = 4

// 当前步骤索引
const activeStep = ref(0)

// 是否显示入场动画
const showIntro = ref(true)

// 是否正在动画过渡中
const isAnimating = ref(false)

// 过渡方向（前进/后退）
const transitionName = ref('step-forward')

const isCompact = ref(false)

// 引导配置（各步骤共享状态）
const config = reactive({
  // 外观设置
  appearance: {
    theme: 'auto',
    accentMode: 'system',
    accentColor: '#0078D4',
    material: 'mica',
    capsuleMode: false
  },
  // 日常使用（热键/自启）
  dailyUse: {
    hotkeyEnabled: true,
    hotkey: 'Ctrl+Alt+D',
    searchHotkeyEnabled: false,
    autoStart: false
  },
  // 存储配置
  storage: {
    storagePath: '',
    pinnedToQuickAccess: false
  },
  // 功能部件开关
  featureWidgets: {
    todo: true,
    'quick-capture': true,
    search: false,
    weather: false,
    music: false,
    glance: false
  }
})

const enabledWidgetsSummary = computed(() => {
  const widgetNames = {
    todo: '待办',
    'quick-capture': '随记便笺',
    search: '全局搜索',
    weather: '天气',
    music: '音乐',
    glance: '概览'
  }
  const enabled = []
  for (const [kind, enabledFlag] of Object.entries(config.featureWidgets)) {
    if (enabledFlag && widgetNames[kind]) {
      enabled.push(widgetNames[kind])
    }
  }
  return enabled
})

/**
 * 入场动画完成
 */
function handleIntroCompleted () {
  showIntro.value = false
}

/**
 * 导航到指定步骤
 */
function navigateToStep (newStep, forward) {
  if (newStep < 0 || newStep >= stepCount || newStep === activeStep.value || isAnimating.value) {
    return
  }

  transitionName.value = forward ? 'step-forward' : 'step-backward'
  isAnimating.value = true
  activeStep.value = newStep

  systemApi.setSetting('onboarding_step_index', String(newStep)).catch(() => {})

  // 动画结束后清除状态
  setTimeout(() => {
    isAnimating.value = false
  }, 420)
}

/**
 * 下一步
 */
function handleNext () {
  if (activeStep.value < stepCount - 1) {
    navigateToStep(activeStep.value + 1, true)
  }
}

/**
 * 上一步
 */
function handleBack () {
  if (activeStep.value > 0) {
    navigateToStep(activeStep.value - 1, false)
  }
}

/**
 * 跳过引导
 */
function handleSkip () {
  completeOnboarding()
}

/**
 * 完成引导
 */
async function completeOnboarding () {
  try {
    // 标记已完成引导
    localStorage.setItem('onboarding_completed', 'true')
    await systemApi.setSetting('onboarding_completed', 'true')
    await systemApi.setSetting('onboarding_step_index', '0')
  } catch (e) {
    // 忽略持久化失败
  }
  router.push('/notes')
}

/**
 * 完成按钮
 */
function handleFinish () {
  completeOnboarding()
}

/**
 * 桌面整理请求更改路径
 * 切换到存储步骤（Step 2）让用户更改
 */
function handleChangeStoragePath () {
  if (activeStep.value !== 2) {
    navigateToStep(2, true)
  }
}

/**
 * 响应式布局检测
 */
function updateResponsiveLayout () {
  isCompact.value = window.innerWidth < 880
}

// 初始化
onMounted(() => {
  updateResponsiveLayout()
  window.addEventListener('resize', updateResponsiveLayout)

  // 读取已保存的步骤索引（用于恢复中断的引导）
  systemApi.getSetting('onboarding_step_index').then(({ value }) => {
    const step = parseInt(value, 10)
    if (!isNaN(step) && step >= 0 && step < stepCount) {
      activeStep.value = step
    }
  }).catch(() => {})
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateResponsiveLayout)
})
</script>

<style scoped lang="scss">
.onboarding-view {
  position: relative;
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 16px;
  min-height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;

  // 紧凑布局
  &--compact {
    padding: 16px 12px;
  }
}

// 品牌头部
.onboarding-header {
  text-align: center;
  margin-bottom: 24px;
}

.brand-logo {
  position: relative;
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;

  &__layer {
    position: absolute;
    width: 32px;
    height: 30px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.26);

    &--1 {
      background: #0B64BF;
      left: 0;
      top: 0;
    }

    &--2 {
      background: #1691E8;
      left: 8px;
      top: 8px;
    }

    &--3 {
      background: #58AAFE;
      left: 16px;
      top: 16px;
    }
  }
}

.onboarding-title {
  font-size: 28px;
  font-weight: 600;
  color: var(--app-text-primary, #303133);
  margin: 0 0 8px;
}

.onboarding-subtitle {
  font-size: 14px;
  color: var(--app-text-secondary, #909399);
  margin: 0;
}

// 步骤进度指示
.onboarding-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 24px;
}

.progress-dots {
  display: flex;
  gap: 6px;
}

.progress-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--app-text-secondary, #909399);
  opacity: 0.34;
  transition: all 0.2s;

  &--active {
    width: 8px;
    height: 8px;
    opacity: 1;
    background: var(--el-color-primary, #409eff);
  }
}

.step-counter {
  font-size: 12px;
  color: var(--app-text-secondary, #909399);
  font-family: monospace;
}

// 步骤内容区
.onboarding-content {
  flex: 1;
  min-height: 320px;
  margin-bottom: 24px;
  position: relative;

  &--animating {
    pointer-events: none;
  }
}

.step-panel {
  width: 100%;
}

.step-forward-enter-active,
.step-forward-leave-active,
.step-backward-enter-active,
.step-backward-leave-active {
  transition: all 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.step-forward-enter-from {
  opacity: 0;
  transform: translateX(40px) scale(0.99);
}

.step-forward-leave-to {
  opacity: 0;
  transform: translateX(-40px) scale(0.99);
}

.step-backward-enter-from {
  opacity: 0;
  transform: translateX(-40px) scale(0.99);
}

.step-backward-leave-to {
  opacity: 0;
  transform: translateX(40px) scale(0.99);
}

// 底部导航
.onboarding-footer {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding-top: 24px;
  border-top: 1px solid var(--app-border, #ebeef5);
}

// 暗色主题
html.dark {
  .onboarding-view {
    --app-bg-primary: #1d1e1f;
    --app-bg-secondary: #262727;
    --app-border: #414243;
  }
}
</style>
