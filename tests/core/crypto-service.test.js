// ============================================================
// 加密服务单元测试
// 覆盖加密/解密往返、空值处理、掩码显示
// ============================================================

const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const setup = require('../setup.js')

let cryptoService

beforeEach(() => {
  // 清除 crypto-service 缓存以使用 mock Electron
  setup.mockElectron()
  delete require.cache[require.resolve('../../electron/core/crypto-service.js')]
  cryptoService = require('../../electron/core/crypto-service.js')
})

afterEach(() => {
  setup.unmockElectron()
})

describe('CryptoService - 加密/解密往返', () => {
  test('应成功加密并解密字符串', () => {
    const plaintext = 'sk-abcdefghijklmn0123456789'
    const encrypted = cryptoService.encrypt(plaintext)
    assert.ok(encrypted, '加密结果不应为空')
    assert.match(encrypted, /^[SA]:/, '应有前缀标识')

    const decrypted = cryptoService.decrypt(encrypted)
    assert.equal(decrypted, plaintext, '解密应还原原文')
  })

  test('应支持中文加密/解密', () => {
    const plaintext = '这是一个中文 API 密钥测试'
    const encrypted = cryptoService.encrypt(plaintext)
    const decrypted = cryptoService.decrypt(encrypted)
    assert.equal(decrypted, plaintext)
  })

  test('应支持特殊字符加密/解密', () => {
    const plaintext = 'key-with-special@chars!#$%^&*()'
    const encrypted = cryptoService.encrypt(plaintext)
    const decrypted = cryptoService.decrypt(encrypted)
    assert.equal(decrypted, plaintext)
  })

  test('应支持空格加密/解密', () => {
    const plaintext = 'key with spaces'
    const encrypted = cryptoService.encrypt(plaintext)
    const decrypted = cryptoService.decrypt(encrypted)
    assert.equal(decrypted, plaintext)
  })

  test('应支持长字符串加密/解密', () => {
    const plaintext = 'a'.repeat(1000)
    const encrypted = cryptoService.encrypt(plaintext)
    const decrypted = cryptoService.decrypt(encrypted)
    assert.equal(decrypted, plaintext)
  })

  test('相同明文多次加密应产生不同密文（IV 随机）', () => {
    const plaintext = 'same-plaintext'
    const encrypted1 = cryptoService.encrypt(plaintext)
    const encrypted2 = cryptoService.encrypt(plaintext)
    // 由于 IV 随机，密文应不同
    assert.notEqual(encrypted1, encrypted2)
    // 但都能解密为相同明文
    assert.equal(cryptoService.decrypt(encrypted1), plaintext)
    assert.equal(cryptoService.decrypt(encrypted2), plaintext)
  })
})

describe('CryptoService - 空值处理', () => {
  test('encrypt 空字符串应返回 null', () => {
    assert.equal(cryptoService.encrypt(''), null)
  })

  test('encrypt null 应返回 null', () => {
    assert.equal(cryptoService.encrypt(null), null)
  })

  test('encrypt undefined 应返回 null', () => {
    assert.equal(cryptoService.encrypt(undefined), null)
  })

  test('encrypt 非字符串应返回 null', () => {
    assert.equal(cryptoService.encrypt(123), null)
    assert.equal(cryptoService.encrypt({}), null)
    assert.equal(cryptoService.encrypt([]), null)
  })

  test('decrypt 空字符串应返回 null', () => {
    assert.equal(cryptoService.decrypt(''), null)
  })

  test('decrypt null 应返回 null', () => {
    assert.equal(cryptoService.decrypt(null), null)
  })
})

describe('CryptoService - 错误处理', () => {
  test('decrypt 无效密文应抛出异常', () => {
    assert.throws(
      () => cryptoService.decrypt('X:invalid-base64-data'),
      /解密失败/
    )
  })

  test('decrypt 未知前缀应抛出异常', () => {
    assert.throws(
      () => cryptoService.decrypt('X:somedata'),
      /解密失败/
    )
  })
})

describe('CryptoService - 掩码显示', () => {
  test('应正确掩码长字符串', () => {
    const plaintext = 'sk-abcdefghijklmn'
    const masked = cryptoService.mask(plaintext)
    // 应保留前 3 字符和后 4 字符，中间用 **** 替换
    assert.equal(masked, 'sk-****klmn')
  })

  test('短字符串应全部掩码为 ****', () => {
    assert.equal(cryptoService.mask('short'), '****')
    assert.equal(cryptoService.mask('12345678'), '****')
  })

  test('9 字符串应使用前后掩码', () => {
    // 长度 9 > 8，应使用前后掩码
    const masked = cryptoService.mask('123456789')
    assert.equal(masked, '123****6789')
  })

  test('mask 空值应返回空字符串', () => {
    assert.equal(cryptoService.mask(''), '')
    assert.equal(cryptoService.mask(null), '')
    assert.equal(cryptoService.mask(undefined), '')
  })

  test('mask 非字符串应返回空字符串', () => {
    assert.equal(cryptoService.mask(123), '')
    assert.equal(cryptoService.mask({}), '')
  })
})

describe('CryptoService - safeStorage 可用性', () => {
  test('isSafeStorageAvailable 应返回布尔值', () => {
    const available = cryptoService.isSafeStorageAvailable()
    assert.equal(typeof available, 'boolean')
    // mock 中 safeStorage.isEncryptionAvailable 返回 false
    assert.equal(available, false)
  })
})