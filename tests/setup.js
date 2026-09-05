// ============================================================
// 测试环境设置
// 提供内存数据库、Electron mock、HTTP mock 等基础设施
// 所有 DAO 测试通过 require 此文件获得统一的测试环境
// ============================================================

const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

// 读取 schema DDL（建表脚本）
const { SCHEMA_DDL } = require('../electron/dao/schema.js')

// ============================================================
// 内存数据库工厂
// ============================================================

/**
 * 创建一个全新的内存数据库并执行建表脚本
 * 每个测试用例应调用此方法获得独立的数据库实例
 * @returns {Database} better-sqlite3 内存数据库实例
 */
function createMemoryDb () {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_DDL)
  return db
}

/**
 * 将指定 db 实例注入到 database.js 模块的 require 缓存中
 * 使所有 DAO 模块通过 require('./database.js').getDb() 获得该实例
 * @param {Database} db 内存数据库实例
 */
function injectDb (db) {
  const databasePath = require.resolve('../electron/dao/database.js')
  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {
      getDb: () => db,
      closeDb: () => { try { db.close() } catch (e) {} },
      // 注册预编译语句缓存：测试环境 no-op（内存数据库随测试销毁，无需跨连接清除）
      registerStmtCache: () => {}
    }
  }
}

/**
 * 清除 database.js 的 require 缓存，使下次 require 重新加载
 */
function clearDbCache () {
  const databasePath = require.resolve('../electron/dao/database.js')
  delete require.cache[databasePath]
}

/**
 * 清除所有 DAO 模块的 require 缓存（包含预编译语句缓存）
 */
function clearAllDaoCache () {
  const daoDir = path.resolve(__dirname, '../electron/dao')
  const adapterDir = path.resolve(__dirname, '../electron/adapters')
  const coreDir = path.resolve(__dirname, '../electron/core')
  const modulesDir = path.resolve(__dirname, '../electron/modules')

  for (const dir of [daoDir, adapterDir, coreDir, modulesDir]) {
    clearDirCache(dir)
  }
  clearDbCache()
}

/**
 * 清除指定目录下所有 .js 文件的 require 缓存
 */
function clearDirCache (dir) {
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.js')) {
      const fullPath = path.join(dir, file)
      delete require.cache[fullPath]
    }
  }
}

/**
 * 完整重置测试环境：清除所有相关 require 缓存并注入新的内存数据库
 * 在 beforeEach 中调用，确保每个测试用例独立
 * @returns {Database} 新的内存数据库实例
 */
function setupFreshDb () {
  clearAllDaoCache()
  const db = createMemoryDb()
  injectDb(db)
  return db
}

// ============================================================
// Electron API Mock
// ============================================================

/**
 * 安装 Electron mock 到 require 缓存
 * 提供 Notification / BrowserWindow / shell / safeStorage 等假实现
 * @param {object} [overrides] 自定义覆盖项
 */
function mockElectron (overrides = {}) {
  const electronMock = {
    Notification: Object.assign(
      class MockNotification {
        constructor (opts) { this.opts = opts; this.shown = false }
        show () { this.shown = true }
        static isSupported () { return true }
      },
      { isSupported: () => true }
    ),
    BrowserWindow: class MockBrowserWindow {
      constructor () { this.destroyed = false; this.visible = true }
      isDestroyed () { return this.destroyed }
      isVisible () { return this.visible }
      show () { this.visible = true }
      webContents = { send: () => {} }
    },
    shell: {
      openExternal: overrides.openExternal || (async (url) => { /* mock */ }),
      openPath: overrides.openPath || (async (p) => { /* mock */ })
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString()
    },
    app: {
      getPath: () => '/tmp',
      on: () => {},
      quit: () => {}
    },
    ...overrides
  }

  const electronPath = require.resolve('electron')
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: electronMock
  }
  return electronMock
}

/**
 * 清除 Electron mock
 */
function unmockElectron () {
  const electronPath = require.resolve('electron')
  delete require.cache[electronPath]
}

// ============================================================
// HTTP fetch Mock
// ============================================================

/**
 * 创建一个 fetch mock，根据预配置的响应规则返回结果
 * @param {Array<{match: Function, response: object}>} rules 响应规则
 * @returns {Function} fetch mock 函数
 */
function createFetchMock (rules = []) {
  const calls = []
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options })

    for (const rule of rules) {
      if (rule.match(url, options)) {
        if (rule.throw) {
          throw new Error(rule.throw)
        }
        return createMockResponse(rule.response, rule.stream)
      }
    }

    // 默认 404
    return createMockResponse({ status: 404, statusText: 'Not Found' })
  }
  fetchFn.calls = calls
  return fetchFn
}

/**
 * 创建 mock Response 对象（兼容 fetch Response 接口）
 */
function createMockResponse (config = {}, stream = false) {
  const status = config.status || 200
  const statusText = config.statusText || 'OK'
  const body = config.body || ''

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => typeof body === 'string' ? JSON.parse(body) : body,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    body: stream ? createMockReadableStream(body) : null
  }
}

/**
 * 创建 mock ReadableStream（用于 SSE/NDJSON 流式响应）
 */
function createMockReadableStream (chunks) {
  const arr = Array.isArray(chunks) ? chunks : [chunks]
  let index = 0

  return {
    getReader () {
      return {
        read: async () => {
          if (index >= arr.length) return { done: true, value: undefined }
          const value = arr[index++]
          return { done: false, value: typeof value === 'string' ? Buffer.from(value) : value }
        },
        releaseLock: () => {}
      }
    }
  }
}

/**
 * 安装 fetch mock 到 global
 * @param {Function} fetchFn fetch mock 函数
 */
function installFetchMock (fetchFn) {
  global.fetch = fetchFn
}

/**
 * 恢复原始 fetch
 */
function restoreFetch () {
  delete global.fetch
}

// ============================================================
// 通用辅助
// ============================================================

/**
 * 等待指定毫秒
 */
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 生成固定时间戳的 ISO 字符串（用于测试）
 */
function fixedISO (year, month, day, hour = 0, minute = 0, second = 0) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

module.exports = {
  createMemoryDb,
  injectDb,
  clearDbCache,
  clearAllDaoCache,
  setupFreshDb,
  mockElectron,
  unmockElectron,
  createFetchMock,
  createMockResponse,
  createMockReadableStream,
  installFetchMock,
  restoreFetch,
  sleep,
  fixedISO,
  SCHEMA_DDL
}