<!--
  桌宠配置页
  职责：管理桌面桌宠的显示与行为
  使用 el-tabs 标签页布局，风格对齐 SettingsView.vue
  配置项：
    - 基本设置：显隐、形象、置顶、位置重置
    - 提醒设置：健康提醒暂停、鼓励气泡、鼓励频率
    - 自定义名言：用户自定义鼓励语，每行一条
  持久化：
    - 已有字段通过 petApi.updateConfig()（主进程 pet-window-manager 持久化）
    - 新字段（鼓励相关、自定义名言）通过 systemApi.setSetting/getSetting 直存 app_settings
-->
<template>
  <div class="pet-settings-view">
    <div class="page-header">
      <h2 class="page-title">桌宠配置</h2>
      <p class="page-subtitle">管理桌面桌宠的显示与行为</p>
    </div>

    <el-card class="settings-card" shadow="never">
      <el-tabs v-model="activeTab" class="settings-tabs">
        <!-- 基本设置 -->
        <el-tab-pane label="基本设置" name="general">
          <div class="settings-section">
            <!-- 桌宠显隐 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">启用桌宠</div>
                <div class="settings-row__desc">开启后桌宠将常驻桌面，关闭则隐藏</div>
              </div>
              <div class="settings-row__control">
                <el-switch
                  v-model="enabled"
                  :loading="enabledLoading"
                  @change="handleEnabledChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 桌宠形象 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">桌宠形象</div>
                <div class="settings-row__desc">点击选择桌宠的卡通形象</div>
              </div>
            </div>

            <!-- 桌宠形象选择卡片 -->
            <div class="character-gallery">
              <div
                class="character-gallery__item"
                :class="{ 'is-active': character === 'cat' }"
                @click="selectCharacter('cat')"
              >
                <PetCharacter state="idle" />
                <div class="character-gallery__name">熊猫</div>
              </div>
              <div
                class="character-gallery__item"
                :class="{ 'is-active': character === 'robot' }"
                @click="selectCharacter('robot')"
              >
                <PetRobot state="idle" />
                <div class="character-gallery__name">机器人</div>
              </div>
              <div
                class="character-gallery__item"
                :class="{ 'is-active': character === 'orb' }"
                @click="selectCharacter('orb')"
              >
                <PetOrb state="idle" />
                <div class="character-gallery__name">科技球</div>
              </div>
              <div
                class="character-gallery__item"
                :class="{ 'is-active': character === 'dna' }"
                @click="selectCharacter('dna')"
              >
                <PetDNA state="idle" />
                <div class="character-gallery__name">DNA螺旋</div>
              </div>
            </div>

            <!-- 桌宠尺寸设置 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">桌宠尺寸</div>
                <div class="settings-row__desc">调整桌宠角色的显示大小（{{ characterSize }}px）</div>
              </div>
              <div class="settings-row__control settings-row__control--slider">
                <el-slider
                  v-model="characterSize"
                  :min="60"
                  :max="300"
                  :step="5"
                  :show-tooltip="true"
                  @input="handleSizeInput"
                  @change="handleSizeChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 气泡透明度 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">气泡透明度</div>
                <div class="settings-row__desc">调整提醒气泡的透明度（{{ Math.round(bubbleOpacity * 100) }}%）</div>
              </div>
              <div class="settings-row__control settings-row__control--slider">
                <el-slider
                  v-model="bubbleOpacity"
                  :min="0.1"
                  :max="1"
                  :step="0.05"
                  :show-tooltip="true"
                  @change="handleBubbleOpacityChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 工具栏透明度 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">小按钮透明度</div>
                <div class="settings-row__desc">调整悬停工具栏的透明度（{{ Math.round(toolbarOpacity * 100) }}%）</div>
              </div>
              <div class="settings-row__control settings-row__control--slider">
                <el-slider
                  v-model="toolbarOpacity"
                  :min="0.1"
                  :max="1"
                  :step="0.05"
                  :show-tooltip="true"
                  @change="handleToolbarOpacityChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 气泡字体大小 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">气泡字体大小</div>
                <div class="settings-row__desc">调整桌宠气泡与 AI 对话的字体大小（{{ bubbleFontSize }}px）</div>
              </div>
              <div class="settings-row__control settings-row__control--slider">
                <el-slider
                  v-model="bubbleFontSize"
                  :min="12"
                  :max="20"
                  :step="1"
                  :show-tooltip="true"
                  @change="handleBubbleFontSizeChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 窗口置顶 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">窗口置顶</div>
                <div class="settings-row__desc">开启后桌宠始终显示在其他窗口之上</div>
              </div>
              <div class="settings-row__control">
                <el-switch
                  v-model="alwaysOnTop"
                  @change="handleAlwaysOnTopChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 键盘连击追踪 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">键盘连击追踪</div>
                <div class="settings-row__desc">开启后实时检测键盘敲击并显示连击特效，关闭后后端不进行按键采集</div>
              </div>
              <div class="settings-row__control">
                <el-switch
                  v-model="keyTrackerEnabled"
                  @change="handleKeyTrackerChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 位置重置 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">重置位置</div>
                <div class="settings-row__desc">将桌宠移动到屏幕右下角默认位置</div>
              </div>
              <div class="settings-row__control">
                <el-button :loading="resetLoading" @click="handleResetPosition">
                  <el-icon><RefreshRight /></el-icon>
                  <span>重置位置</span>
                </el-button>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 提醒设置 -->
        <el-tab-pane label="提醒设置" name="reminders">
          <div class="settings-section">
            <!-- 健康提醒暂停 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">暂停健康提醒</div>
                <div class="settings-row__desc">开启后桌宠不再弹出健康提醒气泡</div>
              </div>
              <div class="settings-row__control">
                <el-switch
                  v-model="remindersPaused"
                  @change="handleRemindersPausedChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 鼓励气泡开关 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">显示鼓励气泡</div>
                <div class="settings-row__desc">开启后桌宠会偶尔弹出鼓励/名言气泡</div>
              </div>
              <div class="settings-row__control">
                <el-switch
                  v-model="encouragementEnabled"
                  :disabled="remindersPaused"
                  @change="handleEncouragementEnabledChange"
                />
              </div>
            </div>

            <el-divider />

            <!-- 鼓励气泡频率 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">鼓励气泡频率</div>
                <div class="settings-row__desc">每隔多久显示一次鼓励气泡</div>
              </div>
              <div class="settings-row__control">
                <el-select
                  v-model="encouragementInterval"
                  :disabled="!encouragementEnabled || remindersPaused"
                  style="width: 140px"
                  @change="handleEncouragementIntervalChange"
                >
                  <el-option :value="0.5" label="每 30 秒" />
                  <el-option :value="1" label="每 1 分钟" />
                  <el-option :value="5" label="每 5 分钟" />
                  <el-option :value="10" label="每 10 分钟" />
                  <el-option :value="15" label="每 15 分钟" />
                  <el-option :value="30" label="每 30 分钟" />
                </el-select>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 自定义名言 -->
        <el-tab-pane label="自定义名言" name="quotes">
          <div class="settings-section">
            <div class="settings-row settings-row--block">
              <div class="settings-row__info">
                <div class="settings-row__label">自定义鼓励语</div>
                <div class="settings-row__desc">
                  每行一条名言，桌宠会随机选择显示。留空则使用内置默认鼓励语。
                </div>
              </div>
            </div>

            <el-input
              v-model="customQuotes"
              type="textarea"
              :rows="10"
              placeholder="例如：&#10;今天也要加油哦！&#10;保持专注，保持热爱。&#10;休息一下，喝杯水吧。"
              resize="vertical"
              class="quotes-input"
            />

            <div class="quotes-actions">
              <el-button type="primary" :loading="quotesSaving" @click="handleSaveQuotes">
                <el-icon><Check /></el-icon>
                <span>保存名言</span>
              </el-button>
              <el-button @click="handleClearQuotes">
                <el-icon><Delete /></el-icon>
                <span>清空</span>
              </el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- AI 助手设置 -->
        <el-tab-pane label="AI 助手" name="ai">
          <div class="settings-section">
            <div class="settings-row settings-row--block">
              <div class="settings-row__info">
                <div class="settings-row__label">人设提示词</div>
                <div class="settings-row__desc">
                  定义桌宠「星宝」的人设、能力、回复原则。修改后保存即可生效。
                </div>
              </div>
            </div>

            <el-input
              v-model="aiSystemPrompt"
              type="textarea"
              :rows="12"
              placeholder="输入桌宠 AI 助手的人设提示词"
              resize="vertical"
              class="quotes-input"
            />

            <div class="quotes-actions">
              <el-button type="primary" :loading="aiPromptSaving" @click="handleSaveAiPrompt">
                <el-icon><Check /></el-icon>
                <span>保存提示词</span>
              </el-button>
              <el-button @click="handleResetAiPrompt">
                <el-icon><RefreshRight /></el-icon>
                <span>恢复默认</span>
              </el-button>
            </div>

            <el-divider />

            <!-- AI 生成提示词 -->
            <div class="settings-row settings-row--block">
              <div class="settings-row__info">
                <div class="settings-row__label">AI 生成提示词</div>
                <div class="settings-row__desc">
                  输入需求描述，让 AI 自动生成一份人设提示词。
                </div>
              </div>
            </div>

            <el-input
              v-model="aiGenerateRequirement"
              type="textarea"
              :rows="3"
              placeholder="例如：让星宝更活泼幽默，多使用表情，适合陪伴小朋友"
              resize="vertical"
              class="quotes-input"
            />

            <div class="quotes-actions">
              <el-button
                type="primary"
                :loading="aiGenerating"
                :disabled="!aiGenerateRequirement.trim()"
                @click="handleGenerateAiPrompt"
              >
                <el-icon><MagicStick /></el-icon>
                <span>生成提示词</span>
              </el-button>
            </div>

            <el-divider />

            <!-- AI 自动对话 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">自动对话</div>
                <div class="settings-row__desc">
                  开启后，星宝会定时自行调用 AI，根据上下文主动关心你，并将回复显示在气泡中
                </div>
              </div>
              <div class="settings-row__control">
                <el-switch v-model="autoChatEnabled" @change="handleToggleAutoChat" />
              </div>
            </div>

            <div class="settings-row" v-if="autoChatEnabled">
              <div class="settings-row__info">
                <div class="settings-row__label">自动对话间隔</div>
                <div class="settings-row__desc">星宝每隔多少分钟主动对话一次（建议 15-60 分钟）</div>
              </div>
              <div class="settings-row__control">
                <el-input-number
                  v-model="autoChatInterval"
                  :min="1"
                  :step="1"
                  style="width: 120px"
                  @change="handleSaveAutoChatInterval"
                />
                <span style="margin-left: 8px; color: var(--el-text-color-secondary)">分钟</span>
              </div>
            </div>

            <div class="settings-row" v-if="autoChatEnabled">
              <div class="settings-row__info">
                <div class="settings-row__label">自动对话深度思考</div>
                <div class="settings-row__desc">开启后，自动对话启用 AI 推理模式，回复更有深度但耗时更长</div>
              </div>
              <div class="settings-row__control">
                <el-switch v-model="autoChatThinkingEnabled" @change="handleSaveAutoChatThinking" />
              </div>
            </div>

            <div class="settings-row" v-if="autoChatEnabled && autoChatThinkingEnabled">
              <div class="settings-row__info">
                <div class="settings-row__label">思考强度</div>
                <div class="settings-row__desc">思考强度越高，推理越深入但耗时越长</div>
              </div>
              <div class="settings-row__control">
                <el-select v-model="autoChatThinkingEffort" style="width: 120px" @change="handleSaveAutoChatThinkingEffort">
                  <el-option label="轻度" value="low" />
                  <el-option label="中度" value="medium" />
                  <el-option label="深度" value="high" />
                  <el-option label="最高" value="max" />
                </el-select>
              </div>
            </div>

            <el-divider />

            <!-- 跳转到 AI 对话 -->
            <div class="settings-row">
              <div class="settings-row__info">
                <div class="settings-row__label">与桌宠对话</div>
                <div class="settings-row__desc">打开 AI 对话页面，与星宝直接聊天</div>
              </div>
              <div class="settings-row__control">
                <el-button type="primary" @click="handleGoToChat">
                  <el-icon><ChatDotRound /></el-icon>
                  <span>前往对话</span>
                </el-button>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { RefreshRight, Check, Delete, MagicStick, ChatDotRound } from '@element-plus/icons-vue'
