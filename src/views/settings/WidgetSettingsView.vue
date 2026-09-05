<!--
  桌面小部件设置页
  职责：
  - 小部件列表表格（类型、启用开关、折叠行为、胶囊形态开关、位置、大小、操作）
  - 外观设置卡片（主题、强调色、窗口材质、布局密度、动画预设）
  - 折叠与胶囊设置卡片（折叠行为、宽度模式、展开方向、内容模式、排列、隐私、动画效果）
  - 托盘设置卡片
  - 全局热键配置卡片
-->
<template>
  <div class="widget-settings-view">
    <!-- 顶部操作区 -->
    <div class="widget-settings-view__header">
      <div class="widget-settings-view__actions">
        <el-button type="primary" :icon="View" @click="handleShowAll">显示所有</el-button>
        <el-button :icon="Hide" @click="handleHideAll">隐藏所有</el-button>
        <el-button :icon="RefreshLeft" @click="handleResetAll">重置所有</el-button>
      </div>
    </div>

    <!-- 小部件列表（双栏卡片布局） -->
    <div class="widget-grid" v-loading="widgetStore.loading">
      <div
        v-for="row in filteredWidgets"
        :key="row.id || row.widget_type"
        class="widget-card"
        :class="{ 'is-enabled': isEnabled(row) }"
      >
        <!-- 卡片头部：图标+名称+启用开关 -->
        <div class="widget-card__header">
          <div class="widget-card__title">
            <el-icon class="widget-card__icon">
              <component :is="getWidgetIcon(row.widget_type)" />
            </el-icon>
            <span>{{ getWidgetTitle(row.widget_type) }}</span>
          </div>
          <el-switch
            :model-value="isEnabled(row)"
            @change="(val) => handleToggleEnabled(row, val)"
          />
        </div>

        <!-- 卡片内容：配置项 -->
        <div class="widget-card__body">
          <div class="widget-card__row">
            <span class="widget-card__label">折叠行为</span>
            <el-select
              :model-value="row.collapse_behavior || 'click'"
              size="small"
              style="width: 130px"
              @change="(val) => handleWidgetCollapseBehaviorChange(row, val)"
            >
              <el-option label="不折叠" value="expanded" />
              <el-option label="点击切换" value="click" />
              <el-option label="智能折叠" value="smart" />
            </el-select>
          </div>

          <!-- 胶囊形态 -->
          <div class="widget-card__row">
            <span class="widget-card__label">胶囊形态</span>
            <el-switch
              :model-value="isCapsule(row)"
              size="small"
              @change="(val) => handleToggleCapsule(row, val)"
            />
          </div>

          <!-- 位置与大小 -->
          <div class="widget-card__row">
            <span class="widget-card__label">位置</span>
            <span class="widget-card__value">{{ row.position_x }}, {{ row.position_y }}</span>
          </div>
          <div class="widget-card__row">
            <span class="widget-card__label">大小</span>
            <span class="widget-card__value">{{ row.width }} × {{ row.height }}</span>
          </div>
        </div>

        <!-- 卡片底部：操作 -->
        <div class="widget-card__footer">
          <el-button size="small" text :icon="RefreshLeft" @click="handleResetPosition(row)">
            重置位置
          </el-button>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!widgetStore.loading && filteredWidgets.length === 0" class="widget-grid__empty">
        暂无小部件配置
      </div>
    </div>

    <el-card class="appearance-card" shadow="never">
      <template #header>
        <div class="card-header">
          <el-icon><Brush /></el-icon>
          <span>外观设置</span>
        </div>
      </template>

      <!-- 主题选择 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">主题</div>
          <div class="setting-row__desc">选择应用界面主题，"跟随系统"将根据系统设置自动切换</div>
        </div>
        <div class="setting-row__control">
          <el-radio-group :model-value="appStore.theme" @change="handleThemeChange">
            <el-radio value="light">浅色</el-radio>
            <el-radio value="dark">深色</el-radio>
            <el-radio value="auto">跟随系统</el-radio>
          </el-radio-group>
        </div>
      </div>

      <!-- 强调色选择 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">强调色</div>
          <div class="setting-row__desc">选择界面强调色，也可点击色块选择预设颜色</div>
        </div>
        <div class="setting-row__control accent-control">
          <el-color-picker v-model="accentColor" @change="handleAccentColorChange" />
          <div class="accent-swatches">
            <button
              v-for="color in accentPresets"
              :key="color"
              type="button"
              class="accent-swatches__btn"
              :style="{ background: color }"
              :title="color"
              @click="handleAccentPresetClick(color)"
            />
          </div>
        </div>
      </div>

      <!-- 窗口材质选择（3种：默认/云母/亚克力） -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">窗口材质</div>
          <div class="setting-row__desc">选择窗口背景材质效果（云母/亚克力同时作用于小部件与主窗口标题栏，需 Windows 11 22H2+）</div>
        </div>
        <div class="setting-row__control">
          <el-radio-group v-model="material" @change="handleMaterialChange">
            <el-radio value="default">默认</el-radio>
            <el-radio value="mica">云母</el-radio>
            <el-radio value="acrylic">亚克力</el-radio>
          </el-radio-group>
        </div>
      </div>

      <!-- 布局密度 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">布局密度</div>
          <div class="setting-row__desc">控制界面元素的间距与紧凑程度</div>
        </div>
        <div class="setting-row__control">
          <el-radio-group v-model="layoutDensity" @change="handleLayoutDensityChange">
            <el-radio value="compact">紧凑</el-radio>
            <el-radio value="standard">标准</el-radio>
            <el-radio value="comfortable">舒适</el-radio>
          </el-radio-group>
        </div>
      </div>

      <!-- 动画预设 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">动画预设</div>
          <div class="setting-row__desc">控制界面过渡动画的速度</div>
        </div>
        <div class="setting-row__control">
          <el-radio-group v-model="animationPreset" @change="handleAnimationPresetChange">
            <el-radio value="none">无</el-radio>
            <el-radio value="fast">快</el-radio>
            <el-radio value="standard">标准</el-radio>
            <el-radio value="slow">慢</el-radio>
          </el-radio-group>
        </div>
      </div>
    </el-card>

    <el-card class="capsule-mode-card" shadow="never">
      <template #header>
        <div class="card-header">
          <el-icon><Connection /></el-icon>
          <span>折叠与胶囊设置</span>
        </div>
      </template>

      <!-- 折叠行为 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">折叠行为</div>
          <div class="setting-row__desc">控制小部件的折叠方式：不折叠 / 点击切换 / 智能折叠（鼠标离开自动折叠）</div>
        </div>
        <div class="setting-row__control">
          <el-select v-model="collapseBehavior" @change="handleCollapseBehaviorChange">
            <el-option label="不折叠" value="expanded" />
            <el-option label="点击切换" value="click" />
            <el-option label="智能折叠" value="smart" />
          </el-select>
        </div>
      </div>

      <!-- 宽度模式 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">宽度模式</div>
          <div class="setting-row__desc">胶囊形态下多小部件的宽度对齐策略</div>
        </div>
        <div class="setting-row__control">
          <el-select v-model="compactWidthMode" @change="handleCompactWidthModeChange">
            <el-option label="对齐" value="aligned" />
            <el-option label="独立" value="independent" />
          </el-select>
        </div>
      </div>

      <!-- 展开方向 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">展开方向</div>
          <div class="setting-row__desc">胶囊展开时内容面板的展开方向</div>
        </div>
        <div class="setting-row__control">
          <el-select v-model="compactExpansionDirection" @change="handleCompactExpansionDirectionChange">
            <el-option label="自动" value="auto" />
            <el-option label="向下" value="down" />
            <el-option label="向上" value="up" />
          </el-select>
        </div>
      </div>

      <!-- 紧凑内容模式 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">紧凑内容模式</div>
          <div class="setting-row__desc">胶囊形态下展示内容的详细程度</div>
        </div>
        <div class="setting-row__control">
          <el-select v-model="compactContentMode" @change="handleCompactContentModeChange">
            <el-option label="最小" value="minimal" />
            <el-option label="摘要" value="summary" />
            <el-option label="智能" value="smart" />
          </el-select>
        </div>
      </div>

      <!-- 胶囊排列 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">胶囊排列</div>
          <div class="setting-row__desc">多个胶囊小部件的排列方式</div>
        </div>
        <div class="setting-row__control">
          <el-select v-model="capsuleArrangement" @change="handleCapsuleArrangementChange">
            <el-option label="自由" value="free" />
            <el-option label="条形" value="bar" />
          </el-select>
        </div>
      </div>

      <!-- 隐私遮蔽开关 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">隐私遮蔽</div>
          <div class="setting-row__desc">折叠状态下遮蔽敏感内容，防止他人窥视</div>
        </div>
        <div class="setting-row__control">
          <el-switch v-model="compactHideSensitive" @change="handleCompactHideSensitiveChange" />
        </div>
      </div>

      <!-- 动画效果 -->
      <div class="setting-row">
        <div class="setting-row__info">
          <div class="setting-row__label">动画效果</div>
          <div class="setting-row__desc">胶囊展开/折叠的动画风格</div>
        </div>
        <div class="setting-row__control">
          <el-select v-model="compactAnimationEffect" @change="handleCompactAnimationEffectChange">
            <el-option label="干脆" value="snappy" />
            <el-option label="平滑" value="smooth" />
            <el-option label="慢" value="slow" />
            <el-option label="无" value="none" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </div>
      </div>
    </el-card>

    <!-- 托盘设置 -->
    <el-card class="tray-card" shadow="never">
      <template #header>
        <div class="card-header">
          <el-icon><SetUp /></el-icon>
          <span>托盘设置</span>
        </div>
      </template>
      <div class="setting-row setting-row--simple">
        <div class="setting-row__info">
          <div class="setting-row__label">点击托盘图标时显示主界面</div>
          <div class="setting-row__desc">关闭后，点击托盘图标仅切换小部件显隐，不弹出主界面</div>
        </div>
        <div class="setting-row__control">
          <el-switch v-model="trayClickShowMain" @change="handleTrayClickChange" />
        </div>
      </div>
    </el-card>

    <!-- 全局热键配置 -->
    <el-card class="hotkey-card" shadow="never">
      <template #header>
        <div class="card-header">
          <el-icon><Key /></el-icon>
          <span>全局热键</span>
        </div>
      </template>

      <div class="setting-row setting-row--simple">
        <div class="setting-row__info">
          <div class="setting-row__label">显示/隐藏所有小部件</div>
          <div class="setting-row__desc">按下热键快速切换所有小部件的显隐状态</div>
        </div>
        <div class="setting-row__control hotkey-control">
          <el-input
            v-model="hotkeyInput"
            placeholder="如 Ctrl+Alt+D"
            class="hotkey-control__input"
            :readonly="isRecording"
            @keydown.prevent="handleHotkeyKeydown"
          />
          <el-button
            :type="isRecording ? 'warning' : 'default'"
            @click="toggleRecording"
          >
            {{ isRecording ? '按下组合键...' : '录制' }}
          </el-button>
          <el-button type="primary" @click="handleSaveHotkey" :disabled="!hotkeyInput">
            应用
          </el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import {
  View, Hide, RefreshLeft, Key,
  EditPen, AlarmClock, FirstAidKit, List,
  Brush, SetUp, Connection,
  Folder, Edit, Sunny, Headset, Grid,
  Monitor, Picture, TrendCharts, Search, PriceTag, VideoPlay
} from '@element-plus/icons-vue'
import { useWidgetStore } from '@/stores/widget-store'
import { useAppStore } from '@/stores/app-store'
import { widgetApi, systemApi } from '@/utils/ipc-client'

