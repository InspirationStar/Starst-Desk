<!--
  桌宠悬停工具栏组件
  职责：鼠标悬停桌宠时显示功能按钮组（隐藏 / 暂停提醒 / 查看今日提醒 / 置顶切换）
  Props:
    - isPaused: 当前是否暂停健康提醒
    - alwaysOnTop: 当前是否置顶
  Emits:
    - hide: 隐藏桌宠
    - toggle-pause: 暂停/继续提醒
    - view-reminders: 查看今日提醒
    - toggle-always-on-top: 切换置顶
  设计：
    - 圆形小按钮组，水平排列，半透明背景 + 毛玻璃效果
    - 4 个按钮（Element Plus 图标）+ el-tooltip 提示
    - 出现/消失动画（opacity + translateY，167ms）
    - 暗色模式适配（通过 --pet-* CSS 变量）
-->
<template>
  <div class="pet-toolbar">
    <!-- 隐藏桌宠 -->
    <el-tooltip
      content="隐藏桌宠"
      placement="top"
      :show-after="300"
    >
      <button
        class="pet-toolbar__btn"
        @click="$emit('hide')"
      >
        <el-icon><Hide /></el-icon>
      </button>
    </el-tooltip>

    <!-- 暂停 / 继续提醒 -->
    <el-tooltip
      :content="isPaused ? '继续提醒' : '暂停提醒'"
      placement="top"
      :show-after="300"
    >
      <button
        class="pet-toolbar__btn"
        :class="{ 'is-active': isPaused }"
        @click="$emit('toggle-pause')"
      >
        <el-icon>
          <VideoPlay v-if="isPaused" />
          <VideoPause v-else />
        </el-icon>
      </button>
    </el-tooltip>

    <!-- 查看今日提醒 -->
    <el-tooltip
      content="今日提醒"
      placement="top"
      :show-after="300"
    >
      <button
        class="pet-toolbar__btn"
        @click="$emit('view-reminders')"
      >
        <el-icon><Bell /></el-icon>
      </button>
    </el-tooltip>

    <!-- 置顶切换 -->
    <el-tooltip
      :content="alwaysOnTop ? '取消置顶' : '置顶'"
      placement="top"
      :show-after="300"
    >
      <button
        class="pet-toolbar__btn"
        :class="{ 'is-active': alwaysOnTop }"
        @click="$emit('toggle-always-on-top')"
      >
        <el-icon><Top /></el-icon>
      </button>
    </el-tooltip>

    <!-- 切换形象（熊猫 → 机器人 → 科技球 → DNA螺旋 → 循环） -->
    <el-tooltip
      :content="character === 'cat' ? '切换为机器人' : character === 'robot' ? '切换为科技球' : character === 'orb' ? '切换为DNA螺旋' : '切换为熊猫'"
      placement="top"
      :show-after="300"
    >
      <button
        class="pet-toolbar__btn"
        @click="$emit('switch-character')"
      >
        <el-icon><Switch /></el-icon>
      </button>
    </el-tooltip>

    <!-- AI 对话 -->
    <el-tooltip
      content="AI 对话"
      placement="top"
      :show-after="300"
    >
      <button
        class="pet-toolbar__btn"
        :class="{ 'is-active': chatActive }"
        @click="$emit('toggle-chat')"
      >
        <el-icon><ChatDotRound /></el-icon>
      </button>
    </el-tooltip>

    <!-- 键盘连击追踪开关 -->
    <el-tooltip
      :content="keyTrackerEnabled ? '关闭键盘连击' : '开启键盘连击'"
      placement="top"
      :show-after="300"
    >
      <button
        class="pet-toolbar__btn"
        :class="{ 'is-active': keyTrackerEnabled }"
        @click="$emit('toggle-key-tracker')"
      >
        <el-icon><Aim /></el-icon>
      </button>
    </el-tooltip>
  </div>
</template>

