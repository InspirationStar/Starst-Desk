<!--
  吸附高亮引导线组件
  职责：收到 widget:snap-guide 事件时在窗口对应边缘显示高亮线
  订阅方式：onMounted 时通过 ipc-client 的 on('widget:snap-guide', cb) 订阅，
           onUnmounted 时调用返回的取消函数清理监听
  事件 payload：{ widgetType, edges: ['left'|'right'|'top'|'bottom'], target }
  行为：
    - edges 包含某边缘时显示该边缘高亮线
    - edges 为空数组时隐藏所有高亮线
    - 高亮线宽度 2px，渐变背景，呼吸动画 opacity 0.45↔1.0，周期 1200ms
-->
<template>
  <div class="widget-snap-guide" aria-hidden="true">
    <!-- 四条边缘高亮线，按 edges 数组动态显隐 -->
    <div
      v-for="edge in edges"
      :key="edge"
      class="widget-snap-guide__line"
      :class="`widget-snap-guide__line--${edge}`"
    ></div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { on } from '@/utils/ipc-client'

// 当前激活的边缘列表（'left' | 'right' | 'top' | 'bottom'）
const edges = ref([])

// 合法边缘值常量（模块作用域，避免每次调用重建数组）
const VALID_EDGES = ['left', 'right', 'top', 'bottom']

// IPC 事件取消监听函数（on 返回，卸载时调用）
let unsubscribe = null

/**
 * 应用新的吸附引导边缘
 * @param {string[]} nextEdges 下一次需要高亮的边缘数组
 */
function applyEdges (nextEdges) {
  // 防御性过滤：仅保留合法边缘值，避免非法 class 注入
  edges.value = Array.isArray(nextEdges)
    ? nextEdges.filter((e) => VALID_EDGES.includes(e))
    : []
}

onMounted(() => {
  // 订阅 widget:snap-guide 事件
  // payload: { widgetType, edges, target }
  unsubscribe = on('widget:snap-guide', (data) => {
    applyEdges(data?.edges)
  })
})

onUnmounted(() => {
  // 清理监听，避免内存泄漏与重复触发
  if (typeof unsubscribe === 'function') {
    unsubscribe()
    unsubscribe = null
  }
  // 重置边缘
  edges.value = []
})
</script>

<style scoped lang="scss">
// 容器：覆盖整个小部件窗口，不拦截指针事件
.widget-snap-guide {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
}

// 单条高亮线：绝对定位 + 渐变背景 + 呼吸动画
.widget-snap-guide__line {
  position: absolute;
  // 渐变背景：使用强调色，中段最亮，两端淡出
  background: linear-gradient(
    to var(--gradient-direction, right),
    transparent 0%,
    var(--widget-accent, #0067C0) 20%,
    var(--widget-accent, #0067C0) 80%,
    transparent 100%
  );
  // 呼吸动画：opacity 0.45 ↔ 1.0，周期 1200ms
  animation: widget-snap-breathe 1200ms ease-in-out infinite;
  // 圆角小值，避免边缘锐利
  border-radius: 2px;
  // 默认隐藏，由具体边缘修饰类定位
  opacity: 0;
}

// 左边缘：竖向高亮线，贴左边界
.widget-snap-guide__line--left {
  top: 0;
  left: 0;
  width: 2px;
  height: 100%;
  --gradient-direction: bottom;
  opacity: 1;
}

// 右边缘：竖向高亮线，贴右边界
.widget-snap-guide__line--right {
  top: 0;
  right: 0;
  width: 2px;
  height: 100%;
  --gradient-direction: bottom;
  opacity: 1;
}

// 上边缘：横向高亮线，贴上边界
.widget-snap-guide__line--top {
  top: 0;
  left: 0;
  width: 100%;
  height: 2px;
  --gradient-direction: right;
  opacity: 1;
}

// 下边缘：横向高亮线，贴下边界
.widget-snap-guide__line--bottom {
  bottom: 0;
  left: 0;
  width: 100%;
  height: 2px;
  --gradient-direction: right;
  opacity: 1;
}

// 呼吸动画关键帧：opacity 在 0.45 与 1.0 之间循环
@keyframes widget-snap-breathe {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

// 暗色模式适配：高亮线在深色下使用更亮的强调色（CSS 变量已在 widget.scss 中通过 html.dark 覆盖）
// 此处仅保留回退，确保变量未加载时仍有合理表现
html.dark .widget-snap-guide__line {
  background: linear-gradient(
    to var(--gradient-direction, right),
    transparent 0%,
    var(--widget-accent, #0078D4) 20%,
    var(--widget-accent, #0078D4) 80%,
    transparent 100%
  );
}
</style>