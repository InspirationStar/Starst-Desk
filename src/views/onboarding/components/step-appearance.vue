<!--
  引导步骤：外观设置
  职责：主题选择、强调色选择、窗口材质选择、胶囊模式开关、实时预览
  - BuildThemeSelector: System/Light/Dark
  - BuildAccentSelector: 系统强调色 + 6 种预设色
  - BuildMaterialSelector: Mica/Acrylic/Solid
  - Step3CapsuleToggle: 胶囊模式开关
  - UpdateAppearancePreview: 实时预览
-->
<template>
  <div class="step-appearance">
    <h3 class="step-title">外观设置</h3>
    <p class="step-desc">选择你喜欢的主题、强调色与窗口材质，所有更改实时生效。</p>

    <!-- 主题选择 -->
    <div class="appearance-row">
      <div class="appearance-row__label">界面主题</div>
      <el-radio-group v-model="theme" @change="handleThemeChange">
        <el-radio value="auto">跟随系统</el-radio>
        <el-radio value="light">浅色</el-radio>
        <el-radio value="dark">深色</el-radio>
      </el-radio-group>
    </div>

    <!-- 强调色选择 -->
    <div class="appearance-row">
      <div class="appearance-row__label">强调色</div>
      <div class="accent-selector">
        <el-radio
          v-model="accentMode"
          value="system"
          @change="handleAccentModeChange"
        >系统强调色</el-radio>
        <div class="accent-presets">
          <button
            v-for="color in presetColors"
            :key="color"
            class="accent-preset"
            :class="{ 'accent-preset--active': accentMode === 'custom' && accentColor === color }"
            :style="{ background: color }"
            :title="color"
            @click="handleAccentColorPreset(color)"
          />
        </div>
      </div>
    </div>

    <!-- 窗口材质选择 -->
    <div class="appearance-row">
      <div class="appearance-row__label">窗口材质</div>
      <el-radio-group v-model="material" @change="handleMaterialChange">
        <el-radio value="mica">云母 (Mica)</el-radio>
        <el-radio value="acrylic">亚克力 (Acrylic)</el-radio>
        <el-radio value="solid">纯色 (Solid)</el-radio>
      </el-radio-group>
    </div>

    <!-- 胶囊模式开关 -->
    <div class="appearance-row">
      <div class="appearance-row__info">
        <div class="appearance-row__label">胶囊模式</div>
        <div class="appearance-row__desc">将小部件折叠为胶囊形态，节省桌面空间</div>
      </div>
      <el-switch v-model="capsuleMode" @change="handleCapsuleChange" />
    </div>

    <!-- 实时预览 -->
    <div class="appearance-preview" :class="`appearance-preview--${material}`">
      <div class="appearance-preview__icon" :style="{ background: effectiveAccentColor }" />
      <div class="appearance-preview__content">
        <div class="appearance-preview__item" :style="{ background: effectiveAccentColor }" />
        <div class="appearance-preview__line" />
        <div class="appearance-preview__line appearance-preview__line--short" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app-store'
import { widgetApi, systemApi } from '@/utils/ipc-client'

const props = defineProps({
  // 外观配置（由父组件传入，双向同步）
  modelValue: {
    type: Object,
    default: () => ({
      theme: 'auto',
      accentMode: 'system',
      accentColor: '#0078D4',
      material: 'mica',
      capsuleMode: false
    })
  }
})

const emit = defineEmits(['update:modelValue'])

const appStore = useAppStore()

const presetColors = ['#0078D4', '#E81123', '#107C10', '#5D2E9B', '#FF8C00', '#0099BC']

// 本地状态
const theme = ref(props.modelValue.theme || 'auto')
const accentMode = ref(props.modelValue.accentMode || 'system')
const accentColor = ref(props.modelValue.accentColor || '#0078D4')
const material = ref(props.modelValue.material || 'mica')
const capsuleMode = ref(props.modelValue.capsuleMode || false)

// 实际生效的强调色
const effectiveAccentColor = computed(() =>
  accentMode.value === 'system' ? '#0078D4' : accentColor.value
)

/**
 * 同步配置到父组件
 */
function syncToParent () {
  emit('update:modelValue', {
    theme: theme.value,
    accentMode: accentMode.value,
    accentColor: accentColor.value,
    material: material.value,
    capsuleMode: capsuleMode.value
  })
}

