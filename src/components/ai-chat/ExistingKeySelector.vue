<!--
  已有 API Key 选择组件
  职责：
    - 调用 aiApi.listConfigs() 获取已有配置列表
    - 下拉仅显示有 api_key_masked（即存在 api_key_encrypted）的配置
    - 选择后 emit change 事件，传递 { config_id, api_endpoint, config_name }
  用法：
    <ExistingKeySelector
      v-model="sourceConfigId"
      :exclude-id="editingConfig?.id"
      @change="handleExistingKeyChange"
    />
-->
<template>
  <div class="existing-key-selector">
    <el-select
      v-model="selectedId"
      placeholder="选择已有配置以复用密钥（可选）"
      :loading="loading"
      clearable
      style="width: 100%"
      @change="handleChange"
    >
      <el-option
        v-for="cfg in availableConfigs"
        :key="cfg.id"
        :label="`${cfg.name}（${getProviderLabel(cfg.provider_type)}）`"
        :value="cfg.id"
      >
        <div class="key-option">
          <span class="key-name">{{ cfg.name }}</span>
          <el-tag size="small" :type="getProviderTagType(cfg.provider_type)" effect="plain">
            {{ getProviderLabel(cfg.provider_type) }}
          </el-tag>
          <el-tag v-if="cfg.model_category && cfg.model_category !== 'language'" size="small" type="info" effect="plain">
            {{ getCategoryLabel(cfg.model_category) }}
          </el-tag>
        </div>
      </el-option>

      <template #empty>
        <div class="empty-option">
          <span>暂无可复用密钥的配置</span>
        </div>
      </template>
    </el-select>

    <!-- 选中后提示 -->
    <div v-if="currentConfig" class="key-hint">
      <el-icon><InfoFilled /></el-icon>
      <span>将复用「{{ currentConfig.name }}」的 API 密钥</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { InfoFilled } from '@element-plus/icons-vue'
import { aiApi } from '@/utils/ipc-client'

const props = defineProps({
  // 当前选中的 config_id
  modelValue: {
    type: [Number, String],
    default: ''
  },
  // 排除的配置 ID（编辑时排除自身）
  excludeId: {
    type: [Number, String],
    default: ''
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

// 已有配置列表（含密钥）
const configs = ref([])
// 加载状态
const loading = ref(false)
// 当前选中的 config_id
const selectedId = ref(props.modelValue)

// 过滤掉排除 ID 后的可用配置
const availableConfigs = computed(() => {
  const exclude = props.excludeId
  if (exclude === '' || exclude === null || exclude === undefined) return configs.value
  return configs.value.filter(c => String(c.id) !== String(exclude))
})

// 当前选中的配置对象
const currentConfig = computed(() => {
  if (!selectedId.value) return null
  return configs.value.find(c => String(c.id) === String(selectedId.value)) || null
})

// 提供商显示名称
function getProviderLabel (type) {
  switch (type) {
    case 'ollama': return 'Ollama'
    case 'openai': return 'OpenAI'
    case 'anthropic': return 'Claude'
    case 'gemini': return 'Gemini'
    case 'deepseek': return 'DeepSeek'
    case 'agnes-image': return 'Agnes 图像'
    case 'agnes-video': return 'Agnes 视频'
    case 'agnes-all': return 'Agnes 全能'
    case 'custom': return '自定义'
    default: return type
  }
}

// 提供商标签类型
function getProviderTagType (type) {
  switch (type) {
    case 'ollama': return 'success'
    case 'openai': return 'primary'
    case 'anthropic': return 'warning'
    case 'gemini': return 'primary'
    case 'deepseek': return 'primary'
    case 'agnes-image': return 'danger'
    case 'agnes-video': return 'danger'
    case 'agnes-all': return 'danger'
    case 'custom': return 'warning'
    default: return 'info'
  }
}

// 模型类别显示名称
function getCategoryLabel (category) {
  switch (category) {
    case 'image': return '图片生成'
    case 'video': return '视频生成'
    default: return '语言'
  }
}

// 拉取已有配置列表（仅保留有密钥的）
async function fetchConfigs () {
  loading.value = true
  try {
    const list = await aiApi.listConfigs()
    // 仅显示有 api_key_masked（即存在 api_key_encrypted）的配置
    configs.value = (list || []).filter(c => c.api_key_masked)
  } catch (err) {
    console.error('[ExistingKeySelector] fetchConfigs 失败:', err)
    configs.value = []
  } finally {
    loading.value = false
  }
}

// 选择变更
function handleChange (configId) {
  emit('update:modelValue', configId)
  const cfg = configId
    ? configs.value.find(c => String(c.id) === String(configId)) || null
    : null
  // 透传 { config_id, api_endpoint, config_name }，父组件可据此显示提示
  emit('change', cfg ? {
    config_id: cfg.id,
    api_endpoint: cfg.api_endpoint || '',
    config_name: cfg.name || ''
  } : null)
}

// 外部 modelValue 变更时同步
watch(() => props.modelValue, (val) => {
  selectedId.value = val
})

onMounted(() => {
  fetchConfigs()
})
</script>

<style scoped lang="scss">
.existing-key-selector {
  width: 100%;

  .key-option {
    display: flex;
    align-items: center;
    gap: 8px;

    .key-name {
      flex: 1;
    }
  }

  .empty-option {
    padding: 8px 12px;
    color: #909399;
  }

  .key-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 6px 8px;
    background: #f0f9eb;
    border-radius: 4px;
    font-size: 12px;
    color: #67c23a;
    line-height: 1.4;
  }
}

// 暗色模式适配
[data-theme='dark'] {
  .existing-key-selector {
    .empty-option {
      color: #bfcbd9;
    }

    .key-hint {
      background: #1a2e1a;
      color: #67c23a;
    }
  }
}
</style>