import { petApi, systemApi, chatApi, aiApi } from '@/utils/ipc-client'
import { useAppStore } from '@/stores/app-store'
import {
  PET_ASSISTANT_SESSION_TITLE,
  KEY_PET_AI_SYSTEM_PROMPT,
  KEY_PET_AI_AUTO_CHAT,
  KEY_PET_AI_AUTO_CHAT_INTERVAL,
  KEY_PET_AI_AUTO_CHAT_THINKING,
  KEY_PET_AI_AUTO_CHAT_THINKING_EFFORT,
  DEFAULT_PET_AI_SYSTEM_PROMPT,
  buildGenerationContext
} from '@/utils/pet-ai-prompt'
import PetCharacter from '@/components/pet/PetCharacter.vue'
import PetRobot from '@/components/pet/PetRobot.vue'
import PetOrb from '@/components/pet/PetOrb.vue'
import PetDNA from '@/components/pet/PetDNA.vue'

const router = useRouter()
const appStore = useAppStore()

// 当前激活的标签页
const activeTab = ref('general')

// ============================================================
// 基本设置
// ============================================================
const enabled = ref(true)
const enabledLoading = ref(false)
const character = ref('cat')
const characterSize = ref(130)
const alwaysOnTop = ref(true)
const keyTrackerEnabled = ref(true)
const resetLoading = ref(false)

