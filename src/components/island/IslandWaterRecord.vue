<!--
  灵动岛喝水便捷记录卡片
  职责：
  - 显示今日饮水;饮水进度
  - 提供快速记录按钮（+1杯、+2杯、+3杯），每杯容量可配置
  - 支持自定义 ml 输入记录
  - Fluent Design 风格
-->
<template>
  <div class="island-water-record">
    <!-- 左侧图标 -->
    <div class="island-water-record__icon">
      <el-icon><ColdDrink /></el-icon>
    </div>

    <!-- 中间内容 -->
    <div class="island-water-record__content">
      <div class="island-water-record__title">喝水提醒 💧</div>
      <div class="island-water-record__body">
        今日 {{ todayTotal }}ml / {{ target }}ml
        <span class="island-water-record__percent">（{{ percent }}%）</span>
      </div>
      <!-- 操作行：杯按钮 + 自定义 ml 输入 -->
      <div class="island-water-record__row">
        <button
          v-for="n in 3"
          :key="n"
          class="island-water-record__cup"
          @click="handleQuickRecord(n)"
        >
          +{{ n }}杯
        </button>
        <input
          v-model.number="customMl"
          type="number"
          class="island-water-record__input"
          placeholder="ml"
          min="1"
          @input="sanitizeCustomMl"
          @keyup.enter="handleCustomRecord"
        />
        <button
          class="island-water-record__cup"
          :disabled="!customMl || customMl <= 0"
          @click="handleCustomRecord"
        >
          记录
        </button>
      </div>
    </div>

    <!-- 关闭按钮 -->
    <div class="island-water-record__close" @click="emit('dismiss')">
      <el-icon><Close /></el-icon>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ColdDrink, Close } from '@element-plus/icons-vue'

const props = defineProps({
  extraData: { type: Object, default: null }
})

const emit = defineEmits(['dismiss', 'action'])

const cupSizeMl = computed(() => props.extraData?.cupSizeMl || 200)
const todayTotal = computed(() => props.extraData?.todayTotal || 0)
const target = computed(() => props.extraData?.target || 2000)
const percent = computed(() => {
  const t = target.value
  return t > 0 ? Math.round((todayTotal.value / t) * 100) : 0
})

const customMl = ref(null)

function handleQuickRecord (cups) {
  const amount = cups * cupSizeMl.value
  emit('action', {
    action: { label: 'water-record', value: 'water-record', amount },
    moduleType: 'water'
  })
}

function handleCustomRecord () {
  if (!customMl.value || customMl.value <= 0) return
  emit('action', {
    action: { label: 'water-record', value: 'water-record', amount: Math.round(customMl.value) },
    moduleType: 'water'
  })
  customMl.value = null
}

/**
 * 即时校验自定义饮水量：拦截负数、0 和非数字
 */
function sanitizeCustomMl () {
  const raw = customMl.value
  if (raw === '' || raw === null || raw === undefined) return
  const num = Number(raw)
  if (isNaN(num) || num <= 0) {
    customMl.value = null
  }
}
</script>

<style lang="scss" scoped>
.island-water-record {
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
    color: #409eff;
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

  &__percent {
    color: #409eff;
    font-weight: 600;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 2px;
  }

  &__cup {
    padding: 4px 10px;
    border-radius: 6px;
    background: rgba(64, 158, 255, 0.15);
    color: #409eff;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.2s ease;
    white-space: nowrap;

    &:hover:not(:disabled) {
      background: rgba(64, 158, 255, 0.28);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__input {
    width: 64px;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid var(--island-card-border, rgba(0, 0, 0, 0.15));
    background: var(--island-action-bg, rgba(0, 0, 0, 0.04));
    color: var(--island-text-primary);
    font-size: 11px;
    outline: none;

    &:focus {
      border-color: #409eff;
    }

    &::placeholder {
      color: var(--island-text-tertiary);
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
