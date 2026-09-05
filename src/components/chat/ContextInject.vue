<!--
  上下文注入展示组件
  职责：在聊天栏中显示每轮调用模型前注入的上下文信息
  - 显示注入标题、描述
  - 显示注入的具体内容项（系统提示词、历史消息、工具定义等）
  - 可折叠/展开
  - 支持暗色主题
-->
<template>
  <div class="context-inject" :class="{ 'is-collapsed': !expanded }">
    <div class="context-inject-header" @click="expanded = !expanded">
      <div class="context-inject-icon">
        <el-icon :size="14"><Connection /></el-icon>
      </div>
      <div class="context-inject-title">
        <span class="inject-title-text">{{ title }}</span>
        <span class="inject-desc">{{ description }}</span>
      </div>
      <el-icon :size="12" class="inject-toggle">
        <ArrowDown v-if="!expanded" />
        <ArrowUp v-else />
      </el-icon>
    </div>

    <transition name="inject-expand">
      <div v-if="expanded" class="context-inject-body">
        <div
          v-for="(item, idx) in contextItems"
          :key="idx"
          class="inject-item"
          :class="{ 'inject-item--full': item.fullValue }"
        >
          <span class="inject-key">{{ item.key }}</span>
          <span class="inject-value">{{ item.fullValue || item.value }}</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Connection, ArrowDown, ArrowUp } from '@element-plus/icons-vue'

const props = defineProps({
  title: { type: String, default: '上下文注入' },
  description: { type: String, default: '' },
  contextItems: { type: Array, default: () => [] }
})

const expanded = ref(false)
</script>

<style scoped lang="scss">
.context-inject {
  margin: 4px 0;
  border-left: 2px solid var(--el-color-info-light-5);
  border-radius: 0 4px 4px 0;
  background: var(--el-fill-color-lighter);
  overflow: hidden;
  transition: all 0.2s ease;
}

.context-inject-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: var(--el-fill-color-light);
  }
}

.context-inject-icon {
  color: var(--el-color-info);
  display: flex;
  align-items: center;
}

.context-inject-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.inject-title-text {
  font-size: 11px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.inject-desc {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inject-toggle {
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.context-inject-body {
  padding: 6px 10px 6px 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.inject-item {
  display: flex;
  gap: 8px;
  font-size: 11px;
  line-height: 1.4;

  &--full {
    .inject-value {
      white-space: pre-wrap;
      max-height: 200px;
      overflow-y: auto;
      background: var(--el-fill-color);
      padding: 4px 6px;
      border-radius: 4px;
    }
  }
}

.inject-key {
  flex-shrink: 0;
  width: 80px;
  color: var(--el-text-color-placeholder);
}

.inject-value {
  flex: 1;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}

// 展开动画
.inject-expand-enter-active,
.inject-expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.inject-expand-enter-from,
.inject-expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.inject-expand-enter-to,
.inject-expand-leave-from {
  opacity: 1;
  max-height: 500px;
}
</style>