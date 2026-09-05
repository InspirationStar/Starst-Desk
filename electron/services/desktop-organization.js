// ============================================================
// 桌面整理服务（主进程）
// 职责：桌面文件扫描、分类、移动、自动整理
// ============================================================

const { ipcMain, shell, app } = require('electron')
const fs = require('fs').promises
const path = require('path')
const os = require('os')

// ============================================================
// 文件类型分类
// ============================================================

const FILE_CATEGORIES = {
  documents: {
    label: '文档',
    extensions: ['.doc', '.docx', '.pdf', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx', '.md']
  },
  images: {
    label: '图片',
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff']
  },
  videos: {
    label: '视频',
    extensions: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm']
  },
  audio: {
    label: '音频',
    extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a']
  },
  archives: {
    label: '压缩包',
    extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2']
  },
  executables: {
    label: '程序',
    extensions: ['.exe', '.msi', '.app', '.apk']
  },
  shortcuts: {
    label: '快捷方式',
    extensions: ['.lnk']
  },
  code: {
    label: '代码',
    extensions: ['.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rb', '.php', '.html', '.css', '.json', '.xml', '.yaml', '.yml']
  },
  other: {
    label: '其他',
    extensions: []
  }
}

/**
 * 获取文件类别
 * @param {string} filePath
 * @returns {string} 类别 key
 */
function getFileCategory (filePath) {
  const ext = path.extname(filePath).toLowerCase()
  for (const [category, info] of Object.entries(FILE_CATEGORIES)) {
    if (info.extensions.includes(ext)) {
      return category
    }
  }
  return 'other'
}

/**
 * 获取桌面路径
 * @returns {string}
 */
function getDesktopPath () {
  try {
    return app.getPath('desktop')
  } catch (err) {
    return path.join(os.homedir(), 'Desktop')
  }
}

// ============================================================
// IPC 处理器
// ============================================================

/**
 * 注册桌面整理相关的 IPC 通道
 */
function registerDesktopOrganizationChannels () {
  // 扫描桌面文件
  ipcMain.handle('desktop-organization:scan', async (event, data) => {
    try {
      const desktopPath = getDesktopPath()
      const entries = await fs.readdir(desktopPath, { withFileTypes: true })
      const files = []

      for (const entry of entries) {
        if (entry.name.startsWith('~$')) continue // 跳过临时文件
        const fullPath = path.join(desktopPath, entry.name)
        try {
          const stat = await fs.stat(fullPath)
          const category = entry.isDirectory() ? 'folder' : getFileCategory(fullPath)
          files.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            category,
            size: stat.size,
            dateModified: stat.mtime
          })
        } catch (err) {
          console.warn(`[DesktopOrg] 无法访问文件: ${fullPath}`, err.message)
        }
      }

      return {
        desktopPath,
        files,
        total: files.length
      }
    } catch (error) {
      console.error('[DesktopOrg] desktop-organization:scan 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 预览整理方案
  ipcMain.handle('desktop-organization:preview', async (event, data) => {
    try {
      const { files, targetFolders } = data
      const preview = []

      for (const file of files) {
        let targetFolder = null
        if (file.isDirectory) {
          targetFolder = targetFolders.folder || getDesktopPath()
        } else {
          targetFolder = targetFolders[file.category] || getDesktopPath()
        }

        preview.push({
          source: file.path,
          destination: path.join(targetFolder, file.name),
          category: file.category,
          action: 'move'
        })
      }

      return { preview }
    } catch (error) {
      console.error('[DesktopOrg] desktop-organization:preview 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 执行整理
  ipcMain.handle('desktop-organization:execute', async (event, data) => {
    try {
      const { preview, transactionId } = data
      const results = {
        success: [],
        failed: [],
        skipped: []
      }

      for (const item of preview) {
        try {
          const destDir = path.dirname(item.destination)
          await fs.mkdir(destDir, { recursive: true })

          // 处理同名冲突
          let finalDest = item.destination
          let counter = 1
          while (await fs.access(finalDest).then(() => true, () => false)) {
            const ext = path.extname(item.source)
            const base = path.basename(item.source, ext)
            finalDest = path.join(destDir, `${base}_${counter}${ext}`)
            counter++
          }

          await fs.rename(item.source, finalDest)
          results.success.push({ source: item.source, destination: finalDest })
        } catch (err) {
          console.warn(`[DesktopOrg] 移动失败: ${item.source}`, err.message)
          results.failed.push({ source: item.source, error: err.message })
        }
      }

      // 记录事务日志
      await logTransaction(transactionId, results)

      return results
    } catch (error) {
      console.error('[DesktopOrg] desktop-organization:execute 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 撤销整理
  ipcMain.handle('desktop-organization:undo', async (event, data) => {
    try {
      const { transactionId } = data
      const transaction = await getTransaction(transactionId)

      if (!transaction) {
        return { error: { code: 'NOT_FOUND', message: '事务记录不存在' } }
      }

      const results = {
        success: [],
        failed: []
      }

      for (const item of transaction.log) {
        try {
          if (item.action === 'move') {
            await fs.rename(item.destination, item.source)
            results.success.push({ source: item.destination, destination: item.source })
          }
        } catch (err) {
          console.warn(`[DesktopOrg] 撤销失败: ${item.destination}`, err.message)
          results.failed.push({ source: item.destination, error: err.message })
        }
      }

      return results
    } catch (error) {
      console.error('[DesktopOrg] desktop-organization:undo 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })

  // 获取事务历史
  ipcMain.handle('desktop-organization:history', async (event, data) => {
    try {
      const transactions = await getAllTransactions()
      return { transactions: transactions.slice(0, 10) }
    } catch (error) {
      console.error('[DesktopOrg] desktop-organization:history 失败:', error.message)
      return { error: { code: 'INTERNAL_ERROR', message: error.message } }
    }
  })
}

// ============================================================
// 事务日志管理
// ============================================================

// 事务日志路径：统一放在应用数据目录 %APPDATA%\StarstDesk 下，便于管理
const TRANSACTION_LOG_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'StarstDesk', 'desktop-org-transactions.json'
)

/**
 * 确保日志目录存在
 */
async function ensureLogDir () {
  const dir = path.dirname(TRANSACTION_LOG_PATH)
  await fs.mkdir(dir, { recursive: true })
}

/**
 * 记录事务
 * @param {string} transactionId
 * @param {object} results
 */
async function logTransaction (transactionId, results) {
  await ensureLogDir()

  let transactions = []
  try {
    const content = await fs.readFile(TRANSACTION_LOG_PATH, 'utf8')
    transactions = JSON.parse(content)
  } catch (err) {
    transactions = []
  }

  const transaction = {
    id: transactionId,
    timestamp: new Date().toISOString(),
    log: results.success.map(item => ({
      source: item.source,
      destination: item.destination,
      action: 'move'
    })),
    failedCount: results.failed.length,
    successCount: results.success.length
  }

  transactions.unshift(transaction)

  // 只保留最近 50 条记录
  if (transactions.length > 50) {
    transactions = transactions.slice(0, 50)
  }

  await fs.writeFile(TRANSACTION_LOG_PATH, JSON.stringify(transactions, null, 2))
}

/**
 * 获取事务
 * @param {string} transactionId
 * @returns {Promise<object|null>}
 */
async function getTransaction (transactionId) {
  try {
    const content = await fs.readFile(TRANSACTION_LOG_PATH, 'utf8')
    const transactions = JSON.parse(content)
    return transactions.find(t => t.id === transactionId) || null
  } catch (err) {
    return null
  }
}

/**
 * 获取所有事务
 * @returns {Promise<Array>}
 */
async function getAllTransactions () {
  try {
    const content = await fs.readFile(TRANSACTION_LOG_PATH, 'utf8')
    return JSON.parse(content)
  } catch (err) {
    return []
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  registerDesktopOrganizationChannels,
  getFileCategory,
  getDesktopPath,
  FILE_CATEGORIES
}