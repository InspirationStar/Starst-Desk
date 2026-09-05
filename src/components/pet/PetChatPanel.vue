<!--
  桌宠 AI 对话面板
  职责：提供常驻 AI 对话界面，包含消息列表、输入框、提示词管理
  Props:
    - messages: 消息列表 [{ role, content, id }]
    - streaming: 是否正在生成
    - systemPrompt: 当前系统提示词
    - streamingContent: 流式生成中的实时内容
  Emits:
    - send: 用户发送消息 (content, attachments, thinkingEffort)
    - clear: 清空消息记录
    - update-prompt: 更新系统提示词 (prompt)
    - generate-prompt: 让 AI 根据用户要求生成提示词 (requirement)
    - close: 关闭面板
  设计：
    - 紧凑布局，适配桌宠窗口（最大宽度 520px）
    - 消息列表可滚动，用户/AI 消息左右区分
    - 流式生成时实时显示内容
    - 提示词设置可展开/收起
    - 暗色模式适配
-->
<template>
  <div class="pet-chat-panel" :style="{ opacity: panelOpacity }" @mouseenter="$emit('mouseenter')" @mouseleave="$emit('mouseleave')">
    <!-- 标题栏 -->
    <div class="chat-header">
      <div class="chat-header__title">
        <span class="chat-header__icon">🤖</span>
        <span>星宝 AI</span>
      </div>
      <div class="chat-header__actions">
        <button class="chat-header__btn" title="透明度" @click="showOpacitySlider = !showOpacitySlider">
          <el-icon><Sunny /></el-icon>
        </button>
        <button class="chat-header__btn" title="提示词设置" @click="showSettings = !showSettings">
          <el-icon><Setting /></el-icon>
        </button>
        <button class="chat-header__btn" title="清空记录" @click="$emit('clear')">
          <el-icon><Delete /></el-icon>
        </button>
        <button class="chat-header__btn" title="关闭" @click="$emit('close')">
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </div>

    <!-- 透明度滑杆（标题栏下方展开） -->
    <transition name="slide-down">
      <div v-if="showOpacitySlider" class="chat-opacity">
        <span class="chat-opacity__label">透明度</span>
        <el-slider
          v-model="panelOpacity"
          :min="0.3"
          :max="1"
          :step="0.05"
          :show-tooltip="false"
          class="chat-opacity__slider"
        />
        <span class="chat-opacity__value">{{ Math.round(panelOpacity * 100) }}%</span>
      </div>
    </transition>

    <!-- 提示词设置区域（可展开） -->
    <transition name="slide-down">
      <div v-if="showSettings" class="chat-settings">
        <div class="chat-settings__label">人设提示词</div>
        <el-input
          v-model="promptDraft"
          type="textarea"
          :rows="8"
          resize="vertical"
          placeholder="输入桌宠 AI 的人设提示词..."
          class="chat-settings__input"
        />
        <div class="chat-settings__actions">
          <el-button size="small" type="primary" @click="handleSavePrompt">保存提示词</el-button>
          <el-button size="small" @click="handleResetPrompt">恢复默认</el-button>
        </div>
        <div class="chat-settings__divider">— 或让 AI 生成 —</div>
        <div class="chat-settings__generate">
          <el-input
            v-model="generateRequirement"
            size="small"
            placeholder="描述你的需求，如：让星宝更幽默一点"
            @keyup.enter="handleGeneratePrompt"
          />
          <el-button size="small" :loading="generating" @click="handleGeneratePrompt">生成</el-button>
        </div>
        <div class="chat-settings__divider">— 生成规范（提示词的提示词）—</div>
        <div class="chat-settings__label">生成规范</div>
        <el-input
          v-model="metaPromptDraft"
          type="textarea"
          :rows="6"
          resize="vertical"
          placeholder="定义 AI 生成人设提示词时的规范，如结构、风格、约束..."
          class="chat-settings__input"
        />
        <div class="chat-settings__actions">
          <el-button size="small" type="primary" @click="handleSaveMetaPrompt">保存规范</el-button>
          <el-button size="small" @click="handleResetMetaPrompt">恢复默认</el-button>
        </div>
      </div>
    </transition>

    <!-- 上下文注入提示（可折叠） -->
    <div v-if="injectedContext" class="chat-context">
      <button class="chat-context__toggle" @click="showContext = !showContext">
        <span class="chat-context__icon">📋</span>
        <span class="chat-context__label">已注入上下文</span>
        <el-icon class="chat-context__arrow" :class="{ 'is-open': showContext }"><ArrowDown /></el-icon>
      </button>
      <transition name="slide-down">
        <div v-if="showContext" class="chat-context__body">{{ injectedContext }}</div>
      </transition>
    </div>

    <!-- 消息列表（设置面板展开时隐藏，避免面板过高超出窗口） -->
    <div v-if="!showSettings" class="chat-messages" ref="messagesRef">
      <!-- 空状态 -->
      <div v-if="messages.length === 0 && !streaming" class="chat-empty">
        <span class="chat-empty__icon">💬</span>
        <span class="chat-empty__text">和星宝聊聊天吧～</span>
      </div>

      <!-- 消息项 -->
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="chat-msg"
        :class="`chat-msg--${msg.role}`"
      >
        <div class="chat-msg__bubble">
          <PetRichText :content="msg.content" />
          <!-- 附件渲染区（图片/视频/文件，参照 MessageBubble.vue） -->
          <div v-if="msg.attachments && msg.attachments.length > 0" class="chat-msg__attachments">
            <template v-for="att in msg.attachments" :key="att.id">
              <!-- 图片：el-image 灯箱预览 -->
              <el-image
                v-if="att.type === 'image'"
                :src="att.thumb_url || att.url"
                :preview-src-list="[att.url]"
                class="chat-attachment-image"
                fit="cover"
                hide-on-click-modal
                preview-teleported
              />
              <!-- 视频 -->
              <video
                v-else-if="att.type === 'video'"
                :src="att.url"
                class="chat-attachment-video"
                controls
                :poster="att.thumb_url"
              />
              <!-- 文件 -->
              <a
                v-else
                :href="att.url"
                :download="att.name"
                class="chat-attachment-file"
              >
                <el-icon><Document /></el-icon>
                <span class="chat-attachment-file__name">{{ att.name }}</span>
              </a>
            </template>
          </div>
        </div>
      </div>

      <!-- 流式生成中 -->
      <div v-if="streaming" class="chat-msg chat-msg--assistant">
        <div class="chat-msg__bubble chat-msg__bubble--streaming">
          <!-- 思考过程（折叠，与 ContextInject 风格统一：el-icon + CSS 变量 + 左边框 + 折叠箭头） -->
          <div v-if="streamingThinking" class="chat-thinking" :class="{ 'is-collapsed': !showStreamingThinking }">
            <div class="chat-thinking__header" @click="showStreamingThinking = !showStreamingThinking">
              <div class="chat-thinking__icon">
                <el-icon :size="14"><MagicStick /></el-icon>
              </div>
              <span class="chat-thinking__label">思考中...</span>
              <el-icon :size="12" class="chat-thinking__toggle">
                <ArrowDown v-if="!showStreamingThinking" />
                <ArrowUp v-else />
              </el-icon>
            </div>
            <transition name="slide-down">
              <div v-if="showStreamingThinking" class="chat-thinking__body">{{ streamingThinking }}</div>
            </transition>
          </div>
          <PetRichText v-if="streamingContent" :content="streamingContent" />
          <template v-else>思考中...</template>
          <span class="chat-msg__cursor"></span>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="chat-input-area">
      <!-- 思考模式下拉（与 AI Chat 视图一致，默认空=关闭） -->
      <div class="chat-thinking-bar">
        <el-select v-model="thinkingEffort" size="small" style="width: 110px">
          <template #prefix><el-icon><MagicStick /></el-icon></template>
          <el-option label="标准模式" value="" />
          <el-option label="轻度思考" value="low" />
          <el-option label="中度思考" value="medium" />
          <el-option label="深度思考" value="high" />
          <el-option label="最高思考" value="max" />
        </el-select>
      </div>
      <!-- 附件输入组件（图片/视频/文件上传、截图、图片生成、视频生成） -->
      <ChatAttachmentInput
        v-model:attachments="attachments"
        :disabled="streaming"
        @screenshot="handleScreenshot"
      />
      <el-input
        v-model="inputText"
        type="textarea"
        :rows="2"
        resize="none"
        placeholder="说点什么..."
        :disabled="streaming"
        @keyup.enter.exact.prevent="handleSend"
      />
      <button
        class="chat-send-btn"
        :disabled="(!inputText.trim() && attachments.length === 0) || streaming"
        @click="handleSend"
      >
        <el-icon v-if="!streaming"><Promotion /></el-icon>
        <el-icon v-else class="is-loading"><Loading /></el-icon>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { Setting, Delete, Close, Promotion, Loading, ArrowDown, ArrowUp, MagicStick, Sunny, Document } from '@element-plus/icons-vue'
