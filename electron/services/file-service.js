// ============================================================
// 文件服务（主进程）
// 职责：文件操作、拖放处理、剪切板管理、
//       文件夹监听、Quick Look 预览、附件存储与健康检查
//   UsnJournalChangeReducer / BoundedPathChangeBuffer /
//   QuickLookPreviewService / AttachmentStorageService /
// ============================================================

const { ipcMain, shell, dialog, app } = require('electron')
const fs = require('fs').promises
const fsSync = require('fs')
const path = require('path')
const os = require('os')
const net = require('net')
const { exec, execSync } = require('child_process')
const { EventEmitter } = require('events')
const crypto = require('crypto')

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取文件类型
 * @param {string} filePath
 * @returns {string}
 */
function getFileType (filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const typeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.py': 'text/x-python',
    '.json': 'application/json',
    '.xml': 'text/xml',
    '.html': 'text/html',
    '.css': 'text/css',
    '.exe': 'application/x-msdownload',
    '.lnk': 'application/x-ms-shortcut'
  }
  return typeMap[ext] || 'application/octet-stream'
}

/**
 * 格式化文件大小
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize (bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 格式化日期
 * @param {string|Date} date
 * @returns {string}
 */
function formatDate (date) {
  if (!date) return ''
  const d = new Date(date)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// ============================================================
// IPC 处理器
// ============================================================

/**
 * 注册文件服务相关的 IPC 通道
 */
function registerFileChannels () {
  // 列出文件夹内容
  ipcMain.handle('file:listFiles', async (event, folderPath) => {
    try {
      const stats = await fs.stat(folderPath)
      if (!stats.isDirectory()) {
        throw new Error('路径不是文件夹')
      }

      const entries = await fs.readdir(folderPath, { withFileTypes: true })
      const files = []

      for (const entry of entries) {
        const fullPath = path.join(folderPath, entry.name)
        try {
          const stat = await fs.stat(fullPath)
          files.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: stat.size,
            sizeFormatted: entry.isDirectory() ? '' : formatFileSize(stat.size),
            type: entry.isDirectory() ? 'Folder' : getFileType(fullPath),
            dateCreated: stat.birthtime,
            dateModified: stat.mtime,
            dateFormatted: formatDate(stat.mtime)
          })
        } catch (err) {
          // 跳过无法访问的文件
          console.warn(`[FileService] 无法访问文件: ${fullPath}`, err.message)
        }
      }

      // 文件夹排在前面
      files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })

      return files
    } catch (err) {
      console.error('[FileService] listFiles 失败:', err.message)
      throw err
    }
  })

  // 获取文件详情
  ipcMain.handle('file:getFileInfo', async (event, filePath) => {
    try {
      const stat = await fs.stat(filePath)
      return {
        name: path.basename(filePath),
        path: filePath,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        sizeFormatted: formatFileSize(stat.size),
        type: getFileType(filePath),
        dateCreated: stat.birthtime,
        dateModified: stat.mtime,
        dateFormatted: formatDate(stat.mtime)
      }
    } catch (err) {
      console.error('[FileService] getFileInfo 失败:', err.message)
      throw err
    }
  })

  // 复制文件
  ipcMain.handle('file:copyItems', async (event, items, destPath) => {
    try {
      const dest = destPath || event.sender.getOwnerBrowserWindow()?.getLastFocusedFileInfo()?.path
      if (!dest) throw new Error('目标路径未指定')

      await fs.mkdir(dest, { recursive: true })

      for (const item of items) {
        const itemName = path.basename(item)
        const destItem = path.join(dest, itemName)

        // 处理同名冲突
        let finalDest = destItem
        let counter = 1
        while (await fs.access(finalDest).then(() => true, () => false)) {
          const ext = path.extname(itemName)
          const base = path.basename(itemName, ext)
          finalDest = path.join(dest, `${base}_${counter}${ext}`)
          counter++
        }

        const stat = await fs.stat(item)
        if (stat.isDirectory()) {
          await copyDirectory(item, finalDest)
        } else {
          await fs.copyFile(item, finalDest)
        }
      }

      return { success: true, count: items.length }
    } catch (err) {
      console.error('[FileService] copyItems 失败:', err.message)
      throw err
    }
  })

  // 剪切文件
  ipcMain.handle('file:cutItems', async (event, items) => {
    // 剪切操作在主进程侧记录，不在这里执行移动
    // 返回剪切板信息供渲染进程使用
    return { items, operation: 'cut' }
  })

  // 移动文件
  ipcMain.handle('file:moveItems', async (event, items, destPath) => {
    try {
      const dest = destPath
      if (!dest) throw new Error('目标路径未指定')

      await fs.mkdir(dest, { recursive: true })

      for (const item of items) {
        const itemName = path.basename(item)
        const destItem = path.join(dest, itemName)

        // 处理同名冲突
        let finalDest = destItem
        let counter = 1
        while (await fs.access(finalDest).then(() => true, () => false)) {
          const ext = path.extname(itemName)
          const base = path.basename(itemName, ext)
          finalDest = path.join(dest, `${base}_${counter}${ext}`)
          counter++
        }

        await fs.rename(item, finalDest)
      }

      return { success: true, count: items.length }
    } catch (err) {
      console.error('[FileService] moveItems 失败:', err.message)
      throw err
    }
  })

  // 删除文件
  ipcMain.handle('file:deleteItems', async (event, items) => {
    try {
      for (const item of items) {
        const stat = await fs.stat(item)
        if (stat.isDirectory()) {
          await fs.rm(item, { recursive: true, force: true })
        } else {
          await fs.unlink(item)
        }
      }
      return { success: true, count: items.length }
    } catch (err) {
      console.error('[FileService] deleteItems 失败:', err.message)
      throw err
    }
  })

  // 重命名文件
  ipcMain.handle('file:renameItem', async (event, oldPath, newPath) => {
    try {
      await fs.rename(oldPath, newPath)
      return { success: true }
    } catch (err) {
      console.error('[FileService] renameItem 失败:', err.message)
      throw err
    }
  })

  // 在资源管理器中显示
  ipcMain.handle('file:revealInExplorer', async (event, filePath) => {
    try {
      shell.showItemInFolder(filePath)
      return { success: true }
    } catch (err) {
      console.error('[FileService] revealInExplorer 失败:', err.message)
      throw err
    }
  })

  // 打开文件
  ipcMain.handle('file:openFile', async (event, filePath) => {
    try {
      await shell.openPath(filePath)
      return { success: true }
    } catch (err) {
      console.error('[FileService] openFile 失败:', err.message)
      throw err
    }
  })

  // 打开文件夹
  ipcMain.handle('file:openFolder', async (event, folderPath) => {
    try {
      await shell.openPath(folderPath)
      return { success: true }
    } catch (err) {
      console.error('[FileService] openFolder 失败:', err.message)
      throw err
    }
  })

  // 从 URL 下载文件
  ipcMain.handle('file:downloadFromUrl', async (event, url, destPath) => {
    try {
      const { exec } = require('child_process')
      const dest = destPath || path.join(os.tmpdir(), path.basename(url))

      return new Promise((resolve, reject) => {
        const child = exec(`powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${dest}'"`)
        child.on('exit', (code) => {
          if (code === 0) {
            resolve({ success: true, path: dest })
          } else {
            reject(new Error('下载失败'))
          }
        })
        child.on('error', reject)
      })
    } catch (err) {
      console.error('[FileService] downloadFromUrl 失败:', err.message)
      throw err
    }
  })

  // 检查 QuickLook 是否运行
  ipcMain.handle('file:checkQuickLook', async () => {
    try {
      const { execSync } = require('child_process')
      execSync('tasklist /FI "IMAGENAME eq QuickLook.exe" /FO CSV', { encoding: 'utf8' })
      return { running: true }
    } catch {
      return { running: false }
    }
  })

  // 创建文件夹
  ipcMain.handle('file:createFolder', async (event, parentPath, folderName) => {
    try {
      const fullPath = path.join(parentPath, folderName)
      await fs.mkdir(fullPath, { recursive: true })
      return { success: true, path: fullPath }
    } catch (err) {
      console.error('[FileService] createFolder 失败:', err.message)
      throw err
    }
  })

  // 获取桌面路径
  ipcMain.handle('file:getDesktopPath', async () => {
    try {
      const desktopPath = app.getPath('desktop')
      return desktopPath
    } catch (err) {
      console.error('[FileService] getDesktopPath 失败:', err.message)
      throw err
    }
  })

  // ============================================================
  // ============================================================

  // 开始监听文件夹
  ipcMain.handle('file:watchFolder', async (event, folderPath) => {
    try {
      folderWatcher.start(folderPath)
      return { success: true, watchedPath: folderPath }
    } catch (err) {
      console.error('[FileService] watchFolder 失败:', err.message)
      throw err
    }
  })

  // 停止监听
  ipcMain.handle('file:stopWatch', async () => {
    try {
      folderWatcher.stop()
      return { success: true }
    } catch (err) {
      console.error('[FileService] stopWatch 失败:', err.message)
      throw err
    }
  })

  // 获取监听健康状态
  ipcMain.handle('file:watchHealth', async () => {
    return folderWatcher.getHealth()
  })

  // ============================================================
  // ============================================================

  // 启动全盘索引
  ipcMain.handle('file:startIndexing', async (event, options = {}) => {
    try {
      usnIndexService.startIndexing(options)
      return { success: true }
    } catch (err) {
      console.error('[FileService] startIndexing 失败:', err.message)
      throw err
    }
  })

  // 停止索引
  ipcMain.handle('file:stopIndexing', async () => {
    try {
      usnIndexService.stopIndexing()
      return { success: true }
    } catch (err) {
      console.error('[FileService] stopIndexing 失败:', err.message)
      throw err
    }
  })

  // 暂停索引
  ipcMain.handle('file:pauseIndexing', async () => {
    usnIndexService.pauseIndexing()
    return { success: true }
  })

  // 恢复索引
  ipcMain.handle('file:resumeIndexing', async () => {
    usnIndexService.resumeIndexing()
    return { success: true }
  })

  // 索引搜索
  ipcMain.handle('file:searchIndex', async (event, query, maxResults = 100) => {
    return usnIndexService.search(query, maxResults)
  })

  // 获取索引状态
  ipcMain.handle('file:indexStatus', async () => {
    return usnIndexService.getStatus()
  })

  // ============================================================
  // ============================================================

  // 检查 QuickLook 是否可预览
  ipcMain.handle('file:canPreview', async (event, filePath) => {
    return { canPreview: quickLookService.canPreview(filePath) }
  })

  // 切换预览（打开/关闭）
  ipcMain.handle('file:quickLookToggle', async (event, filePath) => {
    const ok = await quickLookService.tryToggle(filePath)
    return { success: ok }
  })

  // 切换预览目标（已打开预览窗口时切换显示项）
  ipcMain.handle('file:quickLookSwitch', async (event, filePath) => {
    const ok = await quickLookService.trySwitch(filePath)
    return { success: ok }
  })

  // 关闭预览
  ipcMain.handle('file:quickLookClose', async () => {
    const ok = await quickLookService.tryClose()
    return { success: ok }
  })

  // ============================================================
  // ============================================================

  // 导入文件作为附件（复制到托管目录或保留链接）
  ipcMain.handle('file:importAttachment', async (event, sourcePath, managedDirectory, copyToManagedStorage = true) => {
    try {
      const attachment = await attachmentStorage.importPath(sourcePath, managedDirectory, copyToManagedStorage)
      return attachment
    } catch (err) {
      console.error('[FileService] importAttachment 失败:', err.message)
      throw err
    }
  })

  // 从流保存附件
  ipcMain.handle('file:saveAttachmentStream', async (event, sourceBuffer, fileName, managedDirectory) => {
    try {
      const attachment = await attachmentStorage.saveBuffer(sourceBuffer, fileName, managedDirectory)
      return attachment
    } catch (err) {
      console.error('[FileService] saveAttachmentStream 失败:', err.message)
      throw err
    }
  })

  // 获取附件类型
  ipcMain.handle('file:getAttachmentType', async (event, filePath) => {
    return { type: attachmentStorage.getAttachmentType(filePath) }
  })

  // 删除附件
  ipcMain.handle('file:deleteAttachment', async (event, filePath) => {
    try {
      await fs.unlink(filePath)
      return { success: true }
    } catch (err) {
      console.error('[FileService] deleteAttachment 失败:', err.message)
      throw err
    }
  })

  // ============================================================
  // ============================================================

  // 扫描附件健康状态
  ipcMain.handle('file:scanAttachmentHealth', async (event, dataDirectory) => {
    try {
      const dir = dataDirectory || path.join(app.getPath('userData'), 'attachments')
      const report = await attachmentHealthService.scan(dir)
      return report
    } catch (err) {
      console.error('[FileService] scanAttachmentHealth 失败:', err.message)
      throw err
    }
  })
}

