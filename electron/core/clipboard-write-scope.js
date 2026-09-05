// ============================================================
// 剪贴板写入范围控制
// 标记本应用写入剪贴板的内容，避免捕获自己写入的内容
// 在忽略窗口（默认 2 秒）内，若剪贴板内容与最近写入一致则跳过捕获
// ============================================================

const path = require('path')

// 忽略窗口时长
const IGNORE_WINDOW_MS = 2000

// 支持的图片扩展名
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']

// 内部状态
let lastWriteUtc = 0
let lastText = null
let lastWriteHasImage = false
let lastPaths = []

/**
 * 标记一次剪贴板写入
 * @param {string|null} [text] 文本内容
 * @param {boolean} [hasImage] 是否包含图片
 * @param {Array<string>|null} [paths] 文件路径列表
 */
function markWrite (text = null, hasImage = false, paths = null) {
  const normalizedText = normalizeText(text)
  const normalizedPaths = (paths || [])
    .filter(p => p && typeof p === 'string' && p.trim())
    .map(normalizePath)
    .filter(p => p)
    .filter((value, index, self) => self.indexOf(value.toLowerCase()) === index)

  lastWriteUtc = Date.now()
  lastText = normalizedText
  lastPaths = normalizedPaths
  lastWriteHasImage = !!hasImage || normalizedPaths.some(isImageFile)
}

/**
 * 标记一次纯文本写入
 * @param {string|null} text 文本内容
 */
function markText (text) {
  markWrite(text, false, null)
}

/**
 * 判断是否应当忽略本次剪贴板内容
 * @param {Object} content 剪贴板内容 { text, hasImage, imagePngBytes }
 * @returns {boolean}
 */
function shouldIgnore (content) {
  if (content && content.hasImage && shouldIgnoreImage()) {
    return true
  }
  return shouldIgnoreText(content ? content.text : null)
}

/**
 * 判断是否应当忽略文本
 * @param {string|null} text 文本
 * @returns {boolean}
 */
function shouldIgnoreText (text) {
  const normalizedText = normalizeText(text)
  if (!normalizedText) return false

  const snapshot = getFreshSnapshot()
  if (!snapshot.isFresh) return false

  if (snapshot.text === normalizedText) return true

  if (snapshot.paths.length === 0) return false

  const textPaths = normalizedText
    .split(/\r\n|\n/)
    .map(line => line.trim())
    .filter(line => line)
    .map(normalizePath)
    .filter(p => p)

  return textPaths.length > 0 &&
         textPaths.length === snapshot.paths.length &&
         textPaths.every(p => snapshot.paths.includes(p.toLowerCase()))
}

/**
 * 清空状态（测试用）
 */
function clearForTesting () {
  lastWriteUtc = 0
  lastText = null
  lastWriteHasImage = false
  lastPaths = []
}

/**
 * 判断是否应当忽略图片
 * @returns {boolean}
 */
function shouldIgnoreImage () {
  const snapshot = getFreshSnapshot()
  return snapshot.isFresh && snapshot.hasImage
}

/**
 * 获取新鲜快照
 * @returns {Object}
 */
function getFreshSnapshot () {
  const isFresh = Date.now() - lastWriteUtc <= IGNORE_WINDOW_MS
  return {
    isFresh,
    text: lastText,
    hasImage: lastWriteHasImage,
    paths: lastPaths
  }
}

/**
 * 规范化文本
 */
function normalizeText (text) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  return trimmed || null
}

/**
 * 规范化路径
 */
function normalizePath (p) {
  if (!p || typeof p !== 'string') return ''
  try {
    return path.resolve(p.trim()).toLowerCase()
  } catch {
    return p.trim().toLowerCase()
  }
}

/**
 * 判断是否为图片文件
 */
function isImageFile (p) {
  const ext = path.extname(p).toLowerCase()
  return IMAGE_EXTENSIONS.includes(ext)
}

module.exports = {
  IGNORE_WINDOW_MS,
  markWrite,
  markText,
  shouldIgnore,
  shouldIgnoreText,
  clearForTesting
}