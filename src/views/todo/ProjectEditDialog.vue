<!--
  项目编辑对话框
  功能：新建/编辑项目，包含里程碑管理
-->
<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑项目' : '新建项目'"
    width="560px"
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
      <el-form-item label="名称" prop="name">
        <el-input v-model="form.name" placeholder="项目名称" maxlength="50" show-word-limit ref="nameInputRef" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="form.description" type="textarea" :rows="2" placeholder="可选描述" maxlength="200" show-word-limit />
      </el-form-item>

      <!-- 里程碑管理 -->
      <el-form-item label="里程碑">
        <div class="milestones-manager">
          <div v-for="(ms, index) in form.milestones" :key="index" class="ms-row">
            <el-checkbox v-model="ms.done" class="ms-row__check" />
            <el-input v-model="ms.title" placeholder="里程碑名称" maxlength="50" class="ms-row__title" :disabled="ms.done" />
            <el-button size="small" text type="danger" @click="removeMilestone(index)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
          <el-button size="small" @click="addMilestone">
            <el-icon><Plus /></el-icon>
            添加里程碑
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
  project: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'saved'])

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const isEdit = computed(() => !!props.project?.id)

const formRef = ref()
const nameInputRef = ref()
const saving = ref(false)

const form = ref({
  name: '',
  description: '',
  milestones: []
})

const rules = {
  name: [
    { required: true, message: '请输入项目名称', trigger: 'blur' },
    { max: 50, message: '名称最多 50 个字符', trigger: 'blur' }
  ]
}

watch(visible, (val) => {
  if (val) {
    if (props.project && props.project.id) {
      form.value = {
        name: props.project.name || '',
        description: props.project.description || '',
        milestones: Array.isArray(props.project.milestones)
          ? props.project.milestones.map(m => ({ title: m.title || m.name || '', done: Boolean(m.done) }))
          : []
      }
    } else {
      form.value = { name: '', description: '', milestones: [] }
    }
    formRef.value?.clearValidate()
    nextTick(() => nameInputRef.value?.focus())
  }
})

function addMilestone () {
  form.value.milestones.push({ title: '', done: false })
}

function removeMilestone (index) {
  form.value.milestones.splice(index, 1)
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
      milestones: form.value.milestones
    }

    let result
    if (isEdit.value) {
      result = await invoke('project:update', { id: props.project.id, ...payload })
    } else {
      result = await invoke('project:create', payload)
    }

    if (result?.project) {
      ElMessage.success(isEdit.value ? '已更新项目' : '已创建项目')
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
  form.value = { name: '', description: '', milestones: [] }
  formRef.value?.clearValidate()
}
</script>

<style scoped lang="scss">
.milestones-manager {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.ms-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ms-row__check {
  flex-shrink: 0;
}

.ms-row__title {
  flex: 1;
}
</style>