/**
 * 递归复制目录
 * @param {string} src
 * @param {string} dest
 */
async function copyDirectory (src, dest) {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

// ============================================================
// 在固定容量内合并路径到变化值的映射，溢出后丢弃单项变化，
// 调用方需执行全量对账后再视持久化状态为干净
// ============================================================

class BoundedPathChangeBuffer {
  /**
   * @param {number} capacity 最大容量
   * @param {boolean} [ignoreCase] 路径是否大小写不敏感
   */
  constructor (capacity, ignoreCase = false) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new RangeError('capacity 必须为正整数')
    }
    this._capacity = capacity
    this._entries = new Map()
    this._ignoreCase = ignoreCase
    this.isOverflowed = false
  }

  get count () { return this._entries.size }

  /**
   * 返回 entries 数组（[path, value] 对）
   * @returns {Array<[string, any]>}
   */
  get entries () { return Array.from(this._entries.entries()) }

  /**
   * 返回所有路径键
   * @returns {string[]}
   */
  get keys () { return Array.from(this._entries.keys()) }

  /**
   * 写入或更新一条路径变化
   * @param {string} path
   * @param {any} value
   * @returns {'addedOrUpdated'|'overflowed'|'ignoredAfterOverflow'}
   */
  set (keyPath, value) {
    if (!keyPath || typeof keyPath !== 'string') {
      throw new TypeError('path 不能为空')
    }
    if (this.isOverflowed) {
      return 'ignoredAfterOverflow'
    }

    const normalizedKey = this._ignoreCase ? keyPath.toLowerCase() : keyPath
    if (this._entries.size >= this._capacity && !this._entries.has(normalizedKey)) {
      this._entries.clear()
      this.isOverflowed = true
      return 'overflowed'
    }

    this._entries.set(normalizedKey, value)
    return 'addedOrUpdated'
  }

  /**
   * 重置缓冲，清除溢出标志
   */
  reset () {
    this._entries.clear()
    this.isOverflowed = false
  }
}

// ============================================================
// 维护文件引用号(FRN) → 记录的映射，支持硬链接多路径
// 此处用 ino( inode )作为 FRN 的近似，ParentFRN 用父目录 ino
// ============================================================

