<!--
  待办编辑对话框
  功能：新建 / 编辑待办，表单包含标题、截止日期、重复规则、颜色标签、备注
  调用 todo-store 的 create / update 方法完成持久化
-->
<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑待办' : '新建待办'"
    width="520px"
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="80px"
      label-position="right"
    >
      <!-- 标题 -->
      <el-form-item label="标题" prop="title">
        <el-input
          v-model="form.title"
          placeholder="请输入待办标题"
          maxlength="100"
          show-word-limit
          ref="titleInputRef"
        />
      </el-form-item>

      <!-- 截止日期 -->
      <el-form-item label="截止日期" prop="dueDate">
        <el-date-picker
          v-model="form.dueDate"
          type="date"
          placeholder="选择日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>

      <!-- 重复规则 -->
      <el-form-item label="重复规则" prop="recurrence">
        <el-select
          v-model="form.recurrence"
          placeholder="无"
          clearable
          style="width: 100%"
        >
          <el-option label="无" value="" />
          <el-option label="每天" value="daily" />
          <el-option label="每周" value="weekly" />
          <el-option label="每月" value="monthly" />
        </el-select>
      </el-form-item>

      <!-- 颜色标签 -->
      <el-form-item label="颜色标签">
        <div class="color-selector">
          <span
            v-for="c in colorOptions"
            :key="c.value"
            class="color-dot"
            :class="{ 'is-active': form.color === c.value, 'is-white': c.value === 'white' }"
            :style="{ background: c.hex }"
            :title="c.label"
            @click="form.color = c.value"
          />
        </div>
      </el-form-item>

      <!-- 备注 -->
      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="3"
          placeholder="可选备注信息"
          maxlength="500"
          show-word-limit
        />
      </el-form-item>
    </el-form>

    <!-- 底部按钮 -->
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { useTodoStore } from '@/stores/todo-store'

// ============================================================
// 组件属性与事件
// ============================================================
const props = defineProps({
  // 对话框显示控制
  modelValue: {
    type: Boolean,
    default: false
  },
  // 编辑的待办数据，null 表示新建
  todo: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:modelValue', 'saved'])

// ============================================================
// Store
// ============================================================
const todoStore = useTodoStore()

// ============================================================
// 对话框可见性双向绑定
// ============================================================
const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 是否为编辑模式（有 id 即为编辑）
const isEdit = computed(() => !!props.todo?.id)

// ============================================================
// 颜色选项配置（与 TodoListView 保持一致）
// ============================================================
const colorOptions = [
  { value: 'white', label: '白色', hex: '#ffffff' },
  { value: 'red',    label: '红色', hex: '#f56c6c' },
  { value: 'orange', label: '橙色', hex: '#e6a23c' },
  { value: 'yellow', label: '黄色', hex: '#fadb14' },
  { value: 'green',  label: '绿色', hex: '#67c23a' },
  { value: 'blue',   label: '蓝色', hex: '#409eff' },
  { value: 'purple', label: '紫色', hex: '#7054b8' }
]

// ============================================================
// 表单数据
// ============================================================
const formRef = ref()
const titleInputRef = ref()
const saving = ref(false)

const form = reactive({
  title: '',
  dueDate: '',
  recurrence: '',
  color: '',
  remark: ''
})

// ============================================================
// 表单验证规则
// ============================================================
const rules = {
  title: [
    { required: true, message: '请输入待办标题', trigger: 'blur' }
  ]
}

// ============================================================
// 监听对话框打开，初始化表单数据
// ============================================================
watch(visible, (val) => {
  if (val) {
    if (props.todo && props.todo.id) {
      fillFormFromTodo(props.todo)
    } else {
      resetForm()
    }
    // 手动聚焦标题输入框（替代 autofocus 属性，避免多元素冲突）
    nextTick(() => {
      titleInputRef.value?.focus()
    })
  }
})

/**
 * 从待办数据填充表单
 */
function fillFormFromTodo (todo) {
  form.title = todo.title || ''
  form.dueDate = todo.due_date || ''
  form.recurrence = todo.recurrence || ''
  form.color = todo.color || ''
  form.remark = todo.remark || ''
  nextTick(() => formRef.value?.clearValidate())
}

/**
 * 重置表单
 */
function resetForm () {
  form.title = ''
  form.dueDate = ''
  form.recurrence = ''
  form.color = ''
  form.remark = ''
  nextTick(() => formRef.value?.clearValidate())
}

// ============================================================
// 保存处理
// ============================================================
async function handleSave () {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  saving.value = true
  try {
    let savedTodo
    if (isEdit.value) {
      // 编辑模式：调用 update
      const payload = buildSavePayload()
      savedTodo = await todoStore.update(props.todo.id, payload)
    } else {
      // 新建模式：调用 create
      const payload = buildSavePayload()
      savedTodo = await todoStore.create(payload)
    }

    if (savedTodo) {
      ElMessage.success(isEdit.value ? '已更新待办' : '已创建待办')
      emit('saved', savedTodo)
      visible.value = false
    } else {
      ElMessage.error(`操作失败：${todoStore.error || '未知错误'}`)
    }
  } catch (err) {
    console.error('[TodoEditDialog] 保存失败:', err)
    ElMessage.error(`保存失败：${err.message || '未知错误'}`)
  } finally {
    saving.value = false
  }
}

/**
 * 构建保存到 store 的 payload 对象
 */
function buildSavePayload () {
  const payload = {
    title: form.title.trim(),
    color: form.color || 'blue',
    recurrence: form.recurrence || null,
    remark: form.remark.trim() || null
  }
  // 有日期才提交，清空时传 null
  payload.due_date = form.dueDate || null
  return payload
}

/**
 * 对话框关闭后处理
 */
function handleClosed () {
  resetForm()
}
</script>

<style scoped lang="scss">
// ============================================================
// 颜色选择器
// ============================================================
.color-selector {
  display: flex;
  align-items: center;
  gap: 10px;
}

.color-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  border: 2px solid transparent;

  &:hover {
    transform: scale(1.15);
  }

  &.is-active {
    border-color: var(--el-text-primary, #303133);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.15);
    transform: scale(1.15);
  }

  // 白色圆点需要边框，否则在浅色背景下不可见
  &.is-white {
    border-color: var(--el-border-color, #dcdfe6);
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark {
  .color-dot.is-active {
    border-color: var(--el-text-primary, #e5eaf3);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.2);
  }

  // 取消按钮（默认 el-button）暗色下 hover 状态适配
  // Element Plus 默认 hover 时背景使用 --el-color-primary-light-9，
  // 项目 applyAccentToDom 在暗色下用黑色混合 light-*，导致 hover 背景几乎不可见，
  // 这里显式覆盖 hover 态为半透明主色，保证可见性与对比度
  .el-button:not(.el-button--primary):not(.el-button--success):not(.el-button--warning):not(.el-button--danger):not(.is-text):not(.is-link):not(.is-disabled) {
    &:hover,
    &:focus {
      color: #79bbff;
      background-color: rgba(64, 158, 255, 0.1);
      border-color: rgba(64, 158, 255, 0.4);
    }

    &:active {
      color: #a0cfff;
      background-color: rgba(64, 158, 255, 0.15);
      border-color: rgba(64, 158, 255, 0.5);
    }
  }
}
</style>