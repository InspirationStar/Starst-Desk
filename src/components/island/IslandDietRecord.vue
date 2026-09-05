<!--
  灵动岛饮食便捷记录卡片
  职责：
  - 显示当前餐次提醒（早餐/午餐/晚餐/宵夜）
  - 提供文本输入记录实际吃了什么
  - 提供"已吃"快速记录按钮（携带输入内容）
  - 提供"没吃"跳过按钮
  - 记录作为饮食规律依据
  - Fluent Design 风格
-->
<template>
  <div class="island-diet-record">
    <!-- 左侧图标 -->
    <div class="island-diet-record__icon">
      <el-icon><Bowl /></el-icon>
    </div>

    <!-- 中间内容 -->
    <div class="island-diet-record__content">
      <div class="island-diet-record__title">饮食提醒 {{ mealIcon }}</div>
      <div class="island-diet-record__body">
        到了{{ mealName }}时间（{{ mealTime }}），记得按时进食
      </div>
      <!-- 记录吃了什么 -->
      <div class="island-diet-record__row">
        <input
          v-model="foodContent"
          class="island-diet-record__input"
          placeholder="吃了什么？（可选）"
          @keyup.enter="handleRecord"
        />
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="island-diet-record__actions">
      <button
        class="island-diet-record__btn island-diet-record__btn--done"
        @click="handleRecord"
      >
        已吃{{ mealName }}
      </button>
      <button
        class="island-diet-record__btn island-diet-record__btn--skip"
        @click="handleSkip"
      >
        没吃
      </button>
    </div>

    <!-- 关闭按钮 -->
    <div class="island-diet-record__close" @click="emit('dismiss')">
      <el-icon><Close /></el-icon>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Bowl, Close } from '@element-plus/icons-vue'

const props = defineProps({
  extraData: { type: Object, default: null }
})

const emit = defineEmits(['dismiss', 'action'])

const mealType = computed(() => props.extraData?.mealType || 'breakfast')
const mealName = computed(() => props.extraData?.mealName || '早餐')
const mealTime = computed(() => props.extraData?.mealTime || '08:00')
const mealIcon = computed(() => {
  const icons = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍿' }
  return icons[mealType.value] || '🍽️'
})

const foodContent = ref('')

function handleRecord () {
  emit('action', {
    action: { label: 'diet-record', value: 'diet-record', mealType: mealType.value, content: foodContent.value || '' },
    moduleType: 'diet'
  })
}

function handleSkip () {
  emit('action', {
    action: { label: 'diet-skip', value: 'skipped', mealType: mealType.value },
    moduleType: 'diet'
  })
}
</script>

<style lang="scss" scoped>
.island-diet-record {
  width: 100%;
  min-height: 56px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--island-card-bg);
  border: var(--island-card-border);
  box-shadow: var(--island-card-shadow);
  display: flex;
  align-items: flex-start;
  gap: 12px;
  color: var(--island-text-primary);
  user-select: none;
  position: relative;
  z-index: 1;

  &__icon {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: #e6a23c;
  }

  &__content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--island-text-title);
  }

  &__body {
    font-size: 12px;
    line-height: 1.4;
    color: var(--island-text-secondary);
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
  }

  &__input {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--island-card-border, rgba(0, 0, 0, 0.15));
    background: var(--island-action-bg, rgba(0, 0, 0, 0.04));
    color: var(--island-text-primary);
    font-size: 11px;
    outline: none;

    &:focus {
      border-color: #e6a23c;
    }

    &::placeholder {
      color: var(--island-text-tertiary);
    }
  }

  &__actions {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-right: 20px;
  }

  &__btn {
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.2s ease;
    white-space: nowrap;

    &--done {
      background: rgba(230, 162, 60, 0.2);
      color: #e6a23c;

      &:hover {
        background: rgba(230, 162, 60, 0.32);
      }
    }

    &--skip {
      background: var(--island-skip-bg);
      color: var(--island-skip-color);

      &:hover {
        background: var(--island-skip-bg-hover);
        color: var(--island-skip-color-hover);
      }
    }
  }

  &__close {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: var(--island-close-color);
    cursor: pointer;
    border-radius: 4px;
    transition: color 0.2s ease, background 0.2s ease;

    &:hover {
      color: var(--island-close-color-hover);
      background: var(--island-close-bg-hover);
    }
  }
}
</style>
