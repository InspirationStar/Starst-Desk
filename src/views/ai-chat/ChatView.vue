<!--
  AI 对话主界面
  布局：
    左侧：会话列表（新建、切换、删除）
    右侧：顶部工具栏（模型选择、系统提示词）+ 消息区 + 输入区
  功能：
    - 流式输出
    - 停止生成
    - Markdown 渲染
    - 空会话提示
-->
<template>
  <div class="chat-view">
    <!-- 左侧：会话列表 -->
    <aside class="session-sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">会话列表</span>
        <div class="sidebar-actions">
          <el-button
            v-if="!batchMode"
            type="primary"
            :icon="Plus"
            size="small"
            @click="handleNewSession"
          >新建</el-button>
          <template v-else>
            <el-button
              size="small"
              :disabled="selectedSessionIds.length === 0"
              type="danger"
              :icon="Delete"
              @click="handleBulkDelete"
            >删除 ({{ selectedSessionIds.length }})</el-button>
            <el-button size="small" @click="exitBatchMode">取消</el-button>
          </template>
        </div>
      </div>

      <div class="sidebar-toolbar">
        <el-tooltip
          v-if="!batchMode && chatStore.hasSessions"
          content="进入批量管理模式，可多选会话后统一删除"
          placement="bottom"
          :show-after="0"
          effect="dark"
        >
          <el-button
            size="small"
            :icon="Delete"
            @click="enterBatchMode"
            class="batch-mode-btn"
          >批量删除</el-button>
        </el-tooltip>
        <span v-else-if="batchMode" class="batch-mode-hint">请选择要删除的会话</span>
      </div>

      <div class="session-list">
        <div
          v-for="session in sortedSessions"
          :key="session.id"
          class="session-item"
          :class="{
            active: chatStore.currentSessionId === session.id,
            'session-item--pinned': isPetAssistant(session),
            'session-item--selected': isSelected(session.id)
          }"
          @click="handleSwitchSession(session)"
        >
          <!-- 批量选择复选框 -->
          <div
            v-if="batchMode"
            class="session-checkbox"
            @click.stop
          >
            <el-checkbox
              :model="isSelected(session.id)"
              :disabled="isPetAssistant(session)"
              @change="toggleSelect(session.id)"
            />
          </div>

          <div class="session-info">
            <div class="session-title">
              <el-icon v-if="isPetAssistant(session)" class="session-pin-icon"><Star /></el-icon>
              {{ getSessionTitle(session) }}
            </div>
            <div class="session-time">{{ formatSessionTime(session.updated_at) }}</div>
          </div>
          <!-- 桌宠助手常驻会话：显示清空记录按钮，不可删除 -->
          <el-button
            v-if="isPetAssistant(session) && !batchMode"
            class="session-clear"
            text
            size="small"
            :icon="Delete"
            @click.stop="handleClearMessages(session)"
          />
          <!-- 普通会话：显示删除按钮 -->
          <el-button
            v-else-if="!batchMode"
            class="session-delete"
            text
            size="small"
            :icon="Delete"
            @click.stop="handleDeleteSession(session)"
          />
        </div>

        <div v-if="!chatStore.hasSessions" class="empty-sessions">
          <el-icon :size="32"><ChatDotRound /></el-icon>
          <p>暂无会话</p>
          <el-button type="primary" size="small" @click="handleNewSession">新建会话</el-button>
        </div>
      </div>
    </aside>

    <!-- 右侧：对话区 -->
    <main class="chat-main">
      <!-- 顶部工具栏 -->
      <header class="chat-header">
        <div class="header-left">
          <ModelCategoryTabs
            v-model="currentModelCategory"
            @change="handleCategoryChange"
          />
          <ModelSelector
            v-model="selectedConfigId"
            :category="currentModelCategory"
            @change="handleConfigChange"
          />
        </div>
        <div class="header-right">
          <el-tooltip content="搜索聊天记录（按 ESC 关闭）" placement="bottom" :show-after="0" effect="dark">
            <el-button :icon="Search" size="small" @click="searchVisible = true">搜索</el-button>
          </el-tooltip>
          <el-tooltip content="资产盒子：查看与管理 AI 生成的图片/视频" placement="bottom" :show-after="0" effect="dark">
            <el-button :icon="FolderOpened" size="small" @click="goToAssets">资产</el-button>
          </el-tooltip>
          <el-tooltip content="设置系统提示词：预设 AI 角色与行为" placement="bottom" :show-after="0" effect="dark">
            <el-button :icon="ChatLineSquare" size="small" @click="systemPromptVisible = true">提示词</el-button>
          </el-tooltip>
        </div>
      </header>

      <!-- 消息区 -->
      <section ref="messageAreaRef" class="message-area">
        <!-- 搜索栏 -->
        <AIChatSearchBar
          v-model:visible="searchVisible"
          :session-id="chatStore.currentSessionId"
          @select="handleSearchSelect"
        />

        <!-- 空会话提示 -->
        <div v-if="!chatStore.currentSession" class="empty-chat">
          <el-icon :size="64" color="#c0c4cc"><ChatDotRound /></el-icon>
          <h2>开始 AI 对话</h2>
          <p>选择左侧会话或新建会话开始对话</p>
          <el-button type="primary" @click="handleNewSession">新建会话</el-button>
        </div>

        <!-- 未配置模型提示 -->
        <div v-else-if="!aiConfigStore.hasConfig" class="empty-chat">
          <el-icon :size="64" color="#c0c4cc"><Setting /></el-icon>
          <h2>未配置 AI 模型</h2>
          <p>请先配置至少一个 AI 模型才能开始对话</p>
          <el-button type="primary" @click="$router.push('/ai-chat/config')">前往配置</el-button>
        </div>

        <!-- 消息列表 -->
        <div v-else class="message-list">
          <MessageBubble
            v-for="(message, index) in chatStore.messages"
            :key="message.id"
            :message="message"
            :data-message-id="message.id"
            :is-streaming="isMessageStreaming(message)"
            :streaming-thinking="isMessageStreaming(message) ? chatStore.streamingThinking : ''"
            :can-regenerate="canRegenerate(index)"
            @regenerate="handleRegenerate"
            @media-retry="handleMediaRetry"
            @media-stop="handleMediaStop"
          />
        </div>
      </section>

      <!-- 输入区 -->
      <footer class="chat-input-area">
        <div v-if="chatStore.error" class="error-banner">
          <el-alert
            :title="chatStore.error"
            type="error"
            show-icon
            closable
            @close="chatStore.clearError()"
          />
        </div>

        <div class="input-wrapper">
          <!-- 图生/视频生二选一选项（可 toggle，互斥，默认都不选表示由 AI 自行判断） -->
          <div class="media-mode-bar">
            <!-- 思考强度下拉选择：''=关闭 / low / medium / high / max，默认从当前语言模型配置 enable_thinking 读取 -->
            <el-select
              v-model="thinkingEffort"
              size="small"
              style="width: 110px"
              @change="handleThinkingEffortChange"
            >
              <template #prefix><el-icon><MagicStick /></el-icon></template>
              <el-option label="标准模式" value="" />
              <el-option label="轻度思考" value="low" />
              <el-option label="中度思考" value="medium" />
              <el-option label="深度思考" value="high" />
              <el-option label="最高思考" value="max" />
            </el-select>
            <el-button
              size="small"
              :type="mediaMode === 'image' ? 'primary' : 'default'"
              @click="toggleMediaMode('image')"
            >
              <el-icon><Picture /></el-icon> 图片生成
            </el-button>
            <el-button
              size="small"
              :type="mediaMode === 'video' ? 'primary' : 'default'"
              @click="toggleMediaMode('video')"
            >
              <el-icon><VideoCamera /></el-icon> 视频生成
            </el-button>
          </div>

          <!-- 附件输入组件 -->
          <ChatAttachmentInput
            v-model:attachments="attachments"
            :disabled="inputDisabled"
            :media-mode="mediaMode"
            @screenshot="handleScreenshot"
          />

          <el-input
            v-model="inputContent"
            type="textarea"
            :rows="3"
            :disabled="inputDisabled"
            :placeholder="inputPlaceholder"
            resize="none"
            @keydown.enter.exact.prevent="handleSend"
          />
          <div class="input-actions">
            <!-- 仅语言流式生成时显示停止按钮；媒体生成的停止按钮在 MediaPlaceholder 中 -->
            <el-button
              v-if="chatStore.isGenerating"
              type="danger"
              :icon="VideoPause"
              @click="handleStop"
            >
              停止生成
            </el-button>
            <el-button
              v-else
              type="primary"
              :icon="sendButtonIcon"
              :disabled="!canSend"
              @click="handleSend"
            >
              {{ sendButtonText }}
            </el-button>
          </div>
        </div>
      </footer>
    </main>

    <!-- 系统提示词对话框 -->
    <el-dialog
      v-model="systemPromptVisible"
      title="系统提示词"
      width="500px"
    >
      <el-input
        v-model="systemPromptDraft"
        type="textarea"
        :rows="8"
        placeholder="设置系统提示词，引导 AI 的行为（留空则不设置）"
      />
      <template #footer>
        <el-button @click="systemPromptVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveSystemPrompt">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import {
  Plus, Delete, Star, ArrowDown, ArrowUp,
  Picture, VideoCamera, VideoPause, Setting, FolderOpened, ChatDotRound, ChatLineSquare,
  PictureFilled, VideoPlay, Download, RefreshRight, Tools, CircleCheckFilled,
  CircleCloseFilled, Loading, InfoFilled, Connection, Promotion, Search, MagicStick
} from '@element-plus/icons-vue'
import { useChatStore } from '@/stores/chat-store'
import { useAiConfigStore } from '@/stores/ai-config-store'
import { useAttachmentStore } from '@/stores/attachment-store'
import { chatApi, mediaApi, mediaAssetApi, on } from '@/utils/ipc-client'
import { saveMediaToLocal } from '@/utils/media-loader'
import { PET_ASSISTANT_SESSION_TITLE } from '@/utils/pet-ai-prompt'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import ModelSelector from '@/components/chat/ModelSelector.vue'
import ModelCategoryTabs from '@/components/chat/ModelCategoryTabs.vue'
import ChatAttachmentInput from '@/components/chat/ChatAttachmentInput.vue'
import AIChatSearchBar from '@/components/chat/AIChatSearchBar.vue'

