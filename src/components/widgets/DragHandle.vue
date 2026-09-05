<!--
  拖拽手柄组件
  职责：mousedown 时调用 widgetApi.dragStart() 通知主进程接管拖拽
  说明：透明窗口 CSS transform 拖拽会抖动，改由主进程 win.setBounds 控制移动
    - 拖拽手柄颜色使用 --widget-drag-handle
    - 悬停时加深（使用 --widget-title-hover）
    - 动画使用 83ms（faster）
-->
<template>
  <div class="drag-handle">
    <!-- 拖拽指示图标（默认六点网格） -->
    <slot>
      <div class="drag-handle__dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    </slot>
  </div>
</template>

<script setup>
// 纯视觉指示器组件
// 拖拽逻辑已移至 WidgetHeader.vue（通过 IPC 手动拖拽实现吸附）
</script>

<style scoped lang="scss">
.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  user-select: none;
  // 纯视觉指示器，拖拽由 WidgetHeader.vue 统一处理
  padding: var(--widget-spacing-xs, 4px) var(--widget-spacing-sm, 8px);
  border-radius: var(--widget-radius-small, 4px);
  transition: background var(--widget-motion-faster, 83ms) ease;

  &:hover {
    background: var(--widget-title-hover, rgba(0, 0, 0, 0.06));
  }

  &:active {
    cursor: grabbing;
    background: var(--widget-title-pressed, rgba(0, 0, 0, 0.10));
  }

  // 默认六点网格指示
  &__dots {
    display: grid;
    grid-template-columns: repeat(2, 3px);
    grid-template-rows: repeat(3, 3px);
    gap: 2px;

    .dot {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--widget-drag-handle, #6B6B6B);
      // 悬停时加深
      transition: background var(--widget-motion-faster, 83ms) ease;
    }
  }

  // 悬停时手柄点加深（使用主文字色）
  &:hover .dot {
    background: var(--widget-text, #1A1A1A);
  }
}

// 暗色模式适配：CSS 变量已在 widget.scss 中通过 html.dark 覆盖
// 此处保留兼容性回退
html.dark .drag-handle {
  &:hover {
    background: var(--widget-title-hover, rgba(255, 255, 255, 0.07));
  }

  &:active {
    background: var(--widget-title-pressed, rgba(255, 255, 255, 0.12));
  }

  &__dots .dot {
    background: var(--widget-drag-handle, #D6D6D6);
  }

  &:hover .dot {
    background: var(--widget-text, #F5F5F5);
  }
}
</style>
