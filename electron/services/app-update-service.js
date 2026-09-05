// ============================================================
// 应用更新服务（主进程）
// 职责：检查 GitHub Release 更新 + 数据备份/恢复
// 简化实现：仅检查更新，不自动下载安装（避免破坏当前运行）
// ============================================================

const { app, shell } = require('electron')
const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const zlib = require('zlib')
const logger = require('./../core/logger.js')

// ============================================================
// 配置
// ============================================================

// GitHub 仓库地址（用户可自行修改）
const GITHUB_REPO = 'starst/starst-desk'
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

// 更新状态
let updateState = {
  checking: false,
  hasUpdate: false,
  latestVersion: null,
  currentVersion: app.getVersion(),
  releaseUrl: null,
  releaseNotes: null,
  lastCheckTime: null,
  error: null
}

/**
 * 获取当前更新状态
 * @returns {object}
 */
function getStatus () {
  return { ...updateState }
}

/**
 * 检查更新
 * @returns {Promise<object>}
 */
function checkForUpdates () {
  return new Promise((resolve) => {
    if (updateState.checking) {
      resolve(getStatus())
      return
    }

    updateState.checking = true
    updateState.error = null

    const req = https.get(RELEASES_API, {
      headers: {
        'User-Agent': 'Starst-Desk-Updater',
        'Accept': 'application/vnd.github.v3+json'
      },
      timeout: 15000
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        updateState.checking = false
        updateState.lastCheckTime = new Date().toISOString()

        if (res.statusCode !== 200) {
          updateState.error = `GitHub API 返回 ${res.statusCode}`
          logger.warn('AppUpdate', `检查更新失败: ${updateState.error}`)
          resolve(getStatus())
          return
        }

        try {
          const release = JSON.parse(data)
          const latestVersion = (release.tag_name || '').replace(/^v/, '')
          const currentVersion = updateState.currentVersion

          updateState.latestVersion = latestVersion
          updateState.releaseUrl = release.html_url
          updateState.releaseNotes = release.body
          updateState.hasUpdate = compareVersions(latestVersion, currentVersion) > 0

          logger.info('AppUpdate', `检查完成: 当前 ${currentVersion}, 最新 ${latestVersion}, 有更新: ${updateState.hasUpdate}`)
          resolve(getStatus())
        } catch (e) {
          updateState.error = `解析响应失败: ${e.message}`
          logger.error('AppUpdate', updateState.error)
          resolve(getStatus())
        }
      })
    })

    req.on('error', (err) => {
      updateState.checking = false
      updateState.error = err.message
      updateState.lastCheckTime = new Date().toISOString()
      logger.warn('AppUpdate', `检查更新出错: ${err.message}`)
      resolve(getStatus())
    })

    req.on('timeout', () => {
      req.destroy()
      updateState.checking = false
      updateState.error = '请求超时'
      updateState.lastCheckTime = new Date().toISOString()
      logger.warn('AppUpdate', '检查更新超时')
      resolve(getStatus())
    })
  })
}

/**
 * 比较版本号
 * @param {string} v1
 * @param {string} v2
 * @returns {number} 1=v1>v2, -1=v1<v2, 0=相等
 */
function compareVersions (v1, v2) {
  const parts1 = (v1 || '').split('.').map(n => parseInt(n, 10) || 0)
  const parts2 = (v2 || '').split('.').map(n => parseInt(n, 10) || 0)
  const len = Math.max(parts1.length, parts2.length)
  for (let i = 0; i < len; i++) {
    const a = parts1[i] || 0
    const b = parts2[i] || 0
    if (a > b) return 1
    if (a < b) return -1
  }
  return 0
}

/**
 * 打开下载页面（在系统浏览器中打开 GitHub Release 页面）
 * @returns {Promise<boolean>}
 */
async function openDownloadPage () {
  if (!updateState.releaseUrl) {
    // 使用默认 releases 页面
    const url = `https://github.com/${GITHUB_REPO}/releases/latest`
    await shell.openExternal(url)
    return true
  }
  await shell.openExternal(updateState.releaseUrl)
  return true
}

// ============================================================
// 管理应用数据根路径、恢复目录、日志路径等
// 自动快照存放在恢复目录中，卸载不会删除
// ============================================================

const PRODUCTION_INSTANCE_SCOPE = '7F3A9B2E'
const DEV_ROOT_ENV_VAR = 'STARST_DESK_DEV_DATA_ROOT'

/**
 * 创建数据路径服务实例
 * @param {string|null} rootPath - 自定义根路径，默认使用 app.getPath('userData')
 * @returns {object} 数据路径服务
 */
function createDataPathService (rootPath = null) {
  const productionRoot = app.getPath('userData')
  const resolvedRoot = rootPath
    ? path.resolve(rootPath.trim())
    : productionRoot
  const isDevRoot = path.resolve(resolvedRoot).toLowerCase() !==
    path.resolve(productionRoot).toLowerCase()

  // 开发根路径时基于路径哈希生成作用域 ID，生产环境使用固定值
  const instanceScope = isDevRoot
    ? crypto.createHash('sha256').update(resolvedRoot.toUpperCase()).digest('hex').slice(0, 8).toUpperCase()
    : PRODUCTION_INSTANCE_SCOPE

  // 恢复目录与根路径同级，避免卸载时被删除
  const recoveryDirectory = isDevRoot
    ? `${resolvedRoot}-Recovery`
    : path.join(path.dirname(resolvedRoot), 'StarstDesk-Recovery')

  return {
    rootPath: resolvedRoot,
    isDevelopmentRoot: isDevRoot,
    instanceScope,
    activationEventName: `StarstDesk_Activate_Event_${instanceScope}`,
    singleInstanceMutexName: `StarstDesk_SingleInstance_Mutex_${instanceScope}`,
    dataDirectory: resolvedRoot,
    updatesDirectory: path.join(resolvedRoot, 'updates'),
    recoveryDirectory,
    logFilePath: path.join(resolvedRoot, 'StarstDesk.log'),
    // 开发环境变量覆盖（仅 DEBUG 构建生效）
    developmentRootEnvVar: DEV_ROOT_ENV_VAR
  }
}

// 数据路径服务单例
const dataPathService = createDataPathService(process.env[DEV_ROOT_ENV_VAR] || null)

// ============================================================
// 托管存储路径服务（参考 ManagedStoragePathService.cs）
// 推荐非系统盘上的存储路径，评估路径是否在系统盘/云同步目录
// ============================================================