const USN_ROOT_FRN = 5n // NTFS 根目录固定 FRN
const USN_MAX_PENDING_RENAME = 4096

/**
 * @typedef {Object} UsnRecord
 * @property {bigint} fileReferenceNumber
 * @property {bigint} parentFileReferenceNumber
 * @property {string} name
 * @property {boolean} isDirectory
 * @property {number} timestamp
 */

class UsnJournalChangeReducer {
  /**
   * @param {string} root 根目录路径
   */
  constructor (root) {
    this._root = root.replace(/[\\/]+$/, '')
    /** @type {Map<bigint, UsnRecord>} */
    this._records = new Map()
    /** @type {Map<bigint, Map<string, UsnRecord>>} 文件硬链接：FRN → (linkKey → record) */
    this._fileLinks = new Map()
    /** @type {Map<bigint, UsnRecord>} 待处理的重命名旧记录 */
    this._pendingRenameOld = new Map()
  }

  get records () { return this._records }
  get pendingRenameCount () { return this._pendingRenameOld.size }

  /**
   * 用一组记录替换整个快照
   * @param {Iterable<UsnRecord>} records
   */
  replaceSnapshot (records) {
    this._records.clear()
    this._fileLinks.clear()
    this._pendingRenameOld.clear()
    for (const record of records) {
      if (record.isDirectory) {
        this._records.set(record.fileReferenceNumber, record)
      } else {
        this._addOrUpdateFileLink(record)
      }
    }
  }

  /**
   * 应用一组变化，返回影响汇总
   * @param {Iterable<{kind: string, record: UsnRecord, replacementLinks?: UsnRecord[]}>} changes
   * @returns {{removedPaths: string[], upsertFrns: Set<bigint>, rebuildDirectoryFrns: Set<bigint>, changed: boolean}}
   */
  apply (changes) {
    const removedPaths = new Set()
    const upsertFrns = new Set()
    const rebuildDirectoryFrns = new Set()
    let changed = false

    for (const change of changes) {
      const incoming = change.record
      const frn = incoming.fileReferenceNumber

      if (change.kind === 'renameOld') {
        if (this._pendingRenameOld.size >= USN_MAX_PENDING_RENAME) {
          this._pendingRenameOld.clear()
        }
        this._pendingRenameOld.set(frn, incoming)
        continue
      }

      if (change.kind === 'replaceHardLinks') {
        for (const p of this._resolvePaths(frn)) removedPaths.add(p)
        this._fileLinks.delete(frn)
        this._records.delete(frn)
        for (const link of (change.replacementLinks || [])) {
          if (!link.isDirectory && link.fileReferenceNumber === frn) {
            this._addOrUpdateFileLink(link)
          }
        }
        this._pendingRenameOld.delete(frn)
        upsertFrns.add(frn)
        changed = true
        continue
      }

      if (change.kind === 'delete') {
        const deletedPath = this._resolveRecordPath(incoming)
        if (deletedPath) removedPaths.add(deletedPath)

        if (incoming.isDirectory) {
          const subtree = Array.from(this._enumerateSubtreeFrns(frn))
          const removedDirs = new Set(subtree.filter(fr => {
            const r = this._records.get(fr)
            return r && r.isDirectory
          }))
          for (const descendant of subtree) {
            const item = this._records.get(descendant)
            if (item && item.isDirectory) {
              this._records.delete(descendant)
            } else if (this._fileLinks.has(descendant)) {
              const links = this._fileLinks.get(descendant)
              for (const key of Array.from(links.keys())) {
                const link = links.get(key)
                if (removedDirs.has(link.parentFileReferenceNumber)) {
                  links.delete(key)
                }
              }
              if (links.size === 0) {
                this._fileLinks.delete(descendant)
                this._records.delete(descendant)
              } else {
                this._records.set(descendant, links.values().next().value)
              }
            }
            this._pendingRenameOld.delete(descendant)
          }
        } else {
          this._removeFileLink(incoming)
          this._pendingRenameOld.delete(frn)
        }
        changed = true
        continue
      }

      // upsert / renameNew
      let explicitOld = null
      if (change.kind === 'renameNew' && this._pendingRenameOld.has(frn)) {
        explicitOld = this._pendingRenameOld.get(frn)
        this._pendingRenameOld.delete(frn)
      } else if (change.kind !== 'renameNew') {
        this._pendingRenameOld.delete(frn)
      }

      if (explicitOld) {
        const oldPath = this._resolveRecordPath(explicitOld)
        if (oldPath) removedPaths.add(oldPath)
        if (!explicitOld.isDirectory) {
          this._removeFileLink(explicitOld)
        }
      }

      if (incoming.isDirectory) {
        if (this._records.has(frn) && !explicitOld) {
          const oldDir = this._records.get(frn)
          const oldPath = this._resolveRecordPath(oldDir)
          if (oldPath) removedPaths.add(oldPath)
        }
        this._records.set(frn, incoming)
        rebuildDirectoryFrns.add(frn)
      } else {
        this._updateFileMetadataAndLink(incoming)
        upsertFrns.add(frn)
      }
      changed = true
    }

    return {
      removedPaths: Array.from(removedPaths),
      upsertFrns,
      rebuildDirectoryFrns,
      changed
    }
  }

  /**
   * 解析 FRN 到单一路径（取首个链接）
   * @param {bigint} frn
   * @returns {string|null}
   */
  resolvePath (frn) {
    if (frn === USN_ROOT_FRN) return this._root
    const record = this._records.get(frn)
    return record ? this._resolveRecordPath(record) : null
  }

  /**
   * 解析 FRN 到所有硬链接路径
   * @param {bigint} frn
   * @returns {string[]}
   */
  resolvePaths (frn) {
    return Array.from(this._resolvePaths(frn))
  }

  *_resolvePaths (frn) {
    if (this._fileLinks.has(frn)) {
      for (const link of this._fileLinks.get(frn).values()) {
        const p = this._resolveRecordPath(link)
        if (p) yield p
      }
      return
    }
    const single = this.resolvePath(frn)
    if (single) yield single
  }

  /**
   * 枚举指定目录 FRN 子树的所有 FRN（BFS）
   * @param {bigint} directoryFrn
   * @returns {Iterable<bigint>}
   */
  *_enumerateSubtreeFrns (directoryFrn) {
    const children = new Map()
    for (const [frn, record] of this._records) {
      const parents = this._fileLinks.has(frn)
        ? new Set(Array.from(this._fileLinks.get(frn).values()).map(l => l.parentFileReferenceNumber))
        : new Set([record.parentFileReferenceNumber])
      for (const parentFrn of parents) {
        if (!children.has(parentFrn)) children.set(parentFrn, [])
        children.get(parentFrn).push(frn)
      }
    }
    const queue = [directoryFrn]
    const seen = new Set()
    while (queue.length > 0) {
      const current = queue.shift()
      if (seen.has(current)) continue
      seen.add(current)
      yield current
      const childFrns = children.get(current)
      if (childFrns) queue.push(...childFrns)
    }
  }

  /**
   * 构建目录路径 → FRN 映射表
   * @returns {Map<string, bigint>}
   */
  buildDirectoryPathMap () {
    const result = new Map()
    result.set(this._root.toLowerCase(), USN_ROOT_FRN)
    for (const [frn, record] of this._records) {
      if (!record.isDirectory) continue
      const p = this.resolvePath(frn)
      if (p) result.set(p.toLowerCase(), frn)
    }
    return result
  }

