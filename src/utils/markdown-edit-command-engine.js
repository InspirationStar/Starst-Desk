// ============================================================
// Markdown 编辑命令引擎（纯逻辑）
// 职责：将 Markdown 编辑命令（加粗/斜体/列表/标题/表格等）转换为最小化的文本替换操作
// 设计：纯函数，不依赖 Vue/DOM，可独立单元测试
// 编辑器通过 applyEdit 应用返回的最小范围，保留原生 undo 栈
// ============================================================

// ============================================================
// 命令枚举
// ============================================================
export const MarkdownEditCommand = {
  Bold: 'bold',
  Italic: 'italic',
  Strikethrough: 'strikethrough',
  Code: 'code',
  Link: 'link',
  Heading: 'heading',
  List: 'list',
  Task: 'task',
  Quote: 'quote',
  Table: 'table',
  Indent: 'indent',
  Outdent: 'outdent'
}

// ============================================================
// 行类型枚举（内部使用）
// ============================================================
const LineKind = {
  Plain: 'plain',
  Heading: 'heading',
  List: 'list',
  OrderedList: 'orderedList',
  Task: 'task',
  Quote: 'quote'
}

// ============================================================
// 正则表达式（带 d flag 以获取捕获组位置）
// 与 C# GeneratedRegex 一一对应
// ============================================================
const TASK_LINE_REGEX = /^(?<indent>[ \t]*)[-+*][ \t]+\[[ xX]\][ \t]+(?<content>.*)$/d
const UNORDERED_LIST_LINE_REGEX = /^(?<indent>[ \t]*)[-+*][ \t]+(?<content>.*)$/d
const ORDERED_LIST_LINE_REGEX = /^(?<indent>[ \t]*)\d+[.)][ \t]+(?<content>.*)$/d
const HEADING_LINE_REGEX = /^(?<indent>[ \t]*)#{1,6}[ \t]+(?<content>.*)$/d
const QUOTE_LINE_REGEX = /^(?<indent>[ \t]*)>[ \t]?(?<content>.*)$/d
const LEADING_WHITESPACE_REGEX = /^[ \t]*/
const COMPLETE_LINK_REGEX = /^\[(?<label>[^\]\r\n]*)\]\([^\r\n)]*\)$/

// ============================================================
// 工具函数
// ============================================================

/**
 * 等价于 C# Math.Clamp(value, min, max)
 */