// Store
const widgetStore = useWidgetStore()

// 过滤掉已废弃的小部件类型（已合并为其他功能，不再单独显示）
const filteredWidgets = computed(() => {
  const list = Array.isArray(widgetStore.widgets) ? widgetStore.widgets : []
  return list.filter(w => w.widget_type !== 'quick-capture' && w.widget_type !== 'tags')
})
const appStore = useAppStore()

// 热键输入与录制状态
const hotkeyInput = ref('')
const isRecording = ref(false)

// 窗口材质配置（default / mica / acrylic）
const material = ref('default')
// 托盘点击行为：是否在点击托盘时显示主界面
const trayClickShowMain = ref(true)

// 外观设置：强调色（预设色板 + 自定义）
const accentColor = ref('#0078D4')
const accentPresets = ['#0078D4', '#EF6950', '#2D7D46', '#8764B8', '#D83B01', '#038387']

// 外观设置：布局密度（compact / standard / comfortable）
const layoutDensity = ref('standard')
// 外观设置：动画预设（none / fast / standard / slow）
const animationPreset = ref('standard')

// 折叠与胶囊设置：折叠行为（system / smart / manual）
const collapseBehavior = ref('system')
// 折叠与胶囊设置：宽度模式（aligned / independent）
const compactWidthMode = ref('aligned')
// 折叠与胶囊设置：展开方向（auto / down / up）
const compactExpansionDirection = ref('auto')
// 折叠与胶囊设置：紧凑内容模式（minimal / summary / smart）
const compactContentMode = ref('minimal')
// 折叠与胶囊设置：胶囊排列（free / bar）
const capsuleArrangement = ref('free')
// 折叠与胶囊设置：隐私遮蔽开关
const compactHideSensitive = ref(false)
// 折叠与胶囊设置：动画效果（snappy / smooth / slow / none / custom）
const compactAnimationEffect = ref('smooth')

