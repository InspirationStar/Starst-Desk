<!--
  天气格子组件
  功能：
  - 显示当前天气状况
  - 逐小时和多日预报
  - 城市搜索切换
  - 主题皮肤切换
  - 日/周视图切换
  - 胶囊形态支持
-->
<template>
  <div class="weather-widget" :class="[`skin-${weatherStore.skin}`, `view-${weatherStore.viewMode}`]">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="weather"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态 -->
      <template #capsule>
        <div class="weather-capsule">
          <el-icon class="weather-capsule__icon">
            <component :is="weatherStore.currentWeatherIcon" />
          </el-icon>
          <span class="weather-capsule__temp">{{ weatherStore.temperatureDisplay }}</span>
          <span class="weather-capsule__city">{{ weatherStore.currentCity }}</span>
        </div>
      </template>

      <!-- 展开形态 -->
      <template #expanded>
        <widget-header
          title="天气"
          :icon="WeatherSun"
          :is-capsule="isCapsule"
          :is-position-locked="isPositionLocked"
          :is-size-locked="isSizeLocked"
          :is-always-on-top="isAlwaysOnTop"
          :display-name="displayName"
          :collapse-behavior="collapseBehavior"
          :has-group="hasGroup"
          :chrome-mode="chromeMode"
          @toggle-capsule="handleToggleCapsule"
          @close="handleClose"
          @toggle-position-lock="handleTogglePositionLock"
          @toggle-size-lock="handleToggleSizeLock"
          @reset-position="handleResetPosition"
          @toggle-always-on-top="handleToggleAlwaysOnTop"
          @rename="handleRename"
          @change-collapse-behavior="handleChangeCollapseBehavior"
          @change-chrome-mode="handleChangeChromeMode"
          @group-merge="handleGroupMerge"
          @group-detach="handleGroupDetach"
          @group-dissolve="handleGroupDissolve"
          @open-settings="handleOpenSettings"
          @disable="handleDisable"
        >
          <template #actions>
            <!-- 单位切换 -->
            <el-button class="weather-header-btn" @click="weatherStore.toggleUnits">
              {{ weatherStore.units === 'metric' ? '°C' : '°F' }}
            </el-button>
            <!-- 视图切换 -->
            <el-button class="weather-header-btn" @click="toggleViewMode">
              {{ weatherStore.viewMode === 'day' ? '日' : '周' }}
            </el-button>
          </template>
        </widget-header>

        <!-- 城市搜索 -->
        <div class="weather-search">
          <el-input
            v-model="searchQuery"
            placeholder="搜索城市..."
            clearable
            @input="handleSearchCity"
            @change="handleSelectCity"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <!-- 城市建议列表 -->
          <div v-if="citySuggestions.length > 0" class="city-suggestions win11-scrollbar">
            <div
              v-for="city in citySuggestions"
              :key="city.id"
              class="city-suggestion-item"
              @click="selectCity(city)"
            >
              <span class="city-name">{{ city.name }}</span>
              <span class="city-country">{{ city.country }}</span>
            </div>
          </div>
        </div>

        <!-- 当前天气 -->
        <div class="weather-current">
          <div class="weather-current__main">
            <el-icon class="weather-current__icon" size="64">
              <component :is="weatherStore.currentWeatherIcon" />
            </el-icon>
            <div class="weather-current__temp">
              <span class="temp-value">{{ weatherStore.temperatureDisplay }}</span>
              <span class="temp-label">实时</span>
            </div>
          </div>
          <div class="weather-current__details">
            <div class="detail-item">
              <span class="detail-label">体感</span>
              <span class="detail-value">{{ weatherStore.feelsLikeDisplay }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">湿度</span>
              <span class="detail-value">{{ weatherStore.humidityDisplay }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">风速</span>
              <span class="detail-value">{{ weatherStore.windDisplay }}</span>
            </div>
          </div>
        </div>

        <!-- 预报切换 -->
        <div class="weather-forecast-tabs">
          <el-button
            :type="weatherStore.viewMode === 'day' ? 'primary' : ''"
            size="small"
            @click="weatherStore.setViewMode('day')"
          >
            逐小时
          </el-button>
          <el-button
            :type="weatherStore.viewMode === 'week' ? 'primary' : ''"
            size="small"
            @click="weatherStore.setViewMode('week')"
          >
            多日
          </el-button>
        </div>

        <!-- 逐小时预报 -->
        <div v-if="weatherStore.viewMode === 'day'" class="weather-hourly win11-scrollbar">
          <div
            v-for="(hour, index) in weatherStore.hourlyForecast"
            :key="index"
            class="hourly-item"
          >
            <span class="hourly-time">{{ formatHourTime(hour.time) }}</span>
            <el-icon class="hourly-icon">
              <component :is="getWeatherIcon(hour.condition)" />
            </el-icon>
            <span class="hourly-temp">{{ Math.round(hour.temperature) }}°</span>
          </div>
        </div>

        <!-- 多日预报 -->
        <div v-if="weatherStore.viewMode === 'week'" class="weather-daily win11-scrollbar">
          <div
            v-for="(day, index) in weatherStore.dailyForecast"
            :key="index"
            class="daily-item"
          >
            <span class="daily-day">{{ day.dateFormatted }}</span>
            <el-icon class="daily-icon">
              <component :is="getWeatherIcon(day.condition)" />
            </el-icon>
            <span class="daily-temp-high">{{ Math.round(day.high) }}°</span>
            <span class="daily-temp-low">{{ Math.round(day.low) }}°</span>
          </div>
        </div>
      </template>
    </capsule-container>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import { Sunny as WeatherSun, Search } from '@element-plus/icons-vue'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'
import { weatherApi, widgetApi, on } from '@/utils/ipc-client'
import { useWeatherStore } from '@/stores/weather-store'

// 头部按钮操作（位置锁/大小锁/重置位置/置顶）
const {
  isPositionLocked,
  isSizeLocked,
  isAlwaysOnTop,
  displayName,
  hasGroup,
  chromeMode,
  handleTogglePositionLock,
  handleToggleSizeLock,
  handleResetPosition,
  handleToggleAlwaysOnTop,
  handleRename,
  handleChangeCollapseBehavior,
  handleChangeChromeMode,
  handleGroupMerge,
  handleGroupDetach,
  handleGroupDissolve,
  handleOpenSettings,
  handleDisable,
  loadLockState,
  loadGroupState,
  subscribeLocksChanged,
  cleanupLocks
} = useWidgetHeaderActions('weather')

const weatherStore = useWeatherStore()

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
const contentMode = ref('summary')

// 搜索相关
const searchQuery = ref('')
const citySuggestions = ref([])
let searchTimeout = null

/**
 * 搜索城市
 */
async function handleSearchCity () {
  clearTimeout(searchTimeout)
  if (!searchQuery.value.trim()) {
    citySuggestions.value = []
    return
  }

  searchTimeout = setTimeout(async () => {
    try {
      const result = await weatherApi.searchCities(searchQuery.value)
      citySuggestions.value = result.cities || []
    } catch (err) {
      console.error('[WeatherWidget] 搜索城市失败:', err)
    }
  }, 300)
}

/**
 * 选择城市
 */
async function selectCity (city) {
  searchQuery.value = city.name
  citySuggestions.value = []
  await weatherStore.switchCity(city.name)
}

/**
 * 选择城市（Enter 键或失焦时触发）
 * 如果有建议列表，选择第一个；否则用搜索文本作为城市名
 */
async function handleSelectCity () {
  if (citySuggestions.value.length > 0) {
    await selectCity(citySuggestions.value[0])
  } else if (searchQuery.value.trim()) {
    citySuggestions.value = []
    await weatherStore.switchCity(searchQuery.value.trim())
  }
}

/**
 * 格式化逐小时时间显示
 * 将 ISO 8601 格式（如 2026-08-28T15:02:00.046Z）转为友好的 HH:mm 格式
 */
function formatHourTime (time) {
  if (!time) return ''
  const d = dayjs(time)
  return d.isValid() ? d.format('HH:mm') : time
}

/**
 * 切换视图模式
 */
function toggleViewMode () {
  weatherStore.setViewMode(weatherStore.viewMode === 'day' ? 'week' : 'day')
}

/**
 * 获取天气图标
 */
function getWeatherIcon (condition) {
  const icons = {
    'clear': 'WeatherSun',
    'partly-cloudy': 'Cloudy',
    'cloudy': 'Cloud',
    'rain': 'Rainbow',
    'snow': 'Snowflake',
    'thunder': 'Lightning',
    'fog': 'WeatherFog'
  }
  return icons[condition] || 'WeatherSun'
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  if (typeof newCapsule !== 'boolean') return
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('weather', newCapsule)
  } catch (err) {
    console.error('[WeatherWidget] 切换胶囊失败:', err.message)
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('weather')
  } catch (err) {
    console.error('[WeatherWidget] 隐藏失败:', err.message)
  }
}

onMounted(async () => {
  try {
    await weatherStore.loadWeather('Beijing')
  } catch (err) {
    console.error('[WeatherWidget] 加载天气失败:', err)
  }
  // 加载锁状态并订阅锁变化广播
  await loadLockState()
  await loadGroupState()
  try {
    subscribeLocksChanged()
  } catch (err) {
    // 忽略监听注册失败
  }

  // 加载小部件配置
  try {
    const config = await widgetApi.get('weather')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      // 读取折叠行为
      if (config.collapse_behavior) {
        collapseBehavior.value = config.collapse_behavior
      }
    }
  } catch (err) {
    console.warn('[WeatherWidget] 加载配置失败:', err.message)
  }
})

