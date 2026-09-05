<!--
  Markdown 编辑器组件
  职责：提供 Markdown 编辑能力（工具栏 + 编辑区 + 预览切换）
  - 工具栏：加粗/斜体/删除线/代码/链接/标题/列表/任务/引用/表格/缩进/反缩进
  - 编辑区：textarea，基于 selectionStart/selectionEnd 实现选区操作
  - 预览区：复用 MarkdownRenderer.vue
  - 模式切换：编辑 / 分屏 / 预览
  - 快捷键：Ctrl+B 加粗, Ctrl+I 斜体, Ctrl+K 链接
  - 暗色模式：通过 html.dark 适配
-->
<template>
  <div class="markdown-editor" :style="editorStyle">
    <!-- 工具栏 -->
    <div v-if="!previewOnly && mode !== 'preview'" class="md-toolbar">
      <!-- 行内格式 -->
      <el-button-group>
        <el-tooltip content="加粗 (Ctrl+B)" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Bold)">
            <span class="md-btn-icon md-bold-icon">B</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="斜体 (Ctrl+I)" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Italic)">
            <span class="md-btn-icon md-italic-icon">I</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="删除线" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Strikethrough)">
            <span class="md-btn-icon md-strike-icon">S</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="代码" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Code)">
            <span class="md-btn-icon">&lt;/&gt;</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="链接 (Ctrl+K)" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Link)">
            <el-icon><Link /></el-icon>
          </el-button>
        </el-tooltip>
      </el-button-group>

      <!-- 块级格式 -->
      <el-button-group>
        <el-tooltip content="标题" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Heading)">
            <span class="md-btn-icon">H</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="列表" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.List)">
            <span class="md-btn-icon md-list-icon">•</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="任务" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Task)">
            <span class="md-btn-icon md-task-icon">☐</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="引用" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Quote)">
            <span class="md-btn-icon md-quote-icon">❝</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="表格" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Table)">
            <el-icon><Grid /></el-icon>
          </el-button>
        </el-tooltip>
      </el-button-group>

      <!-- 缩进 -->
      <el-button-group>
        <el-tooltip content="缩进" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Indent)">
            <span class="md-btn-icon md-indent-icon">→</span>
          </el-button>
        </el-tooltip>
        <el-tooltip content="反缩进" placement="bottom" :show-after="300">
          <el-button class="md-btn" size="small" @click="execCommand(MarkdownEditCommand.Outdent)">
            <span class="md-btn-icon md-outdent-icon">←</span>
          </el-button>
        </el-tooltip>
      </el-button-group>

      <!-- 模式切换（右侧） -->
      <div v-if="showPreview" class="md-mode-switch">
        <el-tooltip content="仅编辑" placement="bottom" :show-after="300">
          <el-button
            class="md-btn"
            size="small"
            :type="mode === 'edit' ? 'primary' : 'default'"
            @click="mode = 'edit'"
          >
            <el-icon><EditPen /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="分屏" placement="bottom" :show-after="300">
          <el-button
            class="md-btn"
            size="small"
            :type="mode === 'split' ? 'primary' : 'default'"
            @click="mode = 'split'"
          >
            <el-icon><FullScreen /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="仅预览" placement="bottom" :show-after="300">
          <el-button
            class="md-btn"
            size="small"
            :type="mode === 'preview' ? 'primary' : 'default'"
            @click="mode = 'preview'"
          >
            <el-icon><View /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="md-content" :class="`md-mode-${mode}`">
      <!-- 编辑区 -->
      <textarea
        v-show="mode === 'edit' || mode === 'split'"
        ref="textareaRef"
        class="md-textarea"
        :value="modelValue"
        :placeholder="placeholder"
        :style="textareaStyle"
        spellcheck="false"
        @input="handleInput"
        @keydown="handleKeydown"
        @scroll="syncScroll"
      ></textarea>

      <!-- 预览区 -->
      <div
        v-if="mode === 'split' || mode === 'preview'"
        ref="previewRef"
        class="md-preview win11-scrollbar"
        :style="previewStyle"
      >
        <MarkdownRenderer :content="modelValue" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { Link, Grid, EditPen, FullScreen, View } from '@element-plus/icons-vue'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import {
  MarkdownEditCommand,
  tryCreateEdit,
  applyEdit
} from '@/utils/markdown-edit-command-engine'