const MIN_RECOMMENDED_FREE_SPACE_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB

/**
 * 获取系统盘根目录（如 C:\）
 * @returns {string}
 */
function getSystemDriveRoot () {
  const systemDrive = process.env.SystemDrive
  if (systemDrive) {
    return path.resolve(systemDrive + path.sep)
  }
  // 回退：从系统目录推断
  return path.parse(process.env.windir || 'C:\\Windows').root
}

/**
 * 获取路径的根目录
 * @param {string} p
 * @returns {string|null}
 */
function tryGetPathRoot (p) {
  if (!p || typeof p !== 'string') return null
  try {
    return path.parse(path.resolve(p)).root
  } catch {
    return null
  }
}

/**
 * 判断两个路径是否在同一盘符根
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function sameDriveRoot (left, right) {
  const lr = tryGetPathRoot(left)
  const rr = tryGetPathRoot(right)
  return lr !== null && rr !== null && lr.toLowerCase() === rr.toLowerCase()
}

/**
 * 净化路径段，替换非法字符为下划线
 * @param {string} value
 * @returns {string}
 */
function sanitizePathSegment (value) {
  if (!value || typeof value !== 'string') return ''
  // Windows 非法文件名字符
  const invalid = /[<>:"/\\|?*\x00-\x1F]/g
  return value.trim().replace(invalid, '_').replace(/[.\s]+$/, '')
}

/**
 * 获取云同步根目录列表（OneDrive 等）
 * @returns {string[]}
 */
function getCloudSyncRoots () {
  const vars = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']
  const seen = new Set()
  const roots = []
  for (const name of vars) {
    const value = process.env[name]
    if (!value) continue
    try {
      const normalized = path.resolve(value)
      const key = normalized.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        roots.push(normalized)
      }
    } catch {
      // 忽略无效路径
    }
  }
  return roots
}

/**
 * 判断 path 是否与 directory 相同或是其子路径
 * @param {string} p
 * @param {string} dir
 * @returns {boolean}
 */
function isSameOrDescendant (p, dir) {
  if (!p || !dir) return false
  try {
    const np = path.resolve(p)
    const nd = path.resolve(dir)
    if (np.toLowerCase() === nd.toLowerCase()) return true
    return np.toLowerCase().startsWith(nd.toLowerCase() + path.sep)
  } catch {
    return false
  }
}

/**
 * 获取推荐托管存储路径
 * 优先选择非系统盘、空间充足的固定驱动器
 * @returns {string}
 */
function getRecommendedStoragePath () {
  const userProfile = os.homedir()
  const userName = os.userInfo().username
  const systemRoot = getSystemDriveRoot()
  const fallback = path.join(userProfile, 'StarstDesk')

  // 枚举驱动器（Windows 下硬编码盘符枚举）
  // 简化实现：检查常见盘符
  const candidates = []
  if (process.platform === 'win32') {
    for (let code = 65; code <= 90; code++) {
      const drive = String.fromCharCode(code) + ':\\'
      try {
        // 同步获取磁盘信息（Node.js 无内置 API，使用 fs.existsSync 探测）
        if (fs.existsSync(drive)) {
          // 通过 child_process 获取可用空间会引入额外依赖
          // 这里仅判断盘符是否可用，空间检查留给上层 UI
          candidates.push({
            rootPath: drive,
            isReady: true,
            availableFreeSpace: 0 // 未知，不作为排序依据
          })
        }
      } catch {
        // 忽略不可访问的盘符
      }
    }
  }

  // 筛选非系统盘的固定驱动器
  const suitable = candidates.filter(d =>
    d.isReady && !sameDriveRoot(d.rootPath, systemRoot)
  )

  if (suitable.length === 0) {
    return fallback
  }

  // 选择第一个可用盘（按盘符排序）
  suitable.sort((a, b) => a.rootPath.localeCompare(b.rootPath))
  const selected = suitable[0]

  let accountFolder = sanitizePathSegment(userName)
  if (!accountFolder) {
    accountFolder = sanitizePathSegment(path.basename(userProfile))
  }
  if (!accountFolder) {
    accountFolder = 'User'
  }

  return path.join(selected.rootPath, 'StarstDesk', accountFolder)
}

/**
 * 评估给定路径的存储属性
 * @param {string} p - 待评估路径
 * @returns {object} 包含 isSystemDrive/isCloudSynced/hasSuitableNonSystemDrive 等
 */
function assessStoragePath (p) {
  let normalizedPath
  try {
    normalizedPath = path.resolve(p)
  } catch {
    normalizedPath = p
  }

  const systemRoot = getSystemDriveRoot()
  const pathRoot = tryGetPathRoot(normalizedPath)
  const isSystemDrive = pathRoot !== null && sameDriveRoot(pathRoot, systemRoot)
  const isCloudSynced = getCloudSyncRoots().some(root => isSameOrDescendant(normalizedPath, root))

  // 网络路径
  let driveType = null
  if (normalizedPath.startsWith('\\\\')) {
    driveType = 'network'
  } else if (pathRoot !== null) {
    driveType = 'fixed'
  }

  return {
    isSystemDrive,
    isCloudSynced,
    driveType,
    availableFreeSpace: null, // Node.js 无内置磁盘空间 API
    hasSuitableNonSystemDrive: false // 简化：由 UI 层判断
  }
}

// 托管存储路径服务
const managedStoragePathService = {
  getRecommendedPath: getRecommendedStoragePath,
  assessPath: assessStoragePath,
  minimumRecommendedFreeSpaceBytes: MIN_RECOMMENDED_FREE_SPACE_BYTES
}

// ============================================================
// ZIP 工具（内联实现，避免引入外部依赖）
// 实现基本的 ZIP 归档创建/解压，支持 DEFLATE 压缩
// ============================================================

// CRC32 查找表（懒加载）
let crc32Table = null

/**
 * 获取 CRC32 查找表
 * @returns {Uint32Array}
 */
function getCrc32Table () {
  if (crc32Table) return crc32Table
  crc32Table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    crc32Table[i] = c >>> 0
  }
  return crc32Table
}

/**
 * 计算 Buffer 的 CRC32
 * @param {Buffer} buffer
 * @returns {number} CRC32（无符号 32 位整数）
 */