onBeforeUnmount(() => {
  cleanupLocks()
  if (searchTimeout) clearTimeout(searchTimeout)
})
</script>

<style scoped lang="scss">
// ============================================================
// ============================================================

.weather-widget {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--widget-text, #1A1A1A);
  border-radius: var(--widget-radius-large, 8px);
  overflow: hidden;
}

// ============================================================
// 胶囊形态
// ============================================================
.weather-capsule {
  display: flex;
  align-items: center;
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  gap: var(--widget-spacing-sm, 8px);

  &__icon {
    font-size: 24px;
    color: var(--widget-accent, #0067C0);
  }

  &__temp {
    font-size: var(--widget-font-title, 14px);
    font-weight: 600;
    color: var(--widget-text, #1A1A1A);
  }

  &__city {
    font-size: var(--widget-font-caption, 12px);
    color: var(--widget-text-secondary, #5A5A5A);
  }
}

// ============================================================
// 城市搜索
// ============================================================
.weather-search {
  position: relative;
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  border-bottom: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
}

.city-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--widget-overlay-surface, #FBFCFD);
  border: 1px solid var(--widget-overlay-stroke, rgba(0, 0, 0, 0.14));
  border-radius: var(--widget-radius-medium, 6px);
  margin-top: 4px;
  max-height: 200px;
  z-index: 100;
}

html.dark .city-suggestions {
  background: var(--widget-overlay-surface, #2A3038);
  border-color: var(--widget-overlay-stroke, rgba(255, 255, 255, 0.32));
}

.city-suggestion-item {
  display: flex;
  justify-content: space-between;
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  cursor: pointer;
  transition: background var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }
}

html.dark .city-suggestion-item:hover {
  background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
}

.city-name {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text, #1A1A1A);
}

.city-country {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
}

// ============================================================
// 当前天气
// ============================================================
.weather-current {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--widget-spacing-lg, 16px);
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.5));
  gap: var(--widget-spacing-sm, 8px);
}

