<!--
  便签编辑对话框
  用于新建/编辑便签，包含标题、富文本内容、颜色标签、提醒时间、置顶/完成开关
  表单验证：标题或内容至少一项不为空
-->
<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑便签' : '新建便签'"
    width="640px"
    :close-on-click-modal="false"
    :destroy-on-close="true"
    @open="handleOpen"
    @closed="handleClosed"
  >
    <el-form
      ref="formRef"
      :model="formData"
      :rules="formRules"
      label-position="top"
      class="note-edit-form"
    >
      <!-- 标题 -->
      <el-form-item label="标题" prop="title">
        <el-input
          v-model="formData.title"
          placeholder="请输入标题（可选）"
          maxlength="100"
          show-word-limit
          clearable
        />
      </el-form-item>

      <!-- 内容（富文本 / Markdown 切换） -->
      <el-form-item label="内容" prop="body">
        <!-- 格式切换 -->
        <div class="body-format-switch">
          <el-radio-group v-model="bodyFormat" size="small" @change="handleFormatChange">
            <el-radio-button value="html">富文本</el-radio-button>
            <el-radio-button value="markdown">Markdown</el-radio-button>
          </el-radio-group>
        </div>
        <!-- 富文本编辑器 -->
        <rich-text-editor
          v-if="bodyFormat === 'html'"
          ref="editorRef"
          v-model="formData.body"
          placeholder="请输入便签内容..."
          min-height="200px"
        />
        <!-- Markdown 编辑器 -->
        <markdown-editor
          v-else
          ref="markdownEditorRef"
          v-model="formData.body"
          placeholder="请输入便签内容（Markdown）..."
          height="240px"
          :initial-mode="'edit'"
        />
      </el-form-item>

      <!-- 颜色标签 -->
      <el-form-item label="颜色标签" prop="color_tag">
        <el-radio-group v-model="formData.color_tag">
          <el-radio
            v-for="color in colors"
            :key="color.value"
            :value="color.value"
            class="color-radio"
          >
            <span class="color-swatch" :style="{ background: color.color }">
              {{ color.label }}
            </span>
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <!-- 提醒时间 -->
      <el-form-item label="提醒时间" prop="reminder_time">
        <el-date-picker
          v-model="formData.reminder_time"
          type="datetime"
          placeholder="选择提醒时间（可选）"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DD HH:mm:00"
          :disabled-date="disabledDate"
          :disabled-hours="disabledHours"
          clearable
          style="width: 100%"
        />
      </el-form-item>

      <!-- 置顶 / 完成开关 -->
      <el-form-item label="状态">
        <div class="status-switches">
          <el-switch
            v-model="formData.is_pinned"
            :active-value="1"
            :inactive-value="0"
            active-text="置顶"
            inline-prompt
          />
          <el-switch
            v-model="formData.is_completed"
            :active-value="1"
            :inactive-value="0"
            active-text="标记完成"
            inline-prompt
            :disabled="!isEdit"
          />
        </div>
        <div v-if="!isEdit" class="form-tip">
          新建便签不支持直接标记完成，请创建后在列表中操作
        </div>
      </el-form-item>
    </el-form>

    <!-- 底部按钮 -->
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">
        {{ isEdit ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { NOTE_COLORS } from '@/utils/constants'
import { useNoteStore } from '@/stores/note-store'
import RichTextEditor from '@/components/notes/RichTextEditor.vue'
import MarkdownEditor from '@/components/common/MarkdownEditor.vue'

// Props
const props = defineProps({
  // 是否显示
  modelValue: {
    type: Boolean,
    default: false
  },
  // 编辑的便签对象（null 表示新建）
  note: {
    type: Object,
    default: null
  }
})

// Emits
const emit = defineEmits(['update:modelValue', 'saved'])

// Store
const noteStore = useNoteStore()

// 颜色常量
const colors = NOTE_COLORS

// 对话框可见状态（双向绑定）
const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 是否编辑模式
const isEdit = computed(() => !!props.note && !!props.note.id)

// 表单引用
const formRef = ref(null)
const editorRef = ref(null)
const markdownEditorRef = ref(null)

// 保存中状态
const saving = ref(false)

// 内容格式：html（富文本） / markdown
// 新建默认 markdown（推广新功能），编辑现有根据内容自动检测
const bodyFormat = ref('markdown')

// 表单数据
const formData = reactive({
  id: null,
  title: '',
  body: '',
  color_tag: 'yellow',
  reminder_time: null,
  is_pinned: 0,
  is_completed: 0
})

// 自定义校验：标题或内容至少一项不为空
const validateContent = (rule, value, callback) => {
  const title = formData.title?.trim() || ''
  // 根据格式提取纯文本
  let bodyText = ''
  if (bodyFormat.value === 'markdown') {
    bodyText = markdownEditorRef.value ? markdownEditorRef.value.getText().trim() : (formData.body || '').replace(/<[^>]+>/g, '').trim()
  } else {
    bodyText = editorRef.value ? editorRef.value.getText().trim() : (formData.body || '').replace(/<[^>]+>/g, '').trim()
  }
  if (!title && !bodyText) {
    callback(new Error('标题和内容不能同时为空'))
  } else {
    callback()
  }
}

// 表单校验规则
const formRules = {
  title: [{ validator: validateContent, trigger: 'blur' }],
  body: [{ validator: validateContent, trigger: 'blur' }]
}

// 禁用过去的日期
function disabledDate (date) {
  return date.getTime() < dayjs().startOf('day').valueOf()
}

// 禁用过去的小时（仅当选择今天时）
function disabledHours () {
  const selected = formData.reminder_time ? dayjs(formData.reminder_time) : null
  if (selected && selected.isSame(dayjs(), 'day')) {
    const nowHour = dayjs().hour()
    return Array.from({ length: nowHour }, (_, i) => i)
  }
  return []
}

// 对话框打开时初始化表单
function handleOpen () {
  if (isEdit.value && props.note) {
    // 编辑模式：填充已有数据
    Object.assign(formData, {
      id: props.note.id,
      title: props.note.title || '',
      body: props.note.body || '',
      color_tag: props.note.color_tag || 'yellow',
      reminder_time: props.note.reminder_time || null,
      is_pinned: Number(props.note.is_pinned) || 0,
      is_completed: Number(props.note.is_completed) || 0
    })
    // 自动检测内容格式：包含 HTML 标签视为富文本，否则视为 Markdown
    bodyFormat.value = detectBodyFormat(formData.body)
  } else {
    // 新建模式：重置为默认值，默认 Markdown 格式
    Object.assign(formData, {
      id: null,
      title: '',
      body: '',
      color_tag: 'yellow',
      reminder_time: null,
      is_pinned: 0,
      is_completed: 0
    })
    bodyFormat.value = 'markdown'
  }
  // 清除校验状态
  nextTick(() => {
    formRef.value?.clearValidate()
  })
}

/**
 * 检测 body 内容格式
 * 包含 Quill 常见 HTML 标签视为富文本，否则视为 Markdown
 */
function detectBodyFormat (body) {
  if (!body) return 'markdown'
  // Quill 输出常见标签：<p> <strong> <em> <s> <u> <ol> <ul> <li> <h1> <blockquote> <pre> <span>
  if (/<(p|div|strong|em|s|u|ol|ul|li|h[1-6]|blockquote|pre|span|br|img|a)\b/i.test(body)) {
    return 'html'
  }
  return 'markdown'
}

/**
 * 格式切换处理
 * 切换时清空内容（避免格式混乱），带确认提示
 */
async function handleFormatChange (newFormat) {
  if (!formData.body) return
  try {
    await ElMessageBox.confirm(
      '切换格式将清空当前内容，是否继续？',
      '格式切换',
      { confirmButtonText: '切换并清空', cancelButtonText: '取消', type: 'warning' }
    )
    formData.body = ''
  } catch {
    // 用户取消，恢复原格式
    bodyFormat.value = newFormat === 'markdown' ? 'html' : 'markdown'
  }
}

// 对话框关闭后清理
function handleClosed () {
  formRef.value?.resetFields()
  Object.assign(formData, {
    id: null,
    title: '',
    body: '',
    color_tag: 'yellow',
    reminder_time: null,
    is_pinned: 0,
    is_completed: 0
  })
}

// 保存
async function handleSave () {
  // 表单校验
  try {
    await formRef.value?.validate()
  } catch {
    ElMessage.warning('请检查表单内容')
    return
  }

  // 二次校验内容非空
  const title = formData.title?.trim() || ''
  let bodyText = ''
  if (bodyFormat.value === 'markdown') {
    bodyText = markdownEditorRef.value ? markdownEditorRef.value.getText().trim() : ''
  } else {
    bodyText = editorRef.value ? editorRef.value.getText().trim() : ''
  }
  if (!title && !bodyText) {
    ElMessage.warning('标题和内容不能同时为空')
    return
  }

  // 校验提醒时间不能早于当前
  if (formData.reminder_time) {
    const reminderTime = dayjs(formData.reminder_time)
    if (reminderTime.isBefore(dayjs())) {
      ElMessage.warning('提醒时间不能早于当前时间')
      return
    }
  }

  saving.value = true
  try {
    // 组装请求数据
    const payload = {
      title: formData.title?.trim() || null,
      body: formData.body || null,
      color_tag: formData.color_tag,
      reminder_time: formData.reminder_time || null,
      is_pinned: formData.is_pinned
    }

    let result
    if (isEdit.value) {
      // 编辑：包含 is_completed
      payload.is_completed = formData.is_completed
      result = await noteStore.updateNote(formData.id, payload)
    } else {
      // 新建
      result = await noteStore.createNote(payload)
    }

    if (result) {
      ElMessage.success(isEdit.value ? '保存成功' : '创建成功')
      emit('saved', result)
      visible.value = false
    } else {
      ElMessage.error(noteStore.error || '保存失败')
    }
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.note-edit-form {
  // 内容格式切换
  .body-format-switch {
    margin-bottom: 8px;
  }

  // 颜色选择器
  .color-radio {
    margin-right: 12px;
    margin-bottom: 8px;

    :deep(.el-radio__label) {
      padding-left: 6px;
    }
  }

  .color-swatch {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    color: #606266;
    border: 1px solid rgba(0, 0, 0, 0.08);
  }

  // 状态开关
  .status-switches {
    display: flex;
    gap: 24px;
    align-items: center;
  }

  .form-tip {
    margin-top: 4px;
    font-size: 12px;
    color: #909399;
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark .note-edit-form {
  .color-swatch {
    color: #cfd3dc;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .form-tip {
    color: #a3a6ad;
  }
}
</style>