  _addOrUpdateFileLink (record) {
    if (!this._fileLinks.has(record.fileReferenceNumber)) {
      this._fileLinks.set(record.fileReferenceNumber, new Map())
    }
    const links = this._fileLinks.get(record.fileReferenceNumber)
    links.set(this._getLinkKey(record), record)
    this._records.set(record.fileReferenceNumber, links.values().next().value)
  }

  _updateFileMetadataAndLink (incoming) {
    if (this._fileLinks.has(incoming.fileReferenceNumber)) {
      const links = this._fileLinks.get(incoming.fileReferenceNumber)
      for (const key of Array.from(links.keys())) {
        const link = links.get(key)
        links.set(key, { ...link, timestamp: incoming.timestamp })
      }
    }
    this._addOrUpdateFileLink(incoming)
  }

  _removeFileLink (record) {
    if (!this._fileLinks.has(record.fileReferenceNumber)) return
    const links = this._fileLinks.get(record.fileReferenceNumber)
    links.delete(this._getLinkKey(record))
    if (links.size === 0) {
      this._fileLinks.delete(record.fileReferenceNumber)
      this._records.delete(record.fileReferenceNumber)
    } else {
      this._records.set(record.fileReferenceNumber, links.values().next().value)
    }
  }

  static _getLinkKey (record) {
    return `${record.parentFileReferenceNumber.toString(16)}|${record.name}`
  }

  _getLinkKey (record) {
    return UsnJournalChangeReducer._getLinkKey(record)
  }

  _resolveRecordPath (record) {
    const parentPath = this._resolveDirectoryPath(record.parentFileReferenceNumber)
    return parentPath ? parentPath + path.sep + record.name : null
  }

  _resolveDirectoryPath (frn) {
    if (frn === USN_ROOT_FRN) return this._root
    const chain = []
    const seen = new Set()
    let current = frn
    while (current !== USN_ROOT_FRN) {
      if (seen.has(current)) return null
      seen.add(current)
      const record = this._records.get(current)
      if (!record || !record.isDirectory) return null
      chain.push(record.name)
      if (record.parentFileReferenceNumber === current) break
      current = record.parentFileReferenceNumber
    }
    let p = this._root
    for (let i = chain.length - 1; i >= 0; i--) {
      p += path.sep + chain[i]
    }
    return p
  }
}

// ============================================================
// 基于 Node.js fs.watch，带防抖、有界缓冲、自动重连
// ============================================================

const WATCH_DEBOUNCE_MS = 250
const WATCH_MAX_BUFFERED_CHANGES = 64
const WATCH_MAX_RECONNECT = 8
const WATCH_RECONNECT_BASE_DELAY_MS = 2000

/**
 * 监听健康状态枚举
 * @enum {string}
 */
const FolderWatcherHealth = {
  Stopped: 'stopped',
  Watching: 'watching',
  Degraded: 'degraded',
  Unavailable: 'unavailable',
  AccessDenied: 'accessDenied'
}

class FolderWatcherService extends EventEmitter {
  constructor () {
    super()
    this._watcher = null           // fs.FSWatcher 实例
    this._desktopIniWatcher = null // desktop.ini 子监听器
    this._watchedPath = null
    this._pendingChanges = []
    this._pendingIconPaths = new Set()
    this._requiresFullReload = false
    this._watchGeneration = 0
    this._debounceTimer = null
    this._iconDebounceTimer = null
    this._reconnectTimer = null
    this._reconnectAttempt = 0
    this._reconnectCount = 0
    this._reconnectPath = null
    this._isDisposed = false
    this._lastEventAt = null
    this._health = FolderWatcherHealth.Stopped
    this._lastError = null
  }

  /**
   * 当前监听路径
   * @returns {string|null}
   */
  get watchedPath () { return this._watchedPath }

  get isWatching () { return this._watcher !== null }

  get reconnectCount () { return this._reconnectCount }

  get lastEventAt () { return this._lastEventAt }

  /**
   * 获取健康状态快照
   * @returns {object}
   */
  getHealth () {
    return {
      watchedPath: this._watchedPath,
      status: this._health,
      nativeWatcherActive: this._watcher !== null,
      desktopIniWatcherActive: this._desktopIniWatcher !== null,
      reconnectPending: !!this._reconnectPath,
      reconnectCount: this._reconnectCount,
      lastEventAt: this._lastEventAt,
      lastError: this._lastError
    }
  }

  /**
   * 探测文件夹可访问性
   * @param {string} folderPath
   * @returns {Promise<string>} FolderWatcherHealth
   */
  async _probeAccess (folderPath) {
    return new Promise((resolve) => {
      fsSync.access(folderPath, fsSync.constants.R_OK, (err) => {
        if (!err) {
          fsSync.stat(folderPath, (statErr, stats) => {
            if (statErr) return resolve(FolderWatcherHealth.Unavailable)
            resolve(stats.isDirectory() ? FolderWatcherHealth.Watching : FolderWatcherHealth.Unavailable)
          })
        } else if (err.code === 'EACCES' || err.code === 'EPERM') {
          resolve(FolderWatcherHealth.AccessDenied)
        } else {
          resolve(FolderWatcherHealth.Unavailable)
        }
      })
    })
  }

  /**
   * 开始监听文件夹
   * @param {string} folderPath
   */
  async start (folderPath) {
    if (this._isDisposed) return
    this.stop()
    this._lastError = null
    const startGeneration = this._watchGeneration

    const availability = await this._probeAccess(folderPath)
    if (this._isDisposed || startGeneration !== this._watchGeneration) return

    if (availability !== FolderWatcherHealth.Watching) {
      this._health = availability
      this._beginReconnect(folderPath, true)
      console.warn(`[FolderWatcher] 文件夹不可用，已调度重连: ${folderPath}`)
      return
    }

    this._watchedPath = folderPath
    const generation = this._watchGeneration

    this._startDesktopIniWatcher(folderPath)
    const nativeStarted = this._tryStartNativeWatcher(folderPath, generation)
    if (!nativeStarted) {
      this._health = (availability === FolderWatcherHealth.AccessDenied)
        ? FolderWatcherHealth.AccessDenied
        : FolderWatcherHealth.Unavailable
      this._beginReconnect(folderPath)
    } else {
      this._health = FolderWatcherHealth.Watching
      this._reconnectPath = null
      this._reconnectAttempt = 0
    }
  }

  /**
   * 尝试启动原生 fs.watch 监听
   * @param {string} folderPath
   * @param {number} generation
   * @returns {boolean}
   */
  _tryStartNativeWatcher (folderPath, generation) {
    try {
      this._watcher = fsSync.watch(folderPath, { recursive: false }, (eventType, filename) => {
        if (this._watchGeneration !== generation || !this._watchedPath) return
        this._lastEventAt = new Date().toISOString()
        if (!filename) {
          this._queueFullReload(generation)
          return
        }
        const fullPath = path.join(folderPath, filename)
        // eventType 在 Node 中只有 'rename' 和 'change' 两种
        const changeType = eventType === 'rename' ? 'rename' : 'change'
        this._queueChange({ fullPath, changeType }, generation)
      })
      this._watcher.on('error', (err) => this._onWatcherError(err, generation))
      return true
    } catch (err) {
      this._lastError = err.message
      console.error(`[FolderWatcher] 启动原生监听失败: ${folderPath} - ${err.message}`)
      this._stopNativeWatcher()
      return false
    }
  }

