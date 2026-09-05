<!--
  引导步骤：热键与日常使用设置
  职责：全局热键开关与录制、搜索热键开关、开机自启开关
  - SetupStep4: 初始化热键/搜索热键/自启开关
  - BeginHotkeyRecording/EndHotkeyRecording: 热键录制
  - Step4HotkeyToggle_Toggled: 全局热键开关
  - Step4SearchHotkeyToggle_Toggled: 搜索热键开关
  - Step4StartupToggle_Toggled: 开机自启开关
  - StartKeycapPulse: 键帽脉冲动画
-->
<template>
  <div class="step-hotkey">
    <h3 class="step-title">热键与日常使用</h3>
    <p class="step-desc">配置全局热键快速唤出小部件，设置开机自启让 Starst Desk 常驻桌面。</p>

    <!-- 全局热键开关 -->
    <div class="hotkey-row">
      <div class="hotkey-row__info">
        <div class="hotkey-row__label">全局热键</div>
        <div class="hotkey-row__desc">按下热键快速切换所有小部件的显隐状态</div>
      </div>
      <el-switch v-model="hotkeyEnabled" @change="handleHotkeyToggle" />
    </div>

    <!-- 热键录制（仅当全局热键开启时显示） -->
    <div v-if="hotkeyEnabled" class="hotkey-record-row">
      <div class="hotkey-record-row__label">热键组合</div>
      <div class="hotkey-record-row__control">
        <div class="keycap" :class="{ 'keycap--pulse': hotkeyEnabled && !isRecording }">
          {{ isRecording ? '按下组合键...' : hotkeyDisplay }}
        </div>
        <el-button
          :type="isRecording ? 'warning' : 'default'"
          size="small"
          @click="toggleRecording"
        >
          {{ isRecording ? '取消' : '录制' }}
        </el-button>
      </div>
    </div>

    <!-- 搜索热键开关 -->
    <div class="hotkey-row">
      <div class="hotkey-row__info">
        <div class="hotkey-row__label">搜索热键</div>
        <div class="hotkey-row__desc">按下热键快速打开全局搜索</div>
      </div>
      <el-switch v-model="searchHotkeyEnabled" @change="handleSearchHotkeyToggle" />
    </div>

    <!-- 开机自启开关 -->
    <div class="hotkey-row">
      <div class="hotkey-row__info">
        <div class="hotkey-row__label">开机自启动</div>
        <div class="hotkey-row__desc">系统启动时自动运行 Starst Desk</div>
      </div>
      <el-switch
        v-model="autoStart"
        :loading="autoStartLoading"
        @change="handleAutoStartChange"
      />
    </div>

    <!-- 热键提示 -->
    <p v-if="hotkeyEnabled" class="step-tip">
      <el-icon><InfoFilled /></el-icon>
      按 Esc 取消录制，避免使用 Win+Space 等系统保留组合键
    </p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled } from '@element-plus/icons-vue'
import { useWidgetStore } from '@/stores/widget-store'
import { useAppStore } from '@/stores/app-store'
import { systemApi } from '@/utils/ipc-client'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({
      hotkeyEnabled: true,
      hotkey: 'Ctrl+Alt+D',
      searchHotkeyEnabled: false,
      autoStart: false
    })
  }
})

const emit = defineEmits(['update:modelValue'])

const widgetStore = useWidgetStore()
const appStore = useAppStore()

// 本地状态
const hotkeyEnabled = ref(props.modelValue.hotkeyEnabled !== false)
const hotkey = ref(props.modelValue.hotkey || 'Ctrl+Alt+D')
const searchHotkeyEnabled = ref(props.modelValue.searchHotkeyEnabled || false)
const autoStart = ref(props.modelValue.autoStart || false)
const autoStartLoading = ref(false)
const isRecording = ref(false)

// 热键显示文本
const hotkeyDisplay = computed(() => hotkey.value || 'Ctrl+Alt+D')

/**
 * 同步配置到父组件
 */