// ============================================================
// Props
// ============================================================
const props = defineProps({
  // v-model 绑定值（Markdown 文本）
  modelValue: {
    type: String,
    default: ''
  },
  // 占位符
  placeholder: {
    type: String,
    default: '请输入 Markdown 内容...'
  },
  // 编辑器高度
  height: {
    type: String,
    default: '240px'
  },
  // 是否显示预览切换
  showPreview: {
    type: Boolean,
    default: true
  },
  // 初始模式：edit / split / preview
  initialMode: {
    type: String,
    default: 'edit',
    validator: (v) => ['edit', 'split', 'preview'].includes(v)
  }
})

// ============================================================
// Emits
// ============================================================
const emit = defineEmits(['update:modelValue', 'save'])

// ============================================================
// 状态
// ============================================================
const textareaRef = ref(null)
const previewRef = ref(null)

// 编辑模式：edit / split / preview
const mode = ref(props.showPreview ? props.initialMode : 'edit')

// 仅预览标志（mode === 'preview' 时隐藏工具栏）
const previewOnly = computed(() => mode.value === 'preview')

// ============================================================
// 样式
// ============================================================
const editorStyle = computed(() => ({
  height: props.height
}))

const textareaStyle = computed(() => ({
  // 分屏模式各占一半，否则占满
  flex: mode.value === 'split' ? '1 1 50%' : '1 1 100%'
}))

const previewStyle = computed(() => ({
  flex: mode.value === 'split' ? '1 1 50%' : '1 1 100%'
}))

// ============================================================
// 编辑命令执行
// ============================================================

/**
 * 执行 Markdown 编辑命令
 * 1. 读取 textarea 当前选区
 * 2. 调用 tryCreateEdit 计算最小编辑操作
 * 3. 应用编辑并 emit 更新
 * 4. nextTick 后恢复选区（保留原生 undo 栈）
 */
function execCommand (command) {
  const textarea = textareaRef.value
  if (!textarea) return

  const source = textarea.value
  const start = textarea.selectionStart
  const length = textarea.selectionEnd - textarea.selectionStart

  const edit = tryCreateEdit(source, start, length, command)
  if (!edit) return

  const newText = applyEdit(source, edit)
  emit('update:modelValue', newText)

  // 等待 DOM 更新后恢复选区
  nextTick(() => {
    if (!textareaRef.value) return
    textareaRef.value.focus()
    const selStart = edit.selectionStart
    const selEnd = edit.selectionStart + edit.selectionLength
    textareaRef.value.setSelectionRange(selStart, selEnd)
  })
}

/**
 * textarea 输入事件
 */
function handleInput (event) {
  emit('update:modelValue', event.target.value)
}

/**
 * 快捷键处理
 */
function handleKeydown (event) {
  // Ctrl/Cmd + B：加粗
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault()
    execCommand(MarkdownEditCommand.Bold)
    return
  }
  // Ctrl/Cmd + I：斜体
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
    event.preventDefault()
    execCommand(MarkdownEditCommand.Italic)
    return
  }
  // Ctrl/Cmd + K：链接
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    execCommand(MarkdownEditCommand.Link)
    return
  }
  // Ctrl/Cmd + Enter：保存（向父组件发出 save 事件）
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    emit('save')
    return
  }
  // Tab：缩进（覆盖默认 tab 切换焦点行为）
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    execCommand(MarkdownEditCommand.Indent)
    return
  }
  // Shift + Tab：反缩进
  if (event.key === 'Tab' && event.shiftKey) {
    event.preventDefault()
    execCommand(MarkdownEditCommand.Outdent)
    return
  }
}

/**
 * 同步编辑区与预览区滚动（分屏模式）
 */