const router = useRouter()
const chatStore = useChatStore()
const aiConfigStore = useAiConfigStore()
const attachmentStore = useAttachmentStore()

// 跳转到资产盒子页面
function goToAssets () {
  router.push('/ai-chat/assets')
}

// 输入框内容
const inputContent = ref('')
// 当前模型类别（language / image / video），与 chatStore 同步
const currentModelCategory = ref(chatStore.currentModelCategory)
// 按类别分别存储选中的配置 ID，实现模型选项记忆
const selectedConfigIdByCategory = reactive({
  language: '',
  image: '',
  video: ''
})
// 当前选中的配置 ID（按当前类别读写，可读可写）
const selectedConfigId = computed({
  get: () => selectedConfigIdByCategory[currentModelCategory.value] || '',
  set: (val) => { selectedConfigIdByCategory[currentModelCategory.value] = val }
})
// 媒体模式（可 toggle 的两个按钮）：'' / 'image' / 'video'，空字符串表示都不选（由 AI 自行判断）
const mediaMode = ref('')
// 思考强度选择：''=关闭 / low / medium / high / max，默认从当前语言模型配置 enable_thinking 读取
const thinkingEffort = ref('')
// 当前语言模型配置（用于读取 enable_thinking 默认值）
const currentLanguageConfig = computed(() => {
  const configId = aiConfigStore.activeLanguageConfig?.id || aiConfigStore.activeConfig?.id || selectedConfigIdByCategory.language
  return configId ? aiConfigStore.getConfigById(configId) : null
})
// 当当前语言模型配置变化时，同步思考强度默认值：配置 enable_thinking=1 默认 'high'，否则默认 ''（关闭）
watch(() => currentLanguageConfig.value?.id, () => {
  if (currentLanguageConfig.value) {
    thinkingEffort.value = Number(currentLanguageConfig.value.enable_thinking) === 1 ? 'high' : ''
  }
}, { immediate: true })
// 思考强度切换回调（预留 hook，目前无副作用）
function handleThinkingEffortChange () {
  // 切换思考强度时暂无额外动作，预留以便后续扩展
}
// 系统提示词对话框可见性
const systemPromptVisible = ref(false)
// 系统提示词草稿
const systemPromptDraft = ref('')

// 批量删除模式
const batchMode = ref(false)
// 选中的会话 ID 列表
const selectedSessionIds = ref([])
// 消息区引用（用于自动滚动）
const messageAreaRef = ref(null)
// 搜索栏可见性
const searchVisible = ref(false)
// 附件列表
const attachments = ref([])

// 视频轮询控制
let videoPollTimer = null
let videoPollAttempts = 0
const VIDEO_POLL_INTERVAL = 5000   // 轮询间隔 5 秒
const VIDEO_POLL_MAX_ATTEMPTS = 30 // 最大 30 次重试（后端单次最多 10 分钟）
// 媒体生成事件监听取消函数
let mediaProgressUnsubscribers = []
// 上一次媒体生成的上下文（用于重试）
let lastMediaContext = null

// 输入框占位符（根据当前媒体模式切换）
const inputPlaceholder = computed(() => {
  switch (mediaMode.value) {
    case 'image': return '描述你想生成的图片，Enter 发送，Shift+Enter 换行'
    case 'video': return '描述你想生成的视频，Enter 发送，Shift+Enter 换行'
    default: return '输入消息，Enter 发送，Shift+Enter 换行'
  }
})

