// ============================================================
// 加密服务
// 职责：API 密钥加密存储，优先使用 Electron safeStorage，回退 AES-256-GCM
// 设计依据：design.md 2.8.1 节，满足 NFR-SEC-01
// ============================================================

const crypto = require('crypto')
const logger = require('./logger.js')

// safeStorage 可选依赖（在主进程外或不可用时为 null）
let safeStorage = null
try {
  // 仅在 Electron 主进程上下文中可用
  // eslint-disable-next-line no-unused-expressions
  require('electron').safeStorage
  safeStorage = require('electron').safeStorage
} catch (e) {
  safeStorage = null
}

// ============================================================
// AES-256-GCM 回退方案
// 密钥派生：固定盐值 + 机器标识（hostname + username）→ PBKDF2 → 32 字节密钥
// 注意：回退方案安全性弱于 safeStorage（OS 级加密），仅在 safeStorage 不可用时使用
// ============================================================
const FALLBACK_SALT = 'starst-desk-v1-salt'
const FALLBACK_ITERATIONS = 100000
const FALLBACK_KEY_LENGTH = 32

// 缓存的回退密钥
let fallbackKey = null

/**
 * 派生回退密钥（基于机器标识）
 * @returns {Buffer} 32 字节 AES-256 密钥
 */
function getFallbackKey () {
  if (fallbackKey) return fallbackKey
  // 机器标识：hostname + 用户名 + 进程 UID（尽量稳定且唯一）
  const os = require('os')
  const machineId = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`
  fallbackKey = crypto.pbkdf2Sync(machineId, FALLBACK_SALT, FALLBACK_ITERATIONS, FALLBACK_KEY_LENGTH, 'sha512')
  return fallbackKey
}

/**
 * 检查 safeStorage 是否可用
 * @returns {boolean}
 */
function isSafeStorageAvailable () {
  return !!(safeStorage && safeStorage.isEncryptionAvailable())
}

/**
 * 加密字符串
 * @param {string} plaintext 明文
 * @returns {string} base64 编码的密文（前置标识位 'S:' 表示 safeStorage，'A:' 表示 AES 回退）
 */
function encrypt (plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return null

  try {
    // 优先使用 safeStorage（OS 级加密）
    if (isSafeStorageAvailable()) {
      const buf = safeStorage.encryptString(plaintext)
      return 'S:' + buf.toString('base64')
    }

    // 回退方案：AES-256-GCM
    const key = getFallbackKey()
    const iv = crypto.randomBytes(12) // GCM 推荐 12 字节 IV
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    // 拼接 IV + 密文 + AuthTag，转 base64
    const combined = Buffer.concat([iv, encrypted, authTag])
    return 'A:' + combined.toString('base64')
  } catch (error) {
    logger.error('CryptoService', `encrypt 失败: ${error.message}`)
    throw new Error('加密失败')
  }
}

/**
 * 解密字符串
 * @param {string} ciphertext base64 编码的密文（带前置标识位）
 * @returns {string} 明文
 */
function decrypt (ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') return null

  try {
    const prefix = ciphertext.slice(0, 2)
    const payload = ciphertext.slice(2)

    if (prefix === 'S:') {
      // safeStorage 加密
      if (!isSafeStorageAvailable()) {
        throw new Error('safeStorage 不可用，无法解密')
      }
      const buf = Buffer.from(payload, 'base64')
      return safeStorage.decryptString(buf)
    }

    if (prefix === 'A:') {
      // AES-256-GCM 回退方案
      const key = getFallbackKey()
      const combined = Buffer.from(payload, 'base64')
      const iv = combined.subarray(0, 12)
      const authTag = combined.subarray(combined.length - 16)
      const encrypted = combined.subarray(12, combined.length - 16)
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
      return decrypted.toString('utf8')
    }

    throw new Error('未知的密文格式')
  } catch (error) {
    logger.error('CryptoService', `decrypt 失败: ${error.message}`)
    throw new Error('解密失败')
  }
}

/**
 * 掩码显示（用于 UI 显示密钥时隐藏敏感部分）
 * @param {string} plaintext 明文密钥
 * @returns {string} 掩码后的字符串，如 "sk-****abcd"
 */
function mask (plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return ''
  if (plaintext.length <= 8) return '****'
  return plaintext.slice(0, 3) + '****' + plaintext.slice(-4)
}

module.exports = {
  encrypt,
  decrypt,
  mask,
  isSafeStorageAvailable
}
