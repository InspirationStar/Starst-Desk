<!--
  灵动岛配置视图
  职责：管理灵动岛窗口外观配置（缩放、透明度、锚点位置、偏移、层级、自动隐藏时长）
  修改后即时保存并应用，无需手动点击保存按钮
-->
<template>
  <div class="island-settings-view">
    <div class="page-header">
      <h2 class="page-title">灵动岛配置</h2>
      <p class="page-subtitle">调整灵动岛窗口的外观与位置参数，修改后自动保存并实时应用</p>
    </div>

    <!-- 实时预览：加载实际灵动岛 UI，对应查看修改效果 -->
    <el-card class="preview-card" shadow="never">
      <template #header>
        <div class="preview-header">
          <span>实时预览</span>
          <span class="preview-hint">下方为灵动岛实际卡片，缩放/透明度实时反映</span>
        </div>
      </template>
      <div class="island-preview-stage">
        <div class="island-preview" :style="previewStyle">
          <IslandHealthReminder
            type="health"
            title="久坐伸展提醒"
            body="已坐 45 分钟，起身活动一下 🤸"
            :extra-data="{ moduleType: 'sedentary' }"
            @action="() => {}"
            @dismiss="() => {}"
          />
        </div>
      </div>
    </el-card>

    <el-card class="settings-card" shadow="never">
      <!-- 缩放比例 -->
      <div class="settings-row">
        <div class="settings-row__info">
          <div class="settings-row__label">缩放比例</div>
          <div class="settings-row__desc">调整灵动岛窗口大小，范围 0.8 - 1.5</div>
        </div>
        <div class="settings-row__control">
          <el-slider
            v-model="islandPrefs.islandScale"
            :min="0.8"
            :max="1.5"
            :step="0.1"
            show-stops
            @change="handleAutoSave"
          />
        </div>
      </div>

      <el-divider />

      <!-- 透明度 -->
      <div class="settings-row">
        <div class="settings-row__info">
          <div class="settings-row__label">透明度</div>
          <div class="settings-row__desc">调整灵动岛窗口透明度，范围 0.5 - 1.0</div>
        </div>
        <div class="settings-row__control">
          <el-slider
            v-model="islandPrefs.islandOpacity"
            :min="0.5"
            :max="1.0"
            :step="0.1"
            show-stops
            @change="handleAutoSave"
          />
        </div>
      </div>

      <el-divider />

      <!-- 锚点位置 -->
      <div class="settings-row">
        <div class="settings-row__info">
          <div class="settings-row__label">锚点位置</div>
          <div class="settings-row__desc">灵动岛在屏幕顶部的对齐位置</div>
        </div>
        <div class="settings-row__control">
          <el-radio-group v-model="islandPrefs.islandAnchor" @change="handleAutoSave">
            <el-radio value="top_center">顶部居中</el-radio>
            <el-radio value="top_left">左上角</el-radio>
            <el-radio value="top_right">右上角</el-radio>
          </el-radio-group>
        </div>
      </div>

      <el-divider />

      <!-- 水平偏移 -->
      <div class="settings-row">
        <div class="settings-row__info">
          <div class="settings-row__label">水平偏移</div>
          <div class="settings-row__desc">相对锚点的水平偏移量（像素），范围 -200 到 200</div>
        </div>
        <div class="settings-row__control">
          <el-input-number
            v-model="islandPrefs.islandOffsetX"
            :min="-200"
            :max="200"
            :step="1"
            controls-position="right"
            @change="handleAutoSave"
          />
        </div>
      </div>

      <el-divider />

      <!-- 垂直偏移 -->
      <div class="settings-row">
        <div class="settings-row__info">
          <div class="settings-row__label">垂直偏移</div>
          <div class="settings-row__desc">距屏幕顶部的垂直距离（像素），范围 0 到 200</div>
        </div>
        <div class="settings-row__control">
          <el-input-number
            v-model="islandPrefs.islandOffsetY"
            :min="0"
            :max="200"
            :step="1"
            controls-position="right"
            @change="handleAutoSave"
          />
        </div>
      </div>

      <el-divider />

      <!-- 层级 -->
      <div class="settings-row">
        <div class="settings-row__info">
          <div class="settings-row__label">窗口层级</div>
          <div class="settings-row__desc">置顶显示在最上层，普通层级可被其他窗口遮挡</div>
        </div>
        <div class="settings-row__control">
          <el-switch
            v-model="islandLayerTop"
            active-text="置顶"
            inactive-text="普通"
            @change="handleAutoSave"
          />
        </div>
      </div>

      <el-divider />

      <!-- 自动隐藏时长 -->
      <div class="settings-row">
        <div class="settings-row__info">
          <div class="settings-row__label">自动隐藏时长</div>
          <div class="settings-row__desc">灵动岛显示后自动隐藏的时长（毫秒），0 表示不自动隐藏</div>
        </div>
        <div class="settings-row__control">
          <el-input-number
            v-model="islandPrefs.islandDuration"
            :min="0"
            :max="30000"
            :step="1000"
            controls-position="right"
            @change="handleAutoSave"
          />
        </div>
      </div>
    </el-card>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { islandApi } from '@/utils/ipc-client'
