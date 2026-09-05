// ============================================================
// 截图服务 IPC 通道
// 注册 screenshot:* 系列 IPC 处理器
// ============================================================

const { register, success, failure } = require('./registry.js')
const { captureFull, captureWindow, captureArea, captureAreaWindows, SCREENSHOT_DIR } = require('./../services/screenshot-service.js')
const logger = require('./../core/logger.js')

// ============================================================
// screenshot:full
// 全屏截图
// ============================================================
register('screenshot:full', async (event, data) => {
  try {
    // 若请求隐藏窗口（用于截取窗口外的内容），先隐藏主窗口再截图
    const hideWindow = data?.hideWindow === true
    const { BrowserWindow } = require('electron')
    let win = null

    if (hideWindow && event?.sender) {
      win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        win.hide()
        // 等待窗口完全隐藏后再截图
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }

    const result = await captureFull()

    // 恢复窗口
    if (win) {
      win.show()
      win.focus()
    }

    const dataUrl = `data:image/png;base64,${result.buffer.toString('base64')}`
    return success({ filePath: result.filePath, dataUrl, width: result.width, height: result.height })
  } catch (error) {
    logger.error('ScreenshotChannels', `screenshot:full 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// screenshot:window
// 截取指定窗口
// ============================================================
register('screenshot:window', async (event, data) => {
  try {
    if (!data.window_id) {
      return failure('WINDOW_ID_REQUIRED', 'window_id 不能为空')
    }
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.fromId(data.window_id)
    if (!win) {
      return failure('WINDOW_NOT_FOUND', '窗口不存在')
    }
    const result = await captureWindow(win)
    const dataUrl = `data:image/png;base64,${result.buffer.toString('base64')}`
    return success({ filePath: result.filePath, dataUrl, width: result.width, height: result.height })
  } catch (error) {
    logger.error('ScreenshotChannels', `screenshot:window 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// screenshot:area
// 区域截图
// ============================================================
register('screenshot:area', async (event, data) => {
  try {
    if (!data.x || !data.y || !data.width || !data.height) {
      return failure('REQUIRED_FIELDS', 'x, y, width, height 不能为空')
    }
    // Windows 优先用 GDI BitBlt 区域截图（~10ms），绕开 desktopCapturer 的 1.7s 延迟
    const result = process.platform === 'win32'
      ? await captureAreaWindows(data.x, data.y, data.width, data.height)
      : await captureArea(data.x, data.y, data.width, data.height)
    const dataUrl = `data:image/png;base64,${result.buffer.toString('base64')}`
    return success({ filePath: null, dataUrl, width: result.width, height: result.height })
  } catch (error) {
    logger.error('ScreenshotChannels', `screenshot:area 失败: ${error.message}`)
    return failure('INTERNAL_ERROR', error.message)
  }
})

// ============================================================
// screenshot:getDir
// 获取截图存储目录
// ============================================================
register('screenshot:getDir', async () => {
  return success({ dir: SCREENSHOT_DIR })
})

module.exports = {}