import PetRichText from './PetRichText.vue'
import ChatAttachmentInput from '@/components/chat/ChatAttachmentInput.vue'

const props = defineProps({
  // 消息列表 [{ id, role: 'user'|'assistant', content }]
  messages: {
    type: Array,
    default: () => []
  },
  // 是否正在生成
  streaming: {
    type: Boolean,
    default: false
  },
  // 当前系统提示词
  systemPrompt: {
    type: String,
    default: ''
  },
  // 当前提示词生成 meta-prompt（提示词的提示词）
  metaPrompt: {
    type: String,
    default: ''
  },
  // 流式生成中的实时内容
  streamingContent: {
    type: String,
    default: ''
  },
  // 流式生成中的思考过程（推理模型，与正式回复分离）
  streamingThinking: {
    type: String,
    default: ''
  },
  // 是否正在生成提示词
  generating: {
    type: Boolean,
    default: false
  },
  // 最近一次注入的上下文（去敏感化）
  injectedContext: {
    type: String,
    default: ''
  },
  // 面板透明度（0.3-1，从桌宠配置读取）
  opacity: {
    type: Number,
    default: 1
  }
})

const emit = defineEmits(['send', 'clear', 'update-prompt', 'generate-prompt', 'close', 'reset-prompt', 'update-meta-prompt', 'reset-meta-prompt', 'update-opacity', 'mouseenter', 'mouseleave'])

