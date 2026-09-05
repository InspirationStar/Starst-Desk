// ============================================================
// markdown-edit-command-engine 单元测试
// 纯 Node.js 运行，验证从 C# 移植的编辑命令引擎逻辑
// 运行：node src/utils/markdown-edit-command-engine.test.js
// ============================================================

import { tryCreateEdit, applyEdit, MarkdownEditCommand } from './markdown-edit-command-engine.js'

let passCount = 0
let failCount = 0

function assert (actual, expected, message) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passCount++
    // console.log(`  ✓ ${message}`)
  } else {
    failCount++
    console.log(`  ✗ ${message}`)
    console.log(`    expected: ${e}`)
    console.log(`    actual:   ${a}`)
  }
}

function applyCommand (source, start, length, command) {
  const edit = tryCreateEdit(source, start, length, command)
  if (!edit) return { text: source, sel: [start, 0] }
  return {
    text: applyEdit(source, edit),
    sel: [edit.selectionStart, edit.selectionLength]
  }
}

console.log('--- TryWrap: Bold ---')
// 无选区：插入 ****，光标在中间
assert(
  applyCommand('hello', 2, 0, MarkdownEditCommand.Bold),
  { text: 'he****llo', sel: [4, 0] },
  '空选区插入加粗占位'
)
// 选中文本：包装
assert(
  applyCommand('hello world', 0, 5, MarkdownEditCommand.Bold),
  { text: '**hello** world', sel: [2, 5] },
  '选中文本加粗'
)
// 已加粗：去除包装
assert(
  applyCommand('**hello** world', 0, 9, MarkdownEditCommand.Bold),
  { text: 'hello world', sel: [0, 5] },
  '已加粗选区去除包装'
)
// 光标在 ** 之间：删除包装
assert(
  applyCommand('a****b', 3, 0, MarkdownEditCommand.Bold),
  { text: 'ab', sel: [1, 0] },
  '光标在加粗占位中间删除'
)

console.log('--- TryWrap: Italic ---')
assert(
  applyCommand('hello', 0, 5, MarkdownEditCommand.Italic),
  { text: '*hello*', sel: [1, 5] },
  '斜体包装'
)

console.log('--- TryWrap: Strikethrough ---')
assert(
  applyCommand('hello', 0, 5, MarkdownEditCommand.Strikethrough),
  { text: '~~hello~~', sel: [2, 5] },
  '删除线包装'
)

console.log('--- TryCreateCodeEdit: 行内代码 ---')
assert(
  applyCommand('use foo here', 4, 3, MarkdownEditCommand.Code),
  { text: 'use `foo` here', sel: [5, 3] },
  '行内代码包装'
)

console.log('--- TryCreateCodeEdit: 代码块 ---')
{
  const source = 'line1\nline2\nline3'
  const result = applyCommand(source, 0, source.length, MarkdownEditCommand.Code)
  assert(
    result.text,
    '```\nline1\nline2\nline3\n```',
    '多行选区包装为代码块'
  )
}

console.log('--- TryCreateLinkEdit ---')
// 空选区：插入 [](https://)，光标在 [ 后
assert(
  applyCommand('hello', 2, 0, MarkdownEditCommand.Link),
  { text: 'he[](https://)llo', sel: [3, 0] },
  '空选区插入链接占位'
)
// 选中文本：包装为 [text](https://)，光标在 url 处
assert(
  applyCommand('click here', 0, 5, MarkdownEditCommand.Link),
  { text: '[click](https://) here', sel: [8, 0] },
  '选中文本包装为链接'
)
// 选区是完整链接：解包
assert(
  applyCommand('[click](https://x)', 0, 18, MarkdownEditCommand.Link),
  { text: 'click', sel: [0, 5] },
  '完整链接解包为文本'
)

console.log('--- TryTransformLines: Heading ---')
// 空选区 + 单行：includeSingleBlank 触发，行变标题；选区为 0 长度（与 C# 一致）
assert(
  applyCommand('title', 0, 0, MarkdownEditCommand.Heading),
  { text: '## title', sel: [3, 0] },
  '空行变标题（includeSingleBlank，选区保持 0 长度）'
)
assert(
  applyCommand('hello', 0, 5, MarkdownEditCommand.Heading),
  { text: '## hello', sel: [3, 5] },
  '选中文本变标题'
)
// 已是标题：去除
assert(
  applyCommand('## hello', 0, 8, MarkdownEditCommand.Heading),
  { text: 'hello', sel: [0, 5] },
  '已是标题去除'
)

console.log('--- TryTransformLines: List ---')
assert(
  applyCommand('item', 0, 4, MarkdownEditCommand.List),
  { text: '- item', sel: [2, 4] },
  '文本变列表项'
)

console.log('--- TryTransformLines: Task ---')
assert(
  applyCommand('todo', 0, 4, MarkdownEditCommand.Task),
  { text: '- [ ] todo', sel: [6, 4] },
  '文本变任务项'
)

console.log('--- TryTransformLines: Quote ---')
assert(
  applyCommand('quote', 0, 5, MarkdownEditCommand.Quote),
  { text: '> quote', sel: [2, 5] },
  '文本变引用'
)

console.log('--- TryInsertTable ---')
{
  // 表格插入到当前行前（C# 行为：insertionStart=FindLineStart，行首插入）
  const result = applyCommand('text', 2, 0, MarkdownEditCommand.Table)
  assert(
    result.text,
    '| Column 1 | Column 2 |\n| --- | --- |\n| Content | Content |\ntext',
    '表格插入到当前行前'
  )
}
{
  const result = applyCommand('', 0, 0, MarkdownEditCommand.Table)
  assert(
    result.text,
    '| Column 1 | Column 2 |\n| --- | --- |\n| Content | Content |',
    '空文本插入表格'
  )
}

console.log('--- TryIndent / TryOutdent ---')
assert(
  applyCommand('line', 0, 4, MarkdownEditCommand.Indent),
  { text: '    line', sel: [4, 4] },
  '缩进增加 4 空格'
)
assert(
  applyCommand('    line', 0, 8, MarkdownEditCommand.Outdent),
  { text: 'line', sel: [0, 4] },
  '缩进减少 4 空格'
)
// Tab 缩进反缩进
assert(
  applyCommand('\tline', 0, 5, MarkdownEditCommand.Outdent),
  { text: 'line', sel: [0, 4] },
  'Tab 缩进反缩进'
)

console.log('--- 多行变换 ---')
{
  const source = 'item1\nitem2\nitem3'
  const result = applyCommand(source, 0, source.length, MarkdownEditCommand.List)
  assert(
    result.text,
    '- item1\n- item2\n- item3',
    '多行同时变列表'
  )
}

console.log('--- applyEdit 边界 ---')
assert(applyEdit('hello', { start: 0, length: 5, replacement: 'hi', selectionStart: 0, selectionLength: 0 }), 'hi', 'applyEdit 全替换')
// C# Math.Clamp(100, 0, 5) = 5，长度被夹到 0，结果在末尾追加 replacement
assert(applyEdit('hello', { start: 100, length: 5, replacement: 'x', selectionStart: 0, selectionLength: 0 }), 'hellox', 'applyEdit 越界在末尾追加')
assert(applyEdit(null, { start: 0, length: 0, replacement: 'x', selectionStart: 0, selectionLength: 0 }), 'x', 'applyEdit null source')

console.log(`\n=== 测试结果：${passCount} 通过，${failCount} 失败 ===`)
if (failCount > 0) process.exit(1)