// ============================================================
// 提醒设置
// ============================================================
const remindersPaused = ref(false)
const encouragementEnabled = ref(true)
const encouragementInterval = ref(10)

// ============================================================
// 自定义名言
// ============================================================
const customQuotes = ref('')
const quotesSaving = ref(false)

// ============================================================
// AI 助手设置
// ============================================================
const aiSystemPrompt = ref(DEFAULT_PET_AI_SYSTEM_PROMPT)
const aiPromptSaving = ref(false)
const aiGenerateRequirement = ref('')
const aiGenerating = ref(false)
const autoChatEnabled = ref(false)
const autoChatInterval = ref(30)
// 自动对话深度思考配置（开关 + 强度）
const autoChatThinkingEnabled = ref(false)
const autoChatThinkingEffort = ref('high')
const bubbleOpacity = ref(1.0)
const toolbarOpacity = ref(1.0)
// 桌宠气泡字体大小（px，范围 12-20，默认 14 对齐主聊天界面）
const bubbleFontSize = ref(14)

// 新增配置键名（存储在 app_settings 表）
const KEY_ENCOURAGEMENT_ENABLED = 'pet_encouragement_enabled'   // 鼓励气泡开关，默认 '1'
const KEY_ENCOURAGEMENT_INTERVAL = 'pet_encouragement_interval' // 鼓励气泡频率（分钟），默认 '10'
const KEY_CUSTOM_QUOTES = 'pet_custom_quotes'                   // 自定义名言，每行一条
const KEY_BUBBLE_OPACITY = 'pet_bubble_opacity'                 // 气泡透明度，默认 '1.0'
const KEY_TOOLBAR_OPACITY = 'pet_toolbar_opacity'               // 工具栏透明度，默认 '1.0'
const KEY_BUBBLE_FONT_SIZE = 'pet_bubble_font_size'             // 气泡字体大小，默认 '14'

