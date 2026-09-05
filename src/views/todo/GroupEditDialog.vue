<!--
  任务流编辑对话框
  功能：新建/编辑任务流，包含步骤管理
-->
<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑任务流' : '新建任务流'"
    width="560px"
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
      <el-form-item label="名称" prop="name">
        <el-input v-model="form.name" placeholder="任务流名称" maxlength="50" show-word-limit ref="nameInputRef" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="form.description" type="textarea" :rows="2" placeholder="可选描述" maxlength="200" show-word-limit />
      </el-form-item>

      <!-- 步骤管理 -->
      <el-form-item label="步骤">
        <div class="steps-manager">
          <div v-for="(step, index) in form.steps" :key="index" class="step-row">
            <el-input v-model="step.name" placeholder="步骤名称" maxlength="50" class="step-row__name" />
            <el-input-number v-model="step.duration" :min="1" :max="480" :step="5" class="step-row__duration" controls-position="right" />
            <span class="step-row__unit">分钟</span>
            <el-button size="small" text type="danger" @click="removeStep(index)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
          <el-button size="small" @click="addStep">
            <el-icon><Plus /></el-icon>
            添加步骤
          </el-button>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import { invoke } from '@/utils/ipc-client'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  group: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'saved'])

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const isEdit = computed(() => !!props.group?.id)

const formRef = ref()
const nameInputRef = ref()
const saving = ref(false)

const form = ref({
  name: '',
  description: '',
  steps: []
})

const rules = {
  name: [
    { required: true, message: '请输入任务流名称', trigger: 'blur' },
    { max: 50, message: '名称最多 50 个字符', trigger: 'blur' }
  ]
}

watch(visible, (val) => {
  if (val) {
    if (props.group && props.group.id) {
      form.value = {
        name: props.group.name || '',
        description: props.group.description || '',
        steps: Array.isArray(props.group.steps) ? [...props.group.steps] : []
      }
    } else {
      form.value = { name: '', description: '', steps: [{ name: '', duration: 25 }] }
    }
    formRef.value?.clearValidate()
    nextTick(() => nameInputRef.value?.focus())
  }
})

function addStep () {
  form.value.steps.push({ name: '', duration: 25 })
}

function removeStep (index) {
  form.value.steps.splice(index, 1)
}

async function handleSave () {
  try {
    await formRef.value.validate()
  } catch { return }

  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      steps: form.value.steps.filter(s => s.name.trim())
    }

    let result
    if (isEdit.value) {
      result = await invoke('group:update', { id: props.group.id, ...payload })
    } else {
      result = await invoke('group:create', payload)
    }

    if (result?.group) {
      ElMessage.success(isEdit.value ? '已更新任务流' : '已创建任务流')
      emit('saved')
      visible.value = false
    } else {
      ElMessage.error(`操作失败：${result?.error?.message || '未知错误'}`)
    }
  } catch (err) {
    ElMessage.error(`保存失败：${err.message}`)
  } finally {
    saving.value = false
  }
}

function handleClosed () {
  form.value = { name: '', description: '', steps: [] }
  formRef.value?.clearValidate()
}
</script>

<style scoped lang="scss">
.steps-manager {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.step-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-row__name {
  flex: 1;
}

.step-row__duration {
  width: 80px;
}

.step-row__unit {
  font-size: 13px;
  color: var(--el-text-secondary);
  white-space: nowrap;
}
</style>