function clamp (value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/**
 * 判断字符是否为换行符
 */
function isLineBreak (ch) {
  return ch === '\r' || ch === '\n'
}

/**
 * 判断字符串是否包含换行符
 */
function containsLineBreak (value) {
  return value.includes('\r') || value.includes('\n')
}

/**
 * 检测源文本使用的新行类型
 */
function detectNewline (source) {
  if (source.includes('\r\n')) return '\r\n'
  return source.includes('\r') ? '\r' : '\n'
}

/**
 * 判断字符串是否为空白（等价 C# string.IsNullOrWhiteSpace）
 */
function isNullOrWhiteSpace (value) {
  return value == null || value.trim() === ''
}

// ============================================================
// MarkdownTextEdit 应用
// ============================================================

/**
 * 将编辑操作应用到源文本
 * 等价 C# MarkdownTextEdit.Apply
 * @param {string} source 源文本
 * @param {Object} edit 编辑操作 { start, length, replacement, selectionStart, selectionLength }
 * @returns {string} 应用后的文本
 */
export function applyEdit (source, edit) {
  if (source == null) source = ''
  if (!edit) return source
  const start = clamp(edit.start, 0, source.length)
  const length = clamp(edit.length, 0, source.length - start)
  return source.substring(0, start) + edit.replacement + source.substring(start + length)
}

// ============================================================
// 主入口
// ============================================================

/**
 * 创建编辑操作
 * 等价 C# MarkdownEditCommandEngine.TryCreateEdit
 * @param {string} source 源文本
 * @param {number} selectionStart 选区起始位置
 * @param {number} selectionLength 选区长度
 * @param {string} command 命令（MarkdownEditCommand 的值）
 * @returns {Object|null} 编辑操作 { start, length, replacement, selectionStart, selectionLength }，失败返回 null
 */
export function tryCreateEdit (source, selectionStart, selectionLength, command) {
  if (source == null) source = ''
  selectionStart = clamp(selectionStart, 0, source.length)
  selectionLength = clamp(selectionLength, 0, source.length - selectionStart)

  switch (command) {
    case MarkdownEditCommand.Bold:
      return tryWrap(source, selectionStart, selectionLength, '**', '**')
    case MarkdownEditCommand.Italic:
      return tryWrap(source, selectionStart, selectionLength, '*', '*')
    case MarkdownEditCommand.Strikethrough:
      return tryWrap(source, selectionStart, selectionLength, '~~', '~~')
    case MarkdownEditCommand.Code:
      return tryCreateCodeEdit(source, selectionStart, selectionLength)
    case MarkdownEditCommand.Link:
      return tryCreateLinkEdit(source, selectionStart, selectionLength)
    case MarkdownEditCommand.Heading:
    case MarkdownEditCommand.List:
    case MarkdownEditCommand.Task:
    case MarkdownEditCommand.Quote:
      return tryTransformLines(source, selectionStart, selectionLength, command)
    case MarkdownEditCommand.Table:
      return tryInsertTable(source, selectionStart, selectionLength)
    case MarkdownEditCommand.Indent:
      return tryIndent(source, selectionStart, selectionLength)
    case MarkdownEditCommand.Outdent:
      return tryOutdent(source, selectionStart, selectionLength)
    default:
      return null
  }
}

// ============================================================
// TryWrap：包装/解包装（加粗、斜体、删除线、行内代码）
// ============================================================
function tryWrap (source, start, length, prefix, suffix) {
  // 情况 1：无选区
  if (length === 0) {
    // 1a：光标位于 prefix...suffix 之间（光标紧邻 prefix 之后），删除包装
    if (
      start >= prefix.length &&
      start + suffix.length <= source.length &&
      source.substring(start - prefix.length, start) === prefix &&
      source.substring(start, start + suffix.length) === suffix
    ) {
      return {
        start: start - prefix.length,
        length: prefix.length + suffix.length,
        replacement: '',
        selectionStart: start - prefix.length,
        selectionLength: 0
      }
    }

    // 1b：在光标处插入 prefix+suffix，光标移到中间
    return {
      start,
      length: 0,
      replacement: prefix + suffix,
      selectionStart: start + prefix.length,
      selectionLength: 0
    }
  }

  const selected = source.substring(start, start + length)

  // 情况 2：选区已经是 prefix...suffix 形式，去除包装
  if (
    selected.length >= prefix.length + suffix.length &&
    selected.startsWith(prefix) &&
    selected.endsWith(suffix)
  ) {
    const unwrapped = selected.substring(prefix.length, selected.length - suffix.length)
    return {
      start,
      length,
      replacement: unwrapped,
      selectionStart: start,
      selectionLength: unwrapped.length
    }
  }

  // 情况 3：选区被 prefix...suffix 包围（prefix 在选区前，suffix 在选区后），去除包装
  if (
    start >= prefix.length &&
    start + length + suffix.length <= source.length &&
    source.substring(start - prefix.length, start) === prefix &&
    source.substring(start + length, start + length + suffix.length) === suffix
  ) {
    return {
      start: start - prefix.length,
      length: prefix.length + length + suffix.length,
      replacement: selected,
      selectionStart: start - prefix.length,
      selectionLength: selected.length
    }
  }

  // 情况 4：包装选区
  return {
    start,
    length,
    replacement: prefix + selected + suffix,
    selectionStart: start + prefix.length,
    selectionLength: selected.length
  }
}

// ============================================================
// TryCreateCodeEdit：行内代码 / 代码块
// ============================================================
function tryCreateCodeEdit (source, start, length) {
  // 无选区或选区内无换行：按行内代码处理
  if (length === 0 || !containsLineBreak(source.substring(start, start + length))) {
    return tryWrap(source, start, length, '`', '`')
  }

  const selected = source.substring(start, start + length)
  const newline = detectNewline(source)
  const prefix = '```' + newline
  const suffix = newline + '```'

  // 选区已经是代码块形式，去除包装
  if (selected.startsWith(prefix) && selected.endsWith(suffix)) {
    const unwrapped = selected.substring(prefix.length, selected.length - suffix.length)
    return {
      start,
      length,
      replacement: unwrapped,
      selectionStart: start,
      selectionLength: unwrapped.length
    }
  }

  // 选区被代码块包围，去除包装
  if (
    start >= prefix.length &&
    start + length + suffix.length <= source.length &&
    source.substring(start - prefix.length, start) === prefix &&
    source.substring(start + length, start + length + suffix.length) === suffix
  ) {
    return {
      start: start - prefix.length,
      length: prefix.length + length + suffix.length,
      replacement: selected,
      selectionStart: start - prefix.length,
      selectionLength: selected.length
    }
  }

  // 包装为代码块
  return {
    start,
    length,
    replacement: prefix + selected + suffix,
    selectionStart: start + prefix.length,
    selectionLength: selected.length
  }
}

// ============================================================
// TryCreateLinkEdit：链接
// ============================================================
function tryCreateLinkEdit (source, start, length) {
  const selected = length === 0 ? '' : source.substring(start, start + length)

  // 选区是完整链接 [text](url)，解包为 text
  if (length > 0) {
    const unwrapped = tryUnwrapLink(source, start, length, selected)
    if (unwrapped) return unwrapped
  }

  // 包装为 [selected](https://)，光标定位到 url 处便于编辑
  const replacement = `[${selected}](https://)`
  return {
    start,
    length,
    replacement,
    selectionStart: length === 0 ? start + 1 : start + selected.length + 3,
    selectionLength: 0
  }
}

function tryUnwrapLink (source, start, length, selected) {
  // 情况 1：选区本身是完整链接 [text](url)
  const completeLink = COMPLETE_LINK_REGEX.exec(selected)
  if (completeLink) {
    const label = completeLink.groups.label
    return {
      start,
      length,
      replacement: label,
      selectionStart: start,
      selectionLength: label.length
    }
  }

  // 情况 2：选区是链接的 label 部分，即 [selected](url)
  if (
    start === 0 ||
    source[start - 1] !== '[' ||
    start + length >= source.length ||
    !source.substring(start + length).startsWith('](')
  ) {
    return null
  }

  const destinationEnd = source.indexOf(')', start + length + 2)
  if (destinationEnd < 0) return null

  const syntaxStart = start - 1
  const syntaxLength = destinationEnd - syntaxStart + 1
  return {
    start: syntaxStart,
    length: syntaxLength,
    replacement: selected,
    selectionStart: syntaxStart,
    selectionLength: selected.length
  }
}

// ============================================================
// TryInsertTable：插入表格
// ============================================================
function tryInsertTable (source, start, length) {
  const newline = detectNewline(source)
  const insertionStart = findLineStart(source, start)
  const table = [
    '| Column 1 | Column 2 |',
    '| --- | --- |',
    '| Content | Content |'
  ].join(newline)

  // 表格是块级插入，避免破坏现有文本：在当前行之前插入，并选中第一个表头便于立即编辑
  const needsLeadingNewline = insertionStart > 0 && !isLineBreak(source[insertionStart - 1])
  const needsTrailingNewline = insertionStart < source.length && !isLineBreak(source[insertionStart])
  const leading = needsLeadingNewline ? newline : ''
  const trailing = needsTrailingNewline ? newline : ''
  const replacement = leading + table + trailing

  return {
    start: insertionStart,
    length: 0,
    replacement,
    selectionStart: insertionStart + leading.length + 2, // 跳过 "| " 选中 "Column 1"
    selectionLength: 'Column 1'.length
  }
}

// ============================================================
// TryTransformLines：行变换（标题/列表/任务/引用）
// ============================================================
function tryTransformLines (source, selectionStart, selectionLength, command) {
  const { blockStart, blockEnd } = getSelectedLineRange(source, selectionStart, selectionLength)
  const block = source.substring(blockStart, blockEnd)
  const lines = splitLines(block)
  const includeSingleBlank = selectionLength === 0 && lines.length === 1

  const targetKind = command === MarkdownEditCommand.Heading
    ? LineKind.Heading
    : command === MarkdownEditCommand.List
      ? LineKind.List
      : command === MarkdownEditCommand.Task
        ? LineKind.Task
        : LineKind.Quote

  const infos = lines.map(line => parseLine(line.content))
  const applicable = infos.filter((info, index) =>
    includeSingleBlank || !isNullOrWhiteSpace(lines[index].content)
  )
  const removeTarget = applicable.length > 0 && applicable.every(info => info.kind === targetKind)

  let replacement = ''
  const mappings = []
  let oldOffset = 0
  let newOffset = 0

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const info = infos[index]
    const skipBlank = !includeSingleBlank && isNullOrWhiteSpace(line.content)
    const transform = skipBlank
      ? { text: line.content, oldPrefixLength: 0, newPrefixLength: 0 }
      : transformLine(info, targetKind, removeTarget)

    replacement += transform.text + line.newline
    mappings.push({
      oldStart: oldOffset,
      oldContentLength: line.content.length,
      newStart: newOffset,
      newContentLength: transform.text.length,
      newlineLength: line.newline.length,
      oldPrefixLength: transform.oldPrefixLength,
      newPrefixLength: transform.newPrefixLength
    })
    oldOffset += line.content.length + line.newline.length
    newOffset += transform.text.length + line.newline.length
  }

  const relativeSelectionStart = selectionStart - blockStart
  const relativeSelectionEnd = relativeSelectionStart + selectionLength
  const mappedStart = mapBoundary(relativeSelectionStart, mappings)
  const mappedEnd = mapBoundary(relativeSelectionEnd, mappings)

  return {
    start: blockStart,
    length: block.length,
    replacement,
    selectionStart: blockStart + mappedStart,
    selectionLength: Math.max(0, mappedEnd - mappedStart)
  }
}