/**
 * 初始化：加载桌宠配置与扩展配置
 */
onMounted(async () => {
  await loadConfig()
})

/**
 * 加载配置
 * 已有字段通过 petApi.getConfig()，扩展字段通过 systemApi.getSetting()
 */
async function loadConfig () {
  try {
    const config = await petApi.getConfig()
    enabled.value = !!config.enabled
    alwaysOnTop.value = !!config.alwaysOnTop
    keyTrackerEnabled.value = !!config.keyTrackerEnabled
    character.value = config.character || 'cat'
    if (typeof config.characterSize === 'number' && config.characterSize >= 60 && config.characterSize <= 300) {
      characterSize.value = config.characterSize
    }
    remindersPaused.value = !!config.remindersPaused
  } catch (err) {
    ElMessage.error(`加载桌宠配置失败：${err.message}`)
  }

  // 加载扩展配置（允许失败时使用默认值）
  try {
    const enabledRes = await systemApi.getSetting(KEY_ENCOURAGEMENT_ENABLED)
    if (enabledRes?.value !== null && enabledRes?.value !== undefined) {
      encouragementEnabled.value = enabledRes.value === '1' || enabledRes.value === 'true'
    }
  } catch (err) {
    // 键不存在时使用默认值，忽略错误
  }

  try {
    const intervalRes = await systemApi.getSetting(KEY_ENCOURAGEMENT_INTERVAL)
    if (intervalRes?.value !== null && intervalRes?.value !== undefined) {
      const num = parseInt(intervalRes.value, 10)
      if (!isNaN(num) && num > 0) encouragementInterval.value = num
    }
  } catch (err) {
    // 忽略
  }

  try {
    const quotesRes = await systemApi.getSetting(KEY_CUSTOM_QUOTES)
    if (quotesRes?.value !== null && quotesRes?.value !== undefined) {
      customQuotes.value = quotesRes.value
    }
  } catch (err) {
    // 忽略
  }

  // 加载气泡/工具栏透明度
  try {
    const bubbleRes = await systemApi.getSetting(KEY_BUBBLE_OPACITY)
    if (bubbleRes?.value !== null && bubbleRes?.value !== undefined) {
      const num = parseFloat(bubbleRes.value)
      if (!isNaN(num) && num > 0 && num <= 1) bubbleOpacity.value = num
    }
    const toolbarRes = await systemApi.getSetting(KEY_TOOLBAR_OPACITY)
    if (toolbarRes?.value !== null && toolbarRes?.value !== undefined) {
      const num = parseFloat(toolbarRes.value)
      if (!isNaN(num) && num > 0 && num <= 1) toolbarOpacity.value = num
    }
  } catch (err) {
    // 忽略
  }

  // 加载气泡字体大小
  try {
    const fontRes = await systemApi.getSetting(KEY_BUBBLE_FONT_SIZE)
    if (fontRes?.value !== null && fontRes?.value !== undefined) {
      const num = parseInt(fontRes.value, 10)
      if (!isNaN(num) && num >= 12 && num <= 20) bubbleFontSize.value = num
    }
  } catch (err) {
    // 忽略：使用默认值
  }

  // 加载 AI 助手提示词
  try {
    const promptRes = await systemApi.getSetting(KEY_PET_AI_SYSTEM_PROMPT)
    if (promptRes?.value !== null && promptRes?.value !== undefined && typeof promptRes.value === 'string') {
      aiSystemPrompt.value = promptRes.value
    }
  } catch (err) {
    // 键不存在时使用默认值，忽略错误
  }

  // 加载 AI 自动对话配置
  try {
    const { value: autoChat } = await systemApi.getSetting(KEY_PET_AI_AUTO_CHAT)
    autoChatEnabled.value = autoChat === '1' || autoChat === 'true'
    const { value: interval } = await systemApi.getSetting(KEY_PET_AI_AUTO_CHAT_INTERVAL)
    const num = parseInt(interval, 10)
    if (!isNaN(num) && num > 0) {
      autoChatInterval.value = num
    }
    // 加载自动对话深度思考配置
    const { value: thinkingEnabled } = await systemApi.getSetting(KEY_PET_AI_AUTO_CHAT_THINKING)
    autoChatThinkingEnabled.value = thinkingEnabled === '1' || thinkingEnabled === 'true'
    const { value: thinkingEffort } = await systemApi.getSetting(KEY_PET_AI_AUTO_CHAT_THINKING_EFFORT)
    if (thinkingEffort && ['low', 'medium', 'high', 'max'].includes(thinkingEffort)) {
      autoChatThinkingEffort.value = thinkingEffort
    }
  } catch (err) {
    // 使用默认值
  }
}