  /**
   * 启动 desktop.ini 子监听器（递归），用于检测子文件夹图标自定义
   * @param {string} folderPath
   */
  _startDesktopIniWatcher (folderPath) {
    try {
      this._desktopIniWatcher = fsSync.watch(folderPath, { recursive: true }, (eventType, filename) => {
        if (!this._watchedPath || !filename) return
        const baseName = path.basename(filename)
        if (baseName.toLowerCase() !== 'desktop.ini') return

        this._lastEventAt = new Date().toISOString()
        const fullPath = path.join(folderPath, filename)
        const childDir = path.dirname(fullPath)
        const parent = path.dirname(childDir)
        if (path.relative(parent, this._watchedPath) !== '') return

        this._pendingIconPaths.add(childDir)
        this._restartIconDebounce()
      })
      this._desktopIniWatcher.on('error', (err) => {
        this._lastError = err.message
        this._health = FolderWatcherHealth.Degraded
        console.warn(`[FolderWatcher] desktop.ini 监听错误: ${err.message}`)
      })
    } catch (err) {
      this._lastError = err.message
      this._desktopIniWatcher = null
    }
  }

  /**
   * 停止原生监听器
   */
  _stopNativeWatcher () {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
  }

  /**
   * 停止 desktop.ini 监听器
   */
  _stopDesktopIniWatcher () {
    if (this._desktopIniWatcher) {
      this._desktopIniWatcher.close()
      this._desktopIniWatcher = null
    }
  }

  /**
   * 停止所有监听
   */
  stop () {
    this._clearDebounce()
    this._clearIconDebounce()
    this._clearReconnect()

    this._watchGeneration++
    this._pendingChanges = []
    this._pendingIconPaths = new Set()
    this._requiresFullReload = false
    this._reconnectPath = null
    this._reconnectAttempt = 0

    this._stopDesktopIniWatcher()
    this._stopNativeWatcher()
    this._watchedPath = null
    this._health = FolderWatcherHealth.Stopped
  }

  /**
   * 销毁实例
   */
  dispose () {
    if (this._isDisposed) return
    this._isDisposed = true
    this.stop()
  }

  /**
   * 入队一条变化
   * @param {{fullPath: string, changeType: string, oldFullPath?: string}} change
   * @param {number} generation
   */
  _queueChange (change, generation) {
    if (!this._watchedPath || generation !== this._watchGeneration) return
    this._pendingChanges.push(change)
    if (this._pendingChanges.length > WATCH_MAX_BUFFERED_CHANGES) {
      this._requiresFullReload = true
    }
    this._restartDebounce()
  }

  /**
   * 入队全量重载
   * @param {number} [generation]
   */
  _queueFullReload (generation) {
    const effectiveGen = generation != null ? generation : this._watchGeneration
    if (!this._watchedPath || effectiveGen !== this._watchGeneration) return
    this._requiresFullReload = true
    this._restartDebounce()
  }

  _restartDebounce () {
    this._clearDebounce()
    this._debounceTimer = setTimeout(() => this._onDebounceTick(), WATCH_DEBOUNCE_MS)
  }

  _clearDebounce () {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer)
      this._debounceTimer = null
    }
  }

  _restartIconDebounce () {
    this._clearIconDebounce()
    this._iconDebounceTimer = setTimeout(() => this._onIconDebounceTick(), WATCH_DEBOUNCE_MS)
  }

  _clearIconDebounce () {
    if (this._iconDebounceTimer) {
      clearTimeout(this._iconDebounceTimer)
      this._iconDebounceTimer = null
    }
  }

  _onDebounceTick () {
    if (!this._watchedPath) return
    const batch = {
      watchedPath: this._watchedPath,
      changes: this._pendingChanges.slice(),
      requiresFullReload: this._requiresFullReload,
      generation: this._watchGeneration
    }
    this._pendingChanges = []
    this._requiresFullReload = false

    if (batch.changes.length === 0 && !batch.requiresFullReload) return
    this.emit('changed', batch)
  }

  _onIconDebounceTick () {
    if (!this._watchedPath) return
    const iconPaths = Array.from(this._pendingIconPaths)
    this._pendingIconPaths = new Set()
    for (const p of iconPaths) this.emit('iconChanged', p)
  }

  /**
   * 处理原生监听错误
   * @param {Error} err
   * @param {number} generation
   */
  _onWatcherError (err, generation) {
    if (this._watchGeneration !== generation) return
    this._lastError = err.message
    this._health = FolderWatcherHealth.Degraded
    console.error(`[FolderWatcher] 监听错误: ${err.message}`)
    this._queueFullReload(generation)
    if (this._watchedPath) this._beginReconnect(this._watchedPath)
  }

  /**
   * 开始重连流程
   * @param {string} folderPath
   * @param {boolean} [resetAttempt]
   */
  _beginReconnect (folderPath, resetAttempt = false) {
    if (this._isDisposed || !folderPath) return
    this._watchedPath = folderPath
    this._reconnectPath = folderPath
    if (resetAttempt) this._reconnectAttempt = 0
    this._scheduleReconnect()
  }

  _scheduleReconnect () {
    if (this._isDisposed || !this._reconnectPath) return
    this._reconnectAttempt = Math.min(WATCH_MAX_RECONNECT, this._reconnectAttempt + 1)
    const attempt = this._reconnectAttempt
    this._clearReconnect()
    const delayMs = Math.min(30000, WATCH_RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1))
    this._reconnectTimer = setTimeout(() => this._onReconnectTick(), delayMs)
  }

  _clearReconnect () {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
  }

  async _onReconnectTick () {
    const folderPath = this._reconnectPath
    if (this._isDisposed || !folderPath) return

    const availability = await this._probeAccess(folderPath)
    if (availability !== FolderWatcherHealth.Watching) {
      this._health = availability
      this._scheduleReconnect()
      return
    }

    this._reconnectCount++
    await this.start(folderPath)
    if (!this._isDisposed && this.isWatching) {
      this._queueFullReload()
      console.log(`[FolderWatcher] 已重连: ${folderPath}`)
    }
  }
}

// ============================================================
// 原版基于 NTFS USN Change Journal，需要管理员权限。
// 此处改用 Node.js fs.readdir 递归扫描 + fs.watch 增量同步，
// 提供与原版一致的搜索/暂停/恢复/状态接口
// ============================================================

const USN_MAX_INDEX_ENTRIES = 500000
const USN_SYSTEM_DIR_NAMES = new Set([
  'Windows', 'ProgramData', 'Program Files', 'Program Files (x86)',
  '$Recycle.Bin', 'System Volume Information', 'Recovery', 'PerfLogs',
  'Config.Msi', 'MSOCache', 'WinSxS', 'servicing', 'assembly', 'Intel', 'AMD',
  'node_modules', '.git', '.svn', '__pycache__'
])

/**
 * @param {string} fileName
 * @param {string} query
 * @returns {number}
 */
function computeRelevance (fileName, query) {
  if (!fileName || !query) return 0
  const lowerName = fileName.toLowerCase()
  const lowerQuery = query.toLowerCase()
  if (lowerName === lowerQuery) return 100
  if (lowerName.startsWith(lowerQuery)) return 80
  if (lowerName.includes(lowerQuery)) return 60
  // 子串匹配评分
  let score = 0
  for (const ch of lowerQuery) {
    if (lowerName.includes(ch)) score += 1
  }
  return score / lowerQuery.length * 30
}

class UsnJournalIndexService extends EventEmitter {
  constructor () {
    super()
    this._index = new Map()       // fullPath → entry
    this._reducers = new Map()    // root → UsnJournalChangeReducer
    this._isScanning = false
    this._isPaused = false
    this._isAvailable = false
    this._indexingEnabled = false
    this._scanAbort = null
    this._isDisposed = false
    this._entryCount = 0
    this._volumes = []            // 当前正在扫描的根目录列表
  }