// 主题标签映射（用于切换提示）
const themeLabelMap = {
  light: '浅色',
  dark: '深色',
  auto: '跟随系统'
}

// 小部件类型 → 图标组件映射
const widgetIconMap = {
  note: EditPen,
  task: AlarmClock,
  health: FirstAidKit,
  todo: List,
  file: Folder,
  'quick-capture': Edit,
  weather: Sunny,
  music: Headset,
  'desktop-organizer': Grid,
  'system-monitor': Monitor,
  productivity: TrendCharts,
  search: Search,
  tags: PriceTag
}

// 小部件类型 → 标题映射
const widgetTitleMap = {
  note: '随记便笺',
  task: '任务',
  health: '健康',
  todo: '待办&规划',
  file: '文件',
  'quick-capture': '随记便笺',
  weather: '天气',
  music: '音乐',
  'desktop-organizer': '桌面整理',
  'system-monitor': '系统监控',
  productivity: '生产力',
  search: '搜索',
  tags: '标签'
}

// 小部件类型 → 默认位置/大小映射
const widgetDefaultBounds = {
  note: { x: 100, y: 100, width: 280, height: 360 },
  task: { x: 400, y: 100, width: 280, height: 400 },
  health: { x: 700, y: 100, width: 260, height: 320 },
  todo: { x: 1000, y: 100, width: 300, height: 400 },
  file: { x: 200, y: 200, width: 320, height: 400 },
  'quick-capture': { x: 550, y: 200, width: 300, height: 200 },
  weather: { x: 900, y: 200, width: 280, height: 380 },
  music: { x: 200, y: 500, width: 320, height: 180 },
  'desktop-organizer': { x: 600, y: 500, width: 360, height: 440 },
  'system-monitor': { x: 300, y: 200, width: 300, height: 360 },
  productivity: { x: 500, y: 100, width: 280, height: 400 },
  search: { x: 800, y: 100, width: 300, height: 420 },
  tags: { x: 1100, y: 100, width: 260, height: 360 }
}