/**
 * 启用/禁用桌宠
 */
async function handleEnabledChange (val) {
  enabledLoading.value = true
  try {
    await petApi.updateConfig({ enabled: val })
    if (val) {
      await petApi.show()
    } else {
      await petApi.hide()
    }
    ElMessage.success(val ? '桌宠已启用' : '桌宠已隐藏')
  } catch (err) {
    enabled.value = !val
    ElMessage.error(`设置失败：${err.message}`)
  } finally {
    enabledLoading.value = false
  }
}

/**
 * 桌宠形象切换
 */
async function handleCharacterChange (val) {
  try {
    await petApi.updateConfig({ character: val })
    ElMessage.success('形象已切换')
  } catch (err) {
    ElMessage.error(`切换失败：${err.message}`)
  }
}

function selectCharacter (val) {
  if (character.value === val) return
  character.value = val
  handleCharacterChange(val)
}

async function handleSizeChange (val) {
  try {
    await petApi.updateConfig({ characterSize: val })
  } catch (err) {
    ElMessage.error(`尺寸调整失败：${err.message}`)
  }
}

// 尺寸拖动实时预览（节流 30ms，确保拖动过程中桌宠尺寸连续丝滑变化）
let sizeInputLastTime = 0
let sizeInputTimer = null
function handleSizeInput (val) {
  const now = Date.now()
  // 节流：距离上次发送超过 30ms 才立即发送，否则延迟补发
  if (now - sizeInputLastTime >= 30) {
    sizeInputLastTime = now
    petApi.updateConfig({ characterSize: val }).catch((err) => {
      console.warn('[PetSettings] 实时尺寸更新失败:', err.message)
    })
  } else {
    // 清除上一次延迟发送，确保最终值一定会被发送
    if (sizeInputTimer) clearTimeout(sizeInputTimer)
    sizeInputTimer = setTimeout(() => {
      sizeInputLastTime = Date.now()
      petApi.updateConfig({ characterSize: val }).catch((err) => {
        console.warn('[PetSettings] 实时尺寸更新失败:', err.message)
      })
    }, 30)
  }
}