  get isAvailable () { return this._isAvailable }
  get isScanning () { return this._isScanning }
  get isPaused () { return this._isPaused }
  get entryCount () { return this._entryCount }

  /**
   * 获取索引状态
   * @returns {object}
   */
  getStatus () {
    return {
      isAvailable: this._isAvailable,
      isScanning: this._isScanning,
      isPaused: this._isPaused,
      entryCount: this._entryCount,
      volumes: this._volumes.slice()
    }
  }

  /**
   * 启动索引
   * @param {object} [options] - { roots?: string[] } 默认扫描用户主目录
   */
  startIndexing (options = {}) {
    if (this._isDisposed || this._indexingEnabled) return
    this._indexingEnabled = true
    this._isPaused = false
    const roots = options.roots && options.roots.length > 0
      ? options.roots
      : [os.homedir()]
    this._volumes = roots.slice()
    this._scanAsync(roots).catch(err => {
      console.error('[UsnIndex] 扫描失败:', err.message)
    })
  }

  /**
   * 停止索引
   */
  stopIndexing () {
    this._indexingEnabled = false
    if (this._scanAbort) this._scanAbort.aborted = true
    this._index.clear()
    this._reducers.clear()
    this._isAvailable = false
    this._isScanning = false
    this._isPaused = false
    this._entryCount = 0
    this._volumes = []
    this.emit('indexUpdated')
  }

  pauseIndexing () {
    if (this._indexingEnabled && !this._isPaused) {
      this._isPaused = true
    }
  }

  resumeIndexing () {
    if (this._isPaused) this._isPaused = false
  }

  /**
   * 异步扫描多个根目录
   * @param {string[]} roots
   */
  async _scanAsync (roots) {
    this._isScanning = true
    this._scanAbort = { aborted: false }
    const abort = this._scanAbort

    for (const root of roots) {
      if (abort.aborted || !this._indexingEnabled) break
      const reducer = new UsnJournalChangeReducer(root)
      this._reducers.set(root, reducer)
      await this._scanDirectory(root, root, abort, reducer)
    }

    if (!abort.aborted) {
      this._isAvailable = true
    }
    this._isScanning = false
    this._entryCount = this._index.size
    this.emit('indexUpdated')
  }

  /**
   * 递归扫描目录
   * @param {string} root 根目录
   * @param {string} current 当前目录
   * @param {{aborted: boolean}} abort
   * @param {UsnJournalChangeReducer} reducer
   */
  async _scanDirectory (root, current, abort, reducer) {
    if (abort.aborted || !this._indexingEnabled || this._isPaused) return
    if (this._index.size >= USN_MAX_INDEX_ENTRIES) return

    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (err) {
      return // 跳过无权限目录
    }

    for (const entry of entries) {
      if (abort.aborted) return
      if (this._index.size >= USN_MAX_INDEX_ENTRIES) return

      // 跳过系统目录（仅对根目录的第一层生效）
      if (current === root && USN_SYSTEM_DIR_NAMES.has(entry.name)) continue
      // 跳过隐藏文件
      if (entry.name.startsWith('.') && entry.name !== '.vscode') continue

      const fullPath = path.join(current, entry.name)
      const isDirectory = entry.isDirectory()

      let stat
      try {
        stat = await fs.stat(fullPath)
      } catch {
        continue
      }

      const entryObj = {
        fileName: entry.name,
        directoryPath: current,
        fullPath,
        isDirectory,
        lastModified: stat.mtime
      }
      this._index.set(fullPath.toLowerCase(), entryObj)

      // 推送到 reducer
      try {
        const ino = BigInt(stat.ino || 0)
        const parentIno = BigInt(0) // 简化：不维护父 ino
        reducer.replaceSnapshot([{
          fileReferenceNumber: ino,
          parentFileReferenceNumber: parentIno,
          name: entry.name,
          isDirectory,
          timestamp: stat.mtimeMs
        }])
      } catch {
        // 忽略 reducer 错误
      }

      if (isDirectory) {
        await this._scanDirectory(root, fullPath, abort, reducer)
      }
    }
  }

  /**
   * 搜索索引
   * @param {string} query
   * @param {number} [maxResults=100]
   * @returns {Array<object>}
   */
  search (query, maxResults = 100) {
    if (!query || !query.trim() || this._index.size === 0) return []
    if (maxResults <= 0) return []

    const normalizedQuery = query.trim()
    const candidates = []

    for (const entry of this._index.values()) {
      const score = computeRelevance(entry.fileName, normalizedQuery)
      if (score <= 0) continue
      candidates.push({ entry, score })
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return new Date(b.entry.lastModified) - new Date(a.entry.lastModified)
    })

    return candidates.slice(0, maxResults).map(c => ({
      kind: c.entry.isDirectory ? 'folder' : 'file',
      title: c.entry.fileName,
      subtitle: c.entry.directoryPath,
      detailPath: c.entry.fullPath,
      modifiedAt: c.entry.lastModified,
      relevanceScore: c.score
    }))
  }

  dispose () {
    if (this._isDisposed) return
    this._isDisposed = true
    this.stopIndexing()
  }
}

// ============================================================
// 通过命名管道与 QuickLook 进程通信
// 注意：仅在用户实际触发预览时才连接管道，
//       裸连接会导致 QuickLook 服务线程崩溃
// ============================================================

const QUICKLOOK_PROCESS_NAME = 'QuickLook'
const QUICKLOOK_CONNECT_TIMEOUT_MS = 600
const QUICKLOOK_TOGGLE_MSG = 'QuickLook.App.PipeMessages.Toggle'
const QUICKLOOK_SWITCH_MSG = 'QuickLook.App.PipeMessages.Switch'
const QUICKLOOK_CLOSE_MSG = 'QuickLook.App.PipeMessages.Close'

class QuickLookPreviewService {
  constructor () {
    this._cachedPipeName = null
    this._pipeNameResolved = false
    this._integrityChecked = false
  }

  /**
   * 检查路径是否可预览（不触碰管道，仅枚举进程）
   * @param {string|null} filePath
   * @returns {boolean}
   */
  canPreview (filePath) {
    return this._isPreviewablePath(filePath) && this._isQuickLookRunning()
  }

  /**
   * 切换预览（打开/关闭）
   * @param {string} filePath
   * @returns {Promise<boolean>}
   */
  async tryToggle (filePath) {
    return this._trySend(filePath, `${QUICKLOOK_TOGGLE_MSG}|${filePath}|`, true)
  }

  /**
   * 切换预览目标
   * @param {string} filePath
   * @returns {Promise<boolean>}
   */
  async trySwitch (filePath) {
    return this._trySend(filePath, `${QUICKLOOK_SWITCH_MSG}|${filePath}|`, true)
  }

  /**
   * 关闭预览
   * @returns {Promise<boolean>}
   */
  async tryClose () {
    return this._trySend(null, `${QUICKLOOK_CLOSE_MSG}||`, false)
  }

