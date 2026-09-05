<!--
  媒体格式模板选择组件
  职责：
    - 调用 mediaApi.listTemplates(category) 获取可用模板
    - 下拉选择模板后自动填充 model_name、api_endpoint 默认值
    - 显示模板描述和参数提示
  用法：
    <MediaTemplateSelector
      v-model="templateId"
      category="image"
      @change="handleTemplateChange"
    />
-->
<template>
  <div class="media-template-selector">
    <el-select
      v-model="selectedTemplateId"
      placeholder="选择格式模板（可选）"
      :loading="loading"
      clearable
      style="width: 100%"
      @change="handleChange"
    >
      <el-option
        v-for="tpl in templates"
        :key="tpl.id"
        :label="tpl.label"
        :value="tpl.id"
      >
        <div class="template-option">
          <span class="template-label">{{ tpl.label }}</span>
          <el-tag size="small" :type="getProviderTagType(tpl.provider)" effect="plain">
            {{ tpl.provider }}
          </el-tag>
          <el-tag v-if="tpl.custom" size="small" type="info" effect="plain">自定义</el-tag>
        </div>
      </el-option>

      <template #empty>
        <div class="empty-option">
          <span>暂无可用模板</span>
        </div>
      </template>
    </el-select>

    <!-- 模板描述 / 参数提示 -->
    <div v-if="currentTemplate" class="template-desc">
      <el-icon><InfoFilled /></el-icon>
      <span>{{ templateHint }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { InfoFilled } from '@element-plus/icons-vue'
import { mediaApi } from '@/utils/ipc-client'

const props = defineProps({
  // 当前选中的模板 ID
  modelValue: {
    type: String,
    default: ''
  },
  // 模型类别（image / video）
  category: {
    type: String,
    default: 'image',
    validator: (val) => ['image', 'video'].includes(val)
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

// 模板列表
const templates = ref([])
// 加载状态
const loading = ref(false)
// 当前选中的模板 ID
const selectedTemplateId = ref(props.modelValue)

// 当前选中的模板对象
const currentTemplate = computed(() => {
  if (!selectedTemplateId.value) return null
  return templates.value.find(t => t.id === selectedTemplateId.value) || null
})

// 模板提示文本
const templateHint = computed(() => {
  const tpl = currentTemplate.value
  if (!tpl) return ''
  const parts = []
  parts.push(`提供商：${tpl.provider}`)
  parts.push(`类别：${tpl.category === 'image' ? '图片生成' : '视频生成'}`)
  parts.push(`模型：${tpl.id}`)
  return parts.join(' · ')
})

// 提供商标签类型
function getProviderTagType (provider) {
  switch (provider) {
    case 'agnes': return 'danger'
    case 'openai': return 'primary'
    case 'stability': return 'warning'
    default: return 'info'
  }
}

// 拉取模板列表
async function fetchTemplates () {
  loading.value = true
  try {
    const result = await mediaApi.listTemplates(props.category)
    templates.value = result || []
  } catch (err) {
    console.error('[MediaTemplateSelector] fetchTemplates 失败:', err)
    templates.value = []
  } finally {
    loading.value = false
  }
}

// 选择变更
function handleChange (templateId) {
  emit('update:modelValue', templateId)
  const tpl = templateId
    ? templates.value.find(t => t.id === templateId) || null
    : null
  // 透传模板对象，父组件可据此填充 model_name / api_endpoint
  emit('change', tpl)
}

// 外部 modelValue 变更时同步
watch(() => props.modelValue, (val) => {
  selectedTemplateId.value = val
})

// 类别变更时重新拉取
watch(() => props.category, () => {
  selectedTemplateId.value = ''
  emit('update:modelValue', '')
  emit('change', null)
  fetchTemplates()
})

onMounted(() => {
  fetchTemplates()
})
</script>

<style scoped lang="scss">
.media-template-selector {
  width: 100%;

  .template-option {
    display: flex;
    align-items: center;
    gap: 8px;

    .template-label {
      flex: 1;
    }
  }

  .empty-option {
    padding: 8px 12px;
    color: #909399;
  }

  .template-desc {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 6px 8px;
    background: #f5f7fa;
    border-radius: 4px;
    font-size: 12px;
    color: #909399;
    line-height: 1.4;
  }
}

// 暗色模式适配
[data-theme='dark'] {
  .media-template-selector {
    .empty-option {
      color: #bfcbd9;
    }

    .template-desc {
      background: #252526;
      color: #a3a6ad;
    }
  }
}
</style>