// 输入文本
const inputText = ref('')

// 思考模式强度（''=关闭，low/medium/high/max 对应推理模型 reasoning_effort）
const thinkingEffort = ref('')

// 附件列表（图片/视频/文件，与 ChatAttachmentInput 双向绑定）
const attachments = ref([])

// 设置面板展开状态
const showSettings = ref(false)

// 透明度滑杆展开状态
const showOpacitySlider = ref(false)

// 面板透明度（0.3~1，由滑杆控制，初始值从桌宠配置读取）
const panelOpacity = ref(props.opacity)

// 外部配置变化时同步到本地（如其他面板修改了透明度）
watch(() => props.opacity, (v) => {
  if (typeof v === 'number' && v >= 0.3 && v <= 1 && v !== panelOpacity.value) {
    panelOpacity.value = v
  }
})

// 滑杆变化时通知父组件持久化到桌宠配置
watch(panelOpacity, (v) => {
  emit('update-opacity', v)
})

// 上下文注入展开状态
const showContext = ref(false)

// 流式思考过程展开状态（推理模型思考过程折叠/展开）
const showStreamingThinking = ref(false)

// 提示词编辑草稿
const promptDraft = ref('')

// meta-prompt 编辑草稿（提示词的提示词）
const metaPromptDraft = ref('')

// AI 生成提示词的需求描述
const generateRequirement = ref('')

// 消息列表滚动容器引用
const messagesRef = ref(null)

// 同步外部 systemPrompt 到草稿
watch(() => props.systemPrompt, (val) => {
  promptDraft.value = val
}, { immediate: true })

// 同步外部 metaPrompt 到草稿
watch(() => props.metaPrompt, (val) => {
  metaPromptDraft.value = val
}, { immediate: true })

// 消息变化或流式内容变化时，自动滚动到底部
// immediate: 面板首次打开时立即滚动到聊天记录最底端
watch(
  () => [props.messages.length, props.streamingContent, props.streaming],
  () => {
    nextTick(() => {
      if (messagesRef.value) {
        messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      }
    })
  },
  { immediate: true }
)

/**
 * 发送消息
 * 取出当前附件后清空附件列表，连同文本与思考模式一起 emit 给父组件
 */
function handleSend () {
  const text = inputText.value.trim()
  const currentAttachments = [...attachments.value]
  // 文本和附件都为空时不发送
  if ((!text && currentAttachments.length === 0) || props.streaming) return
  emit('send', text, currentAttachments, thinkingEffort.value)
  inputText.value = ''
  attachments.value = []
}

/**
 * 截图回调（截图已由 ChatAttachmentInput 添加到附件列表）
 */
function handleScreenshot (attachment) {
  console.log('[PetChatPanel] 截图已添加:', attachment)
}

/**
 * 保存提示词
 */
function handleSavePrompt () {
  emit('update-prompt', promptDraft.value)
}

/**
 * 恢复默认提示词
 */
function handleResetPrompt () {
  emit('reset-prompt')
}

/**
 * 保存 meta-prompt（生成规范）
 */
function handleSaveMetaPrompt () {
  emit('update-meta-prompt', metaPromptDraft.value)
}