  /**
   * 实际发送管道消息
   * @param {string|null} filePath
   * @param {string} message
   * @param {boolean} validatePath
   * @returns {Promise<boolean>}
   */
  async _trySend (filePath, message, validatePath) {
    if (validatePath && !this._isPreviewablePath(filePath)) {
      console.warn(`[QuickLook] 路径不可预览: ${filePath}`)
      return false
    }

    const pipeName = this._getPipeName()
    if (!pipeName) {
      console.warn('[QuickLook] 无法解析管道名（SID 不可用）')
      return false
    }

    return new Promise((resolve) => {
      const client = net.connect(pipeName, () => {
        client.end(message + '\n', 'utf8')
      })
      client.setTimeout(QUICKLOOK_CONNECT_TIMEOUT_MS, () => {
        client.destroy()
        resolve(false)
      })
      client.on('error', (err) => {
        console.warn(`[QuickLook] 管道发送失败: ${err.message}`)
        if (err.code === 'EACCES') this._logIntegrityHintOnce()
        resolve(false)
      })
      client.on('close', () => resolve(true))
    })
  }

  /**
   * 检查路径是否可预览（文件或目录存在）
   * @param {string|null} filePath
   * @returns {boolean}
   */
  _isPreviewablePath (filePath) {
    if (!filePath || typeof filePath !== 'string') return false
    try {
      return fsSync.existsSync(filePath)
    } catch {
      return false
    }
  }