// 是否正在生成（语言流式或媒体生成）
const isGenerating = computed(() => chatStore.isGenerating || chatStore.isMediaGenerating)

// 输入区禁用状态：仅语言流式生成时禁用，媒体生成时允许继续发送新消息
const inputDisabled = computed(() => !chatStore.currentSession || chatStore.isGenerating)

// 是否可以发送：媒体生成时仍可发送（开始新的语言对话）
const canSend = computed(() => {
  return chatStore.currentSession &&
    !chatStore.isGenerating &&
    (inputContent.value.trim().length > 0 || attachments.value.length > 0)
})

// 发送按钮图标
const sendButtonIcon = computed(() => {
  if (mediaMode.value === 'image') return Picture
  if (mediaMode.value === 'video') return VideoCamera
  return Promotion
})

// 发送按钮文案
const sendButtonText = computed(() => {
  if (mediaMode.value === 'image') return '生成图片'
  if (mediaMode.value === 'video') return '生成视频'
  return '发送'
})

// 判断消息是否正在流式输出
function isMessageStreaming (message) {
  return chatStore.isGenerating &&
    chatStore.streaming.messageId === message.id
}

// 判断是否可以重新生成（最后一条 AI 消息且未在生成中）
function canRegenerate (index) {
  return !isGenerating.value &&
    index === chatStore.messages.length - 1
}

// 判断是否为桌宠助手常驻会话
function isPetAssistant (session) {
  return session && session.title === PET_ASSISTANT_SESSION_TITLE
}

// 会话列表排序：桌宠助手常驻会话始终置顶（只显示数据库中真实存在的会话）
const sortedSessions = computed(() => {
  const list = [...chatStore.sessions]
  // 排序：桌宠助手置顶
  list.sort((a, b) => {
    const aPet = isPetAssistant(a)
    const bPet = isPetAssistant(b)
    if (aPet && !bPet) return -1
    if (!aPet && bPet) return 1
    return 0
  })
  return list
})

// 获取会话显示标题（桌宠助手显示友好名称）
function getSessionTitle (session) {
  if (isPetAssistant(session)) return '星宝助手'
  return session.title
}

// ============================================================
// 会话管理
// ============================================================

// 新建会话
async function handleNewSession () {
  // 确保有可用配置
  if (!aiConfigStore.hasConfig) {
    await aiConfigStore.fetchConfigs()
  }
  if (!aiConfigStore.hasConfig) {
    ElMessage.warning('请先配置 AI 模型')
    return
  }

  // 新建会话始终使用语言模型配置，不受当前标签类别影响
  const configId = aiConfigStore.activeLanguageConfig?.id || aiConfigStore.activeConfig?.id || selectedConfigIdByCategory.language
  if (!configId) {
    ElMessage.warning('请选择 AI 模型')
    return
  }

  try {
    const result = await ElMessageBox.prompt('请输入会话标题', '新建会话', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputValue: `会话 ${chatStore.sessions.length + 1}`,
      inputValidator: (val) => !!val && val.trim().length > 0 || '标题不能为空'
    })
    const session = await chatStore.createSession({
      title: result.value.trim(),
      model_config_id: configId
    })
    if (session) {
      await chatStore.switchSession(session)
      ElMessage.success('会话已创建')
    }
  } catch {
    // 用户取消
  }
}

// 切换会话
async function handleSwitchSession (session) {
  if (chatStore.isGenerating) {
    ElMessage.warning('正在生成中，请先停止')
    return
  }

  await chatStore.switchSession(session)
  // 同步选中配置（会话关联的始终是语言模型配置，写入 language 类别）
  if (session.model_config_id) {
    selectedConfigIdByCategory.language = session.model_config_id
  }
  // 如果当前标签页是语言模型，确保 ModelSelector 显示正确的选中值
  if (currentModelCategory.value === 'language') {
    // 触发 selectedConfigId computed 重新计算（通过重新赋值确保响应式更新）
    selectedConfigId.value = selectedConfigIdByCategory.language
  }
  // 切换会话后滚动到底部
  await scrollToBottom()
}