function transformLine (info, targetKind, removeTarget) {
  // 移除目标标记
  if (removeTarget) {
    const replacementPrefix = targetKind === LineKind.Task ? '- ' : ''
    return {
      text: info.indent + replacementPrefix + info.content,
      oldPrefixLength: info.prefixLength,
      newPrefixLength: info.indent.length + replacementPrefix.length
    }
  }

  const marker = targetKind === LineKind.Heading
    ? '## '
    : targetKind === LineKind.List
      ? '- '
      : targetKind === LineKind.Task
        ? '- [ ] '
        : '> '

  // 已经是目标类型，保持不变
  if (info.kind === targetKind) {
    return {
      text: info.original,
      oldPrefixLength: info.prefixLength,
      newPrefixLength: info.prefixLength
    }
  }

  // 标题/列表/任务/引用在工具栏中互斥，转换现有块标记而非产生无效组合（如 "- ## title"）
  const content = info.kind === LineKind.Plain
    ? info.original.substring(info.indent.length)
    : info.content
  const oldPrefixLength = info.kind === LineKind.Plain
    ? info.indent.length
    : info.prefixLength
  return {
    text: info.indent + marker + content,
    oldPrefixLength,
    newPrefixLength: info.indent.length + marker.length
  }
}

// ============================================================
// TryIndent / TryOutdent：缩进 / 反缩进
// ============================================================
function tryIndent (source, selectionStart, selectionLength) {
  return tryAdjustIndent(source, selectionStart, selectionLength, false)
}