function computeCrc32 (buffer) {
  const table = getCrc32Table()
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * 将 Date 转换为 DOS 时间/日期
 * @param {Date} date
 * @returns {{time: number, date: number}}
 */
function dosDateTime (date) {
  const time = ((date.getHours() & 0x1F) << 11) |
    ((date.getMinutes() & 0x3F) << 5) |
    ((Math.floor(date.getSeconds() / 2)) & 0x1F)
  const dt = (((date.getFullYear() - 1980) & 0x7F) << 9) |
    (((date.getMonth() + 1) & 0x0F) << 5) |
    (date.getDate() & 0x1F)
  return { time, date: dt }
}

/**
 * 创建 ZIP 归档
 * @param {string} archivePath - 归档文件路径
 * @param {Array<{relativePath: string, content: Buffer}>} entries - 文件条目
 * @returns {void}
 */
function createZipArchive (archivePath, entries) {
  const chunks = []
  const centralEntries = []
  let offset = 0

  for (const entry of entries) {
    const fileNameBuffer = Buffer.from(entry.relativePath, 'utf8')
    const content = entry.content
    const crc = computeCrc32(content)

    // 使用 deflateRaw 压缩（ZIP 使用 raw DEFLATE，无 zlib 头）
    let compressed
    let compressionMethod
    try {
      compressed = zlib.deflateRawSync(content, { level: zlib.constants.Z_BEST_SPEED })
      // 如果压缩后更大，使用存储模式
      if (compressed.length >= content.length) {
        compressed = content
        compressionMethod = 0 // 存储
      } else {
        compressionMethod = 8 // DEFLATE
      }
    } catch {
      compressed = content
      compressionMethod = 0
    }

    const { time: dosTime, date: dosDate } = dosDateTime(new Date())

    // 本地文件头（30 字节 + 文件名）
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)     // 签名
    localHeader.writeUInt16LE(20, 4)              // 版本需要解压
    localHeader.writeUInt16LE(0, 6)               // 通用位标志
    localHeader.writeUInt16LE(compressionMethod, 8) // 压缩方法
    localHeader.writeUInt16LE(dosTime, 10)        // 最后修改时间
    localHeader.writeUInt16LE(dosDate, 12)        // 最后修改日期
    localHeader.writeUInt32LE(crc, 14)            // CRC-32
    localHeader.writeUInt32LE(compressed.length, 18) // 压缩大小
    localHeader.writeUInt32LE(content.length, 22)    // 未压缩大小
    localHeader.writeUInt16LE(fileNameBuffer.length, 26) // 文件名长度
    localHeader.writeUInt16LE(0, 28)              // 额外字段长度

    const localEntry = Buffer.concat([localHeader, fileNameBuffer, compressed])
    chunks.push(localEntry)

    // 记录中央目录信息
    centralEntries.push({
      fileNameBuffer,
      compressionMethod,
      dosTime,
      dosDate,
      crc,
      compressedSize: compressed.length,
      uncompressedSize: content.length,
      localHeaderOffset: offset
    })

    offset += localEntry.length
  }

  // 中央目录
  let centralOffset = offset
  let centralSize = 0
  for (const ce of centralEntries) {
    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)    // 签名
    centralHeader.writeUInt16LE(20, 4)             // 版本制作
    centralHeader.writeUInt16LE(20, 6)             // 版本需要解压
    centralHeader.writeUInt16LE(0, 8)              // 通用位标志
    centralHeader.writeUInt16LE(ce.compressionMethod, 10) // 压缩方法
    centralHeader.writeUInt16LE(ce.dosTime, 12)    // 最后修改时间
    centralHeader.writeUInt16LE(ce.dosDate, 14)    // 最后修改日期
    centralHeader.writeUInt32LE(ce.crc, 16)        // CRC-32
    centralHeader.writeUInt32LE(ce.compressedSize, 20) // 压缩大小
    centralHeader.writeUInt32LE(ce.uncompressedSize, 24) // 未压缩大小
    centralHeader.writeUInt16LE(ce.fileNameBuffer.length, 28) // 文件名长度
    centralHeader.writeUInt16LE(0, 30)             // 额外字段长度
    centralHeader.writeUInt16LE(0, 32)             // 文件注释长度
    centralHeader.writeUInt16LE(0, 34)             // 起始磁盘号
    centralHeader.writeUInt16LE(0, 36)             // 内部文件属性
    centralHeader.writeUInt32LE(0, 38)             // 外部文件属性
    centralHeader.writeUInt32LE(ce.localHeaderOffset, 42) // 本地文件头偏移

    const centralEntry = Buffer.concat([centralHeader, ce.fileNameBuffer])
    chunks.push(centralEntry)
    centralSize += centralEntry.length
  }

  // 结束记录（22 字节）
  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)          // 签名
  endRecord.writeUInt16LE(0, 4)                    // 当前磁盘号
  endRecord.writeUInt16LE(0, 6)                    // 起始磁盘号
  endRecord.writeUInt16LE(centralEntries.length, 8) // 当前磁盘上的记录数
  endRecord.writeUInt16LE(centralEntries.length, 10) // 总记录数
  endRecord.writeUInt32LE(centralSize, 12)         // 中央目录大小
  endRecord.writeUInt32LE(centralOffset, 16)       // 中央目录偏移
  endRecord.writeUInt16LE(0, 20)                   // 注释长度

  chunks.push(endRecord)

  // 原子写入：先写临时文件再重命名
  const tmpPath = `${archivePath}.${crypto.randomUUID().replace(/-/g, '')}.tmp`
  try {
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))
    fs.renameSync(tmpPath, archivePath)
  } finally {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* 忽略清理失败 */ }
  }
}

/**
 * 解析 ZIP 归档，返回所有条目
 * @param {string} archivePath - 归档文件路径
 * @returns {Array<{relativePath: string, content: Buffer}>} 文件条目列表
 */
