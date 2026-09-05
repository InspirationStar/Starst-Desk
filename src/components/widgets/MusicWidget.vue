<!--
  音乐控制格子组件
  功能：
  - 显示当前播放信息
  - 播放控制（播放/暂停、上一首、下一首）
  - 进度条和音量控制
  - 播放模式切换
  - 专辑封面显示
  - 唱片布局
  - 胶囊形态支持
-->
<template>
  <div class="music-widget" :class="[`layout-${musicStore.layout}`]">
    <capsule-container
      :is-capsule="isCapsule"

      :collapse-behavior="collapseBehavior"
      :content-mode="contentMode"
      widget-type="music"
      @toggle="handleToggleCapsule"
    >
      <!-- 胶囊形态 -->
      <template #capsule>
        <div class="music-capsule">
          <el-button
            class="music-capsule__play"
            :icon="musicStore.isPlaying ? Pause : Play"
            circle
            size="small"
            @click="musicStore.togglePlay"
          />
          <span class="music-capsule__title" :title="musicStore.trackInfo.title">
            {{ musicStore.trackInfo.title || '未播放' }}
          </span>
        </div>
      </template>

      <!-- 展开形态 -->
      <template #expanded>
        <widget-header
          title="音乐"
          :icon="Music"
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
        />

        <!-- 专辑封面 -->
        <div class="music-cover" :class="{ 'is-playing': musicStore.isPlaying }">
          <div class="music-cover__art" :style="coverStyle">
            <img
              v-if="musicStore.albumArtSrc"
              :src="musicStore.albumArtSrc"
              alt="专辑封面"
              class="music-cover__img"
            />
            <el-icon v-else class="music-cover__placeholder"><Disk /></el-icon>
          </div>
        </div>

        <!-- 歌曲信息 -->
        <div class="music-info">
          <div class="music-info__title">{{ musicStore.trackInfo.title || '未知歌曲' }}</div>
          <div class="music-info__artist">{{ musicStore.trackInfo.artist || '未知艺术家' }}</div>
          <div class="music-info__album">{{ musicStore.trackInfo.album || '未知专辑' }}</div>
        </div>

        <!-- 进度条 -->
        <div class="music-progress">
          <span class="music-progress__time">{{ musicStore.currentTimeDisplay }}</span>
          <el-slider
            v-model="musicStore.progress"
            :max="musicStore.duration || 1"
            :show-tooltip="false"
            class="music-progress__slider"
            @change="handleProgressChange"
          />
          <span class="music-progress__time">{{ musicStore.totalTimeDisplay }}</span>
        </div>

        <!-- 控制按钮 -->
        <div class="music-controls">
          <el-button
            class="music-controls__btn"
            :icon="musicStore.playModeIcon"
            circle
            @click="musicStore.cyclePlayMode"
          />
          <el-button class="music-controls__btn" icon="Back" @click="musicStore.prevTrack" />
          <el-button
            class="music-controls__play"
            :icon="musicStore.isPlaying ? Pause : Play"
            circle
            @click="musicStore.togglePlay"
          />
          <el-button class="music-controls__btn" icon="Forward" @click="musicStore.nextTrack" />
          <el-button
            class="music-controls__btn"
            :icon="musicStore.isMuted ? MuteVolume : VolumeRich"
            circle
            @click="musicStore.toggleMute"
          />
        </div>

        <!-- 音量滑块 -->
        <div class="music-volume">
          <el-icon class="music-volume__icon"><MuteVolume /></el-icon>
          <el-slider
            v-model="musicStore.volume"
            :max="1"
            :min="0"
            :step="0.01"
            :show-tooltip="false"
            class="music-volume__slider"
            @change="handleVolumeChange"
          />
          <el-icon class="music-volume__icon"><VolumeRich /></el-icon>
        </div>

        <!-- 布局切换 -->
        <div class="music-layout-switch">
          <el-button
            size="small"
            :type="musicStore.layout === 'cover' ? 'primary' : ''"
            @click="musicStore.setLayout('cover')"
          >
            封面
          </el-button>
          <el-button
            size="small"
            :type="musicStore.layout === 'record' ? 'primary' : ''"
            @click="musicStore.setLayout('record')"
          >
            唱片
          </el-button>
          <el-button
            size="small"
            :type="musicStore.layout === 'compact' ? 'primary' : ''"
            @click="musicStore.setLayout('compact')"
          >
            紧凑
          </el-button>
        </div>
      </template>
    </capsule-container>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Headset as Music, VideoPlay as Play, VideoPause as Pause, Back, ArrowRight as Forward, Files as Disk, Mute as MuteVolume, Microphone as VolumeRich } from '@element-plus/icons-vue'
