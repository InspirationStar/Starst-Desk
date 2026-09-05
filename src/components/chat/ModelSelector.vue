<!--
  模型选择组件
  职责：下拉选择当前使用的 AI 模型配置
  - 显示模型类型图标（Ollama/DeepSeek/自定义）
  - 快速跳转到配置页
  - 支持按模型类别（language / image / video）过滤配置列表
-->
<template>
  <div class="model-selector">
    <el-select
      v-model="selectedConfigId"
      :placeholder="placeholder"
      :loading="loading"
      size="default"
      style="width: 240px"
      @change="handleChange"
    >
      <el-option
        v-for="config in configs"
        :key="config.id"
        :label="config.name"
        :value="config.id"
      >
        <div class="option-content">
          <el-icon class="option-icon"><component :is="getProviderIcon(config.provider_type)" /></el-icon>
          <span class="option-name">{{ config.name }}</span>
          <el-tag size="small" :type="getProviderTagType(config.provider_type)" effect="plain">
            {{ getProviderLabel(config.provider_type) }}
          </el-tag>
        </div>
      </el-option>

      <template #empty>
        <div class="empty-option">
          <span>{{ emptyText }}</span>
          <el-button text size="small" type="primary" @click="goToConfig">去配置</el-button>
        </div>
      </template>
    </el-select>

    <el-tooltip content="AI 模型配置" placement="bottom">
      <el-button :icon="Setting" circle size="small" @click="goToConfig" />
    </el-tooltip>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Setting, Cpu, Connection, Box } from '@element-plus/icons-vue'
import { useAiConfigStore } from '@/stores/ai-config-store'

const props = defineProps({
  // 当前选中的配置 ID
  modelValue: {
    type: String,
    default: ''
  },
  // 模型类别（language / image / video），传入时按类别过滤
  category: {
    type: String,
    default: '',
    validator: (val) => ['', 'language', 'image', 'video'].includes(val)
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

const router = useRouter()
const aiConfigStore = useAiConfigStore()

const loading = computed(() => aiConfigStore.loading)

// 按类别过滤后的配置列表
const configs = computed(() => {
  let list
  if (!props.category) {
    list = aiConfigStore.configs
  } else {
    list = aiConfigStore.configsByCategory[props.category] || []
  }
  // 确保 selectedConfigId 对应的配置在列表中，避免 el-select 显示原始 ID
  if (selectedConfigId.value) {
    const exists = list.some(c => c.id === selectedConfigId.value)
    if (!exists) {
      const selectedConfig = aiConfigStore.getConfigById(selectedConfigId.value)
      if (selectedConfig) {
        list = [...list, selectedConfig]
      } else if (aiConfigStore.loading || aiConfigStore.configs.length === 0) {
        // configs 正在加载或尚未加载，显示占位选项避免显示原始 ID
        list = [...list, { id: selectedConfigId.value, name: '加载中...', provider_type: '' }]
      }
    }
  }
  return list
})

// 当前选中的配置 ID（双向绑定）
const selectedConfigId = ref(props.modelValue)

// 监听外部变化
watch(() => props.modelValue, (val) => {
  selectedConfigId.value = val
})

// 监听 configs 列表加载完成，确保 selectedConfigId 对应的配置在列表中
// 解决切换页面后 configs 为空导致 el-select 显示原始 ID 的问题
// configs computed 会自动响应 aiConfigStore.configs 变化，这里显式 watch 作为保障
watch(() => aiConfigStore.configs.length, (newLen, oldLen) => {
  // configs 从空变为有数据时，configs computed 会自动重新计算并补充配置
  // 此处无需额外操作，仅通过 watch 确保响应式依赖被正确建立
  if (oldLen === 0 && newLen > 0 && selectedConfigId.value) {
    // 触发 selectedConfigId 重新赋值，确保 configs computed 重新计算
    const id = selectedConfigId.value
    selectedConfigId.value = id
  }
})

// 类别对应的占位符
const placeholder = computed(() => {
  if (configs.value.length === 0) {
    switch (props.category) {
      case 'image': return '请先配置图生模型'
      case 'video': return '请先配置视频模型'
      default: return '请先配置 AI 模型'
    }
  }
  switch (props.category) {
    case 'image': return '选择图生模型'
    case 'video': return '选择视频模型'
    default: return '选择 AI 模型'
  }
})

// 类别对应的空状态文案
const emptyText = computed(() => {
  switch (props.category) {
    case 'image': return '暂无图生模型'
    case 'video': return '暂无视频模型'
    default: return '暂无可用模型'
  }
})

// 提供商图标
function getProviderIcon (type) {
  switch (type) {
    case 'ollama': return Cpu
    case 'deepseek': return Connection
    case 'custom': return Box
    default: return Box
  }
}

// 提供商标签文本
function getProviderLabel (type) {
  switch (type) {
    case 'ollama': return 'Ollama'
    case 'deepseek': return 'DeepSeek'
    case 'custom': return '自定义'
    default: return type
  }
}

// 提供商标签类型
function getProviderTagType (type) {
  switch (type) {
    case 'ollama': return 'success'
    case 'deepseek': return 'primary'
    case 'custom': return 'warning'
    default: return 'info'
  }
}

// 选择变更
function handleChange (configId) {
  emit('update:modelValue', configId)
  emit('change', configId)
}

// 跳转到配置页
function goToConfig () {
  router.push('/ai-chat/config')
}

// 初始化时拉取配置列表
async function init () {
  if (aiConfigStore.configs.length === 0) {
    await aiConfigStore.fetchConfigs()
  }
  // 如果没有选中且有活跃配置，默认选中活跃配置
  if (!selectedConfigId.value && aiConfigStore.activeConfig) {
    // 若指定了类别，仅在该类别下才默认选中
    if (!props.category || (aiConfigStore.activeConfig.model_category || 'language') === props.category) {
      selectedConfigId.value = aiConfigStore.activeConfig.id
      handleChange(selectedConfigId.value)
    }
  }
}

init()
</script>

<style scoped lang="scss">
.model-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.option-content {
  display: flex;
  align-items: center;
  gap: 8px;

  .option-icon {
    color: #909399;
  }

  .option-name {
    flex: 1;
  }
}

.empty-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  color: #909399;
}

// 暗色模式适配
[data-theme='dark'] {
  .empty-option {
    color: #bfcbd9;
  }

  .option-content {
    .option-icon {
      color: #a3a6ad;
    }
  }
}
</style>