// 删除会话
async function handleDeleteSession (session) {
  try {
    await ElMessageBox.confirm(`确定删除会话"${session.title}"？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const ok = await chatStore.deleteSession(session.id)
    if (ok) {
      ElMessage.success('会话已删除')
    }
  } catch {
    // 取消
  }
}

// 批量删除模式
function enterBatchMode () {
  batchMode.value = true
  selectedSessionIds.value = []
}

function exitBatchMode () {
  batchMode.value = false
  selectedSessionIds.value = []
}

function isSelected (id) {
  return selectedSessionIds.value.includes(id)
}

function toggleSelect (id) {
  const idx = selectedSessionIds.value.indexOf(id)
  if (idx >= 0) {
    selectedSessionIds.value.splice(idx, 1)
  } else {
    selectedSessionIds.value.push(id)
  }
}

async function handleBulkDelete () {
  if (selectedSessionIds.value.length === 0) return
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selectedSessionIds.value.length} 个会话？此操作不可恢复。`,
      '批量删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    const result = await chatStore.bulkDeleteSessions(selectedSessionIds.value)
    if (result.success > 0) {
      ElMessage.success(`已删除 ${result.success} 个会话`)
    }
    if (result.failed > 0) {
      ElMessage.warning(`${result.failed} 个会话删除失败`)
    }
    exitBatchMode()
  } catch {
    // 取消
  }
}

// 清空会话消息（桌宠助手或普通会话）
async function handleClearMessages (session) {
  try {
    const msg = isPetAssistant(session)
      ? '确定清空桌宠助手的所有消息记录？'
      : '确定清空该会话的所有消息记录？'
    await ElMessageBox.confirm(msg, '提示', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const ok = await chatStore.clearMessages(session.id)
    if (ok) {
      ElMessage.success('记录已清空')
      await scrollToBottom()
    }
  } catch {
    // 取消
  }
}

// ============================================================
// 模型配置变更
// ============================================================

async function handleConfigChange (configId) {
  // 媒体类别下，记录媒体配置 ID（仅用于媒体生成时查找配置）
  // 使用本地 currentModelCategory 判断，不依赖 chatStore.currentModelCategory
  if (currentModelCategory.value === 'image' || currentModelCategory.value === 'video') {
    chatStore.setSelectedMediaConfigId(configId)
    return
  }
  // 语言类别下，如果当前有会话，更新会话关联的模型配置
  if (chatStore.currentSession && chatStore.currentSession.model_config_id !== configId) {
    await chatStore.updateSession({
      id: chatStore.currentSession.id,
      model_config_id: configId
    })
  }
}

// ============================================================
// 模型类别变更
// ============================================================

function handleCategoryChange (category) {
  // ModelCategoryTabs 仅作为配置入口，切换显示哪个类别的配置列表供用户选择/查看
  // 不影响发送逻辑：正常对话始终使用语言模型，图生/视频通过 mediaMode 主动选择
  // 因此不同步到 chatStore.currentModelCategory

  // 如果当前类别已有记忆的选择，直接使用
  if (selectedConfigIdByCategory[category]) {
    // 验证记忆的配置是否仍存在
    const list = aiConfigStore.configsByCategory[category] || []
    if (list.some(c => c.id === selectedConfigIdByCategory[category])) {
      if (category !== 'language') {
        chatStore.setSelectedMediaConfigId(selectedConfigIdByCategory[category])
      }
      return
    }
  }
  // 没有记忆或记忆失效，使用默认值
  selectedConfigId.value = ''
  if (category === 'language') {
    // 语言类别默认选中活跃配置
    const activeConfig = aiConfigStore.activeLanguageConfig || aiConfigStore.activeConfig
    if (activeConfig) {
      selectedConfigId.value = activeConfig.id
    }
  } else {
    // 媒体类别默认选中该类别下活跃配置或第一个配置
    const activeConfig = aiConfigStore.activeConfigByCategory(category)
    if (activeConfig) {
      selectedConfigId.value = activeConfig.id
      chatStore.setSelectedMediaConfigId(activeConfig.id)
    } else {
      const list = aiConfigStore.configsByCategory[category] || []
      if (list.length > 0) {
        selectedConfigId.value = list[0].id
        chatStore.setSelectedMediaConfigId(list[0].id)
      } else {
        chatStore.setSelectedMediaConfigId(null)
      }
    }
  }
}

// ============================================================
// 媒体模式二选一切换（可 toggle：再次点击已选中按钮取消选择）
// ============================================================

function toggleMediaMode (mode) {
  if (mediaMode.value === mode) {
    mediaMode.value = ''  // 取消选择，回到默认（由 AI 自行判断）
  } else {
    mediaMode.value = mode
  }
}

// ============================================================
// 消息发送
// ============================================================

async function handleSend () {
  if (!canSend.value) return
  const content = inputContent.value.trim()
  const currentAttachments = [...attachments.value]
  inputContent.value = ''
  attachments.value = []

  // 媒体模式（图生/视频）走媒体生成 API（非阻塞，后台执行，用户可继续对话）
  if (mediaMode.value === 'image' || mediaMode.value === 'video') {
    handleMediaGenerate(content, mediaMode.value).then(() => scrollToBottom())
    return
  }

  // 默认走语言模型聊天流式 API
  // 始终使用语言模型的活跃配置，不受顶部标签类别影响
  const languageConfigId = aiConfigStore.activeLanguageConfig?.id || aiConfigStore.activeConfig?.id || selectedConfigIdByCategory.language
  const ok = await chatStore.sendMessage(content, {
    config_id: languageConfigId || undefined,
    attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    enable_thinking: thinkingEffort.value !== '',
    reasoning_effort: thinkingEffort.value || undefined
  })
  if (!ok && chatStore.error) {
    ElMessage.error(chatStore.error)
  }

  // 滚动到底部
  await scrollToBottom()
}

// 生成当前时间戳（YYYY-MM-DD HH:mm:ss，本地时间）
function nowTimestamp () {
  return dayjs().format('YYYY-MM-DD HH:mm:ss')
}

// 媒体生成（图生/视频），mediaType: 'image' | 'video'
async function handleMediaGenerate (prompt, mediaType) {
  if (!prompt) {
    ElMessage.warning('请输入生成描述')
    return
  }
  if (mediaType !== 'image' && mediaType !== 'video') {
    ElMessage.warning('未指定媒体类型')
    return
  }
  // 从对应类别下找配置：优先使用该类别下选中的配置，否则取该类别下第一个
  const list = aiConfigStore.configsByCategory[mediaType] || []
  let configId = ''
  const categorySelectedId = selectedConfigIdByCategory[mediaType] || ''
  if (categorySelectedId && list.some(c => c.id === categorySelectedId)) {
    configId = categorySelectedId
  } else if (list.length > 0) {
    configId = list[0].id
  }
  if (!configId) {
    ElMessage.warning(mediaType === 'image' ? '未配置图生模型，请先前往配置' : '未配置视频模型，请先前往配置')
    return
  }
  // 获取配置以取得模型名
  const config = aiConfigStore.getConfigById(configId)
  const modelName = config?.model_name || ''

  // 启动媒体生成状态，获取占位消息 ID
  let placeholderId = chatStore.startMediaGeneration(mediaType, configId, prompt)
  // 记算视频预计耗时（秒），用于占位文案
  const estimatedSeconds = mediaType === 'video' ? estimateVideoSeconds(config) : 0

  // 在消息列表中追加一条用户提示消息（保存到数据库）
  const userMessage = {
    id: `local-user-${Date.now()}`,
    session_id: chatStore.currentSessionId,
    role: 'user',
    content: prompt,
    is_complete: 1,
    created_at: nowTimestamp()
  }
  chatStore.messages.push(userMessage)
  // 保存用户消息到数据库
  try {
    const saved = await chatApi.createMessage({
      session_id: chatStore.currentSessionId,
      role: 'user',
      content: prompt,
      is_complete: 1
    })
    if (saved?.id) userMessage.id = saved.id
  } catch (err) {
    console.error('[ChatView] 保存用户消息失败:', err)
  }

  // 占位 assistant 消息（携带 mediaType 字段，由 MessageBubble 渲染 MediaPlaceholder）
  const placeholderMessage = {
    id: placeholderId,
    session_id: chatStore.currentSessionId,
    role: 'assistant',
    content: '',
    is_complete: 0,
    created_at: nowTimestamp(),
    mediaType,
    mediaStatus: 'pending',
    mediaProgress: 0,
    mediaError: '',
    mediaEstimatedSeconds: estimatedSeconds
  }
  chatStore.messages.push(placeholderMessage)
  // 保存占位消息到数据库
  try {
    const saved = await chatApi.createMessage({
      session_id: chatStore.currentSessionId,
      role: 'assistant',
      content: '',
      is_complete: 0
    })
    if (saved?.id) {
      placeholderMessage.id = saved.id
      placeholderId = saved.id
    }
  } catch (err) {
    console.error('[ChatView] 保存占位消息失败:', err)
  }

  // 记算视频预计耗时（秒），用于占位文案
  // 保存上下文便于重试
  lastMediaContext = { prompt, configId, modelName, mediaType, placeholderId }

  // 监听视频进度事件（仅视频需要）
  if (mediaType === 'video') {
    setupMediaProgressListeners(placeholderId)
  }

  try {
    // 调用通用媒体生成 API
    const result = await mediaApi.generate({
      prompt,
      config_id: configId,
      model_name: modelName,
      category: mediaType
    })
    console.log('[ChatView] mediaApi.generate 返回:', { url: result?.url?.substring(0, 60), b64: !!result?.b64_json, taskId: result?.task_id, videoId: result?.video_id })

    // 用户在生成期间点击了"停止生成"
    if (!chatStore.isMediaGenerating) {
      console.log('[ChatView] 媒体生成已被用户取消')
      return
    }

    // 直接返回 url 或 b64_json（同步生成完成，常见于图片）
    const resultUrl = result?.url || (result?.b64_json ? `data:image/png;base64,${result.b64_json}` : null)
    if (resultUrl) {
      await finalizeMediaPlaceholder(placeholderId, resultUrl, mediaType, {
        prompt,
        model: modelName,
        configId
      })
      chatStore.finishMediaGeneration({ url: resultUrl })
      cleanupMediaProgressListeners()
      await scrollToBottom()
      return
    }

    // 返回 task_id（异步任务，常见于视频）
    if (result?.task_id || result?.video_id) {
      const taskId = result.task_id || result.video_id
      const videoId = result.video_id || result.task_id
      chatStore.setMediaTaskId(taskId)
      // 构造 meta，供 finalizeMediaPlaceholder 保存到资产盒子
      const taskMeta = { prompt, model: modelName, configId }
      // 视频需要轮询（传 video_id 给后端）
      if (mediaType === 'video') {
        await pollVideoTask(videoId, placeholderId, mediaType, taskMeta)
      } else {
        // 图片异步任务（罕见）也走轮询
        await pollVideoTask(videoId, placeholderId, mediaType, taskMeta)
      }
      return
    }

    // 既无 url/b64_json 也无 task_id
    throw new Error(`生成完成，但未返回结果。返回值: ${JSON.stringify(result).substring(0, 200)}`)
  } catch (err) {
    console.error('[ChatView] 媒体生成失败:', err)
    // 仅当消息尚未标记为成功时才标记为错误（避免覆盖已成功的状态）
    const msg = chatStore.messages.find(m => m.id === placeholderId)
    if (msg && msg.mediaStatus !== 'success') {
      markMediaError(placeholderId, err.message || '媒体生成失败')
    }
    chatStore.setMediaError(err.message || '媒体生成失败')
    cleanupMediaProgressListeners()
  }
}

// 估算视频生成耗时（秒）
function estimateVideoSeconds (config) {
  // 简单启发式：默认 60 秒，配置中若有 estimated_seconds 字段则使用
  if (config?.estimated_seconds) return Number(config.estimated_seconds)
  return 60
}

// 完成占位消息：替换为实际媒体内容，并自动保存到资产盒子
async function finalizeMediaPlaceholder (placeholderId, url, mediaType, meta = {}) {
  console.log('[ChatView] finalizeMediaPlaceholder 被调用:', { placeholderId, urlType: url?.substring(0, 30), mediaType, meta })
  const message = chatStore.messages.find(m => m.id === placeholderId)
  if (!message) {
    console.warn('[ChatView] finalizeMediaPlaceholder: 占位消息未找到:', placeholderId)
    return
  }
  if (mediaType === 'image') {
    message.content = `![生成图片](${url})`
  } else {
    message.content = `<video src="${url}" controls></video>`
  }
  message.is_complete = 1
  message.mediaStatus = 'success'
  message.mediaProgress = 100
  // 设置 mediaMetadata，供 MessageBubble 显示元信息与 URL
  message.mediaMetadata = {
    url,
    model: meta.model || '',
    ...meta
  }

  // 更新数据库中的消息内容
  try {
    await chatApi.updateMessage({
      id: placeholderId,
      content: message.content,
      is_complete: 1
    })
  } catch (err) {
    console.error('[ChatView] 更新数据库消息失败:', err)
  }

  // 自动保存到资产盒子（失败不影响聊天流程，仅打印错误）
  let assetResult = null
  try {
    console.log('[ChatView] 保存到资产盒子:', {
      type: mediaType,
      url: url.substring(0, 80),
      configId: meta.configId,
      sessionId: chatStore.currentSessionId,
      placeholderId
    })
    assetResult = await mediaAssetApi.create({
      type: mediaType,
      url: url,
      thumbnail_url: mediaType === 'image' ? url : null,
      prompt: meta.prompt || '',
      model_name: meta.model || '',
      config_id: meta.configId || '',
      session_id: chatStore.currentSessionId || '',
      message_id: placeholderId,
      metadata: JSON.stringify(meta)
    })
    console.log('[ChatView] 资产盒子保存成功:', assetResult)
    ElMessage.success('已收纳到资产盒子')
  } catch (err) {
    console.error('[ChatView] 保存到资产盒子失败:', err)
    console.error('[ChatView] 资产盒子保存失败详情:', {
      message: err.message,
      code: err.code,
      channel: err.channel
    })
    ElMessage.error(`资产盒子保存失败: ${err.message || err}`)
  }

  // 后台异步下载保存到本地磁盘（不阻塞首次显示，首次显示仍通过 URL 加载）
  // 保存成功后设置 localPath，后续切换会话再回来时从本地读取（快速磁盘 IO）
  // 使用 saveMediaToLocal（走 media-loader.js），更新 localPathCache 避免重复下载
  ;(async () => {
    try {
      console.log('[ChatView] 后台下载保存到本地:', url.substring(0, 80))
      const result = await saveMediaToLocal(url)
      console.log('[ChatView] saveMediaToLocal 返回:', result)
      if (!result) return
      const { localPath } = result
      // saveMediaToLocal 不返回 dataUrl，需要单独读取
      const { mediaApi } = await import('@/utils/ipc-client')
      const readResult = await mediaApi.readLocalFile(localPath)
      message.mediaMetadata.localPath = localPath
      message.mediaMetadata.dataUrl = readResult?.dataUrl
      console.log('[ChatView] 本地保存成功:', localPath)
      ElMessage.success(`资源已保存到本地`)
      // 更新资产记录的 file_path（仅在未设置时更新）
      if (assetResult?.id && !assetResult.file_path) {
        await mediaAssetApi.updatePath(assetResult.id, localPath)
        console.log('[ChatView] 资产 file_path 已更新')
      }
    } catch (err) {
      console.error('[ChatView] 本地保存失败:', err)
      console.error('[ChatView] saveMediaToLocal 失败详情:', {
        message: err.message,
        code: err.code,
        channel: err.channel
      })
      ElMessage.error(`本地保存失败: ${err.message || err}`)
    }
  })()
}

// 标记占位消息为错误状态
function markMediaError (placeholderId, errorMessage) {
  const message = chatStore.messages.find(m => m.id === placeholderId)
  if (!message) return
  message.is_complete = 0
  message.mediaStatus = 'error'
  message.mediaError = errorMessage
}

// ============================================================
// 视频轮询
// ============================================================

async function pollVideoTask (videoId, placeholderId, mediaType = 'video', meta = {}) {
  // 重入保护：清理上一轮未结束的轮询定时器，避免并行轮询链泄漏
  if (videoPollTimer) {
    clearTimeout(videoPollTimer)
    videoPollTimer = null
  }
  videoPollAttempts = 0

  const poll = async () => {
    // 用户已取消生成
    if (!chatStore.isMediaGenerating) {
      console.log('[ChatView] 视频轮询被取消')
      cleanupMediaProgressListeners()
      return
    }
    videoPollAttempts++
    try {
      // 传 video_id、config_id、model_name 给后端
      const result = await mediaApi.videoPoll({
        video_id: videoId,
        config_id: meta.configId,
        model_name: meta.model
      })
      // 再次检查取消状态
      if (!chatStore.isMediaGenerating) {
        cleanupMediaProgressListeners()
        return
      }

      // 兼容多种完成状态：completed / succeeded / progress=100
      const isCompleted = result?.status === 'completed' ||
        result?.status === 'succeeded' ||
        result?.code === 1 ||
        result?.progress === 100
      // 提取 URL：优先 url，其次 metadata.url / data.url / result_url
      const resultUrl = result?.url ||
        result?.metadata?.url ||
        result?.data?.url ||
        result?.result_url ||
        result?.video_url

      if (isCompleted && resultUrl) {
        await finalizeMediaPlaceholder(placeholderId, resultUrl, mediaType, {
          ...meta,
          videoId
        })
        chatStore.finishMediaGeneration({ url: resultUrl, taskId: videoId })
        cleanupMediaProgressListeners()
        await scrollToBottom()
        return
      }

      if (result?.status === 'failed' || result?.code === -1) {
        const errMsg = result.error || result.message || '视频生成失败'
        markMediaError(placeholderId, errMsg)
        chatStore.setMediaError(errMsg)
        cleanupMediaProgressListeners()
        return
      }

      // 更新进度
      if (typeof result?.progress === 'number') {
        chatStore.updateMediaProgress(result.progress)
        const message = chatStore.messages.find(m => m.id === placeholderId)
        if (message) message.mediaProgress = result.progress
      }

      // 继续轮询
      if (videoPollAttempts < VIDEO_POLL_MAX_ATTEMPTS) {
        videoPollTimer = setTimeout(poll, VIDEO_POLL_INTERVAL)
      } else {
        const errMsg = '视频生成超时（5 分钟未完成）'
        markMediaError(placeholderId, errMsg)
        chatStore.setMediaError(errMsg)
        cleanupMediaProgressListeners()
        ElMessage.warning(errMsg)
      }
    } catch (err) {
      console.error('[ChatView] 视频轮询失败:', err)
      if (!chatStore.isMediaGenerating) {
        cleanupMediaProgressListeners()
        return
      }
      // 仅当消息尚未标记为成功时才标记为错误（避免覆盖已成功的状态）
      const msg = chatStore.messages.find(m => m.id === placeholderId)
      if (msg && msg.mediaStatus === 'success') {
        // 已成功，不覆盖状态，仅清理
        cleanupMediaProgressListeners()
        return
      }
      // 网络错误等：继续重试直到达到上限
      if (videoPollAttempts < VIDEO_POLL_MAX_ATTEMPTS) {
        videoPollTimer = setTimeout(poll, VIDEO_POLL_INTERVAL)
      } else {
        markMediaError(placeholderId, err.message || '视频轮询失败')
        chatStore.setMediaError(err.message || '视频轮询失败')
        cleanupMediaProgressListeners()
      }
    }
  }

  poll()
}

// ============================================================
// 媒体进度事件监听
// ============================================================

function setupMediaProgressListeners (placeholderId) {
  cleanupMediaProgressListeners()
  // 监听 agnes 与通用媒体通道的视频进度事件
  const unsub1 = on('agnes:video:progress', (data) => {
    handleVideoProgressEvent(data, placeholderId)
  })
  const unsub2 = on('media:video:progress', (data) => {
    handleVideoProgressEvent(data, placeholderId)
  })
  mediaProgressUnsubscribers = [unsub1, unsub2]
}

function handleVideoProgressEvent (data, placeholderId) {
  // 仅处理当前任务的事件
  if (!chatStore.isMediaGenerating) return
  if (data?.task_id && chatStore.mediaGenerating.taskId && data.task_id !== chatStore.mediaGenerating.taskId) {
    return
  }
  if (typeof data?.progress === 'number') {
    chatStore.updateMediaProgress(data.progress)
    const message = chatStore.messages.find(m => m.id === placeholderId)
    if (message) message.mediaProgress = data.progress
  }
}

function cleanupMediaProgressListeners () {
  for (const unsub of mediaProgressUnsubscribers) {
    if (typeof unsub === 'function') unsub()
  }
  mediaProgressUnsubscribers = []
}

function cleanupMediaGeneration () {
  if (videoPollTimer) {
    clearTimeout(videoPollTimer)
    videoPollTimer = null
  }
  cleanupMediaProgressListeners()
  // 仅在媒体生成活跃时才取消，避免组件卸载时无操作也触发日志
  if (chatStore.isMediaGenerating) {
    chatStore.cancelMediaGeneration()
  }
}

// 停止生成（语言流式 / 媒体生成）
async function handleStop () {
  if (chatStore.isMediaGenerating) {
    cleanupMediaGeneration()
    ElMessage.info('已停止媒体生成')
    return
  }
  await chatStore.stopGeneration()
}

// 媒体停止生成（来自 MessageBubble 的 media-stop 事件，由 MediaPlaceholder 触发）
function handleMediaStop (message) {
  cleanupMediaGeneration()
  ElMessage.info('已停止媒体生成')
}

// 重新生成
async function handleRegenerate () {
  await chatStore.regenerate()
  await scrollToBottom()
}

// 媒体重试（来自 MessageBubble 的 media-retry 事件）
async function handleMediaRetry (message) {
  if (!lastMediaContext) {
    ElMessage.warning('无法重试：未找到上次生成的上下文')
    return
  }
  // 清理旧占位消息
  if (message?.id) {
    const idx = chatStore.messages.findIndex(m => m.id === message.id)
    if (idx !== -1) chatStore.messages.splice(idx, 1)
  }
  // 重置媒体生成状态
  chatStore.cancelMediaGeneration()
  // 重新触发生成（复用上次的 prompt / configId / mediaType）
  const { prompt, mediaType } = lastMediaContext
  await handleMediaGenerate(prompt, mediaType)
  await scrollToBottom()
}

// ============================================================
// AI 回复媒体生成意图确认
// ============================================================

/**
 * 处理 AI 回复中的媒体生成意图确认
 * 弹出对话框让用户选择是否生成
 * @param {object} intent { type: 'image'|'video', prompt: string }
 * @param {object} message 包含意图的 AI 消息对象
 */
async function handleMediaIntentConfirmation (intent, message) {
  const typeLabel = intent.type === 'image' ? '图片' : '视频'
  try {
    const result = await ElMessageBox.confirm(
      `AI 建议生成${typeLabel}：${intent.prompt || intent.url}\n\n是否立即生成？`,
      '生成确认',
      {
        confirmButtonText: '生成',
        cancelButtonText: '取消',
        type: 'info',
        distinguishCancelAndClose: true,
        showClose: true
      }
    )
    if (result === 'confirm') {
      // 用户确认生成
      // 如果 AI 已经返回了 URL，直接使用该 URL 完成生成
      // 否则使用 prompt 触发新的生成
      if (intent.isDirectUrl && intent.url) {
        // AI 已经生成了图片，直接使用
        await finalizeMediaPlaceholder(message.id, intent.url, intent.type, {
          prompt: intent.prompt || '',
          model: '',
          configId: selectedConfigIdByCategory.language
        })
        chatStore.finishMediaGeneration({ url: intent.url })
        await scrollToBottom()
      } else {
        // 需要触发新的生成
        // 清除原消息中的意图标记
        const cleanContent = intent.type === 'image'
          ? message.content.replace(/!\[[^\]]*\]\([^)]+\)/, '').trim()
          : message.content.replace(/<video[^>]*>.*?<\/video>/s, '').trim()
        message.content = cleanContent

        // 找到或创建媒体占位消息
        let placeholderMessage = chatStore.messages.find(m =>
          m.mediaType === intent.type && m.mediaStatus === 'pending'
        )
        if (!placeholderMessage) {
          placeholderMessage = {
            id: `local-media-${Date.now()}`,
            session_id: chatStore.currentSessionId,
            role: 'assistant',
            content: '',
            is_complete: 0,
            created_at: nowTimestamp(),
            mediaType: intent.type,
            mediaStatus: 'pending',
            mediaProgress: 0,
            mediaError: ''
          }
          chatStore.messages.push(placeholderMessage)
        }

        // 触发媒体生成
        await handleMediaGenerate(intent.prompt, intent.type)
        await scrollToBottom()
      }
    }
  } catch {
    // 用户取消或关闭对话框，不做任何操作
    console.log('[ChatView] 用户取消了媒体生成确认')
  }
}