/**
 * 获取小部件图标
 */
function getWidgetIcon (type) {
  return widgetIconMap[type] || EditPen
}

/**
 * 获取小部件标题
 */
function getWidgetTitle (type) {
  return widgetTitleMap[type] || type
}

/**
 * 判断小部件是否启用
 */
function isEnabled (widget) {
  return Number(widget.is_enabled) === 1
}

/**
 * 判断小部件是否为胶囊形态
 */
function isCapsule (widget) {
  return Number(widget.is_capsule) === 1
}

/**
 * 切换小部件启用状态
 */
async function handleToggleEnabled (widget, enabled) {
  try {
    await widgetStore.toggleWidget(widget.widget_type)
    ElMessage.success(enabled ? '小部件已启用' : '小部件已禁用')
  } catch (err) {
    ElMessage.error(`操作失败：${err.message}`)
  }
}

/**
 * 注意：el-select 的 model-value 绑定 row.collapse_behavior，更新失败时 row 不变，
 * Element Plus 会自动回退显示，无需手动处理。
 * 与全局 handleCollapseBehaviorChange 区分，此函数针对单个小部件卡片
 */
async function handleWidgetCollapseBehaviorChange (widget, behavior) {
  try {
    // 调用 store 更新，store 内部会用 splice 触发响应式并合并 data 字段兜底
    await widgetStore.updateWidget({
      widget_type: widget.widget_type,
      collapse_behavior: behavior
    })
    ElMessage.success('折叠行为已更新')
  } catch (err) {
    // 更新失败：row.collapse_behavior 未变，el-select 自动回退到原值
    ElMessage.error(`更新失败：${err.message}`)
  }
}