/**
 * 恢复默认 meta-prompt（生成规范）
 */
function handleResetMetaPrompt () {
  emit('reset-meta-prompt')
}

/**
 * 让 AI 生成提示词
 */
function handleGeneratePrompt () {
  const req = generateRequirement.value.trim()
  if (!req) return
  emit('generate-prompt', req)
}
</script>

<style scoped lang="scss">
.pet-chat-panel {
  display: flex;
  flex-direction: column;
  width: 520px;
  max-width: 100%;
  background: var(--pet-bg, rgba(255, 255, 255, 0.92));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 12px;
  border: 1px solid var(--pet-stroke, rgba(0, 0, 0, 0.08));
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  overflow-y: auto;
}

// 标题栏
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--pet-stroke, rgba(0, 0, 0, 0.06));

  &__title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--pet-text, #1A1A1A);
  }

  &__icon {
    font-size: 16px;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    background: transparent;
    border-radius: 50%;
    cursor: pointer;
    color: var(--pet-text-tertiary, #8A8A8A);
    transition: background 0.15s, color 0.15s;

    .el-icon {
      font-size: 14px;
    }

    &:hover {
      background: var(--pet-toolbar-btn-hover, rgba(0, 0, 0, 0.06));
      color: var(--pet-text, #1A1A1A);
    }
  }
}

// 透明度滑杆
.chat-opacity {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--pet-stroke, rgba(0, 0, 0, 0.06));
  font-size: 12px;
  color: var(--pet-text-tertiary, #8A8A8A);

  &__label {
    flex-shrink: 0;
  }

  &__slider {
    flex: 1;
    min-width: 0;
  }

  &__value {
    flex-shrink: 0;
    width: 32px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
}

// 设置区域
.chat-settings {
  padding: 10px 12px;
  border-bottom: 1px solid var(--pet-stroke, rgba(0, 0, 0, 0.06));
  max-height: 320px;
  overflow-y: auto;

  &__label {
    font-size: 12px;
    font-weight: 500;
    color: var(--pet-text-secondary, #5A5A5A);
    margin-bottom: 6px;
  }

  &__input {
    margin-bottom: 8px;
  }

  &__actions {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  &__divider {
    text-align: center;
    font-size: 11px;
    color: var(--pet-text-tertiary, #8A8A8A);
    margin-bottom: 6px;
  }

  &__generate {
    display: flex;
    gap: 8px;
    align-items: center;
  }
}

// 上下文注入提示
.chat-context {
  border-bottom: 1px solid var(--pet-stroke, rgba(0, 0, 0, 0.06));

  &__toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 12px;
    color: var(--pet-text-secondary, #5A5A5A);
    transition: background 0.15s;

    &:hover {
      background: var(--pet-toolbar-btn-hover, rgba(0, 0, 0, 0.04));
    }
  }

  &__icon {
    font-size: 13px;
  }

  &__label {
    flex: 1;
    text-align: left;
  }

  &__arrow {
    font-size: 12px;
    transition: transform 0.2s;

    &.is-open {
      transform: rotate(180deg);
    }
  }

  &__body {
    padding: 8px 12px 10px;
    font-size: 11px;
    line-height: 1.6;
    color: var(--pet-text-tertiary, #8A8A8A);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 160px;
    overflow-y: auto;
    background: var(--pet-toolbar-btn-hover, rgba(0, 0, 0, 0.03));

    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.15);
      border-radius: 2px;
    }
  }
}

// 思考过程折叠区（流式生成中，推理模型，与 ContextInject 风格统一）
.chat-thinking {
  margin: 0 0 6px;
  border-left: 2px solid var(--el-color-info-light-5);
  border-radius: 0 4px 4px 0;
  background: var(--el-fill-color-lighter);
  overflow: hidden;

  &__header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }

  &__icon {
    display: flex;
    align-items: center;
  }

  &__label {
    flex: 1;
    font-weight: 500;
  }

  &__toggle {
    color: var(--el-text-color-placeholder);
  }

  &__body {
    padding: 4px 10px 8px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;

    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.15);
      border-radius: 2px;
    }
  }
}

// 消息列表
.chat-messages {
  flex: 1;
  min-height: 120px;
  max-height: 300px;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  // 自定义滚动条
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.15);
    border-radius: 2px;
  }
}

// 空状态
.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  color: var(--pet-text-tertiary, #8A8A8A);

  &__icon {
    font-size: 28px;
  }

  &__text {
    font-size: 13px;
  }
}