// ============================================================
// 系统提示词
// ============================================================

function handleSaveSystemPrompt () {
  if (chatStore.currentSession) {
    chatStore.updateSession({
      id: chatStore.currentSession.id,
      system_prompt: systemPromptDraft.value
    })
  }
  systemPromptVisible.value = false
  ElMessage.success('系统提示词已保存')
}

// 监听系统提示词对话框打开，加载当前值
watch(systemPromptVisible, (visible) => {
  if (visible) {
    systemPromptDraft.value = chatStore.currentSession?.system_prompt || ''
  }
})

// ============================================================
// 自动滚动
// ============================================================

async function scrollToBottom () {
  await nextTick()
  if (messageAreaRef.value) {
    messageAreaRef.value.scrollTop = messageAreaRef.value.scrollHeight
  }
}

// 监听消息变化自动滚动
watch(() => chatStore.messages.length, () => scrollToBottom())
watch(() => chatStore.streaming.accumulatedContent, () => scrollToBottom())

// 监听工具调用事件，弹出确认框
watch(() => chatStore.pendingToolCall, (toolCall) => {
  if (!toolCall) return
  handleToolCallConfirmation(toolCall)
})

/**
 * 处理工具调用确认
 * AI 通过 Function Calling 请求生成媒体时，弹出确认框让用户选择
 * 同时显示上下文注入信息
 * @param {object} toolCall { type, prompt, name, toolCallId, messageId, toolCallCount, contextInfo }
 */