/**
 * 切换胶囊形态（关键修复：让用户能在设置页直接切换胶囊形态）
 * 调用 widgetStore.setCapsule → 主进程调整窗口尺寸
 */
async function handleToggleCapsule (widget, val) {
  try {
    await widgetStore.setCapsule(widget.widget_type, val)
    ElMessage.success(val ? '已切换为胶囊形态' : '已切换为常规形态')
  } catch (err) {
    ElMessage.error(`操作失败：${err.message}`)
  }
}

/**
 * 重置小部件位置到默认值
 */
async function handleResetPosition (widget) {
  const defaultBounds = widgetDefaultBounds[widget.widget_type]
  if (!defaultBounds) {
    ElMessage.warning('未知的小部件类型')
    return
  }
  try {
    await widgetStore.resetPosition(widget.widget_type, defaultBounds)
    ElMessage.success('位置已重置')
  } catch (err) {
    ElMessage.error(`重置失败：${err.message}`)
  }
}

/**
 * 显示所有小部件
 */
async function handleShowAll () {
  try {
    await widgetStore.showAll()
    ElMessage.success('已显示所有小部件')
  } catch (err) {
    ElMessage.error(`操作失败：${err.message}`)
  }
}

/**
 * 隐藏所有小部件
 */
async function handleHideAll () {
  try {
    await widgetStore.hideAll()
    ElMessage.success('已隐藏所有小部件')
  } catch (err) {
    ElMessage.error(`操作失败：${err.message}`)
  }
}

/**
 * 重置所有小部件（位置、尺寸、胶囊状态、锁定状态）
 */
async function handleResetAll () {
  try {
    await widgetApi.resetAll()
    ElMessage.success('已重置所有小部件')
    // 刷新小部件列表
    await widgetStore.loadWidgets()
  } catch (err) {
    console.error('[WidgetSettingsView] 重置所有失败:', err)
    ElMessage.error(`重置失败：${err.message}`)
  }
}

/**
 * 切换热键录制状态
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
function handleHotkeyKeydown (event) {
  if (!isRecording.value) return

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
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)

  hotkeyInput.value = parts.join('+')
  isRecording.value = false
}

/**
 * 保存热键配置
 */
