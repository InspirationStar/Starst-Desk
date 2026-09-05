<!--
  媒体生成占位组件
  职责：在消息列表中展示图生/视频生的生成占位
  - 图片占位：骨架屏 + 旋转图标 + "正在生成图片..." 文案
  - 视频占位：骨架屏 + 进度条 + "正在生成视频...（预计 X 秒）" 文案
  - 支持渐进式更新：接收 progress prop 后更新进度条
  - 生成失败时显示错误状态 + 重试按钮（emit retry 事件）
  - shimmer 动画 + 暗色模式适配
-->
<template>
  <div class="media-placeholder" :class="`type-${type}`">
    <!-- 错误状态 -->
    <div v-if="status === 'error'" class="placeholder-error">
      <el-icon :size="32" class="error-icon"><WarningFilled /></el-icon>
      <div class="error-text">
        <div class="error-title">生成失败</div>
        <div class="error-detail">{{ errorMessage || '请重试或检查模型配置' }}</div>
      </div>
      <el-button type="primary" size="small" :icon="RefreshRight" @click="handleRetry">
        重试
      </el-button>
    </div>

    <!-- 成功状态（一般不会显示，由父组件替换为实际媒体） -->
    <div v-else-if="status === 'success'" class="placeholder-success">
      <el-icon :size="20" class="success-icon"><CircleCheckFilled /></el-icon>
      <span class="success-text">生成完成</span>
    </div>

    <!-- 生成中状态 -->
    <div v-else class="placeholder-pending">
      <!-- 骨架屏预览区 -->
      <div class="skeleton-preview">
        <div class="skeleton-shimmer" />
        <el-icon :size="36" class="pending-icon">
          <Loading v-if="type === 'image'" />
          <VideoCamera v-else />
        </el-icon>
      </div>

      <!-- 文案与进度 -->
      <div class="pending-info">
        <div class="pending-text">
          <el-icon class="pending-spinner"><Loading /></el-icon>
          <span v-if="type === 'image'">正在生成图片...</span>
          <span v-else>
            正在生成视频...<template v-if="estimatedSeconds > 0">（预计 {{ estimatedSeconds }} 秒）</template>
          </span>
        </div>

        <!-- 视频进度条 -->
        <div v-if="type === 'video'" class="pending-progress">
          <el-progress
            :percentage="displayProgress"
            :stroke-width="6"
            :status="progressStatus"
            :show-text="true"
            :format="formatProgress"
          />
        </div>

        <!-- 图片生成提示（无明确进度） -->
        <div v-else class="pending-dots">
          <span class="dot" />
          <span class="dot" />
          <span class="dot" />
        </div>
      </div>

      <!-- 停止生成按钮（已禁用：API 不支持取消生成） -->
      <el-button
        v-if="status === 'pending'"
        class="placeholder-stop-btn"
        size="small"
        type="danger"
        :icon="VideoPause"
        disabled
      >
        停止生成
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  Loading, VideoCamera, WarningFilled, CircleCheckFilled, RefreshRight, VideoPause
} from '@element-plus/icons-vue'

const props = defineProps({
  // 生成类型：image | video
  type: {
    type: String,
    default: 'image',
    validator: (val) => ['image', 'video'].includes(val)
  },
  // 进度百分比 0-100
  progress: {
    type: Number,
    default: 0
  },
  // 状态：pending | success | error
  status: {
    type: String,
    default: 'pending',
    validator: (val) => ['pending', 'success', 'error'].includes(val)
  },
  // 错误信息
  errorMessage: {
    type: String,
    default: ''
  },
  // 预计耗时（秒）
  estimatedSeconds: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['retry', 'stop'])

// 显示进度（限制在 0-100 之间）
const displayProgress = computed(() => {
  const p = Number(props.progress) || 0
  return Math.max(0, Math.min(100, p))
})

// 进度条状态
const progressStatus = computed(() => {
  if (props.status === 'error') return 'exception'
  if (props.status === 'success' || displayProgress.value >= 100) return 'success'
  return ''
})

// 格式化进度文案
function formatProgress (percentage) {
  return `${percentage}%`
}

// 重试
function handleRetry () {
  emit('retry')
}
</script>

<style scoped lang="scss">
.media-placeholder {
  width: 100%;
  max-width: 360px;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
}

// ============================================================
// 生成中状态
// ============================================================
.placeholder-pending {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

// 骨架屏预览区
.skeleton-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  overflow: hidden;
  background: #ebeef5;
  display: flex;
  align-items: center;
  justify-content: center;

  // shimmer 流光动画
  .skeleton-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.6) 50%,
      rgba(255, 255, 255, 0) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.6s infinite linear;
    pointer-events: none;
  }

  .pending-icon {
    color: #c0c4cc;
    animation: spin 1.4s infinite linear;
  }
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

// 文案与进度
.pending-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

// 停止生成按钮
.placeholder-stop-btn {
  align-self: flex-start;
  margin-top: 4px;
}

.pending-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;

  .pending-spinner {
    font-size: 14px;
    color: #409eff;
    animation: spin 1.2s infinite linear;
  }
}

.pending-progress {
  :deep(.el-progress-bar) {
    padding-right: 4px;
  }
}

// 图片生成的省略号动画
.pending-dots {
  display: flex;
  gap: 4px;
  padding-left: 4px;

  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #409eff;
    opacity: 0.4;
    animation: dot-bounce 1.2s infinite ease-in-out;

    &:nth-child(2) {
      animation-delay: 0.2s;
    }

    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
}

@keyframes dot-bounce {
  0%, 80%, 100% {
    opacity: 0.4;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1.2);
  }
}

// ============================================================
// 错误状态
// ============================================================
.placeholder-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  background: #fef0f0;
  color: #f56c6c;

  .error-icon {
    flex-shrink: 0;
    color: #f56c6c;
  }

  .error-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;

    .error-title {
      font-size: 13px;
      font-weight: 600;
    }

    .error-detail {
      font-size: 12px;
      color: #909399;
      word-break: break-word;
    }
  }
}

// ============================================================
// 成功状态
// ============================================================
.placeholder-success {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px;
  font-size: 13px;
  color: #67c23a;

  .success-icon {
    color: #67c23a;
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
[data-theme='dark'] {
  .media-placeholder {
    background: #2b2d30;
    border-color: #414243;
  }

  .skeleton-preview {
    background: #36383c;

    .skeleton-shimmer {
      background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 255, 255, 0.12) 50%,
        rgba(255, 255, 255, 0) 100%
      );
      background-size: 200% 100%;
    }

    .pending-icon {
      color: #6e7681;
    }
  }

  .pending-text {
    color: #bfcbd9;
  }

  .placeholder-error {
    background: #3a2a2a;
    color: #f89898;

    .error-icon {
      color: #f89898;
    }

    .error-detail {
      color: #909399;
    }
  }

  .placeholder-success {
    color: #85ce61;

    .success-icon {
      color: #85ce61;
    }
  }
}
</style>