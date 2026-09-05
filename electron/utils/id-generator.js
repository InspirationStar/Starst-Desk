// ============================================================
// UUID 生成工具
// 使用 uuid 库生成 UUID v4
// ============================================================

const { v4: uuidv4 } = require('uuid')

/**
 * 生成 UUID v4
 * @returns {string} UUID 字符串
 */
function generateId () {
  return uuidv4()
}

module.exports = {
  generateId
}