import CapsuleContainer from '@/components/widgets/CapsuleContainer.vue'
import WidgetHeader from '@/components/widgets/WidgetHeader.vue'
import { useWidgetHeaderActions } from '@/composables/use-widget-header-actions'
import { musicApi, widgetApi } from '@/utils/ipc-client'
import { useMusicStore } from '@/stores/music-store'

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
} = useWidgetHeaderActions('music')

const musicStore = useMusicStore()

// 胶囊状态
const isCapsule = ref(false)

// 折叠行为
const collapseBehavior = ref('click')
const contentMode = ref('summary')

// 计算专辑艺术背景样式
const coverStyle = computed(() => {
  if (musicStore.albumColor) {
    return {
      background: `radial-gradient(circle at center, ${musicStore.albumColor} 0%, transparent 70%)`
    }
  }
  return {}
})

/**
 * 处理进度条变化
 */
async function handleProgressChange (value) {
  try {
    await musicApi.updateProgress(value)
  } catch (err) {
    console.error('[MusicWidget] 更新进度失败:', err)
  }
}

/**
 * 处理音量变化
 */
async function handleVolumeChange (value) {
  try {
    await musicApi.setVolume(value)
  } catch (err) {
    console.error('[MusicWidget] 设置音量失败:', err)
  }
}

/**
 * 切换胶囊状态
 */
async function handleToggleCapsule (newCapsule) {
  if (typeof newCapsule !== 'boolean') return
  isCapsule.value = newCapsule
  try {
    await widgetApi.toggleCapsule('music', newCapsule)
  } catch (err) {
    console.error('[MusicWidget] 切换胶囊失败:', err.message)
  }
}

/**
 * 隐藏小部件
 */
async function handleClose () {
  try {
    await widgetApi.hide('music')
  } catch (err) {
    console.error('[MusicWidget] 隐藏失败:', err.message)
  }
}

onMounted(async () => {
  // 初始化媒体会话
  musicStore.initMediaSession()

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
    const config = await widgetApi.get('music')
    if (config) {
      isCapsule.value = !!Number(config.is_capsule)

      // 读取折叠行为
      if (config.collapse_behavior) {
        collapseBehavior.value = config.collapse_behavior
      }
    }
  } catch (err) {
    console.warn('[MusicWidget] 加载配置失败:', err.message)
  }

  // 加载当前状态
  try {
    const status = await musicApi.getStatus()
    if (status) {
      musicStore.isPlaying = status.isPlaying
      musicStore.volume = status.volume
      musicStore.trackInfo = status.track || {}
    }
  } catch (err) {
    console.warn('[MusicWidget] 加载音乐状态失败:', err.message)
  }
})

onBeforeUnmount(() => {
  musicStore.cleanup()
  cleanupLocks()
})
</script>

<style scoped lang="scss">
// ============================================================
// ============================================================