function extractZipArchive (archivePath) {
  const buffer = fs.readFileSync(archivePath)

  // 查找结束记录（从文件末尾向前搜索）
  let eocdOffset = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) {
    throw new Error('ZIP 结束记录未找到，文件可能已损坏')
  }

  const centralEntriesCount = buffer.readUInt16LE(eocdOffset + 10)
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16)

  const entries = []
  for (let i = 0; i < centralEntriesCount; i++) {
    // 读取中央目录头
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error(`中央目录头签名无效（条目 ${i}）`)
    }
    const compressionMethod = buffer.readUInt16LE(centralOffset + 10)
    const crc = buffer.readUInt32LE(centralOffset + 16)
    const compressedSize = buffer.readUInt32LE(centralOffset + 20)
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24)
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28)
    const extraFieldLength = buffer.readUInt16LE(centralOffset + 30)
    const fileCommentLength = buffer.readUInt16LE(centralOffset + 32)
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42)

    const fileName = buffer.toString('utf8', centralOffset + 46, centralOffset + 46 + fileNameLength)

    // 跳过目录条目（以 / 结尾）
    if (fileName.endsWith('/')) {
      centralOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength
      continue
    }

    // 读取本地文件头获取数据偏移
    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength

    const compressedData = buffer.subarray(dataOffset, dataOffset + compressedSize)

    let content
    if (compressionMethod === 0) {
      // 存储模式
      content = compressedData
    } else if (compressionMethod === 8) {
      // DEFLATE
      content = zlib.inflateRawSync(compressedData)
    } else {
      throw new Error(`不支持的压缩方法 ${compressionMethod}（条目 ${fileName}）`)
    }

    // 验证 CRC32
    if (computeCrc32(content) !== crc) {
      throw new Error(`CRC32 校验失败（条目 ${fileName}）`)
    }

    // 验证解压后大小
    if (content.length !== uncompressedSize) {
      throw new Error(`解压大小不匹配（条目 ${fileName}）`)
    }

    entries.push({ relativePath: fileName, content })

    centralOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength
  }

  return entries
}

/**
 * 从 ZIP 归档中读取单个条目（不全部解压）
 * @param {string} archivePath - 归档文件路径
 * @param {string} entryName - 条目名称
 * @returns {Buffer|null} 条目内容，不存在返回 null
 */
function readZipEntry (archivePath, entryName) {
  const entries = extractZipArchive(archivePath)
  const entry = entries.find(e => e.relativePath === entryName)
  return entry ? entry.content : null
}

// ============================================================
// 实现数据备份/恢复、自动快照、SHA256 完整性校验
// ============================================================

const BACKUP_SCHEMA_VERSION = 2
const MIN_SUPPORTED_BACKUP_SCHEMA_VERSION = 1
const MAX_AUTOMATIC_SNAPSHOT_COUNT = 7
const MAX_PRE_RESTORE_BACKUP_COUNT = 5
const MAX_RESTORE_FILE_COUNT = 100000
const MAX_RESTORE_FILE_SIZE_BYTES = 4 * 1024 * 1024 * 1024
const MAX_RESTORE_TOTAL_SIZE_BYTES = 16 * 1024 * 1024 * 1024
const AUTOMATIC_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000 // 1 天

/**
 * 创建数据备份服务实例
 * @param {object|null} pathService - 数据路径服务，默认使用单例
 * @returns {object} 数据备份服务
 */