function tryOutdent (source, selectionStart, selectionLength) {
  return tryAdjustIndent(source, selectionStart, selectionLength, true)
}

function tryAdjustIndent (source, selectionStart, selectionLength, outdent) {
  const { blockStart, blockEnd } = getSelectedLineRange(source, selectionStart, selectionLength)
  const block = source.substring(blockStart, blockEnd)
  const lines = splitLines(block)

  let replacement = ''
  const mappings = []
  let oldOffset = 0
  let newOffset = 0

  for (const line of lines) {
    let remove = 0
    if (outdent) {
      if (line.content.startsWith('    ')) remove = 4
      else if (line.content.startsWith('\t')) remove = 1
    }
    const transformed = outdent
      ? line.content.substring(remove)
      : '    ' + line.content
    const added = outdent ? 0 : 4

    replacement += transformed + line.newline
    mappings.push({
      oldStart: oldOffset,
      oldContentLength: line.content.length,
      newStart: newOffset,
      newContentLength: transformed.length,
      newlineLength: line.newline.length,
      oldPrefixLength: remove,
      newPrefixLength: added
    })
    oldOffset += line.content.length + line.newline.length
    newOffset += transformed.length + line.newline.length
  }

  const relativeStart = selectionStart - blockStart
  const relativeEnd = relativeStart + selectionLength
  const mappedStart = mapBoundary(relativeStart, mappings)
  const mappedEnd = mapBoundary(relativeEnd, mappings)

  return {
    start: blockStart,
    length: block.length,
    replacement,
    selectionStart: blockStart + mappedStart,
    selectionLength: Math.max(0, mappedEnd - mappedStart)
  }
}