function syncScroll (event) {
  if (mode.value !== 'split' || !previewRef.value) return
  const textarea = event.target
  // 按比例同步滚动
  const ratio = textarea.scrollTop / (textarea.scrollHeight - textarea.clientHeight || 1)
  previewRef.value.scrollTop = ratio * (previewRef.value.scrollHeight - previewRef.value.clientHeight || 1)
}

// ============================================================
// 暴露方法（供父组件调用）
// ============================================================
defineExpose({
  /**
   * 执行编辑命令
   * @param {string} command MarkdownEditCommand 值
   */
  execCommand,
  /**
   * 获取纯文本（去除 Markdown 标记）
   * 用于表单校验等场景
   */
  getText () {
    return (props.modelValue || '')
      // 去除标题/列表/任务/引用标记
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-+*]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^[-+*]\s+/gm, '')
      .replace(/^>\s*/gm, '')
      // 去除行内格式标记
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim()
  },
  /**
   * 聚焦编辑区
   */
  focus () {
    textareaRef.value?.focus()
  }
})

// ============================================================
// 监听 showPreview 变化
// ============================================================
watch(() => props.showPreview, (val) => {
  if (!val) mode.value = 'edit'
  else if (mode.value === 'edit' && props.initialMode !== 'edit') mode.value = props.initialMode
})
</script>

<style scoped lang="scss">
.markdown-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 4px;
  overflow: hidden;
  background: var(--el-bg-color, #fff);
}

// ============================================================
// 工具栏
// ============================================================
.md-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--el-border-color, #dcdfe6);
  background: var(--el-fill-color-light, #f5f7fa);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.md-btn {
  // 缩小按钮尺寸，使工具栏紧凑
  padding: 4px 8px !important;
  min-width: 28px;
  height: 26px !important;
}

.md-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  line-height: 1;
  min-width: 14px;
}

// 加粗：粗体字
.md-bold-icon {
  font-weight: 700;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

// 斜体：斜体字
.md-italic-icon {
  font-style: italic;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

// 删除线
.md-strike-icon {
  text-decoration: line-through;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

// 列表符号
.md-list-icon {
  font-size: 16px;
  font-weight: 700;
}

// 任务符号
.md-task-icon {
  font-size: 14px;
}

// 引用符号
.md-quote-icon {
  font-size: 16px;
}

// 缩进符号
.md-indent-icon,
.md-outdent-icon {
  font-size: 14px;
  font-weight: 700;
}

// 模式切换（右侧）
.md-mode-switch {
  display: flex;
  gap: 2px;
  margin-left: auto;
}

// ============================================================
// 内容区
// ============================================================
.md-content {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;

  // 分屏模式中间加分隔线
  &.md-mode-split {
    .md-textarea {
      border-right: 1px solid var(--el-border-color, #dcdfe6);
    }
  }
}

// 编辑区 textarea
.md-textarea {
  flex: 1;
  width: 100%;
  padding: 10px 12px;
  border: none;
  outline: none;
  resize: none;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular, #303133);
  background: var(--el-bg-color, #fff);
  overflow-y: auto;

  &::placeholder {
    color: var(--el-text-color-placeholder, #a8abb2);
  }
}

// 预览区
.md-preview {
  flex: 1;
  padding: 10px 12px;
  overflow-y: auto;
  background: var(--el-bg-color, #fff);

  // 复用 MarkdownRenderer 样式，略微调整
  :deep(.markdown-renderer) {
    font-size: 13px;
  }
}

// ============================================================
// 暗色模式
// ============================================================
html.dark .markdown-editor {
  border-color: var(--el-border-color, #4c4d4f);
  background: var(--el-bg-color, #1d1e1f);
}

html.dark .md-toolbar {
  border-color: var(--el-border-color, #4c4d4f);
  background: var(--el-fill-color-light, #262727);
}

html.dark .md-content.md-mode-split .md-textarea {
  border-right-color: var(--el-border-color, #4c4d4f);
}
</style>