import IslandHealthReminder from '@/components/island/IslandHealthReminder.vue'
// 引入灵动岛主题变量定义：实时预览走主应用链路（main.js 仅加载 global.scss，未加载 island.scss），
//   不引入则 --island-card-bg/border/shadow 未定义，卡片背景/边框/阴影全部失效变透明
import '@/assets/styles/island.scss'

const logger = { warn: (module, msg) => console.warn(`[${module}]`, msg) }

// 灵动岛外观配置
const islandPrefs = ref({
  islandScale: 1.0,
  islandOpacity: 1.0,
  islandAnchor: 'top_center',
  islandOffsetX: 0,
  islandOffsetY: 8,
  islandLayer: 'top',
  islandDuration: 5000
})
// 层级开关绑定：islandLayer 'top'/'normal' ↔ boolean
const islandLayerTop = computed({
  get: () => islandPrefs.value.islandLayer === 'top',
  set: (val) => { islandPrefs.value.islandLayer = val ? 'top' : 'normal' }
})

// 预览区样式：缩放 + 透明度实时反映
const previewStyle = computed(() => ({
  transform: `scale(${islandPrefs.value.islandScale})`,
  opacity: islandPrefs.value.islandOpacity,
  transformOrigin: 'top center'
}))

// 防抖保存定时器
let saveTimer = null

onMounted(async () => {
  await loadIslandPrefs()
})

/**
 * 加载灵动岛外观配置
 */
async function loadIslandPrefs () {
  try {
    const prefs = await islandApi.getPreferences()
    if (prefs && typeof prefs === 'object') {
      islandPrefs.value = { ...islandPrefs.value, ...prefs }
    }
  } catch (err) {
    logger.warn('IslandSettingsView', `加载灵动岛配置失败: ${err.message}`)
  }
}

/**
 * 自动保存（防抖 300ms）
 */
function handleAutoSave () {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(async () => {
    saveTimer = null
    try {
      await islandApi.updatePreferences({ ...islandPrefs.value })
    } catch (err) {
      logger.warn('IslandSettingsView', `自动保存失败: ${err.message}`)
    }
  }, 300)
}

// 组件卸载时若仍有未触发的防抖保存，立即 flush 落库，避免切换页面丢失修改
onUnmounted(() => {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
    islandApi.updatePreferences({ ...islandPrefs.value }).catch(err => {
      logger.warn('IslandSettingsView', `卸载时保存失败: ${err.message}`)
    })
  }
})
</script>

<style scoped lang="scss">
.island-settings-view {
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 16px;

  .page-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--app-text-primary, #303133);
    margin: 0 0 4px;
  }

  .page-subtitle {
    font-size: 13px;
    color: var(--app-text-secondary, #909399);
    margin: 0;
  }
}

.settings-card {
  border-radius: 8px;
}

.preview-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

.preview-header {
  display: flex;
  align-items: baseline;
  gap: 12px;

  .preview-hint {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
  }
}

// 预览舞台：固定高度区域，卡片缩放后居中显示，避免溢出影响布局
.island-preview-stage {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 160px;
  padding: 16px 0;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
}

.island-preview {
  width: 400px;
  max-width: 100%;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 8px 0;

  &__info {
    flex: 1;
    min-width: 0;
  }

  &__label {
    font-size: 14px;
    font-weight: 500;
    color: var(--app-text-primary, #303133);
    margin-bottom: 4px;
  }

  &__desc {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    line-height: 1.5;
  }

  &__control {
    flex-shrink: 0;
    width: 320px;
    max-width: 320px;
    display: flex;
    align-items: center;
    justify-content: flex-end;

    // 滑杆撑满控件区域，防止在 flex 布局中因 width:100% 循环依赖而显示异常
    .el-slider {
      width: 100%;
    }
  }
}

// ============================================================
// 暗色模式适配
// --app-text-secondary 未在暗色下定义，回退值 #909399 在暗色背景下可读性差
// 此处显式覆盖为全局暗色配色方案的次要文字色
// ============================================================
html.dark .island-settings-view {
  .page-title {
    color: #e5eaf3;
  }

  .page-subtitle {
    color: #a3a6ad;
  }

  .settings-row__label {
    color: #e5eaf3;
  }

  .settings-row__desc {
    color: #a3a6ad;
  }

  .island-preview-stage {
    background: rgba(255, 255, 255, 0.04);
  }
}
</style>
