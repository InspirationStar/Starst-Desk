<!--
  模型类别标签组件
  职责：在聊天界面顶部展示三个模型类别标签（语言/图生/视频）
  - 切换标签时 emit change 事件，传递当前类别
  - 暗色模式适配
-->
<template>
  <div class="model-category-tabs">
    <div
      v-for="item in categories"
      :key="item.value"
      class="category-tab"
      :class="{ active: currentCategory === item.value }"
      @click="handleClick(item.value)"
    >
      <el-icon class="category-icon"><component :is="item.icon" /></el-icon>
      <span class="category-label">{{ item.label }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ChatDotRound, Picture, VideoCamera } from '@element-plus/icons-vue'

const props = defineProps({
  // 当前选中的类别
  modelValue: {
    type: String,
    default: 'language',
    validator: (val) => ['language', 'image', 'video'].includes(val)
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

// 类别定义
const categories = [
  { value: 'language', label: '语言模型', icon: ChatDotRound },
  { value: 'image', label: '图生模型', icon: Picture },
  { value: 'video', label: '视频模型', icon: VideoCamera }
]

// 当前类别
const currentCategory = computed(() => props.modelValue)

// 点击切换类别
function handleClick (category) {
  if (category === currentCategory.value) return
  emit('update:modelValue', category)
  emit('change', category)
}
</script>

<style scoped lang="scss">
.model-category-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: #f5f7fa;
  border-radius: 6px;

  .category-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
    font-size: 13px;
    color: #606266;
    transition: all 0.2s;

    &:hover {
      color: #409eff;
      background: #ecf5ff;
    }

    &.active {
      color: #fff;
      background: #409eff;
    }

    .category-icon {
      font-size: 14px;
    }

    .category-label {
      line-height: 1;
    }
  }
}

// 暗色模式适配
[data-theme='dark'] {
  .model-category-tabs {
    background: #1d1e1f;

    .category-tab {
      color: #bfcbd9;

      &:hover {
        color: #79bbff;
        background: #2b2d30;
      }

      &.active {
        color: #fff;
        background: #409eff;

      }
    }
  }
}
</style>