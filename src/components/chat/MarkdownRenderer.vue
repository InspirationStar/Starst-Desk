<!--
  Markdown 渲染组件
  职责：将 Markdown 文本渲染为 HTML，支持代码高亮与代码块复制按钮
  安全：配置 markdown-it 安全选项防止 XSS（禁用 HTML 原样输出）
-->
<template>
  <div class="markdown-renderer" v-html="renderedHtml"></div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import MarkdownIt from 'markdown-it'
// 按需导入 highlight.js 核心，仅注册常用语言，减小打包体积（~1MB → ~200KB）
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import shell from 'highlight.js/lib/languages/shell'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'

// 注册常用语言（覆盖 AI 对话中绝大多数代码高亮场景）
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', shell)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c++', cpp)
hljs.registerLanguage('c', c)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('diff', diff)

// ============================================================
// 初始化 markdown-it
// 安全选项：
//   - html: false  禁用 HTML 原样输出（防止 XSS）
//   - linkify: true 自动识别链接
//   - breaks: true 换行符转 <br>
// ============================================================
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight (code, lang) {
    // 代码高亮
    const language = (lang || '').toLowerCase()
    if (language && hljs.getLanguage(language)) {
      try {
        return `<pre class="code-block"><code class="hljs language-${language}">${hljs.highlight(code, { language }).value}</code><button class="code-copy-btn" type="button">复制</button></pre>`
      } catch {
        // 高亮失败时回退到普通代码块
      }
    }
    // 自动检测语言
    try {
      return `<pre class="code-block"><code class="hljs">${hljs.highlightAuto(code).value}</code><button class="code-copy-btn" type="button">复制</button></pre>`
    } catch {
      return `<pre class="code-block"><code class="hljs">${md.utils.escapeHtml(code)}</code><button class="code-copy-btn" type="button">复制</button></pre>`
    }
  }
})

// 链接默认在新窗口打开（target=_blank + rel=noopener 防止 reverse tabnabbing）
const defaultLinkRender = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  const targetIndex = token.attrIndex('target')
  const relIndex = token.attrIndex('rel')
  if (targetIndex < 0) token.attrPush(['target', '_blank'])
  else token.attrs[targetIndex][1] = '_blank'
  if (relIndex < 0) token.attrPush(['rel', 'noopener noreferrer'])
  else token.attrs[relIndex][1] = 'noopener noreferrer'
  return defaultLinkRender(tokens, idx, options, env, self)
}

// ============================================================
// 组件 props
// ============================================================
const props = defineProps({
  // Markdown 文本内容
  content: {
    type: String,
    default: ''
  }
})

// ============================================================
// 自定义内联插件：彩色文字
// 语法：{#hex}(文字)  例如 {#ff0000}(红色) {#f00}(红)
// 安全：仅允许 #hex 颜色值（3 或 6 位），防止 XSS
// 集成 markdown-it parser，非 HTML 后处理
// ============================================================
function colorInlinePlugin (md) {
  // 颜色值正则：#hex（3 或 6 位）
  const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

  md.inline.ruler.before('emphasis', 'color', (state, silent) => {
    const src = state.src
    const start = state.pos
    const max = state.posMax

    // 必须以 {# 开头
    if (src.charCodeAt(start) !== 0x7B /* { */) return false
    if (src.charCodeAt(start + 1) !== 0x23 /* # */) return false

    // 查找 }( 的位置
    let pos = start + 2
    let colorEnd = -1
    while (pos < max) {
      if (src.charCodeAt(pos) === 0x7D /* } */ && pos + 1 < max && src.charCodeAt(pos + 1) === 0x28 /* ( */) {
        colorEnd = pos
        break
      }
      pos++
    }
    if (colorEnd < 0) return false

    // 提取颜色值（含 #）
    const color = src.slice(start + 1, colorEnd).trim()
    if (!COLOR_RE.test(color)) return false

    // 查找匹配的 )（支持嵌套括号）
    pos = colorEnd + 2
    let depth = 1
    let textEnd = -1
    while (pos < max) {
      const ch = src.charCodeAt(pos)
      if (ch === 0x28 /* ( */) depth++
      else if (ch === 0x29 /* ) */) {
        depth--
        if (depth === 0) { textEnd = pos; break }
      }
      pos++
    }
    if (textEnd < 0) return false

    if (!silent) {
      // 推入 token：span 开标签 + 文本 + span 闭标签
      const openToken = state.push('color_open', 'span', 1)
      openToken.attrs = [['style', `color:${color}`]]
      openToken.markup = '{#}'
      const contentToken = state.push('text', '', 0)
      contentToken.content = src.slice(colorEnd + 2, textEnd)
      const closeToken = state.push('color_close', 'span', -1)
      closeToken.markup = '{#}'
    }

    state.pos = textEnd + 1
    return true
  })
}

// 注册彩色文字插件
md.use(colorInlinePlugin)

// 渲染后的 HTML
const renderedHtml = computed(() => {
  if (!props.content) return ''
  try {
    return md.render(props.content)
  } catch (err) {
    console.error('[MarkdownRenderer] 渲染失败:', err)
    return md.utils.escapeHtml(props.content)
  }
})