// 消息项
.chat-msg {
  display: flex;

  &--user {
    justify-content: flex-end;
  }

  &--assistant {
    justify-content: flex-start;
  }

  &__bubble {
    max-width: 85%;
    padding: 6px 10px;
    border-radius: 10px;
    // 字体对齐主聊天界面 MarkdownRenderer（font-size: 14px; line-height: 1.7）
    // 通过 --pet-bubble-font-size CSS 变量支持用户自定义大小（默认 14px）
    font-size: var(--pet-bubble-font-size, 14px);
    line-height: 1.7;
    word-break: break-word;
    white-space: pre-wrap;
  }

  // 用户消息气泡
  &--user &__bubble {
    background: var(--el-color-primary, #409eff);
    color: #fff;
    border-bottom-right-radius: 4px;
  }

  // AI 消息气泡
  &--assistant &__bubble {
    background: var(--el-fill-color-light, #f5f7fa);
    color: var(--pet-text, #1A1A1A);
    border-bottom-left-radius: 4px;
    // AI 输出加粗，突出内容
    font-weight: 600;
  }

  // 流式生成中的气泡
  &__bubble--streaming {
    min-width: 40px;
  }

  // 光标动画
  &__cursor {
    display: inline-block;
    width: 6px;
    height: 14px;
    margin-left: 2px;
    background: var(--pet-text-secondary, #5A5A5A);
    border-radius: 1px;
    animation: blink 1s step-end infinite;
    vertical-align: text-bottom;
  }

  // 附件渲染区（消息气泡内，图片/视频/文件）
  &__attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
}

// 附件图片缩略图（el-image 灯箱预览）
.chat-attachment-image {
  width: 80px;
  height: 80px;
  border-radius: 6px;
  overflow: hidden;
  cursor: zoom-in;
  display: block;
}

// 附件视频
.chat-attachment-video {
  width: 120px;
  max-width: 100%;
  border-radius: 6px;
  display: block;
  background: #000;
}

// 附件文件链接
.chat-attachment-file {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.06);
  color: inherit;
  text-decoration: none;
  font-size: 12px;
  max-width: 200px;
  transition: background 0.15s;

  .el-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    background: rgba(0, 0, 0, 0.1);
  }
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

// 输入区域
.chat-input-area {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--pet-stroke, rgba(0, 0, 0, 0.06));
  // 附件输入组件占满整行（附件预览 + 操作按钮在 textarea 上方）
  :deep(.chat-attachment-input) {
    width: 100%;
    margin-bottom: 2px;
  }

  :deep(.el-textarea__inner) {
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.4;
    padding: 6px 10px;
  }
}

// 思考模式下拉条（与 AI Chat 视图一致，位于附件输入上方）
.chat-thinking-bar {
  width: 100%;
  display: flex;
  align-items: center;
  margin-bottom: 2px;

  :deep(.el-select) {
    .el-select__wrapper {
      border-radius: 6px;
    }
  }
}

.chat-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--el-color-primary, #409eff);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s, transform 0.15s;

  .el-icon {
    font-size: 16px;
  }

  &:hover:not(:disabled) {
    transform: scale(1.05);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .is-loading {
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// 设置区域展开动画
.slide-down-enter-active,
.slide-down-leave-active {
  transition: max-height 0.25s ease, opacity 0.25s ease;
  overflow: hidden;
}

.slide-down-enter-from,
.slide-down-leave-to {
  max-height: 0;
  opacity: 0;
}

// 暗色模式适配
html.dark .pet-chat-panel {
  background: var(--pet-bg, rgba(45, 45, 48, 0.92));
  border-color: var(--pet-stroke, rgba(255, 255, 255, 0.08));

  .chat-msg--assistant .chat-msg__bubble {
    background: rgba(255, 255, 255, 0.08);
    color: var(--pet-text, #F5F5F5);
  }

  .chat-msg__cursor {
    background: var(--pet-text-secondary, #C0C4CC);
  }

  // 滚动条在暗色背景下需使用浅色半透明，否则不可见
  .chat-messages::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
  }

  .chat-context__body {
    background: rgba(255, 255, 255, 0.05);

    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
    }
  }

  // 思考过程折叠区暗色适配（CSS 变量自动适配主色，仅滚动条 thumb 需覆盖）
  .chat-thinking {
    &__body {
      &::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
      }
    }
  }

  // 附件文件链接暗色适配
  .chat-attachment-file {
    background: rgba(255, 255, 255, 0.08);

    &:hover {
      background: rgba(255, 255, 255, 0.12);
    }
  }
}
</style>