.music-widget {
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
.music-capsule {
  display: flex;
  align-items: center;
  padding: var(--widget-spacing-sm, 8px) var(--widget-spacing-md, 12px);
  gap: var(--widget-spacing-sm, 8px);
}

.music-capsule__play {
  flex-shrink: 0;
}

.music-capsule__title {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text, #1A1A1A);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

// ============================================================
// 专辑封面
// ============================================================
.music-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--widget-spacing-xl, 20px);
  position: relative;
}

.music-cover__art {
  width: 120px;
  height: 120px;
  border-radius: var(--widget-radius-large, 8px);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.5));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: transform var(--widget-motion-normal, 250ms) ease;

  &.is-playing {
    animation: rotate 20s linear infinite;
  }
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.music-cover__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.music-cover__placeholder {
  font-size: 48px;
  color: var(--widget-text-secondary, #5A5A5A);
}

// ============================================================
// 歌曲信息
// ============================================================
.music-info {
  padding: 0 var(--widget-spacing-md, 12px) var(--widget-spacing-sm, 8px);
  text-align: center;
}

.music-info__title {
  font-size: var(--widget-font-title, 14px);
  font-weight: 600;
  color: var(--widget-text, #1A1A1A);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.music-info__artist {
  font-size: var(--widget-font-body, 13px);
  color: var(--widget-text-secondary, #5A5A5A);
  margin-top: 4px;
}

.music-info__album {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-tertiary, #5A5A5A);
  margin-top: 2px;
}

// ============================================================
// 进度条
// ============================================================
.music-progress {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-xs, 4px);
  padding: 0 var(--widget-spacing-md, 12px);
}

.music-progress__time {
  font-size: var(--widget-font-caption, 12px);
  color: var(--widget-text-secondary, #5A5A5A);
  min-width: 35px;
}

.music-progress__slider {
  flex: 1;
  margin: 0 var(--widget-spacing-sm, 8px);
}

// ============================================================
// 控制按钮
// ============================================================
.music-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--widget-spacing-md, 12px);
  padding: var(--widget-spacing-sm, 8px);
}

.music-controls__btn {
  width: 36px;
  height: 36px;
}

.music-controls__play {
  width: 48px;
  height: 48px;
  font-size: 20px;
}

// ============================================================
// 音量控制
// ============================================================
.music-volume {
  display: flex;
  align-items: center;
  gap: var(--widget-spacing-xs, 4px);
  padding: 0 var(--widget-spacing-md, 12px) var(--widget-spacing-sm, 8px);
}

.music-volume__icon {
  font-size: 16px;
  color: var(--widget-text-secondary, #5A5A5A);
}

.music-volume__slider {
  flex: 1;
}

// ============================================================
// 布局切换
// ============================================================
.music-layout-switch {
  display: flex;
  justify-content: center;
  gap: var(--widget-spacing-xs, 4px);
  padding: var(--widget-spacing-sm, 8px);
  border-top: 1px solid var(--widget-divider, rgba(208, 208, 208, 0.62));
}

// ============================================================
// 暗色模式
// ============================================================
html.dark .music-widget {
  color: var(--widget-text, #F5F5F5);
}

html.dark .music-cover__art {
  background: var(--widget-layer-fill, rgba(255, 255, 255, 0.08));
}

html.dark .music-info__title {
  color: var(--widget-text, #F5F5F5);
}

html.dark .music-info__artist {
  color: var(--widget-text-secondary, #A5A5A5);
}

html.dark .music-info__album {
  color: var(--widget-text-tertiary, #A5A5A5);
}

html.dark .music-progress__time {
  color: var(--widget-text-secondary, #A5A5A5);
}

html.dark .music-layout-switch {
  border-top-color: var(--widget-divider, rgba(60, 60, 60, 0.62));
}

// 暗色模式补充：胶囊标题、占位图标、音量图标
html.dark .music-capsule__title {
  color: var(--widget-text, #F5F5F5);
}

html.dark .music-cover__placeholder,
html.dark .music-volume__icon {
  color: var(--widget-text-secondary, #A5A5A5);
}
</style>