// ============================================================
// 代码块复制按钮事件委托
// ============================================================
function handleClick (event) {
  const target = event.target
  if (target && target.classList && target.classList.contains('code-copy-btn')) {
    const pre = target.closest('pre.code-block')
    if (pre) {
      const code = pre.querySelector('code')
      if (code) {
        const text = code.textContent || ''
        // 使用 navigator.clipboard 写入剪贴板
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => {
            target.textContent = '已复制'
            setTimeout(() => { target.textContent = '复制' }, 1500)
          }).catch(() => {
            _fallbackCopy(text)
            target.textContent = '已复制'
            setTimeout(() => { target.textContent = '复制' }, 1500)
          })
        } else {
          _fallbackCopy(text)
          target.textContent = '已复制'
          setTimeout(() => { target.textContent = '复制' }, 1500)
        }
      }
    }
  }
}

// 回退复制方案（使用临时 textarea + execCommand）
function _fallbackCopy (text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
  } catch {
    // 忽略
  }
  document.body.removeChild(textarea)
}

onMounted(() => {
  document.addEventListener('click', handleClick, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClick, true)
})
</script>

<style scoped lang="scss">
.markdown-renderer {
  font-size: 14px;
  line-height: 1.7;
  color: #303133;
  word-break: break-word;

  // 标题样式
  :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
    margin: 16px 0 8px;
    font-weight: 600;
    line-height: 1.3;
  }
  :deep(h1) { font-size: 1.6em; }
  :deep(h2) { font-size: 1.4em; }
  :deep(h3) { font-size: 1.2em; }
  :deep(h4) { font-size: 1.1em; }
  :deep(h5), :deep(h6) { font-size: 1em; }

  // 段落
  // 首个 <p> 去掉上 margin、末个 <p> 去掉下 margin，避免气泡内内容偏上
  :deep(p) {
    margin: 8px 0;
    &:first-child { margin-top: 0; }
    &:last-child { margin-bottom: 0; }
  }

  // 列表
  :deep(ul), :deep(ol) {
    margin: 8px 0;
    padding-left: 24px;
  }
  :deep(li) {
    margin: 4px 0;
  }

  // 引用
  :deep(blockquote) {
    margin: 8px 0;
    padding: 8px 12px;
    border-left: 3px solid #dcdfe6;
    background: #f5f7fa;
    color: #606266;
  }

  // 表格
  :deep(table) {
    margin: 8px 0;
    border-collapse: collapse;
    width: 100%;
  }
  :deep(th), :deep(td) {
    border: 1px solid #dcdfe6;
    padding: 6px 12px;
    text-align: left;
  }
  :deep(th) {
    background: #f5f7fa;
    font-weight: 600;
  }

  // 行内代码
  :deep(code):not(.hljs) {
    padding: 2px 6px;
    background: #f5f7fa;
    border-radius: 3px;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.9em;
    color: #e96900;
  }

  // 代码块
  :deep(.code-block) {
    position: relative;
    margin: 12px 0;
    padding: 12px;
    background: #1e1e1e;
    border-radius: 6px;
    overflow-x: auto;

    .code-copy-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      padding: 2px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 3px;
      color: #fff;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;

      &:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    }

    code.hljs {
      background: transparent;
      padding: 0;
      color: #d4d4d4;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
    }
  }

  // 链接
  :deep(a) {
    color: #409eff;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }

  // 分隔线
  :deep(hr) {
    margin: 16px 0;
    border: none;
    border-top: 1px solid #dcdfe6;
  }

  // 图片
  :deep(img) {
    max-width: 100%;
    border-radius: 4px;
  }
}

// ============================================================
// 暗色模式适配
// ============================================================
[data-theme='dark'] {
  .markdown-renderer {
    color: #e5eaf3;

    // 引用块暗色适配
    :deep(blockquote) {
      border-left-color: #414243;
      background: #18191a;
      color: #cfd3dc;
    }

    // 表格暗色适配
    :deep(th),
    :deep(td) {
      border-color: #414243;
    }

    :deep(th) {
      background: #252627;
    }

    // 行内代码暗色适配（避免浅色背景刺眼）
    :deep(code):not(.hljs) {
      background: #2a2b2c;
      color: #f0883e;
    }

    // 分隔线暗色适配
    :deep(hr) {
      border-top-color: #414243;
    }

    // 链接暗色适配（使用更亮的蓝色保证可读性）
    :deep(a) {
      color: #66b1ff;

      &:hover {
        color: #79bbff;
      }
    }
  }
}
</style>

<style>
/* highlight.js 主题（全局样式，避免 scoped 影响） */
/* 使用 GitHub Dark 主题的精简版 */
.hljs {
  display: block;
  overflow-x: auto;
  color: #d4d4d4;
  background: transparent;
}
.hljs-comment, .hljs-quote { color: #6a9955; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-link { color: #569cd6; }
.hljs-function .hljs-keyword { color: #dcdcaa; }
.hljs-string, .hljs-attr, .hljs-template-tag, .hljs-addition { color: #ce9178; }
.hljs-built_in, .hljs-builtin-name, .hljs-type, .hljs-class .hljs-title { color: #4ec9b0; }
.hljs-variable, .hljs-template-variable, .hljs-bullet, .hljs-regexp, .hljs-symbol { color: #9cdcfe; }
.hljs-number, .hljs-meta { color: #b5cea8; }
.hljs-title, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: #dcdcaa; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 700; }
.hljs-deletion { color: #d4d4d4; background: #5a1d1d; }
</style>