// ============================================================
// MapBoundary：将旧位置映射到新位置
// ============================================================
function mapBoundary (position, mappings) {
  if (mappings.length === 0) return 0

  for (const mapping of mappings) {
    const oldLineEnd = mapping.oldStart + mapping.oldContentLength
    const oldFullEnd = oldLineEnd + mapping.newlineLength
    if (position > oldFullEnd) continue

    if (position >= oldLineEnd) {
      return mapping.newStart + mapping.newContentLength +
        Math.min(position - oldLineEnd, mapping.newlineLength)
    }

    const column = Math.max(0, position - mapping.oldStart)
    if (column <= mapping.oldPrefixLength) {
      return mapping.newStart + mapping.newPrefixLength
    }

    return mapping.newStart + Math.min(
      mapping.newContentLength,
      mapping.newPrefixLength + column - mapping.oldPrefixLength
    )
  }

  const last = mappings[mappings.length - 1]
  return last.newStart + last.newContentLength + last.newlineLength
}

// ============================================================
// GetSelectedLineRange：获取选区覆盖的完整行范围
// ============================================================
function getSelectedLineRange (source, selectionStart, selectionLength) {
  const blockStart = findLineStart(source, selectionStart)

  const selectionEnd = selectionStart + selectionLength
  const lookupEnd = selectionLength > 0 && selectionEnd <= source.length &&
    isLineBreak(source[selectionEnd - 1])
    ? selectionEnd - 1
    : selectionEnd

  let blockEnd = source.length
  for (let index = clamp(lookupEnd, 0, source.length); index < source.length; index++) {
    if (isLineBreak(source[index])) {
      blockEnd = index
      break
    }
  }

  return { blockStart, blockEnd }
}

/**
 * 找到指定位置所在行的起始位置
 */
function findLineStart (source, position) {
  for (let index = Math.min(position, source.length) - 1; index >= 0; index--) {
    if (isLineBreak(source[index])) return index + 1
  }
  return 0
}

// ============================================================
// SplitLines：将文本块拆分为行（保留新行符）
// ============================================================
function splitLines (block) {
  const lines = []
  let start = 0
  for (let index = 0; index < block.length; index++) {
    if (!isLineBreak(block[index])) continue

    let newlineEnd = index + 1
    if (block[index] === '\r' && newlineEnd < block.length && block[newlineEnd] === '\n') {
      newlineEnd++
    }

    lines.push({
      content: block.substring(start, index),
      newline: block.substring(index, newlineEnd)
    })
    start = newlineEnd
    index = newlineEnd - 1
  }

  lines.push({ content: block.substring(start), newline: '' })
  return lines
}

// ============================================================
// ParseLine：解析单行，识别缩进/类型/内容
// ============================================================
function parseLine (line) {
  let match = TASK_LINE_REGEX.exec(line)
  if (match) return fromMatch(line, match, LineKind.Task)

  match = UNORDERED_LIST_LINE_REGEX.exec(line)
  if (match) return fromMatch(line, match, LineKind.List)

  match = ORDERED_LIST_LINE_REGEX.exec(line)
  if (match) return fromMatch(line, match, LineKind.OrderedList)

  match = HEADING_LINE_REGEX.exec(line)
  if (match) return fromMatch(line, match, LineKind.Heading)

  match = QUOTE_LINE_REGEX.exec(line)
  if (match) return fromMatch(line, match, LineKind.Quote)

  // 普通行：仅识别前导缩进
  const indent = LEADING_WHITESPACE_REGEX.exec(line)[0]
  return {
    original: line,
    indent,
    kind: LineKind.Plain,
    prefixLength: indent.length,
    content: line.substring(indent.length)
  }
}

function fromMatch (line, match, kind) {
  const indent = match.groups.indent
  const content = match.groups.content
  // content 捕获组在原始行中的起始位置（等价 C# match.Groups["content"].Index）
  const contentIndex = match.indices.groups.content[0]
  return {
    original: line,
    indent,
    kind,
    prefixLength: contentIndex,
    content
  }
}

// ============================================================
// 内联图片提取 / 替换 / 恢复
// 用于将 Markdown 中 base64 内联图片（data:image/...）与附件存储互转
//   - 提取：识别 ![alt](data:image/...) 形式
//   - 替换：转为 ![alt](attachment://noteId/imageId.ext) 引用，便于持久化
//   - 恢复：编辑时将附件引用还原为 dataUrl 以正常显示
// ============================================================

