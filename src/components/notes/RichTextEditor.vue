<!--
  富文本编辑器组件
  基于 Quill 2.x 封装，支持加粗/斜体/列表/标题等基本格式
  通过 v-model 双向绑定 HTML 内容
-->
<template>
  <div class="rich-text-editor">
    <!-- 工具栏容器：Quill 会将按钮渲染到此容器中 -->
    <div ref="toolbarRef" class="rich-text-toolbar">
      <span class="ql-formats">
        <button type="button" class="ql-header" value="1" title="标题 1"></button>
        <button type="button" class="ql-header" value="2" title="标题 2"></button>
        <button type="button" class="ql-header" value="false" title="正文"></button>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-bold" title="加粗"></button>
        <button type="button" class="ql-italic" title="斜体"></button>
        <button type="button" class="ql-strike" title="删除线"></button>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-list" value="ordered" title="有序列表"></button>
        <button type="button" class="ql-list" value="bullet" title="无序列表"></button>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-blockquote" title="引用"></button>
        <button type="button" class="ql-code" title="代码"></button>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-clean" title="清除格式"></button>
      </span>
    </div>

    <!-- 编辑区容器：Quill 会在此挂载可编辑 DOM -->
    <div ref="editorRef" class="rich-text-content"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
// 引入 Quill 与其样式
import Quill from 'quill'
import 'quill/dist/quill.snow.css'

// Props
const props = defineProps({
  // v-model 绑定值（HTML 字符串）
  modelValue: {
    type: String,
    default: ''
  },
  // 占位符
  placeholder: {
    type: String,
    default: '请输入内容...'
  },
  // 最小高度
  minHeight: {
    type: String,
    default: '180px'
  }
})

// Emits
const emit = defineEmits(['update:modelValue', 'change', 'blur', 'focus'])

// DOM 引用
const toolbarRef = ref(null)
const editorRef = ref(null)

// Quill 实例
let quill = null
// 内部同步标志：避免回写 modelValue 时触发 watch - setText 死循环
let isInternalChange = false

onMounted(() => {
  // 初始化 Quill 实例
  quill = new Quill(editorRef.value, {
    theme: 'snow',
    placeholder: props.placeholder,
    modules: {
      toolbar: toolbarRef.value
    },
    // 允许的格式：标题、加粗、斜体、删除线、列表、引用、代码
    formats: [
      'header',
      'bold', 'italic', 'strike',
      'list', 'blockquote', 'code'
    ]
  })

  // 设置初始内容
  if (props.modelValue) {
    quill.root.innerHTML = props.modelValue
  }

  // 监听内容变化，向父组件同步
  quill.on('text-change', () => {
    isInternalChange = true
    const html = quill.root.innerHTML
    emit('update:modelValue', html)
    emit('change', html)
    // nextTick 后重置标志
    setTimeout(() => { isInternalChange = false }, 0)
  })

  quill.on('selection-change', (range) => {
    if (range === null) {
      emit('blur')
    } else {
      emit('focus')
    }
  })
})

// 监听外部 modelValue 变化，同步到编辑器
watch(() => props.modelValue, (newVal) => {
  if (isInternalChange) return
  if (quill && newVal !== quill.root.innerHTML) {
    quill.root.innerHTML = newVal || ''
  }
})

// 组件卸载前清理
onBeforeUnmount(() => {
  if (quill) {
    quill = null
  }
})

// 暴露方法给父组件
defineExpose({
  // 获取 HTML 内容
  getHTML () {
    return quill ? quill.root.innerHTML : ''
  },
  // 获取纯文本内容
  getText () {
    return quill ? quill.getText() : ''
  },
  // 清空内容
  clear () {
    if (quill) {
      quill.setText('')
    }
  },
  // 聚焦
  focus () {
    if (quill) {
      quill.focus()
    }
  }
})
</script>

<style scoped lang="scss">
.rich-text-editor {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #ffffff;
  overflow: hidden;

  // 工具栏样式调整
  .rich-text-toolbar {
    border-bottom: 1px solid #ebeef5;
    padding: 4px 8px;
    background: #fafafa;

    // 隐藏默认的 SVG 图标尺寸异常
    .ql-formats {
      margin-right: 8px;
    }
  }

  // 编辑区样式
  .rich-text-content {
    min-height: v-bind('minHeight');
    max-height: 360px;
    overflow-y: auto;
    padding: 8px 12px;
    font-size: 14px;
    line-height: 1.6;

    // 允许编辑区文字选中
    :deep(.ql-editor) {
      min-height: v-bind('minHeight');
      padding: 8px 12px;

      &.ql-blank::before {
        color: #c0c4cc;
        font-style: normal;
        font-size: 14px;
      }
    }
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
html.dark .rich-text-editor {
  border-color: #414243;
  background: #252627;

  .rich-text-toolbar {
    border-bottom-color: #414243;
    background: #1d1e1f;
  }

  .rich-text-content {
    :deep(.ql-editor) {
      &.ql-blank::before {
        color: #8d9095;
      }
    }
  }
}
</style>