html.dark .weather-current {
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.08));
}

.weather-current__main {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-md, 12px);
}

.weather-current__icon {
  color: var(--widget-accent, #0067C0);
}

.weather-current__temp {
  display: flex;
  flex-direction: column;
}

.temp-value {
  font-size: 36px;
  font-weight: 300;
  color: var(--widget-text, #1A1A1A);
  line-height: 1;
}

.temp-label {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
  margin-top: 4px;
}

.weather-current__details {
  display: flex;
  gap: var(--widget-spacing-md, 12px);
  flex-shrink: 0;
}

.detail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 50px;
}

.detail-label {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
}

.detail-value {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// 预报标签
// ============================================================
.weather-forecast-tabs {
  display: flex;
  justify-content: center;
  gap: var(--widget-spacing-sm, 8px);
  padding: var(--widget-spacing-sm, 8px);
  border-bottom: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
}

// ============================================================
// 逐小时预报
// ============================================================
.weather-hourly {
  display: flex;
  overflow-x: auto;
  padding: var(--widget-spacing-md, 12px);
  gap: var(--widget-spacing-md, 12px);
}

.hourly-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--widget-spacing-xs, 4px);
  min-width: 60px;
  padding: var(--widget-spacing-sm, 8px);
  border-radius: var(--widget-radius-medium, 6px);
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.5));
}

html.dark .hourly-item {
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.08));
}

.hourly-time {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
}

.hourly-icon {
  font-size: 20px;
  color: var(--widget-accent, #0067C0);
}

.hourly-temp {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text, #1A1A1A);
}

// ============================================================
// 多日预报
// ============================================================
.weather-daily {
  padding: var(--widget-spacing-md, 12px);
  display: flex;
  flex-direction: column;
  gap: var(--widget-spacing-xs, 4px);
}

.daily-item {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-md, 12px);
  padding: var(--widget-spacing-sm, 8px);
  border-radius: var(--widget-radius-small, 4px);
  transition: background var(--widget-motion-fast, 167ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.04));
  }
}

html.dark .daily-item:hover {
  background: var(--widget-title-hover, rgba(255, 255, 255, 0.06));
}

.daily-day {
  width: 60px;
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text, #1A1A1A);
}

.daily-icon {
  font-size: 20px;
  color: var(--widget-accent, #0067C0);
}

.daily-temp-high {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text, #1A1A1A);
  font-weight: 500;
}

.daily-temp-low {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text-secondary, #5A5A5A);
  margin-left: auto;
}

// ============================================================
// 标题栏按钮
// ============================================================
.weather-header-btn {
  min-width: 32px;
  height: 32px;
}

// ============================================================
// 暗色模式
// ============================================================
html.dark .weather-widget {
  color: var(--widget-text, #F5F5F5);
}

html.dark .temp-value,
html.dark .detail-value,
html.dark .daily-day,
html.dark .daily-temp-high,
html.dark .weather-capsule__temp,
html.dark .city-name,
html.dark .hourly-temp {
  color: var(--widget-text, #F5F5F5);
}

html.dark .weather-capsule__city,
html.dark .city-country,
html.dark .temp-label,
html.dark .detail-label,
html.dark .hourly-time,
html.dark .daily-temp-low {
  color: var(--widget-text-secondary, #A5A5A5);
}

// 暗色模式下分割线颜色调暗
html.dark .weather-search,
html.dark .weather-forecast-tabs {
  border-bottom-color: var(--widget-divider, rgba(60, 60, 60, 0.62));
}
</style>