// 匹配 Markdown 图片语法中的 data URL（base64 内联图片）
// 形如 ![alt](data:image/png;base64,xxxx)
// 使用非贪婪 alt 与 [^)]* 的 data URL（data URL 不含未转义右括号）
const INLINE_IMAGE_REGEX = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]*)\)/g

// 匹配附件引用形式 ![alt](attachment://noteId/imageId.ext)
const ATTACHMENT_REF_REGEX = /!\[([^\]]*)\]\((attachment:\/\/[^)]+)\)/g

/**
 * 提取 Markdown 中所有 base64 内联图片
 * @param {string} markdown 源 Markdown 文本
 * @returns {Array<{alt: string, dataUrl: string, index: number}>} 图片列表
 *   - alt：图片替代文本
 *   - dataUrl：base64 数据 URL（data:image/png;base64,...）
 *   - index：在源文本中的起始位置
 */
export function extractInlineImages (markdown) {
  if (!markdown || typeof markdown !== 'string') return []
  const images = []
  // 重置 lastIndex（全局正则复用安全）
  INLINE_IMAGE_REGEX.lastIndex = 0
  let match
  while ((match = INLINE_IMAGE_REGEX.exec(markdown)) !== null) {
    images.push({
      alt: match[1],
      dataUrl: match[2],
      index: match.index
    })
  }
  return images
}

/**
 * 将 Markdown 中的 base64 内联图片替换为附件引用
 * 生成的引用形式：![alt](attachment://noteId/imageId.png)
 *   - imageId 为基于时间戳 + 序号的简单唯一标识
 *   - 扩展名从 data URL 的 MIME 类型推断（png/jpeg/gif/webp 等）
 * @param {string} markdown 源 Markdown 文本
 * @param {string|number} noteId 笔记 ID（用于构造附件引用路径）
 * @returns {{markdown: string, images: Array<{alt: string, dataUrl: string, imageId: string, ext: string}>}}
 *   - markdown：替换后的文本
 *   - images：提取的图片信息列表（含生成的 imageId 与扩展名，供后续保存到附件存储）
 */
export function replaceInlineImagesWithRefs (markdown, noteId) {
  if (!markdown || typeof markdown !== 'string') return { markdown: markdown || '', images: [] }
  const images = []
  const stamp = Date.now()
  let counter = 0
  // 使用 replace 函数形式逐个替换，同步收集图片信息
  const replaced = markdown.replace(INLINE_IMAGE_REGEX, ( (fullMatch, alt, dataUrl) => {
    const ext = inferImageExtension(dataUrl)
    const imageId = `img-${stamp}-${counter}`
    counter++
    images.push({ alt, dataUrl, imageId, ext })
    return `![${alt}](attachment://${noteId}/${imageId}.${ext})`
  }))
  return { markdown: replaced, images }
}

/**
 * 从 data URL 推断图片扩展名
 * @param {string} dataUrl data:image/png;base64,...
 * @returns {string} 扩展名（不含点），未知类型默认 png
 */
function inferImageExtension (dataUrl) {
  // data:image/png;base64,... → png
  const mimeMatch = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl)
  if (!mimeMatch) return 'png'
  const subtype = mimeMatch[1].toLowerCase()
  // jpeg → jpg，其余保持原样
  if (subtype === 'jpeg') return 'jpg'
  // svg+xml → svg
  if (subtype === 'svg+xml') return 'svg'
  return subtype
}

/**
 * 将 Markdown 中的附件引用还原为 base64 内联图片
 * 用于编辑时从持久化形式恢复图片显示
 * @param {string} markdown 源 Markdown 文本（含 attachment:// 引用）
 * @param {Object<string, string>|Array<{ref: string, dataUrl: string}>} attachments
 *   - 对象形式：{ 'attachment://noteId/imageId.png': 'data:image/png;base64,...' }
 *   - 数组形式：[{ ref: 'attachment://noteId/imageId.png', dataUrl: 'data:image/...' }]
 * @returns {string} 还原后的 Markdown（含 base64 内联图片）
 */
export function restoreInlineImagesFromRefs (markdown, attachments) {
  if (!markdown || typeof markdown !== 'string') return markdown || ''
  if (!attachments) return markdown

  // 统一为 lookup 函数
  let lookup
  if (Array.isArray(attachments)) {
    lookup = ref => {
      const item = attachments.find(a => a && a.ref === ref)
      return item ? item.dataUrl : null
    }
  } else if (typeof attachments === 'object') {
    lookup = ref => attachments[ref] || null
  } else {
    return markdown
  }

  return markdown.replace(ATTACHMENT_REF_REGEX, (fullMatch, alt, ref) => {
    const dataUrl = lookup(ref)
    return dataUrl ? `![${alt}](${dataUrl})` : fullMatch
  })
}

