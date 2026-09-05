<!--
  桌宠富文本渲染组件
  职责：解析 IMD 思考过程标记 + Markdown 渲染正式内容
  安全：MarkdownRenderer 配置 markdown-it html:false 防注入
  用法：<PetRichText :content="msg.content" />
-->
<template>
  <span class="pet-rich-text">
    <!-- 思考过程（折叠，与 ContextInject 风格统一） -->
    <span v-if="thinking" class="pet-rich-text__thinking" :class="{ 'is-collapsed': !showThinking }">
      <div class="pet-rich-text__thinking-header" @click="showThinking = !showThinking">
        <el-icon :size="14" class="pet-rich-text__thinking-icon"><MagicStick /></el-icon>
        <span class="pet-rich-text__thinking-label">已深度思考</span>
        <el-icon :size="12" class="pet-rich-text__thinking-toggle">
          <ArrowDown v-if="!showThinking" />
          <ArrowUp v-else />
        </el-icon>
      </div>
      <transition name="rt-slide-down">
        <span v-if="showThinking" class="pet-rich-text__thinking-body">{{ thinking }}</span>
      </transition>
    </span>
    <!-- 正式内容（Markdown 渲染） -->
    <MarkdownRenderer v-if="displayContent" :content="displayContent" class="pet-rich-text__content" />
  </span>
</template>

<script setup>
import { computed, ref } from 'vue'
import { MagicStick, ArrowDown, ArrowUp } from '@element-plus/icons-vue'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'

const props = defineProps({
  // 待解析的文本内容
  content: {
    type: String,
    default: ''
  }
})

// 思考过程展开状态
const showThinking = ref(false)

// 思考过程标记正则： IMD ... IMD （与 DeepSeek 官方格式一致）
const THINKING_RE = /^ IMD ([\s\S]*?) IMD \s*/

/**
 * 解析 IMD ... IMD 标记，提取思考过程
 * 思考过程放在正式内容前，用标记包裹，便于持久化与回显
 */
const thinking = computed(() => {
  const text = props.content || ''
  const match = text.match(THINKING_RE)
  return match ? match[1].trim() : ''
})

/**
 * 正式内容：去掉 IMD 思考块后的文本，交给 MarkdownRenderer 渲染
 * MarkdownRenderer 支持 **粗体**、*斜体*、`代码`、代码块、链接等 markdown 格式
 */
const displayContent = computed(() => {
  return (props.content || '').replace(THINKING_RE, '')
})
</script>

<style scoped lang="scss">
// 思考过程折叠区（持久化消息回显，与 ContextInject 风格统一）
.pet-rich-text__thinking {
  display: block;
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
    display: block;
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
      background: var(--el-border-color-light);
      border-radius: 2px;
    }
  }
}

// 折叠展开动画
.rt-slide-down-enter-active,
.rt-slide-down-leave-active {
  transition: max-height 0.25s ease, opacity 0.25s ease;
  overflow: hidden;
}

.rt-slide-down-enter-from,
.rt-slide-down-leave-to {
  max-height: 0;
  opacity: 0;
}

// 暗色模式适配（CSS 变量自动适配，仅滚动条需覆盖）
html.dark .pet-rich-text__thinking {
  .pet-rich-text__thinking-body {
    &::-webkit-scrollbar-thumb {
      background: var(--el-border-color);
    }
  }
}
</style>