<script setup>
import { Hide, VideoPause, VideoPlay, Bell, Top, Switch, ChatDotRound, Aim } from '@element-plus/icons-vue'

defineProps({
  // 当前是否暂停健康提醒
  isPaused: {
    type: Boolean,
    default: false
  },
  // 当前是否置顶
  alwaysOnTop: {
    type: Boolean,
    default: false
  },
  // 当前桌宠形象（cat / robot / orb）
  character: {
    type: String,
    default: 'cat'
  },
  // AI 对话面板是否打开
  chatActive: {
    type: Boolean,
    default: false
  },
  // 键盘连击追踪是否启用
  keyTrackerEnabled: {
    type: Boolean,
    default: true
  }
})

defineEmits(['hide', 'toggle-pause', 'view-reminders', 'toggle-always-on-top', 'switch-character', 'toggle-chat', 'toggle-key-tracker'])
</script>

<style scoped lang="scss">
.pet-toolbar {
  // 水平排列按钮组
  display: inline-flex;
  align-items: center;
  gap: var(--pet-spacing-xs, 4px);
  // 半透明背景 + 毛玻璃
  background: var(--pet-toolbar-bg, rgba(255, 255, 255, 0.72));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  // 圆角与描边
  border-radius: var(--pet-radius-pill, 999px);
  border: 1px solid var(--pet-toolbar-stroke, rgba(0, 0, 0, 0.08));
  // 内边距
  padding: 4px var(--pet-spacing-sm, 8px);
  // 阴影
  box-shadow: var(--pet-shadow-toolbar, 0 2px 8px rgba(0, 0, 0, 0.08));
  // 出现动画：opacity + translateY，167ms
  animation: pet-toolbar-in var(--pet-motion-fast, 167ms) ease-out;

  // 操作按钮
  &__btn {
    // 居中图标
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--pet-toolbar-btn-size, 28px);
    height: var(--pet-toolbar-btn-size, 28px);
    min-width: var(--pet-toolbar-btn-size, 28px);
    min-height: var(--pet-toolbar-btn-size, 28px);
    padding: 0;
    border: none;
    background: var(--pet-toolbar-btn-bg, transparent);
    border-radius: 50%;
    cursor: pointer;
    color: var(--pet-toolbar-btn-icon, #5A5A5A);
    // 按钮反馈过渡
    transition: background var(--pet-motion-faster, 83ms) ease,
                color var(--pet-motion-faster, 83ms) ease;

    .el-icon {
      font-size: 14px;
    }

    // 悬停
    &:hover {
      background: var(--pet-toolbar-btn-hover, rgba(0, 0, 0, 0.06));
      color: var(--pet-text, #1A1A1A);
    }

    // 按下
    &:active {
      background: var(--pet-toolbar-btn-active, rgba(0, 0, 0, 0.10));
    }

    // 激活态（暂停中 / 置顶中）：强调色高亮
    &.is-active {
      color: var(--pet-accent, #0067C0);
      background: var(--pet-accent-soft, rgba(0, 103, 192, 0.12));

      &:hover {
        background: var(--pet-accent-soft, rgba(0, 103, 192, 0.18));
      }
    }
  }
}

// 工具栏出现动画：从下方 6px 淡入
// 注意：父级 .pet-root__toolbar 使用 transform: translateX(-50%) 做水平居中，
// 此处动画必须保留 -50% 的 X 位移，否则会覆盖父级居中导致工具栏向右偏移
@keyframes pet-toolbar-in {
  from {
    opacity: 0;
    transform: translate(-50%, 6px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

// 暗色模式适配：CSS 变量已在 pet.scss 中通过 html.dark 覆盖
// 此处保留兼容性回退，确保在变量未加载时仍有合理表现
html.dark .pet-toolbar {
  // 按钮在深色模式下的回退颜色
  &__btn {
    color: var(--pet-toolbar-btn-icon, #C0C4CC);

    &:hover {
      color: var(--pet-text, #F5F5F5);
    }
  }
}
</style>