/**
 * 主题切换
 */
async function handleThemeChange (val) {
  try {
    await appStore.setTheme(val)
  } catch (err) {
    ElMessage.error(`主题切换失败：${err.message}`)
  }
  syncToParent()
}

/**
 * 强调色模式切换：系统
 */
async function handleAccentModeChange (val) {
  if (val === 'system') {
    try {
      await appStore.setAccentColor('#0078D4')
    } catch (err) {
      ElMessage.error(`强调色重置失败：${err.message}`)
    }
  }
  syncToParent()
}

/**
 * 强调色预设选择
 */
async function handleAccentColorPreset (color) {
  accentMode.value = 'custom'
  accentColor.value = color
  try {
    await appStore.setAccentColor(color)
  } catch (err) {
    ElMessage.error(`强调色设置失败：${err.message}`)
  }
  syncToParent()
}

/**
 * 窗口材质切换
 */
async function handleMaterialChange (val) {
  try {
    await widgetApi.setMaterial(val)
  } catch (err) {
    ElMessage.error(`材质切换失败：${err.message}`)
  }
  syncToParent()
}

/**
 * 胶囊模式切换
 */
async function handleCapsuleChange (val) {
  try {
    await systemApi.setSetting('widget_capsule_mode_enabled', val ? 'true' : 'false')
    await systemApi.setSetting(
      'widget_collapse_behavior',
      val ? 'smart' : 'expanded'
    )
  } catch (err) {
    ElMessage.error(`胶囊模式设置失败：${err.message}`)
  }
  syncToParent()
}

// 监听 props 变化，同步本地状态
watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      theme.value = val.theme || 'auto'
      accentMode.value = val.accentMode || 'system'
      accentColor.value = val.accentColor || '#0078D4'
      material.value = val.material || 'mica'
      capsuleMode.value = val.capsuleMode || false
    }
  },
  { deep: true }
)

// 初始化：从 appStore 同步当前主题
onMounted(() => {
  theme.value = appStore.theme || 'auto'
  accentColor.value = appStore.accentColor || '#0078D4'
  // 读取已保存的材质配置
  widgetApi.getMaterial().then(result => {
    if (result?.material) {
      material.value = result.material
    }
  }).catch(() => {})
  // 读取已保存的胶囊模式
  systemApi.getSetting('widget_capsule_mode_enabled').then(({ value }) => {
    if (typeof value === 'string') {
      capsuleMode.value = value === 'true'
    }
  }).catch(() => {})
})
</script>

<style scoped lang="scss">
.step-appearance {
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

.appearance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--app-border, #ebeef5);

  &__label {
    font-size: 14px;
    font-weight: 500;
    color: var(--app-text-primary, #303133);
  }

  &__desc {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    margin-top: 4px;
  }

  &__info {
    display: flex;
    flex-direction: column;
  }
}

// 强调色选择器
.accent-selector {
  display: flex;
  align-items: center;
  gap: 12px;
}

.accent-presets {
  display: flex;
  gap: 6px;
}

.accent-preset {
  width: 28px;
  height: 28px;
  border: 2px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s, border-color 0.15s;

  &:hover {
    transform: scale(1.1);
  }

  &--active {
    border-color: var(--app-text-primary, #303133);
  }
}

// 实时预览
.appearance-preview {
  margin-top: 20px;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--app-border, #ebeef5);
  display: flex;
  align-items: center;
  gap: 12px;
  transition: background 0.3s;

  &--mica {
    background: rgba(250, 250, 250, 0.5);
  }

  &--acrylic {
    background: rgba(244, 244, 244, 0.8);
  }

  &--solid {
    background: #f8f8f8;
  }

  &__icon {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  &__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__item {
    width: 48px;
    height: 8px;
    border-radius: 4px;
  }

  &__line {
    height: 6px;
    border-radius: 3px;
    background: var(--app-text-secondary, #909399);
    opacity: 0.3;

    &--short {
      width: 60%;
    }
  }
}

// 暗色主题
html.dark {
  .appearance-preview {
    &--mica {
      background: rgba(28, 28, 28, 0.5);
    }

    &--acrylic {
      background: rgba(44, 44, 44, 0.8);
    }

    &--solid {
      background: #202020;
    }
  }
}
</style>