onBeforeUnmount(() => {
  if (sizeInputTimer) clearTimeout(sizeInputTimer)
})

/**
 * 气泡透明度变化
 */
async function handleBubbleOpacityChange (val) {
  try {
    await systemApi.setSetting(KEY_BUBBLE_OPACITY, String(val))
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  }
}

/**
 * 工具栏透明度变化
 */
async function handleToolbarOpacityChange (val) {
  try {
    await systemApi.setSetting(KEY_TOOLBAR_OPACITY, String(val))
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  }
}

/**
 * 气泡字体大小变化
 * 通过 appStore.setPetBubbleFontSize 持久化并广播到桌宠窗口
 */
async function handleBubbleFontSizeChange (val) {
  try {
    await appStore.setPetBubbleFontSize(val)
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  }
}

/**
 * 窗口置顶切换
 */
async function handleAlwaysOnTopChange (val) {
  try {
    await petApi.setAlwaysOnTop(val)
    ElMessage.success(val ? '已置顶' : '已取消置顶')
  } catch (err) {
    alwaysOnTop.value = !val
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 键盘连击追踪开关
 */
async function handleKeyTrackerChange (val) {
  try {
    await petApi.updateConfig({ keyTrackerEnabled: val })
    ElMessage.success(val ? '已开启键盘连击追踪' : '已关闭键盘连击追踪')
  } catch (err) {
    keyTrackerEnabled.value = !val
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 重置桌宠位置到屏幕右下角默认位置
 */
async function handleResetPosition () {
  resetLoading.value = true
  try {
    await petApi.resetPosition()
    ElMessage.success('位置已重置')
  } catch (err) {
    ElMessage.error(`重置失败：${err.message}`)
  } finally {
    resetLoading.value = false
  }
}

/**
 * 健康提醒暂停/恢复
 */
async function handleRemindersPausedChange (val) {
  try {
    if (val) {
      await petApi.pauseReminders()
    } else {
      await petApi.resumeReminders()
    }
    ElMessage.success(val ? '健康提醒已暂停' : '健康提醒已恢复')
  } catch (err) {
    remindersPaused.value = !val
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 鼓励气泡开关切换
 */
async function handleEncouragementEnabledChange (val) {
  try {
    await systemApi.setSetting(KEY_ENCOURAGEMENT_ENABLED, val ? '1' : '0')
    ElMessage.success(val ? '鼓励气泡已开启' : '鼓励气泡已关闭')
  } catch (err) {
    encouragementEnabled.value = !val
    ElMessage.error(`设置失败：${err.message}`)
  }
}

/**
 * 鼓励气泡频率切换
 */
async function handleEncouragementIntervalChange (val) {
  try {
    await systemApi.setSetting(KEY_ENCOURAGEMENT_INTERVAL, String(val))
    ElMessage.success('频率已保存')
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  }
}

/**
 * 保存自定义名言
 */
async function handleSaveQuotes () {
  quotesSaving.value = true
  try {
    await systemApi.setSetting(KEY_CUSTOM_QUOTES, customQuotes.value || '')
    ElMessage.success('名言已保存')
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  } finally {
    quotesSaving.value = false
  }
}

/**
 * 清空自定义名言输入区
 */
function handleClearQuotes () {
  customQuotes.value = ''
}

// ============================================================
// AI 助手设置处理
// ============================================================

/**
 * 切换 AI 自动对话开关
 */
async function handleToggleAutoChat (val) {
  try {
    await systemApi.setSetting(KEY_PET_AI_AUTO_CHAT, val ? '1' : '0')
    ElMessage.success(val ? '自动对话已开启' : '自动对话已关闭')
  } catch (err) {
    ElMessage.error('保存失败：' + err.message)
    autoChatEnabled.value = !val
  }
}

/**
 * 保存自动对话间隔
 */
async function handleSaveAutoChatInterval (val) {
  try {
    await systemApi.setSetting(KEY_PET_AI_AUTO_CHAT_INTERVAL, String(val))
  } catch (err) {
    ElMessage.error('保存间隔失败：' + err.message)
  }
}

/**
 * 保存自动对话深度思考开关
 */
async function handleSaveAutoChatThinking (val) {
  try {
    await systemApi.setSetting(KEY_PET_AI_AUTO_CHAT_THINKING, val ? '1' : '0')
    ElMessage.success(val ? '深度思考已开启' : '深度思考已关闭')
  } catch (err) {
    ElMessage.error('保存失败：' + err.message)
    autoChatThinkingEnabled.value = !val
  }
}

/**
 * 保存自动对话思考强度
 */
async function handleSaveAutoChatThinkingEffort (val) {
  try {
    await systemApi.setSetting(KEY_PET_AI_AUTO_CHAT_THINKING_EFFORT, String(val))
  } catch (err) {
    ElMessage.error('保存思考强度失败：' + err.message)
  }
}

/**
 * 保存 AI 人设提示词
 */
async function handleSaveAiPrompt () {
  aiPromptSaving.value = true
  try {
    await systemApi.setSetting(KEY_PET_AI_SYSTEM_PROMPT, aiSystemPrompt.value)
    ElMessage.success('提示词已保存')
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  } finally {
    aiPromptSaving.value = false
  }
}

/**
 * 恢复默认 AI 人设提示词
 */
async function handleResetAiPrompt () {
  aiSystemPrompt.value = DEFAULT_PET_AI_SYSTEM_PROMPT
  try {
    await systemApi.setSetting(KEY_PET_AI_SYSTEM_PROMPT, DEFAULT_PET_AI_SYSTEM_PROMPT)
    ElMessage.success('已恢复默认提示词')
  } catch (err) {
    ElMessage.error(`恢复失败：${err.message}`)
  }
}

/**
 * 让 AI 根据需求生成提示词
 * 查找桌宠助手常驻会话，向其发送生成请求
 */
async function handleGenerateAiPrompt () {
  const requirement = aiGenerateRequirement.value.trim()
  if (!requirement) return

  aiGenerating.value = true
  try {
    // 查找桌宠助手常驻会话
    const sessionsRes = await chatApi.listSessions()
    const sessions = sessionsRes?.list || sessionsRes || []
    const petSession = sessions.find(s => s.title === PET_ASSISTANT_SESSION_TITLE)
    if (!petSession) {
      ElMessage.warning('桌宠助手会话未初始化，请先打开桌宠窗口')
      return
    }

    // 获取可用 AI 配置
    const configRes = await aiApi.listConfigs()
    const configs = configRes?.list || configRes || []
    if (!configs || configs.length === 0) {
      ElMessage.warning('请先配置 AI 模型')
      return
    }
    const config = configs.find(c => c.is_active) || configs[0]

    // 获取最近10条对话记录，作为生成背景（比日常对话多，帮助 AI 了解用户风格）
    const msgRes = await chatApi.listMessages(petSession.id)
    const msgs = msgRes?.list || []
    const recentHistory = msgs.slice(-10).map(m => ({ role: m.role, content: m.content }))
    const generationContext = buildGenerationContext(recentHistory)

    const generatePrompt = `请根据以下需求和背景信息，为桌宠助手「星宝」生成一份完整的系统提示词（包含人设、能力、回复原则、可用工具）。

${generationContext}

【用户需求】${requirement}

请直接输出提示词内容，不要包含其他说明。`

    // 发送消息并生成回复
    await chatApi.sendMessage({
      session_id: petSession.id,
      content: generatePrompt,
      config_id: config.id
    })

    const result = await chatApi.generateMessage({
      session_id: petSession.id,
      config_id: config.id
    })

    // 提取生成的提示词
    if (result && result.content) {
      const generatedPrompt = result.content.trim()
      aiSystemPrompt.value = generatedPrompt
      await systemApi.setSetting(KEY_PET_AI_SYSTEM_PROMPT, generatedPrompt)
      ElMessage.success('提示词已生成并保存')
    } else {
      // 流式生成可能需要从消息列表获取
      const msgRes = await chatApi.listMessages(petSession.id)
      const msgs = msgRes?.list || msgRes || []
      const lastMsg = msgs[msgs.length - 1]
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
        const generatedPrompt = lastMsg.content.trim()
        aiSystemPrompt.value = generatedPrompt
        await systemApi.setSetting(KEY_PET_AI_SYSTEM_PROMPT, generatedPrompt)
        ElMessage.success('提示词已生成并保存')
      } else {
        ElMessage.warning('生成结果为空，请稍后重试')
      }
    }
  } catch (err) {
    ElMessage.error(`生成失败：${err.message}`)
  } finally {
    aiGenerating.value = false
  }
}

/**
 * 跳转到 AI 对话页面
 */
function handleGoToChat () {
  router.push('/ai-chat')
}
</script>

<style scoped lang="scss">
.pet-settings-view {
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

.settings-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 16px;
  }
}

.settings-section {
  padding: 8px 0;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 8px 0;

  // 块级布局：信息区占满整行，下方放控件
  &--block {
    align-items: flex-start;
    margin-bottom: 12px;
  }

  &__info {
    flex: 1;
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

    // 滑杆控件需要更宽的空间，左右 padding 避免滑块在两端被裁剪
    &--slider {
      flex-shrink: 1;
      padding: 0 12px;

      .el-slider {
        width: 100%;
      }
    }
  }
}

// 自定义名言输入区
.quotes-input {
  margin-bottom: 16px;
}

.quotes-actions {
  display: flex;
  gap: 12px;
}

.character-gallery {
  display: flex;
  gap: 16px;
  margin: 12px 0;

  &__item {
    width: 130px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 8px;
    border-radius: 12px;
    border: 2px solid var(--el-border-color-lighter, #e4e7ed);
    background: var(--el-fill-color-light, #f5f7fa);
    cursor: pointer;
    transition: border-color 0.2s, box-shadow 0.2s;

    &:hover {
      border-color: var(--el-color-primary, #409eff);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    &.is-active {
      border-color: var(--el-color-primary, #409eff);
      box-shadow: 0 0 0 2px var(--el-color-primary, #409eff);
    }
  }

  &__name {
    margin-top: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary, #303133);
  }
}

// ============================================================
// 暗色模式适配
// --app-text-secondary 未在暗色下定义，回退值 #909399 在暗色背景下可读性差
// 此处显式覆盖为全局暗色配色方案的次要文字色
// ============================================================
html.dark .pet-settings-view {
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
}
</style>