// ============================================================
// 文件服务 IPC 通道
// 注册 file:* 系列处理器
// ============================================================

const { register, success, failure } = require('./registry')
const { getFileType, formatFileSize, formatDate } = require('../services/file-service')
const { app } = require('electron')

// ============================================================
// file:listWidgets - 获取所有文件格子配置
// ============================================================
register('file:list-widgets', async (event, data) => {
  try {
    const { widgetDao } = require('../dao/widget-dao')
    const list = widgetDao.list().filter(w => w.widget_type === 'file')
    return { list }
  } catch (error) {
    console.error('[FileChannels] file:list-widgets 失败:', error.message)
    return { list: [] }
  }
})

// ============================================================
// file:get-widget - 获取单个文件格子配置
// data: { widgetType }
// ============================================================
register('file:get-widget', async (event, data) => {
  try {
    const { widgetDao } = require('../dao/widget-dao')
    const widget = widgetDao.getByType(data.widgetType)
    if (!widget) {
      return { error: { code: 'NOT_FOUND', message: `文件格子 ${data.widgetType} 不存在` } }
    }
    return { widget }
  } catch (error) {
    console.error('[FileChannels] file:get-widget 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// file:list-files - 列出文件夹内容
// data: { path }
// ============================================================
register('file:list-files', async (event, data) => {
  try {
    const fs = require('fs').promises
    const path = require('path')
    const os = require('os')

    const folderPath = data.path
    if (!folderPath) {
      return { error: { code: 'INVALID_ARGS', message: '路径不能为空' } }
    }

    const stats = await fs.stat(folderPath)
    if (!stats.isDirectory()) {
      return { error: { code: 'INVALID_ARGS', message: '路径不是文件夹' } }
    }

    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    const files = []

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name)
      try {
        const fileStats = await fs.stat(fullPath)
        files.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          sizeFormatted: entry.isDirectory() ? '' : formatFileSize(fileStats.size),
          type: entry.isDirectory() ? 'Folder' : getFileType(fullPath),
          dateCreated: fileStats.birthtime,
          dateModified: fileStats.mtime,
          dateFormatted: formatDate(fileStats.mtime)
        })
      } catch (err) {
        console.warn(`[FileChannels] 无法访问文件: ${fullPath}`, err.message)
      }
    }

    // 文件夹排在前面
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    return { files, path: folderPath }
  } catch (error) {
    console.error('[FileChannels] file:list-files 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// file:get-file-info - 获取文件详情
// data: { path }
// ============================================================
register('file:get-file-info', async (event, data) => {
  try {
    const fs = require('fs').promises
    const path = require('path')

    const filePath = data.path
    if (!filePath) {
      return { error: { code: 'INVALID_ARGS', message: '路径不能为空' } }
    }

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
  } catch (error) {
    console.error('[FileChannels] file:get-file-info 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// file:copy-items - 复制文件/文件夹
// data: { items, destPath }
// ============================================================
register('file:copy-items', async (event, data) => {
  try {
    const fs = require('fs').promises
    const path = require('path')

    const { items, destPath } = data
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { error: { code: 'INVALID_ARGS', message: '未指定要复制的项' } }
    }

    const dest = destPath || event.sender.getOwnerBrowserWindow()?.getLastFocusedFileInfo()?.path
    if (!dest) {
      return { error: { code: 'INVALID_ARGS', message: '目标路径未指定' } }
    }

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
  } catch (error) {
    console.error('[FileChannels] file:copy-items 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// file:cut-items - 剪切文件/文件夹（记录到剪切板）
// data: { items }
// ============================================================
register('file:cut-items', async (event, data) => {
  try {
    const { items } = data
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { error: { code: 'INVALID_ARGS', message: '未指定要剪切的项' } }
    }

    // 剪切操作在主进程侧记录，这里只返回成功
    return { items, operation: 'cut' }
  } catch (error) {
    console.error('[FileChannels] file:cut-items 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// file:move-items - 移动文件/文件夹
// data: { items, destPath }
// ============================================================
register('file:move-items', async (event, data) => {
  try {
    const fs = require('fs').promises
    const path = require('path')

    const { items, destPath } = data
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { error: { code: 'INVALID_ARGS', message: '未指定要移动的项' } }
    }

    const dest = destPath
    if (!dest) {
      return { error: { code: 'INVALID_ARGS', message: '目标路径未指定' } }
    }

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
  } catch (error) {
    console.error('[FileChannels] file:move-items 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// file:delete-items - 删除文件/文件夹
// data: { items }
// ============================================================
register('file:delete-items', async (event, data) => {
  try {
    const fs = require('fs').promises

    const { items } = data
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { error: { code: 'INVALID_ARGS', message: '未指定要删除的项' } }
    }

    for (const item of items) {
      const stat = await fs.stat(item)
      if (stat.isDirectory()) {
        await fs.rm(item, { recursive: true, force: true })
      } else {
        await fs.unlink(item)
      }
    }

    return { success: true, count: items.length }
  } catch (error) {
    console.error('[FileChannels] file:delete-items 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// file:rename-item - 重命名文件/文件夹
// data: { oldPath, newPath }
// ============================================================
register('file:rename-item', async (event, data) => {
  try {
    const fs = require('fs').promises

    const { oldPath, newPath } = data
    if (!oldPath || !newPath) {
      return { error: { code: 'INVALID_ARGS', message: '原路径和新路径不能为空' } }
    }

    await fs.rename(oldPath, newPath)
    return { success: true }
  } catch (error) {
    console.error('[FileChannels] file:rename-item 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// file:reveal-in-explorer - 在资源管理器中显示
// data: { path }
// ============================================================
register('file:reveal-in-explorer', async (event, data) => {
  try {
    const { shell } = require('electron')
    const { path } = data

    if (!path) {
      return failure('INVALID_ARGS', '路径不能为空')
    }

    shell.showItemInFolder(path)
    return success({ revealed: true })
  } catch (error) {
    console.error('[FileChannels] file:reveal-in-explorer 失败:', error.message)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// file:open-file - 打开文件
// data: { path }
// ============================================================
register('file:open-file', async (event, data) => {
  try {
    const { shell } = require('electron')
    const { path } = data

    if (!path) {
      return failure('INVALID_ARGS', '路径不能为空')
    }

    await shell.openPath(path)
    return success({ opened: true })
  } catch (error) {
    console.error('[FileChannels] file:open-file 失败:', error.message)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// file:open-folder - 打开文件夹
// data: { path }
// ============================================================
register('file:open-folder', async (event, data) => {
  try {
    const { shell } = require('electron')
    const { path } = data

    if (!path) {
      return failure('INVALID_ARGS', '路径不能为空')
    }

    await shell.openPath(path)
    return success({ opened: true })
  } catch (error) {
    console.error('[FileChannels] file:open-folder 失败:', error.message)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// file:get-desktop-path - 获取桌面路径
// ============================================================
register('file:get-desktop-path', async (event, data) => {
  try {
    const desktopPath = app.getPath('desktop')
    return { path: desktopPath }
  } catch (error) {
    console.error('[FileChannels] file:get-desktop-path 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// file:check-quicklook - 检查 QuickLook 是否运行
// ============================================================
register('file:check-quicklook', async (event, data) => {
  try {
    const { execSync } = require('child_process')
    execSync('tasklist /FI "IMAGENAME eq QuickLook.exe" /FO CSV', { encoding: 'utf8' })
    return { running: true }
  } catch {
    return { running: false }
  }
})

// ============================================================
// file:create-folder - 创建文件夹
// data: { parentPath, folderName }
// ============================================================
register('file:create-folder', async (event, data) => {
  try {
    const fs = require('fs').promises
    const path = require('path')

    const { parentPath, folderName } = data
    if (!parentPath || !folderName) {
      return { error: { code: 'INVALID_ARGS', message: '路径和文件夹名称不能为空' } }
    }

    const fullPath = path.join(parentPath, folderName)
    await fs.mkdir(fullPath, { recursive: true })
    return { success: true, path: fullPath }
  } catch (error) {
    console.error('[FileChannels] file:create-folder 失败:', error.message)
    return { error: { code: 'INTERNAL_ERROR', message: error.message } }
  }
})

// ============================================================
// 辅助函数：递归复制目录
// ============================================================
async function copyDirectory (src, dest) {
  const fs = require('fs').promises
  const path = require('path')

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