function syncToParent () {
  emit('update:modelValue', {
    hotkeyEnabled: hotkeyEnabled.value,
    hotkey: hotkey.value,
    searchHotkeyEnabled: searchHotkeyEnabled.value,
    autoStart: autoStart.value
  })
}

/**
 * 全局热键开关切换
 */
async function handleHotkeyToggle (val) {
  try {
    await systemApi.setSetting('global_hotkey_enabled', val ? 'true' : 'false')
  } catch (err) {
    ElMessage.error(`热键开关设置失败：${err.message}`)
  }
  syncToParent()
}

/**
 * 搜索热键开关切换
 */
async function handleSearchHotkeyToggle (val) {
  try {
    await systemApi.setSetting('search_hotkey_enabled', val ? 'true' : 'false')
  } catch (err) {
    ElMessage.error(`搜索热键开关设置失败：${err.message}`)
  }
  syncToParent()
}

/**
 * 开机自启切换
 */
async function handleAutoStartChange (val) {
  autoStartLoading.value = true
  try {
    await appStore.setAutoStart(val)
  } catch (err) {
    ElMessage.error(`开机自启设置失败：${err.message}`)
    autoStart.value = !val
  } finally {
    autoStartLoading.value = false
    syncToParent()
  }
}

/**
 * 切换录制状态
 */
function toggleRecording () {
  isRecording.value = !isRecording.value
  if (isRecording.value) {
    ElMessage.info('请按下组合键（如 Ctrl+Alt+D）')
  }
}

/**
 * 热键录制：捕获按键组合
 */
function handleKeydown (event) {
  if (!isRecording.value) return

  // Esc 取消录制
  if (event.key === 'Escape') {
    isRecording.value = false
    return
  }

  // 忽略单独的修饰键
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return

  const parts = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')

  // 转换主键为 Electron accelerator 格式
  let key = event.key.toUpperCase()
  if (key === ' ') key = 'Space'
  parts.push(key)

  hotkey.value = parts.join('+')
  isRecording.value = false
  applyHotkey()
}

/**
 * 应用热键配置
 */
async function applyHotkey () {
  try {
    await widgetStore.setHotkey(hotkey.value)
    ElMessage.success(`热键已设置为：${hotkey.value}`)
  } catch (err) {
    ElMessage.error(`热键设置失败：${err.message}`)
  }
  syncToParent()
}

// 全局键盘监听（录制期间）
onMounted(() => {
  window.addEventListener('keydown', handleKeydown, true)

  // 从 store 加载当前热键
  widgetStore.loadHotkey().then(() => {
    if (widgetStore.hotkey) {
      hotkey.value = widgetStore.hotkey
    }
  }).catch(() => {})

  // 读取热键开关状态
  systemApi.getSetting('global_hotkey_enabled').then(({ value }) => {
    if (typeof value === 'string') {
      hotkeyEnabled.value = value !== 'false'
    }
  }).catch(() => {})

  systemApi.getSetting('search_hotkey_enabled').then(({ value }) => {
    if (typeof value === 'string') {
      searchHotkeyEnabled.value = value === 'true'
    }
  }).catch(() => {})

  // 读取开机自启状态
  systemApi.getAutoStart().then(({ enabled }) => {
    autoStart.value = !!enabled
  }).catch(() => {})
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<style scoped lang="scss">
.step-hotkey {
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

  .step-tip {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 16px;
    font-size: 13px;
    color: var(--el-color-primary, #409eff);
  }
}

.hotkey-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--app-border, #ebeef5);

  &__info {
    display: flex;
    flex-direction: column;
  }

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
}

// 热键录制行
.hotkey-record-row {
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

  &__control {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 80px;
  padding: 6px 14px;
  border: 1px solid var(--app-border, #dcdfe6);
  border-radius: 6px;
  background: var(--app-bg-secondary, #f5f7fa);
  font-family: 'Segoe UI', monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-primary, #303133);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  transition: transform 0.15s;

  &--pulse {
    animation: keycap-pulse 1.5s ease-in-out infinite;
  }
}

@keyframes keycap-pulse {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

// 暗色主题
html.dark {
  .keycap {
    background: var(--app-bg-secondary, #262727);
  }
}
</style>