<!--
  工具调用上下文展示组件
  职责：在聊天栏中显示 AI 的工具调用过程
  - 显示工具名称、调用参数
  - 显示调用状态（调用中/已完成/已取消）
  - 可折叠/展开查看详情
  - 支持暗色主题
-->
<template>
  <div class="tool-call-context" :class="{ 'is-collapsed': !expanded, [`is-${status}`]: true }">
    <div class="tool-call-header" @click="expanded = !expanded">
      <div class="tool-call-icon">
        <el-icon :size="16">
          <Tools v-if="status === 'pending'" />
          <CircleCheckFilled v-else-if="status === 'success'" />
          <CircleCloseFilled v-else-if="status === 'error'" />
          <Loading v-else />
        </el-icon>
      </div>
      <div class="tool-call-info">
        <span class="tool-call-name">{{ toolDisplayName }}</span>
        <span class="tool-call-status">{{ statusText }}</span>
      </div>
      <div class="tool-call-meta">
        <span v-if="iteration > 0" class="tool-call-iteration">第 {{ iteration + 1 }} 轮</span>
        <el-icon :size="14" class="tool-call-toggle">
          <ArrowDown v-if="!expanded" />
          <ArrowUp v-else />
        </el-icon>
      </div>
    </div>

    <transition name="tool-call-expand">
      <div v-if="expanded" class="tool-call-body">
        <!-- 注入的上下文说明 -->
        <div class="context-section">
          <div class="context-label">注入上下文</div>
          <div class="context-content">
            <div class="context-item">
              <span class="context-key">工具名称</span>
              <span class="context-value">{{ name }}</span>
            </div>
            <div class="context-item">
              <span class="context-key">媒体类型</span>
              <span class="context-value">{{ typeLabel }}</span>
            </div>
            <div class="context-item">
              <span class="context-key">提示词</span>
              <span class="context-value context-prompt">{{ prompt }}</span>
            </div>
            <div v-if="extraArgs.length > 0" class="context-item">
              <span class="context-key">附加参数</span>
              <div class="context-args">
                <div v-for="arg in extraArgs" :key="arg.key" class="arg-item">
                  <span class="arg-key">{{ arg.key }}:</span>
                  <span class="arg-value">{{ arg.value }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 上下文消息说明 -->
        <div class="context-message">
          <el-icon :size="12"><InfoFilled /></el-icon>
          <span>{{ contextMessage }}</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  Tools, CircleCheckFilled, CircleCloseFilled, Loading,
  ArrowDown, ArrowUp, InfoFilled
} from '@element-plus/icons-vue'

const props = defineProps({
  // 工具名称
  name: { type: String, default: '' },
  // 媒体类型
  type: { type: String, default: 'image' },
  // 提示词
  prompt: { type: String, default: '' },
  // 调用状态：pending / running / success / error / cancelled
  status: { type: String, default: 'pending' },
  // 迭代轮次
  iteration: { type: Number, default: 0 },
  // 附加参数
  args: { type: Object, default: () => ({}) },
  // 上下文消息
  contextMessage: { type: String, default: '' }
})

const expanded = ref(true)

const toolDisplayName = computed(() => {
  if (props.name === 'generate_image') return '生图工具'
  if (props.name === 'generate_video') return '生视频工具'
  return props.name || '工具'
})

const typeLabel = computed(() => {
  return props.type === 'image' ? '图片' : '视频'
})

const statusText = computed(() => {
  const map = {
    pending: '调用中...',
    running: '执行中...',
    success: '已完成',
    error: '执行失败',
    cancelled: '已取消'
  }
  return map[props.status] || '调用中...'
})

const extraArgs = computed(() => {
  const result = []
  const excludeKeys = ['prompt']
  for (const [key, value] of Object.entries(props.args || {})) {
    if (!excludeKeys.includes(key) && value != null && value !== '') {
      result.push({ key, value: String(value) })
    }
  }
  return result
})

const contextMessage = computed(() => {
  if (props.contextMessage) return props.contextMessage
  return `已将工具调用记录注入对话上下文，AI 将基于此结果继续回复`
})
</script>

<style scoped lang="scss">
.tool-call-context {
  margin: 8px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-light);
  overflow: hidden;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--el-border-color);
  }

  &.is-collapsed {
    .tool-call-header {
      border-bottom: none;
    }
  }
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--el-border-color-lighter);
  transition: background 0.2s;

  &:hover {
    background: var(--el-fill-color);
  }
}

.tool-call-icon {
  display: flex;
  align-items: center;
  color: var(--el-color-primary);

  .is-success & {
    color: var(--el-color-success);
  }

  .is-error & {
    color: var(--el-color-danger);
  }
}

.tool-call-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tool-call-name {
  font-weight: 500;
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.tool-call-status {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.tool-call-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-call-iteration {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--el-fill-color-dark);
}

.tool-call-toggle {
  color: var(--el-text-color-secondary);
  transition: transform 0.2s;
}

.tool-call-body {
  padding: 12px;
}

.context-section {
  margin-bottom: 8px;
}

.context-label {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.context-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.context-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.context-key {
  flex-shrink: 0;
  width: 70px;
  color: var(--el-text-color-secondary);
}

.context-value {
  flex: 1;
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.context-prompt {
  font-style: italic;
  color: var(--el-color-primary);
}

.context-args {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.arg-item {
  display: flex;
  gap: 4px;
  font-size: 11px;
}

.arg-key {
  color: var(--el-text-color-secondary);
}

.arg-value {
  color: var(--el-text-color-primary);
}

.context-message {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border-radius: 4px;
  margin-top: 8px;

  .el-icon {
    color: var(--el-color-info);
    flex-shrink: 0;
  }
}

// 展开动画
.tool-call-expand-enter-active,
.tool-call-expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.tool-call-expand-enter-from,
.tool-call-expand-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.tool-call-expand-enter-to,
.tool-call-expand-leave-from {
  opacity: 1;
  max-height: 500px;
}
</style>