  /**
   * 检查 QuickLook 是否正在运行（仅枚举进程，不触碰管道）
   * @returns {boolean}
   */
  _isQuickLookRunning () {
    try {
      execSync(`tasklist /FI "IMAGENAME eq ${QUICKLOOK_PROCESS_NAME}.exe" /FO CSV /NH`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * 解析 QuickLook 命名管道名（基于当前用户 SID）
   * @returns {string|null}
   */
  _getPipeName () {
    if (this._pipeNameResolved) return this._cachedPipeName
    this._pipeNameResolved = true
    try {
      // 通过 whoami 获取当前用户 SID
      const sid = execSync('whoami /user /fo csv /nh', { encoding: 'utf8' }).trim().split(',')[1]
      if (!sid) {
        this._cachedPipeName = null
        return null
      }
      // 命名管道路径
      this._cachedPipeName = `\\\\.\\pipe\\QuickLook.App.Pipe.${sid.trim()}`
    } catch {
      this._cachedPipeName = null
    }
    return this._cachedPipeName
  }

  /**
   * 一次性记录完整性提示（管理员权限不匹配）
   */
  _logIntegrityHintOnce () {
    if (this._integrityChecked) return
    this._integrityChecked = true
    console.warn('[QuickLook] 管道访问被拒，可能是完整性级别不匹配（QuickLook 以管理员运行而本应用未提升）')
  }
}

// ============================================================
// 提供文件导入、流保存、附件类型识别
// ============================================================

const ATTACHMENT_LINKED_MODE = 'linked'
const ATTACHMENT_MANAGED_MODE = 'managed'

class AttachmentStorageService {
  /**
   * 从源路径导入附件
   * @param {string} sourcePath 源文件路径
   * @param {string} managedDirectory 托管目录
   * @param {boolean} copyToManagedStorage 是否复制到托管目录（false=保留链接）
   * @returns {Promise<object|null>} 附件对象
   */
  async importPath (sourcePath, managedDirectory, copyToManagedStorage) {
    if (!sourcePath) return null
    try {
      await fs.access(sourcePath)
    } catch {
      return null
    }

    const normalizedSourcePath = path.resolve(sourcePath)
    if (!copyToManagedStorage) {
      return this._createAttachment(normalizedSourcePath, ATTACHMENT_LINKED_MODE)
    }

    await fs.mkdir(managedDirectory, { recursive: true })
    const destPath = await this._getAvailablePath(path.join(managedDirectory, path.basename(normalizedSourcePath)))
    await fs.copyFile(normalizedSourcePath, destPath)
    return this._createAttachment(destPath, ATTACHMENT_MANAGED_MODE)
  }

  /**
   * 从 Buffer 保存附件
   * @param {Buffer} buffer
   * @param {string} fileName
   * @param {string} managedDirectory
   * @returns {Promise<object|null>}
   */
  async saveBuffer (buffer, fileName, managedDirectory) {
    if (!buffer || !Buffer.isBuffer(buffer)) return null

    await fs.mkdir(managedDirectory, { recursive: true })
    let normalizedName = this._sanitizeFileSystemName(path.basename(fileName || ''))
    if (!normalizedName) {
      normalizedName = `Attachment-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
    }

    const destPath = await this._getAvailablePath(path.join(managedDirectory, normalizedName))
    await fs.writeFile(destPath, buffer)
    return this._createAttachment(destPath, ATTACHMENT_MANAGED_MODE)
  }

  /**
   * 从流保存附件
   * @param {import('stream').Readable} stream
   * @param {string} fileName
   * @param {string} managedDirectory
   * @returns {Promise<object|null>}
   */
  async saveStream (stream, fileName, managedDirectory) {
    if (!stream || typeof stream.pipe !== 'function') return null

    await fs.mkdir(managedDirectory, { recursive: true })
    let normalizedName = this._sanitizeFileSystemName(path.basename(fileName || ''))
    if (!normalizedName) {
      normalizedName = `Attachment-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
    }

    const destPath = await this._getAvailablePath(path.join(managedDirectory, normalizedName))
    return new Promise((resolve, reject) => {
      const dest = fsSync.createWriteStream(destPath)
      stream.pipe(dest)
      dest.on('finish', () => resolve(this._createAttachment(destPath, ATTACHMENT_MANAGED_MODE)))
      dest.on('error', reject)
      stream.on('error', reject)
    })
  }

  /**
   * 获取附件类型
   * @param {string|null} filePath
   * @returns {string} 'image'|'video'|'pdf'|'file'
   */
  getAttachmentType (filePath) {
    const ext = !filePath ? '' : path.extname(filePath).toLowerCase()
    const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tiff', '.tif', '.heic', '.heif']
    const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm']
    if (imageExts.includes(ext)) return 'image'
    if (videoExts.includes(ext)) return 'video'
    if (ext === '.pdf') return 'pdf'
    return 'file'
  }

  /**
   * 创建附件对象
   * @param {string} filePath
   * @param {string} storageMode
   * @returns {object}
   */
  _createAttachment (filePath, storageMode) {
    return {
      filePath,
      displayName: path.basename(filePath),
      type: this.getAttachmentType(filePath),
      storageMode,
      addedAt: new Date().toISOString()
    }
  }

  /**
   * 获取可用路径（处理同名冲突）
   * @param {string} targetPath
   * @returns {Promise<string>}
   */
  async _getAvailablePath (targetPath) {
    let finalPath = targetPath
    let counter = 1
    while (true) {
      try {
        await fs.access(finalPath)
        const ext = path.extname(targetPath)
        const base = path.basename(targetPath, ext)
        finalPath = path.join(path.dirname(targetPath), `${base}_${counter}${ext}`)
        counter++
      } catch {
        return finalPath
      }
    }
  }

  /**
   * 清理文件名中的非法字符
   * @param {string} name
   * @returns {string}
   */
  _sanitizeFileSystemName (name) {
    if (!name) return ''
    // Windows 非法字符：< > : " / \ | ? *
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  }
}

// ============================================================
// 扫描引用的附件路径，识别缺失文件和孤立托管文件
// ============================================================

class AttachmentHealthService {
  /**
   * 扫描指定数据目录下的附件健康状态
   * @param {string} dataDirectory 数据目录
   * @returns {Promise<object>} 健康报告
   */
  async scan (dataDirectory) {
    if (!dataDirectory) throw new Error('数据目录不能为空')
    const dataDir = path.resolve(dataDirectory)

    const referencedPaths = new Set()
    const missingLinkedPaths = new Set()
    const missingManagedPaths = new Set()
    let unreadableStoreCount = 0

    // 扫描 quick-capture 存储
    const quickCapturePath = path.join(dataDir, 'quick-capture', 'quick-capture.json')
    if (fsSync.existsSync(quickCapturePath)) {
      try {
        const raw = await fs.readFile(quickCapturePath, 'utf8')
        const data = JSON.parse(raw)
        const items = [...(data.items || []), ...(data.recentItems || [])]
        for (const item of items) {
          this._addAttachments(
            item.attachments || [],
            referencedPaths,
            missingLinkedPaths,
            missingManagedPaths
          )
        }
      } catch (err) {
        unreadableStoreCount++
        console.warn(`[AttachmentHealth] 读取失败 ${quickCapturePath}: ${err.message}`)
      }
    }

    // 扫描 widgets 目录下的 todo.json
    const widgetsDirectory = path.join(dataDir, 'widgets')
    if (fsSync.existsSync(widgetsDirectory)) {
      const widgetDirs = await fs.readdir(widgetsDirectory, { withFileTypes: true })
      for (const dir of widgetDirs) {
        if (!dir.isDirectory()) continue
        const todoPath = path.join(widgetsDirectory, dir.name, 'todo.json')
        if (!fsSync.existsSync(todoPath)) continue
        try {
          const raw = await fs.readFile(todoPath, 'utf8')
          const data = JSON.parse(raw)
          for (const item of (data.items || [])) {
            this._addAttachments(
              item.attachments || [],
              referencedPaths,
              missingLinkedPaths,
              missingManagedPaths
            )
          }
        } catch (err) {
          unreadableStoreCount++
          console.warn(`[AttachmentHealth] 读取失败 ${todoPath}: ${err.message}`)
        }
      }
    }

    // 扫描便签附件清单（note-attachments/{noteId}/manifest.json）
    const noteAttachmentsDir = path.join(dataDir, 'note-attachments')
    if (fsSync.existsSync(noteAttachmentsDir)) {
      const noteDirs = await fs.readdir(noteAttachmentsDir, { withFileTypes: true })
      for (const dir of noteDirs) {
        if (!dir.isDirectory()) continue
        const manifestPath = path.join(noteAttachmentsDir, dir.name, 'manifest.json')
        if (!fsSync.existsSync(manifestPath)) continue
        try {
          const raw = await fs.readFile(manifestPath, 'utf8')
          const manifest = JSON.parse(raw)
          this._addAttachments(
            manifest.attachments || [],
            referencedPaths,
            missingLinkedPaths,
            missingManagedPaths
          )
        } catch (err) {
          unreadableStoreCount++
          console.warn(`[AttachmentHealth] 读取失败 ${manifestPath}: ${err.message}`)
        }
      }
    }

    // 识别孤立托管文件（在托管目录中但未被引用）
    const orphanManagedPaths = new Set()
    for (const managedDirectory of this._enumerateManagedAttachmentDirectories(dataDir, widgetsDirectory)) {
      try {
        const files = await this._enumerateAllFiles(managedDirectory)
        for (const filePath of files) {
          const normalized = path.resolve(filePath)
          if (!referencedPaths.has(normalized.toLowerCase())) {
            orphanManagedPaths.add(normalized)
          }
        }
      } catch (err) {
        console.warn(`[AttachmentHealth] 枚举托管目录失败 ${managedDirectory}: ${err.message}`)
      }
    }

    const report = {
      referencedFileCount: referencedPaths.size,
      missingLinkedFiles: Array.from(missingLinkedPaths).sort(),
      missingManagedFiles: Array.from(missingManagedPaths).sort(),
      orphanManagedFiles: Array.from(orphanManagedPaths).sort(),
      unreadableStoreCount
    }
    report.isHealthy =
      report.missingLinkedFiles.length === 0 &&
      report.missingManagedFiles.length === 0 &&
      report.orphanManagedFiles.length === 0 &&
      report.unreadableStoreCount === 0
    return report
  }

  /**
   * 枚举所有托管附件目录
   * @param {string} dataDir
   * @param {string} widgetsDirectory
   * @returns {string[]}
   */
  _enumerateManagedAttachmentDirectories (dataDir, widgetsDirectory) {
    const result = []
    const quickCaptureAttachments = path.join(dataDir, 'quick-capture', 'attachments')
    if (fsSync.existsSync(quickCaptureAttachments)) result.push(quickCaptureAttachments)

    const noteAttachmentsDir = path.join(dataDir, 'note-attachments')
    if (fsSync.existsSync(noteAttachmentsDir)) {
      try {
        for (const dir of fsSync.readdirSync(noteAttachmentsDir, { withFileTypes: true })) {
          if (!dir.isDirectory()) continue
          result.push(path.join(noteAttachmentsDir, dir.name))
        }
      } catch {
        // 忽略
      }
    }

    if (fsSync.existsSync(widgetsDirectory)) {
      try {
        for (const dir of fsSync.readdirSync(widgetsDirectory, { withFileTypes: true })) {
          if (!dir.isDirectory()) continue
          const attachmentDir = path.join(widgetsDirectory, dir.name, 'attachments')
          if (fsSync.existsSync(attachmentDir)) result.push(attachmentDir)
        }
      } catch {
        // 忽略
      }
    }
    return result
  }

  /**
   * 递归枚举目录下所有文件
   * @param {string} directory
   * @returns {Promise<string[]>}
   */
  async _enumerateAllFiles (directory) {
    const result = []
    const stack = [directory]
    while (stack.length > 0) {
      const current = stack.pop()
      let entries
      try {
        entries = await fs.readdir(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(fullPath)
        } else {
          result.push(fullPath)
        }
      }
    }
    return result
  }

  /**
   * 将附件列表加入引用/缺失集合
   * @param {Array<object>} attachments
   * @param {Set<string>} referencedPaths
   * @param {Set<string>} missingLinkedPaths
   * @param {Set<string>} missingManagedPaths
   */
  _addAttachments (attachments, referencedPaths, missingLinkedPaths, missingManagedPaths) {
    for (const attachment of attachments) {
      if (!attachment || !attachment.filePath) continue
      let filePath
      try {
        filePath = path.resolve(attachment.filePath)
      } catch {
        filePath = attachment.filePath
      }
      const lower = filePath.toLowerCase()
      referencedPaths.add(lower)
      if (fsSync.existsSync(filePath)) continue

      if (attachment.storageMode === ATTACHMENT_MANAGED_MODE) {
        missingManagedPaths.add(filePath)
      } else {
        missingLinkedPaths.add(filePath)
      }
    }
  }
}

// ============================================================
// 单例实例（供 IPC 通道使用）
// ============================================================
const folderWatcher = new FolderWatcherService()
const usnIndexService = new UsnJournalIndexService()
const quickLookService = new QuickLookPreviewService()
const attachmentStorage = new AttachmentStorageService()
const attachmentHealthService = new AttachmentHealthService()

// ============================================================
// 导出
// ============================================================

module.exports = {
  registerFileChannels,
  getFileType,
  formatFileSize,
  formatDate,
  // 文件夹监听
  FolderWatcherService,
  FolderWatcherHealth,
  folderWatcher,
  BoundedPathChangeBuffer,
  // USN 索引与归约
  UsnJournalIndexService,
  UsnJournalChangeReducer,
  usnIndexService,
  // Quick Look
  QuickLookPreviewService,
  quickLookService,
  // 附件存储
  AttachmentStorageService,
  attachmentStorage,
  // 附件健康检查
  AttachmentHealthService,
  attachmentHealthService,
  // 附件存储模式常量
  ATTACHMENT_LINKED_MODE,
  ATTACHMENT_MANAGED_MODE
}