// ============================================================
// 简单 Markdown 渲染（用于预览模式）
// 支持：标题(h1-h6)、粗体、斜体、删除线、代码、列表、链接、图片、引用、分隔线
// 不依赖第三方库，纯字符串替换
// 注意：本渲染器为轻量预览用，不处理嵌套语法与边界完备性；
//   完整渲染请使用 marked 等库。转义先行以避免 XSS。
// ============================================================

/**
 * 简单 Markdown 渲染（用于预览模式）
 * @param {string} markdown 源 Markdown 文本
 * @returns {string} HTML
 */
export function simpleRender (markdown) {
  if (!markdown || typeof markdown !== 'string') return ''

  // 按行处理块级元素，行内元素统一处理
  const lines = markdown.split(/\r?\n/)
  const htmlLines = []
  let inList = false
  let inOrderedList = false
  let inQuote = false

  /**
   * 关闭当前列表/引用块（生成闭合标签）
   */
  function closeBlocks () {
    if (inList) { htmlLines.push('</ul>'); inList = false }
    if (inOrderedList) { htmlLines.push('</ol>'); inOrderedList = false }
    if (inQuote) { htmlLines.push('</blockquote>'); inQuote = false }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 分隔线：--- 或 *** 或 ___（三个或更多）
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeBlocks()
      htmlLines.push('<hr>')
      continue
    }

    // 标题：# ~ ######
    const headingMatch = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    if (headingMatch) {
      closeBlocks()
      const level = headingMatch[1].length
      const content = renderInline(headingMatch[2])
      htmlLines.push(`<h${level}>${content}</h${level}>`)
      continue
    }

    // 引用：> text
    const quoteMatch = /^\s*>\s?(.*)$/.exec(line)
    if (quoteMatch) {
      if (!inQuote) { htmlLines.push('<blockquote>'); inQuote = true }
      htmlLines.push(`<p>${renderInline(quoteMatch[1])}</p>`)
      continue
    }

    // 无序列表：- / * / + item
    const unorderedMatch = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (unorderedMatch) {
      if (inOrderedList) { htmlLines.push('</ol>'); inOrderedList = false }
      if (!inList) { htmlLines.push('<ul>'); inList = true }
      htmlLines.push(`<li>${renderInline(unorderedMatch[1])}</li>`)
      continue
    }

    // 有序列表：1. item / 1) item
    const orderedMatch = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (orderedMatch) {
      if (inList) { htmlLines.push('</ul>'); inList = false }
      if (!inOrderedList) { htmlLines.push('<ol>'); inOrderedList = true }
      htmlLines.push(`<li>${renderInline(orderedMatch[1])}</li>`)
      continue
    }

    // 空行：关闭块级元素
    if (line.trim() === '') {
      closeBlocks()
      continue
    }

    // 普通段落
    closeBlocks()
    htmlLines.push(`<p>${renderInline(line)}</p>`)
  }

  closeBlocks()
  return htmlLines.join('\n')
}

/**
 * 渲染行内元素：转义 HTML、图片、链接、代码、粗体、斜体、删除线
 * 处理顺序：先转义，再按"先块后行"顺序替换标记
 * @param {string} text 单行文本（已去除块级标记）
 * @returns {string} HTML
 */
function renderInline (text) {
  // 1. 转义 HTML 特殊字符（防 XSS）
  let html = escapeHtml(text)

  // 2. 图片：![alt](url) → <img src="url" alt="alt">
  //    注意：图片先于链接处理，避免 ![alt](url) 被链接正则误匹配
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')

  // 3. 链接：[text](url) → <a href="url">text</a>
  html = html.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // 4. 行内代码：`code` → <code>code</code>
  //    代码内不再处理其他标记，先处理以避免 ** 等被代码内容干扰
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // 5. 粗体：**text** → <strong>text</strong>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  // 6. 斜体：*text* → <em>text</em>
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  // 7. 删除线：~~text~~ → <del>text</del>
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return html
}

/**
 * 转义 HTML 特殊字符
 * @param {string} text
 * @returns {string}
 */
function escapeHtml (text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}