async function handleSaveHotkey () {
  if (!hotkeyInput.value) {
    ElMessage.warning('请先输入或录制热键')
    return
  }
  try {
    await widgetStore.setHotkey(hotkeyInput.value)
    ElMessage.success(`热键已设置为：${hotkeyInput.value}`)
  } catch (err) {
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 切换窗口材质
 */
async function handleMaterialChange (val) {
  try {
    await widgetApi.setMaterial(val)
    ElMessage.success(`窗口材质已切换为：${val}`)
  } catch (err) {
    ElMessage.error(`材质切换失败：${err.message}`)
    // 失败时回退到当前配置
    try {
      const result = await widgetApi.getMaterial()
      material.value = result?.material || 'default'
    } catch (e) { /* 忽略 */ }
  }
}

/**
 * 切换"点击托盘显示主界面"开关
 */
async function handleTrayClickChange (val) {
  try {
    await systemApi.setSetting('tray_click_show_main', val ? 'true' : 'false')
    ElMessage.success(val ? '已开启点击托盘显示主界面' : '已关闭点击托盘显示主界面')
  } catch (err) {
    ElMessage.error(`设置失败：${err.message}`)
    // 失败时回退
    trayClickShowMain.value = !val
  }
}

/**
 * 切换主题
 */
async function handleThemeChange (val) {
  try {
    await appStore.setTheme(val)
    ElMessage.success(`主题已切换为：${themeLabelMap[val] || val}`)
  } catch (err) {
    ElMessage.error(`主题切换失败：${err.message}`)
  }
}

/**
 * 强调色变化（el-color-picker 自定义颜色）
 * 通过 appStore.setAccentColor 统一处理持久化与 DOM 应用
 * 主进程会向所有小部件窗口广播 app:setting-changed 事件
 */
async function handleAccentColorChange (val) {
  if (!val) return
  try {
    await appStore.setAccentColor(val)
    ElMessage.success(`强调色已设置为：${val}`)
  } catch (err) {
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 强调色预设色板点击
 */
async function handleAccentPresetClick (color) {
  accentColor.value = color
  await handleAccentColorChange(color)
}

/**
 * 通用设置持久化辅助函数
 * @param {string} key 设置键名
 * @param {string} value 设置值
 * @param {string} label 设置项标签（用于成功提示）
 */
async function persistSetting (key, value, label) {
  try {
    await systemApi.setSetting(key, value)
    ElMessage.success(`${label}已更新`)
  } catch (err) {
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 布局密度变化
 */
function handleLayoutDensityChange (val) {
  return persistSetting('layout_density', val, '布局密度')
}

/**
 * 动画预设变化
 */
function handleAnimationPresetChange (val) {
  return persistSetting('animation_preset', val, '动画预设')
}

/**
 * 折叠行为变化
 */
async function handleCollapseBehaviorChange (val) {
  try {
    await persistSetting('collapse_behavior', val, '折叠行为')
    // 广播折叠行为变化事件
    window.dispatchEvent(new CustomEvent('widget:collapse-behavior-changed', { detail: { behavior: val } }))
  } catch (err) {
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 宽度模式变化
 */
function handleCompactWidthModeChange (val) {
  return persistSetting('compact_width_mode', val, '宽度模式')
}

/**
 * 展开方向变化
 */
function handleCompactExpansionDirectionChange (val) {
  return persistSetting('compact_expansion_direction', val, '展开方向')
}

/**
 * 紧凑内容模式变化
 */
function handleCompactContentModeChange (val) {
  return persistSetting('compact_content_mode', val, '紧凑内容模式')
}

/**
 * 胶囊排列变化
 */
function handleCapsuleArrangementChange (val) {
  return persistSetting('capsule_arrangement', val, '胶囊排列')
}

/**
 * 隐私遮蔽开关变化
 */
async function handleCompactHideSensitiveChange (val) {
  try {
    await systemApi.setSetting('compact_hide_sensitive', val ? 'true' : 'false')
    ElMessage.success(val ? '已开启隐私遮蔽' : '已关闭隐私遮蔽')
  } catch (err) {
    ElMessage.error(`设置失败：${err.message}`)
    // 失败时回退
    compactHideSensitive.value = !val
  }
}

/**
 * 胶囊动画效果变化
 */
function handleCompactAnimationEffectChange (val) {
  return persistSetting('compact_animation_effect', val, '动画效果')
}

/**
 * 通用设置加载辅助函数
 * @param {string} key 设置键名
 * @param {any} defaultValue 默认值
 * @returns {Promise<any>}
 */
async function loadSetting (key, defaultValue) {
  try {
    const result = await systemApi.getSetting(key)
    const value = result?.value
    if (value === null || value === undefined) return defaultValue
    return value
  } catch (err) {
    console.warn(`[WidgetSettings] 加载 ${key} 失败:`, err.message)
    return defaultValue
  }
}

/**
 * 初始化：加载小部件列表、热键配置、材质配置、外观与折叠与胶囊设置
 */
onMounted(async () => {
  await widgetStore.loadWidgets()
  await widgetStore.loadHotkey()
  hotkeyInput.value = widgetStore.hotkey

  // 加载窗口材质配置
  try {
    const result = await widgetApi.getMaterial()
    material.value = result?.material || 'default'
  } catch (err) {
    // 加载失败使用默认值
    console.warn('[WidgetSettings] 加载材质配置失败:', err.message)
  }

  // 加载托盘点击行为设置
  trayClickShowMain.value = await loadSetting('tray_click_show_main', 'true') !== 'false'

  // 加载外观设置
  accentColor.value = await loadSetting('accent_color', '#0078D4')
  layoutDensity.value = await loadSetting('layout_density', 'standard')
  animationPreset.value = await loadSetting('animation_preset', 'standard')

  // 加载折叠与胶囊设置
  collapseBehavior.value = await loadSetting('collapse_behavior', 'click')
  compactWidthMode.value = await loadSetting('compact_width_mode', 'aligned')
  compactExpansionDirection.value = await loadSetting('compact_expansion_direction', 'auto')
  compactContentMode.value = await loadSetting('compact_content_mode', 'minimal')
  capsuleArrangement.value = await loadSetting('capsule_arrangement', 'free')
  compactHideSensitive.value = await loadSetting('compact_hide_sensitive', 'false') !== 'false'
  compactAnimationEffect.value = await loadSetting('compact_animation_effect', 'smooth')
})
</script>

<style scoped lang="scss">
.widget-settings-view {
  padding: 8px 0;

  &__header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 16px;

    .widget-settings-view__actions {
      display: flex;
      gap: 8px;
    }
  }
}

// 小部件四栏卡片网格
.widget-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;

  &__empty {
    grid-column: span 4;
    text-align: center;
    padding: 32px;
    color: var(--app-text-secondary, #909399);
    font-size: 14px;
  }
}

// 小部件卡片
.widget-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;

  &:hover {
    border-color: var(--el-color-primary, #409eff);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  &.is-enabled {
    border-left: 3px solid var(--el-color-primary, #409eff);
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--el-fill-color-light, #f5f7fa);
  }

  &__title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    color: var(--app-text-primary, #303133);
  }

  &__icon {
    font-size: 16px;
    color: var(--app-text-secondary, #909399);
  }

  &__body {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__label {
    font-size: 12px;
    color: var(--app-text-secondary, #909399);
    flex-shrink: 0;
  }

  &__value {
    font-size: 12px;
    color: var(--app-text-primary, #303133);
    font-variant-numeric: tabular-nums;
  }

  &__footer {
    padding: 6px 14px;
    border-top: 1px solid var(--el-border-color-lighter, #ebeef5);
    display: flex;
    justify-content: flex-end;
  }
}

// 卡片通用头部
.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
}

// 通用设置行：左侧标题+描述，右侧控件
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 0;

  // 行间分隔线（简单模式不分隔）
  & + .setting-row:not(.setting-row--simple) {
    border-top: 1px solid var(--el-border-color-lighter, #ebeef5);
  }

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
    gap: 8px;

    // 统一下拉框宽度，避免撑满控制区
    :deep(.el-select) {
      width: 180px;
    }
  }
}

// 强调色控件区域
.accent-control {
  gap: 12px;
}

// 强调色预设色板
.accent-swatches {
  display: flex;
  gap: 6px;

  &__btn {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.1);
    cursor: pointer;
    padding: 0;
    transition: transform 0.15s ease;

    &:hover {
      transform: scale(1.15);
    }

    &:focus {
      outline: 2px solid var(--el-color-primary, #409eff);
      outline-offset: 2px;
    }
  }
}

// 热键控件区域
.hotkey-control {
  &__input {
    width: 180px;
  }
}

// 各卡片统一样式：间距 20px，圆角 8px
.appearance-card,
.capsule-mode-card,
.tray-card,
.hotkey-card {
  margin-top: 20px;
  border-radius: 8px;
}

// 外观设置卡片：按钮组（el-radio-group）统一对齐
// 确保所有按钮组在设置行中垂直居中，按钮组内部按钮均匀分布
.appearance-card {
  .setting-row__control {
    // 按钮组在控件区域内垂直居中（已在 .setting-row 中设置 align-items: center）
    // 这里确保按钮组内部按钮均匀分布，视觉居中
    :deep(.el-radio-group) {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      // 按钮组内按钮间距适中，避免拥挤
      .el-radio {
        margin-right: 20px;
      }
    }
  }
}

// 暗色模式适配
html.dark .widget-settings-view {
  // 四栏网格空状态
  .widget-grid__empty {
    color: #a3a6ad;
  }

  // 小部件卡片暗色覆盖
  .widget-card {
    border-color: #414243;

    &:hover {
      border-color: var(--el-color-primary);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    &__header {
      background: #1d1e1f;
    }

    &__title {
      color: #e5eaf3;
    }

    &__icon {
      color: #a3a6ad;
    }

    &__label {
      color: #a3a6ad;
    }

    &__value {
      color: #cfd3dc;
    }

    &__footer {
      border-top-color: #414243;
    }
  }

  // 设置行文字
  .setting-row__label {
    color: #e5eaf3;
  }

  .setting-row__desc {
    color: #a3a6ad;
  }

  // 设置行分隔线
  .setting-row + .setting-row:not(.setting-row--simple) {
    border-top-color: #414243;
  }

  // 暗色模式下色板边框调整
  .accent-swatches__btn {
    border-color: rgba(255, 255, 255, 0.15);
  }
}
</style>