async function handleToolCallConfirmation (toolCall) {
  const typeLabel = toolCall.type === 'image' ? '图片' : '视频'
  const toolNameLabel = toolCall.name === 'generate_image' ? '生图模型' : '生视频模型'

  // 构建上下文摘要
  const contextSummary = toolCall.contextInfo?.description || `AI 正在调用 ${toolNameLabel} 工具`
  const contextDetail = toolCall.toolCallCount > 1
    ? `\n\n上下文：这是第 ${toolCall.toolCallCount} 次工具调用`
    : ''

  try {
    await ElMessageBox.confirm(
      `${contextSummary}\n\n${typeLabel}提示词：${toolCall.prompt}${contextDetail}\n\n是否立即生成？`,
      'AI 工具调用确认',
      {
        confirmButtonText: '生成',
        cancelButtonText: '取消',
        type: 'info',
        distinguishCancelAndClose: true,
        showClose: true
      }
    )
    // 用户确认，更新状态并触发生成
    chatStore.updateToolCallStatus(toolCall.messageId, toolCall.toolCallId, 'success')
    chatStore.clearPendingToolCall()
    await handleMediaGenerate(toolCall.prompt, toolCall.type)
    await scrollToBottom()
  } catch {
    // 用户取消，更新状态
    chatStore.updateToolCallStatus(toolCall.messageId, toolCall.toolCallId, 'cancelled')
    chatStore.clearPendingToolCall()
    console.log('[ChatView] 用户取消了工具调用确认')
  }
}