function createDataBackupService (pathService = null) {
  const paths = pathService || dataPathService
  const rootPath = paths.rootPath
  const dataDirectory = paths.dataDirectory
  const recoveryDirectory = paths.recoveryDirectory

  // 各类目录路径
  const automaticSnapshotDirectory = path.join(recoveryDirectory, 'automatic')
  const legacyAutomaticSnapshotDirectory = path.join(rootPath, 'backups', 'automatic')
  const preRestoreBackupDirectory = path.join(rootPath, 'backups', 'pre-restore')
  const restoreStagingDirectory = path.join(rootPath, 'restore-staging')
  const backupSnapshotStagingDirectory = path.join(rootPath, 'backup-staging')
  const pendingRestoreMarkerPath = path.join(rootPath, 'restore-pending.json')

  // 互斥锁（同一进程内串行化备份操作）
  let gateLocked = false

  /**
   * 获取互斥锁
   * @returns {boolean} 是否成功获取
   */
  function acquireGate () {
    if (gateLocked) return false
    gateLocked = true
    return true
  }

  /**
   * 释放互斥锁
   */
  function releaseGate () {
    gateLocked = false
  }

  /**
   * 判断路径是否在指定目录内
   * @param {string} p
   * @param {string} dir
   * @returns {boolean}
   */
  function isPathInsideDirectory (p, dir) {
    try {
      const fp = path.resolve(p)
      const dp = path.resolve(dir) + path.sep
      return fp.toLowerCase().startsWith(dp.toLowerCase())
    } catch {
      return false
    }
  }

  /**
   * 尝试删除文件（忽略错误）
   * @param {string} p
   */
  function tryDeleteFile (p) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch { /* 忽略 */ }
  }

  /**
   * 尝试删除目录（忽略错误）
   * @param {string} p
   */
  function tryDeleteDirectory (p) {
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
    } catch { /* 忽略 */ }
  }

  /**
   * 尝试删除空目录（忽略错误）
   * @param {string} p
   */
  function tryDeleteEmptyDirectory (p) {
    try {
      if (fs.existsSync(p) && fs.readdirSync(p).length === 0) {
        fs.rmdirSync(p)
      }
    } catch { /* 忽略 */ }
  }

  /**
   * 获取可用归档路径（避免文件名冲突）
   * @param {string} dir
   * @param {string} fileName
   * @returns {string}
   */
  function getAvailableArchivePath (dir, fileName) {
    let candidate = path.join(dir, fileName)
    if (!fs.existsSync(candidate)) return candidate
    const ext = path.extname(fileName)
    const stem = path.basename(fileName, ext)
    for (let suffix = 2; ; suffix++) {
      candidate = path.join(dir, `${stem}-${suffix}${ext}`)
      if (!fs.existsSync(candidate)) return candidate
    }
  }

  /**
   * 判断是否应包含在备份中
   * 排除临时文件、缩略图、导出文件
   * @param {string} relativePath
   * @returns {boolean}
   */
  function shouldIncludeInBackup (relativePath) {
    const lower = relativePath.toLowerCase()
    if (lower.endsWith('.tmp')) return false
    if (lower.startsWith('quick-capture/thumbnails/')) return false
    if (lower.startsWith('quick-capture/exports/')) return false
    return true
  }

  /**
   * 检查是否有备份数据
   * @returns {boolean}
   */
  function hasBackupSourceData () {
    if (!fs.existsSync(dataDirectory)) return false
    try {
      const entries = fs.readdirSync(dataDirectory, { recursive: true })
      return entries.some(e => {
        const fullPath = path.join(dataDirectory, e)
        try { return fs.statSync(fullPath).isFile() } catch { return false }
      })
    } catch {
      return false
    }
  }

  /**
   * 递归收集目录下所有文件
   * @param {string} dir
   * @returns {Array<{absolutePath: string, relativePath: string}>}
   */
  function collectFiles (dir) {
    const results = []
    if (!fs.existsSync(dir)) return results

    function walk (currentDir, baseDir) {
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath, baseDir)
        } else if (entry.isFile()) {
          const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/')
          results.push({ absolutePath: fullPath, relativePath: rel })
        }
      }
    }

    walk(dir, dir)
    return results
  }

  /**
   * 创建归档核心逻辑
   * 1. 将数据目录快照到临时目录
   * 2. 验证快照数据
   * 3. 从快照创建 ZIP 归档（含 manifest.json）
   * @param {string} archivePath - 归档文件路径
   * @param {string} backupKind - 备份类型（automatic/manual/pre-restore）
   * @returns {void}
   */
  function createArchiveCore (archivePath, backupKind) {
    const snapshotRoot = path.join(backupSnapshotStagingDirectory, crypto.randomUUID().replace(/-/g, ''))
    const snapshotDataDirectory = path.join(snapshotRoot, 'data')

    try {
      // 创建数据快照
      createDataSnapshot(snapshotDataDirectory)
      // 验证快照数据
      validateRestoreData(snapshotDataDirectory)
      // 从快照创建归档
      createArchiveFromSnapshot(archivePath, backupKind, snapshotDataDirectory)
    } finally {
      tryDeleteDirectory(snapshotRoot)
      tryDeleteEmptyDirectory(backupSnapshotStagingDirectory)
    }
  }

  /**
   * 创建数据快照（复制到临时目录）
   * @param {string} snapshotDataDirectory - 快照目标目录
   */
  function createDataSnapshot (snapshotDataDirectory) {
    const settingsPath = path.join(dataDirectory, 'settings.json')
    if (!fs.existsSync(settingsPath)) {
      throw new Error('设置文件不可用，无法备份')
    }

    const sourceFiles = collectFiles(dataDirectory)
      .filter(f => shouldIncludeInBackup(f.relativePath))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))

    fs.mkdirSync(snapshotDataDirectory, { recursive: true })
    for (const file of sourceFiles) {
      const destPath = path.join(snapshotDataDirectory, file.relativePath.replace(/\//g, path.sep))
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      // 稳定快照复制：读取后立即写入，避免源文件变化
      const content = fs.readFileSync(file.absolutePath)
      fs.writeFileSync(destPath, content)
    }
  }

  /**
   * 从快照目录创建 ZIP 归档
   * @param {string} archivePath - 归档文件路径
   * @param {string} backupKind - 备份类型
   * @param {string} snapshotDataDirectory - 快照数据目录
   */
  function createArchiveFromSnapshot (archivePath, backupKind, snapshotDataDirectory) {
    const sourceFiles = collectFiles(snapshotDataDirectory)
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))

    const entries = []
    const fileManifest = []

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file.absolutePath)
      const sha256 = crypto.createHash('sha256').update(content).digest('hex')
      entries.push({
        relativePath: `data/${file.relativePath}`,
        content
      })
      fileManifest.push({
        path: file.relativePath,
        length: content.length,
        sha256
      })
    }

    // 备份清单
    const manifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      kind: backupKind,
      createdAtUtc: new Date().toISOString(),
      appVersion: app.getVersion(),
      sourceDataPath: dataDirectory,
      files: fileManifest
    }
    entries.push({
      relativePath: 'manifest.json',
      content: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
    })

    createZipArchive(archivePath, entries)
  }

  /**
   * 验证恢复数据目录
   * @param {string} dir - 数据目录
   */
  function validateRestoreData (dir) {
    if (!fs.existsSync(dir)) {
      throw new Error('备份数据目录不存在')
    }
    const files = collectFiles(dir)
    if (files.length === 0) {
      throw new Error('备份数据目录为空')
    }
    const settingsPath = path.join(dir, 'settings.json')
    if (!fs.existsSync(settingsPath)) {
      throw new Error('备份缺少 settings.json')
    }
    // 验证 settings.json 可解析
    try {
      const json = fs.readFileSync(settingsPath, 'utf8')
      JSON.parse(json)
    } catch (e) {
      throw new Error(`settings.json 无效: ${e.message}`)
    }
  }

  /**
   * 验证完整性清单
   * @param {Array} expectedFiles - 预期文件清单
   * @param {Map} extractedFiles - 实际提取的文件
   */
  function validateIntegrityManifest (expectedFiles, extractedFiles) {
    if (!expectedFiles || expectedFiles.length === 0) {
      throw new Error('备份完整性清单缺失或为空')
    }

    const expectedByPath = new Map()
    for (const expected of expectedFiles) {
      if (!expected || !expected.path || expected.path.includes('\\') ||
        expected.path.startsWith('/') || expected.path.split('/').some(s => s === '' || s === '.' || s === '..')) {
        throw new Error('备份完整性清单包含无效路径')
      }
      if (expected.length < 0 || !expected.sha256 || expected.sha256.length !== 64) {
        throw new Error(`备份完整性条目无效: ${expected.path}`)
      }
      const key = expected.path.toLowerCase()
      if (expectedByPath.has(key)) {
        throw new Error('备份完整性清单包含重复路径')
      }
      expectedByPath.set(key, expected)
    }

    if (expectedByPath.size !== extractedFiles.size) {
      throw new Error('备份文件列表与完整性清单不匹配')
    }

    for (const [relPath, actual] of extractedFiles) {
      const expected = expectedByPath.get(relPath.toLowerCase())
      if (!expected || expected.length !== actual.length ||
        expected.sha256.toLowerCase() !== actual.sha256.toLowerCase()) {
        throw new Error(`备份完整性验证失败: ${relPath}`)
      }
    }
  }

  /**
   * 判断备份是否来自更新的应用版本
   * @param {string} backupVersion
   * @returns {boolean}
   */
  function isBackupFromNewerApp (backupVersion) {
    const currentVersion = app.getVersion()
    return compareVersions(backupVersion, currentVersion) > 0
  }

  /**
   * 提取并验证恢复归档
   * @param {string} archivePath - 归档路径
   * @param {string} stagingRoot - 暂存根目录
   * @returns {{manifest: object, fileCount: number, totalUncompressedBytes: number}}
   */
  function extractAndValidateRestoreArchive (archivePath, stagingRoot) {
    const entries = extractZipArchive(archivePath)

    // 查找 manifest.json
    const manifestEntry = entries.find(e => e.relativePath === 'manifest.json')
    if (!manifestEntry) {
      throw new Error('备份清单缺失')
    }
    if (manifestEntry.content.length > 1024 * 1024) {
      throw new Error('备份清单过大')
    }

    let manifest
    try {
      manifest = JSON.parse(manifestEntry.content.toString('utf8'))
    } catch {
      throw new Error('备份清单无效')
    }

    if (manifest.schemaVersion < MIN_SUPPORTED_BACKUP_SCHEMA_VERSION ||
      manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
      throw new Error(`不支持的备份架构版本 ${manifest.schemaVersion}`)
    }

    if (isBackupFromNewerApp(manifest.appVersion)) {
      throw new Error(`此备份由更新的应用版本 ${manifest.appVersion} 创建`)
    }

    const stagedDataDirectory = path.join(stagingRoot, 'data')
    fs.mkdirSync(stagedDataDirectory, { recursive: true })

    const extractedFiles = new Map()
    let fileCount = 0
    let totalUncompressedBytes = 0

    for (const entry of entries) {
      if (entry.relativePath === 'manifest.json') continue

      // 验证条目路径
      if (entry.relativePath.includes('\\') ||
        (!entry.relativePath.startsWith('data/') && entry.relativePath !== 'data')) {
        throw new Error(`意外的备份条目: ${entry.relativePath}`)
      }

      // 跳过目录条目
      if (entry.relativePath.endsWith('/')) continue
      if (entry.relativePath === 'data') {
        throw new Error('备份数据根条目必须是目录')
      }

      fileCount++
      if (fileCount > MAX_RESTORE_FILE_COUNT || entry.content.length > MAX_RESTORE_FILE_SIZE_BYTES) {
        throw new Error('备份包含过多文件或超大文件')
      }
      totalUncompressedBytes += entry.content.length
      if (totalUncompressedBytes > MAX_RESTORE_TOTAL_SIZE_BYTES) {
        throw new Error('展开后的备份过大')
      }

      const relativePath = entry.relativePath.slice('data/'.length)
      const destPath = path.join(stagedDataDirectory, relativePath.replace(/\//g, path.sep))

      // 路径安全检查
      if (!isPathInsideDirectory(destPath, stagedDataDirectory)) {
        throw new Error(`不安全的备份条目: ${entry.relativePath}`)
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.writeFileSync(destPath, entry.content)

      const sha256 = crypto.createHash('sha256').update(entry.content).digest('hex')
      extractedFiles.set(relativePath, { length: entry.content.length, sha256 })
    }

    if (fileCount === 0) {
      throw new Error('备份不包含任何数据文件')
    }

    // Schema v2+ 验证完整性清单
    if (manifest.schemaVersion >= 2) {
      validateIntegrityManifest(manifest.files, extractedFiles)
    }

    validateRestoreData(stagedDataDirectory)
    return { manifest, fileCount, totalUncompressedBytes }
  }

  /**
   * 删除待恢复标记和暂存目录
   */
  function deletePendingRestoreCore () {
    if (fs.existsSync(pendingRestoreMarkerPath)) {
      try {
        const json = fs.readFileSync(pendingRestoreMarkerPath, 'utf8')
        const marker = JSON.parse(json)
        if (marker && marker.stagingRoot && isPathInsideDirectory(marker.stagingRoot, restoreStagingDirectory)) {
          tryDeleteDirectory(marker.stagingRoot)
        }
      } catch (e) {
        logger.warn('DataBackup', `取消待恢复时读取标记失败: ${e.message}`)
      }
    }
    tryDeleteFile(pendingRestoreMarkerPath)
    tryDeleteDirectory(restoreStagingDirectory)
  }

  /**
   * 原子写入 JSON 文件
   * @param {string} p - 文件路径
   * @param {object} value - JSON 值
   */
  function writeJsonAtomically (p, value) {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const tmpPath = `${p}.${crypto.randomUUID().replace(/-/g, '')}.tmp`
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8')
      fs.renameSync(tmpPath, p)
    } finally {
      tryDeleteFile(tmpPath)
    }
  }

  /**
   * 清理过多的自动快照
   */
  function pruneAutomaticSnapshots () {
    if (!fs.existsSync(automaticSnapshotDirectory)) return
    const files = fs.readdirSync(automaticSnapshotDirectory)
      .filter(f => f.startsWith('StarstDesk-Auto-') && f.endsWith('.zip'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(automaticSnapshotDirectory, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime)

    for (const file of files.slice(MAX_AUTOMATIC_SNAPSHOT_COUNT)) {
      tryDeleteFile(path.join(automaticSnapshotDirectory, file.name))
    }
  }

  /**
   * 清理过多的恢复前备份
   */
  function prunePreRestoreBackups () {
    if (!fs.existsSync(preRestoreBackupDirectory)) return
    const files = fs.readdirSync(preRestoreBackupDirectory)
      .filter(f => f.startsWith('StarstDesk-PreRestore-') && f.endsWith('.zip'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(preRestoreBackupDirectory, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime)

    for (const file of files.slice(MAX_PRE_RESTORE_BACKUP_COUNT)) {
      tryDeleteFile(path.join(preRestoreBackupDirectory, file.name))
    }
  }

  /**
   * 读取快照清单摘要
   * @param {string} snapshotPath
   * @returns {object}
   */
  function readSnapshotManifestSummary (snapshotPath) {
    try {
      const manifestContent = readZipEntry(snapshotPath, 'manifest.json')
      if (!manifestContent || manifestContent.length > 1024 * 1024) {
        return { isReadable: false, createdAtUtc: null, appVersion: null, schemaVersion: 0 }
      }
      const manifest = JSON.parse(manifestContent.toString('utf8'))
      return {
        isReadable: true,
        createdAtUtc: manifest.createdAtUtc,
        appVersion: manifest.appVersion,
        schemaVersion: manifest.schemaVersion
      }
    } catch {
      return { isReadable: false, createdAtUtc: null, appVersion: null, schemaVersion: 0 }
    }
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 如果到期则创建自动快照
   * @returns {string|null} 快照路径，未创建返回 null
   */
  function createAutomaticSnapshotIfDue () {
    if (!acquireGate()) return null
    try {
      if (!hasBackupSourceData()) return null

      fs.mkdirSync(automaticSnapshotDirectory, { recursive: true })
      const existing = fs.readdirSync(automaticSnapshotDirectory)
        .filter(f => f.startsWith('StarstDesk-Auto-') && f.endsWith('.zip'))
        .map(f => ({
          name: f,
          mtime: fs.statSync(path.join(automaticSnapshotDirectory, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime)

      if (existing.length > 0) {
        const latest = existing[0]
        const now = Date.now()
        if (now - latest.mtime < AUTOMATIC_SNAPSHOT_INTERVAL_MS) {
          return null // 未到期
        }
      }

      const now = new Date()
      const fileName = `StarstDesk-Auto-${formatTimestamp(now)}.zip`
      const snapshotPath = getAvailableArchivePath(automaticSnapshotDirectory, fileName)
      createArchiveCore(snapshotPath, 'automatic')
      pruneAutomaticSnapshots()
      logger.info('DataBackup', `已创建自动快照: ${snapshotPath}`)
      return snapshotPath
    } catch (e) {
      logger.warn('DataBackup', `自动快照失败: ${e.message}`)
      return null
    } finally {
      releaseGate()
    }
  }

  /**
   * 立即创建自动快照（忽略到期检查）
   * @returns {string|null} 快照路径
   */
  function createAutomaticSnapshotNow () {
    if (!acquireGate()) return null
    try {
      if (!hasBackupSourceData()) return null

      fs.mkdirSync(automaticSnapshotDirectory, { recursive: true })
      const now = new Date()
      const fileName = `StarstDesk-Auto-${formatTimestamp(now)}.zip`
      const snapshotPath = getAvailableArchivePath(automaticSnapshotDirectory, fileName)
      createArchiveCore(snapshotPath, 'automatic')
      pruneAutomaticSnapshots()
      logger.info('DataBackup', `已创建自动快照: ${snapshotPath}`)
      return snapshotPath
    } catch (e) {
      logger.warn('DataBackup', `自动快照失败: ${e.message}`)
      return null
    } finally {
      releaseGate()
    }
  }

  /**
   * 导出备份到指定目录
   * @param {string} destinationDirectory - 目标目录
   * @returns {string} 备份文件路径
   */
  function exportBackup (destinationDirectory) {
    if (!destinationDirectory) throw new Error('目标目录不能为空')
    const destDir = path.resolve(destinationDirectory)

    if (!acquireGate()) throw new Error('备份操作正在进行中')
    try {
      if (!hasBackupSourceData()) {
        throw new Error('数据目录为空，无法备份')
      }

      fs.mkdirSync(destDir, { recursive: true })
      const now = new Date()
      const fileName = `StarstDesk-Backup-${formatTimestamp(now)}.zip`
      const backupPath = getAvailableArchivePath(destDir, fileName)
      createArchiveCore(backupPath, 'manual')
      logger.info('DataBackup', `已导出备份: ${backupPath}`)
      return backupPath
    } finally {
      releaseGate()
    }
  }

  /**
   * 准备恢复（解压并验证，但不实际应用）
   * @param {string} archivePath - 归档文件路径
   * @returns {object} 恢复准备信息
   */
  function prepareRestore (archivePath) {
    if (!archivePath) throw new Error('归档路径不能为空')
    const resolvedArchivePath = path.resolve(archivePath)
    if (!fs.existsSync(resolvedArchivePath)) {
      throw new Error('所选备份文件不存在')
    }

    if (!acquireGate()) throw new Error('备份操作正在进行中')
    let stagingRoot = null
    try {
      deletePendingRestoreCore()
      stagingRoot = path.join(restoreStagingDirectory, crypto.randomUUID().replace(/-/g, ''))
      fs.mkdirSync(stagingRoot, { recursive: true })

      const archiveInfo = extractAndValidateRestoreArchive(resolvedArchivePath, stagingRoot)

      const marker = {
        stagingRoot,
        archivePath: resolvedArchivePath,
        preparedAtUtc: new Date().toISOString(),
        backupCreatedAtUtc: archiveInfo.manifest.createdAtUtc,
        appVersion: archiveInfo.manifest.appVersion
      }
      writeJsonAtomically(pendingRestoreMarkerPath, marker)
      logger.info('DataBackup', `已准备恢复: ${resolvedArchivePath}`)

      return {
        backupCreatedAtUtc: archiveInfo.manifest.createdAtUtc,
        appVersion: archiveInfo.manifest.appVersion,
        fileCount: archiveInfo.fileCount,
        totalUncompressedBytes: archiveInfo.totalUncompressedBytes,
        backupSchemaVersion: archiveInfo.manifest.schemaVersion,
        hasIntegrityManifest: archiveInfo.manifest.schemaVersion >= 2
      }
    } catch (e) {
      if (stagingRoot) tryDeleteDirectory(stagingRoot)
      throw e
    } finally {
      releaseGate()
    }
  }

  /**
   * 取消待恢复
   */
  function cancelPendingRestore () {
    if (!acquireGate()) return
    try {
      deletePendingRestoreCore()
    } finally {
      releaseGate()
    }
  }

  /**
   * 应用待恢复（实际替换数据目录）
   * @returns {object} {hadPendingRestore, succeeded, errorMessage}
   */
  function applyPendingRestore () {
    if (!acquireGate()) return { hadPendingRestore: false, succeeded: false, errorMessage: '备份操作正在进行中' }
    let rollbackRoot = null
    try {
      if (!fs.existsSync(pendingRestoreMarkerPath)) {
        return { hadPendingRestore: false, succeeded: true, errorMessage: null }
      }

      const marker = JSON.parse(fs.readFileSync(pendingRestoreMarkerPath, 'utf8'))
      const stagingRoot = path.resolve(marker.stagingRoot)
      if (!isPathInsideDirectory(stagingRoot, restoreStagingDirectory)) {
        throw new Error('待恢复暂存路径无效')
      }

      const stagedDataDirectory = path.join(stagingRoot, 'data')
      validateRestoreData(stagedDataDirectory)

      // 恢复前备份当前数据
      if (hasBackupSourceData()) {
        fs.mkdirSync(preRestoreBackupDirectory, { recursive: true })
        const now = new Date()
        const fileName = `StarstDesk-PreRestore-${formatTimestamp(now)}.zip`
        const preRestorePath = getAvailableArchivePath(preRestoreBackupDirectory, fileName)
        createArchiveCore(preRestorePath, 'pre-restore')
        prunePreRestoreBackups()
        logger.info('DataBackup', `已创建恢复前备份: ${preRestorePath}`)
      }

      // 回滚目录
      rollbackRoot = path.join(rootPath, 'restore-rollback', crypto.randomUUID().replace(/-/g, ''))
      const rollbackDataDirectory = path.join(rollbackRoot, 'data')
      fs.mkdirSync(rollbackRoot, { recursive: true })

      // 移动当前数据到回滚目录
      if (fs.existsSync(dataDirectory)) {
        fs.renameSync(dataDirectory, rollbackDataDirectory)
      }

      try {
        // 移动暂存数据到数据目录
        fs.renameSync(stagedDataDirectory, dataDirectory)
      } catch (e) {
        // 恢复失败，尝试回滚
        if (!fs.existsSync(dataDirectory) && fs.existsSync(rollbackDataDirectory)) {
          fs.renameSync(rollbackDataDirectory, dataDirectory)
        }
        throw e
      }

      tryDeleteFile(pendingRestoreMarkerPath)
      tryDeleteDirectory(stagingRoot)
      tryDeleteDirectory(rollbackRoot)
      logger.info('DataBackup', `已应用待恢复: ${marker.archivePath}`)
      return { hadPendingRestore: true, succeeded: true, errorMessage: null }
    } catch (e) {
      logger.error('DataBackup', `待恢复失败: ${e.message}`)
      deletePendingRestoreCore()
      return { hadPendingRestore: true, succeeded: false, errorMessage: e.message }
    } finally {
      if (rollbackRoot && fs.existsSync(rollbackRoot) && fs.existsSync(dataDirectory)) {
        tryDeleteDirectory(rollbackRoot)
      }
      releaseGate()
    }
  }

  /**
   * 获取快照清单
   * @returns {Array} 快照信息列表
   */
  function getSnapshotInventory () {
    if (!acquireGate()) return []
    try {
      const dirs = [
        { dir: automaticSnapshotDirectory, kind: 'automatic' },
        { dir: legacyAutomaticSnapshotDirectory, kind: 'automatic' },
        { dir: preRestoreBackupDirectory, kind: 'pre-restore' }
      ]

      const allSnapshots = []
      for (const { dir, kind } of dirs) {
        if (!fs.existsSync(dir)) continue
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith('.zip')) continue
          const fullPath = path.join(dir, file)
          const stat = fs.statSync(fullPath)
          const summary = readSnapshotManifestSummary(fullPath)
          allSnapshots.push({
            path: fullPath,
            kind,
            createdAtUtc: summary.createdAtUtc || stat.mtime.toISOString(),
            sizeBytes: stat.size,
            isReadable: summary.isReadable,
            appVersion: summary.appVersion,
            schemaVersion: summary.schemaVersion,
            _mtime: stat.mtimeMs
          })
        }
      }

      return allSnapshots.sort((a, b) => b._mtime - a._mtime).map(({ _mtime, ...rest }) => rest)
    } finally {
      releaseGate()
    }
  }

  /**
   * 获取最新的恢复快照
   * @returns {object|null}
   */
  function getLatestRecoverySnapshot () {
    if (!acquireGate()) return null
    try {
      if (!fs.existsSync(automaticSnapshotDirectory)) return null

      const files = fs.readdirSync(automaticSnapshotDirectory)
        .filter(f => f.startsWith('StarstDesk-Auto-') && f.endsWith('.zip'))
        .map(f => ({
          name: f,
          mtime: fs.statSync(path.join(automaticSnapshotDirectory, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime)

      for (const file of files) {
        const fullPath = path.join(automaticSnapshotDirectory, file.name)
        const stat = fs.statSync(fullPath)
        const summary = readSnapshotManifestSummary(fullPath)
        if (!summary.isReadable) continue

        return {
          path: fullPath,
          kind: 'automatic',
          createdAtUtc: summary.createdAtUtc || stat.mtime.toISOString(),
          sizeBytes: stat.size,
          isReadable: true,
          appVersion: summary.appVersion,
          schemaVersion: summary.schemaVersion
        }
      }

      return null
    } finally {
      releaseGate()
    }
  }

  /**
   * 删除快照
   * @param {string} snapshotPath - 快照路径
   * @returns {boolean} 是否删除成功
   */
  function deleteSnapshot (snapshotPath) {
    if (!snapshotPath) throw new Error('快照路径不能为空')
    const resolved = path.resolve(snapshotPath)

    if (!resolved.toLowerCase().endsWith('.zip') ||
      (!isPathInsideDirectory(resolved, automaticSnapshotDirectory) &&
        !isPathInsideDirectory(resolved, legacyAutomaticSnapshotDirectory) &&
        !isPathInsideDirectory(resolved, preRestoreBackupDirectory))) {
      throw new Error('所选备份快照不受应用管理')
    }

    if (!acquireGate()) throw new Error('备份操作正在进行中')
    try {
      if (!fs.existsSync(resolved)) return false
      fs.unlinkSync(resolved)
      logger.info('DataBackup', `已删除快照: ${resolved}`)
      return true
    } finally {
      releaseGate()
    }
  }

  return {
    // 自动快照
    createAutomaticSnapshotIfDue,
    createAutomaticSnapshotNow,
    // 手动备份/恢复
    exportBackup,
    prepareRestore,
    cancelPendingRestore,
    applyPendingRestore,
    // 快照管理
    getSnapshotInventory,
    getLatestRecoverySnapshot,
    deleteSnapshot,
    // 目录路径（供外部使用）
    dataDirectory,
    automaticSnapshotDirectory,
    preRestoreBackupDirectory,
    recoveryDirectory
  }
}

/**
 * 格式化时间戳（yyyyMMdd-HHmmss）
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp (date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

// 数据备份服务单例
const dataBackupService = createDataBackupService(dataPathService)

module.exports = {
  // 更新检查
  checkForUpdates,
  getStatus,
  openDownloadPage,
  compareVersions,
  // 数据路径服务
  dataPathService,
  createDataPathService,
  // 托管存储路径服务
  managedStoragePathService,
  // 数据备份服务
  dataBackupService,
  createDataBackupService
}