// ============================================================
// 快速捕获剪贴板格式化器
// 格式化剪贴板项为可读文本，支持单项、批量、附件
// ============================================================

const path = require('path')

/**
 * 格式化单项剪贴板内容
 * @param {Object} item 剪贴板项
 * @param {string} item.copyText 复制文本
 * @param {Array} item.attachments 附件列表 [{ attachment: { filePath, displayName } }]
 * @param {Object} localizationService 本地化服务
 * @returns {string}
 */
function formatSingle (item, localizationService) {
  const attachments = (item.attachments || [])
    .map(a => a.attachment)
    .filter(a => a && a.filePath && a.filePath.trim())
  return formatContent(
    item.copyText,
    attachments,
    localizationService,
    /* includeContentLabel */ attachments.length > 0
  )
}

/**
 * 格式化内容
 * @param {string|null} content 内容
 * @param {Array} attachments 附件列表
 * @param {Object} localizationService 本地化服务
 * @param {boolean} [includeContentLabel=true] 是否包含内容标签
 * @returns {string}
 */
function formatContent (content, attachments, localizationService, includeContentLabel = true) {
  const normalizedContent = ((content || '')).trim()
  const attachmentList = (attachments || [])
    .filter(a => a && a.filePath && a.filePath.trim())
  if (attachmentList.length === 0) {
    return normalizedContent
  }

  const sections = []
  if (normalizedContent) {
    sections.push(includeContentLabel
      ? `${localizationService.t('Clipboard.ContentLabel')}\n${normalizedContent}`
      : normalizedContent)
  }

  sections.push(formatAttachments(attachmentList, localizationService))
  return sections.join('\n\n')
}

/**
 * 格式化批量剪贴板项
 * @param {Array} items 剪贴板项列表
 * @param {Object} localizationService 本地化服务
 * @returns {string}
 */
function formatBatch (items, localizationService) {
  return items
    .map((item, index) => {
      const attachments = (item.attachments || [])
        .map(a => a.attachment)
        .filter(a => a && a.filePath && a.filePath.trim())
      return [
        localizationService.format('QuickCapture.Copy.ItemHeader', index + 1),
        formatContent(item.copyText, attachments, localizationService)
      ].join('\n')
    })
    .join('\n\n---\n\n')
}

/**
 * 格式化附件列表
 * @param {Array} attachments 附件列表
 * @param {Object} localizationService 本地化服务
 * @returns {string}
 */
function formatAttachments (attachments, localizationService) {
  const lines = [localizationService.format('Clipboard.Attachments', attachments.length)]
  for (const attachment of attachments) {
    const displayName = (!attachment.displayName || !attachment.displayName.trim())
      ? path.basename(attachment.filePath)
      : attachment.displayName.trim()
    lines.push(`- ${displayName}`)
    lines.push(`  ${localizationService.format('Clipboard.Path', attachment.filePath)}`)
  }
  return lines.join('\n')
}

/**
 * 创建简易本地化服务（用于无外部本地化依赖场景）
 * @param {Object} [overrides] 键值覆盖
 * @returns {Object}
 */
function createSimpleLocalizationService (overrides = {}) {
  const defaults = {
    'Clipboard.ContentLabel': '内容',
    'Clipboard.Attachments': (count) => `附件 (${count})`,
    'Clipboard.Path': (p) => `路径: ${p}`,
    'QuickCapture.Copy.ItemHeader': (index) => `#${index}`
  }
  const dict = { ...defaults, ...overrides }

  return {
    t (key) {
      const value = dict[key]
      return typeof value === 'function' ? value() : (value || key)
    },
    format (key, ...args) {
      const value = dict[key]
      return typeof value === 'function' ? value(...args) : (value || key)
    }
  }
}

module.exports = {
  formatSingle,
  formatContent,
  formatBatch,
  formatAttachments,
  createSimpleLocalizationService
}