// 监听流式结束，检测媒体生成意图
watch(() => chatStore.streaming.isStreaming, (isStreaming) => {
  if (!isStreaming && chatStore.streaming.messageId) {
    // 流式结束，检测最后一条 AI 消息是否包含媒体生成意图
    const lastMessage = chatStore.messages[chatStore.messages.length - 1]
    if (lastMessage?.role === 'assistant' && lastMessage?.content) {
      const intent = chatStore.detectMediaIntent(lastMessage.content)
      if (intent?.hasIntent) {
        handleMediaIntentConfirmation(intent, lastMessage)
      }
    }
  }
})

// 格式化会话时间
// 使用 dayjs 解析本地时间字符串，避免 new Date() 时区解析歧义（数据库存储的是本地时间）
function formatSessionTime (time) {
  if (!time) return ''
  const d = dayjs(time)
  if (!d.isValid()) return ''
  const diff = Date.now() - d.valueOf()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return d.format('MM-DD')
}

// 截图处理
function handleScreenshot (attachment) {
  // 截图已添加到附件列表
  console.log('[ChatView] 截图已添加:', attachment)
}

// 搜索结果显示处理
function handleSearchSelect (result) {
  if (!result || !result.id) return
  const el = messageAreaRef.value?.querySelector(`[data-message-id="${result.id}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('search-highlight')
    setTimeout(() => el.classList.remove('search-highlight'), 2000)
  }
}

// ============================================================
// 生命周期
// ============================================================

onMounted(async () => {
  // 初始化流式事件监听
  chatStore.initStreamListeners()
  // 拉取会话列表与配置列表
  await Promise.all([
    chatStore.fetchSessions(),
    aiConfigStore.fetchConfigs()
  ])
  // 确保桌宠助手常驻会话存在（统一入口，避免占位假 ID 导致 FOREIGN KEY 错误）
  await chatStore.ensurePetAssistantSession()
  // 刷新会话列表以反映新创建的桌宠助手会话
  await chatStore.fetchSessions()
  // 为每个类别初始化默认选中的配置（优先使用活跃配置，回退到列表第一个）
  const categories = ['language', 'image', 'video']
  for (const cat of categories) {
    if (!selectedConfigIdByCategory[cat]) {
      const activeConfig = aiConfigStore.activeConfigByCategory(cat)
      if (activeConfig) {
        selectedConfigIdByCategory[cat] = activeConfig.id
      } else {
        const list = aiConfigStore.configsByCategory[cat] || []
        if (list.length > 0) {
          selectedConfigIdByCategory[cat] = list[0].id
        }
      }
    }
  }
  // 如果有当前会话和消息，滚动到底部（从其他页面切回时也需要）
  if (chatStore.currentSessionId && chatStore.messages.length > 0) {
    await scrollToBottom()
  }
})

onBeforeUnmount(() => {
  chatStore.destroyStreamListeners()
  // 清理媒体生成资源（轮询定时器、事件监听）
  cleanupMediaGeneration()
})
</script>

<style scoped lang="scss">
.chat-view {
  position: absolute;
  inset: 0;
  display: flex;
  background: #fff;
}

// 左侧会话列表
.session-sidebar {
  flex-shrink: 0;
  width: 240px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e4e7ed;
  background: #fafafa;

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #e4e7ed;

    .sidebar-title {
      font-size: 14px;
      font-weight: 600;
      color: #303133;
    }
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .session-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background: #ecf5ff;

      .session-delete,
      .session-clear {
        opacity: 1;
      }
    }

    &.active {
      background: #e8f0fe;
    }

    // 桌宠助手常驻会话样式
    &--pinned {
      .session-pin-icon {
        color: #e6a23c;
        margin-right: 4px;
        vertical-align: middle;
      }

      .session-clear {
        // 常驻会话的清空按钮始终可见（低透明度，hover 时高亮）
        opacity: 0.4;
      }
    }

    .session-info {
      flex: 1;
      min-width: 0;
    }

    .session-title {
      font-size: 13px;
      color: #303133;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .session-time {
      font-size: 11px;
      color: #909399;
      margin-top: 2px;
    }

    .session-delete,
    .session-clear {
      opacity: 0;
      transition: opacity 0.2s;
    }
  }

  .empty-sessions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    color: #909399;

    p {
      margin: 0;
      font-size: 13px;
    }
  }

  // 批量删除模式
  .sidebar-toolbar {
    padding: 4px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .batch-mode-btn {

    font-size: 12px;
  }

  .batch-mode-hint {
    font-size: 12px;
    color: var(--el-color-primary);
  }

  .session-item--selected {
    background: #f0f9eb !important;
  }

  .session-checkbox {
    padding-right: 4px;
  }

  .session-delete,
  .session-clear {
    opacity: 0;
    transition: opacity 0.2s;
    color: #909399;

    &:hover {
      color: var(--el-color-danger);
    }
  }
}

// 右侧对话区
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e7ed;
  background: #fff;

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.message-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px;
  background: #f5f7fa;

  // 搜索结果定位高亮
  :deep(.message-bubble.search-highlight) {
    box-shadow: 0 0 0 2px #409eff;
    border-radius: 8px;
    transition: box-shadow 0.3s ease;
  }

  .empty-chat {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: #909399;

    h2 {
      margin: 8px 0 0;
      font-size: 18px;
      color: #606266;
    }

    p {
      margin: 0;
      font-size: 14px;
    }
  }

  .message-list {
    max-width: 900px;
    margin: 0 auto;
  }
}

.chat-input-area {
  flex-shrink: 0;
  border-top: 1px solid #e4e7ed;
  background: #fff;
  padding: 12px 16px;

  .error-banner {
    margin-bottom: 8px;
  }

  .input-wrapper {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 900px;
    margin: 0 auto;

    .media-mode-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 0;

      :deep(.el-button) {
        font-size: 12px;
        padding: 6px 12px;

        .el-icon {
          margin-right: 4px;
        }
      }
    }

    .el-textarea {
      flex: 1;
    }

    .input-actions {
      flex-shrink: 0;
      align-self: flex-end;
    }
  }
}

// 暗色模式适配
[data-theme='dark'] {
  .chat-view {
    background: #1d1e1f;
  }

  .session-sidebar {
    border-right-color: #414243;
    background: #252526;

    .sidebar-header {
      border-bottom-color: #414243;

      .sidebar-title {
        color: #e5eaf3;
      }
    }

    .session-item {
      &:hover {
        background: #2b2d30;
      }

      &.active {
        background: #36383c;
      }

      .session-title {
        color: #e5eaf3;
      }

      .session-time {
        color: #909399;
      }
    }

    // 空会话提示暗色适配
    .empty-sessions {
      color: #a3a6ad;
    }
  }

  .chat-header {
    border-bottom-color: #414243;
    background: #1d1e1f;
  }

  .message-area {
    background: #1d1e1f;

    .empty-chat {
      color: #909399;

      h2 {
        color: #bfcbd9;
      }
    }
  }

  .chat-input-area {
    border-top-color: #414243;
    background: #1d1e1f;

    .input-wrapper {
      .media-mode-bar {
        // 默认按钮（未选中）暗色样式
        :deep(.el-button:not(.el-button--primary)) {
          background: #2b2d30;
          border-color: #414243;
          color: #bfcbd9;

          &:hover {
            background: #36383c;
            border-color: #6c6d70;
            color: #e5eaf3;
          }
        }

        // 选中按钮（primary）暗色样式保持 Element Plus 默认主色
        :deep(.el-button--primary) {
          background: #409eff;
          border-color: #409eff;
          color: #fff;

          &:hover {
            background: #66b1ff;
            border-color: #66b1ff;
            color: #fff;
          }
        }
      }
    }
  }
}

// 暗色主题适配
html.dark {
  .chat-view {
    .session-sidebar {
      background: #141414;
      border-right-color: #303133;

      .sidebar-header {
        .sidebar-title {
          color: #e5eaf3;
        }
      }

      .sidebar-toolbar {

        .batch-mode-hint {
          color: #409eff;
        }
      }

      .session-list {
        .session-item {
          color: #cfd3dc;

          &:hover {
            background: #252627;

            .session-delete,
            .session-clear {
              opacity: 1;
              color: #a3a6ad;

              &:hover {
                color: #f56c6c;
              }
            }
          }

          &.active {
            background: #2563eb;
            color: #fff;

            .session-time {
              color: rgba(255, 255, 255, 0.7);
            }
          }

          &--selected {
            background: #2563eb !important;
            color: #fff;
          }

          &--pinned {
            .session-pin-icon {
              color: #e6a23c;
            }
          }

          .session-info {
            .session-title {
              color: inherit;
            }

            .session-time {
              color: #8d9095;
            }
          }
        }

        .empty-sessions {
          color: #8d9095;
        }
      }
    }
  }
}
</style>
