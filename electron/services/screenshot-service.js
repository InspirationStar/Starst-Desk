// ============================================================
// Screenshot Service（主进程）
// 职责：提供系统截图功能，支持全屏、窗口、区域截图
// ============================================================

const { screen, BrowserWindow, desktopCapturer } = require('electron')
const fs = require('fs').promises
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')
const logger = require('./../core/logger.js')

// koffi Win32 GDI 句柄（懒加载，首次调用 BitBlt 时初始化）
let gdiApi = null

/**
 * 初始化 koffi Win32 GDI API
 * @returns {Object|null}
 */
function initGdiApi () {
  if (gdiApi !== null) return gdiApi || null
  if (process.platform !== 'win32') return null
  try {
    const koffi = require('koffi')
    const gdi32 = koffi.load('gdi32.dll')
    const user32 = koffi.load('user32.dll')
    gdiApi = {
      // HDC GetDesktopWindow() -> 桌面设备上下文（整个屏幕）
      GetDesktopWindow: user32.func('void *GetDesktopWindow()'),
      // HDC GetDC(void *hWnd)
      GetDC: user32.func('void *GetDC(void *hWnd)'),
      // BOOL ReleaseDC(void *hWnd, void *hDC)
      ReleaseDC: user32.func('int ReleaseDC(void *hWnd, void *hDC)'),
      // HGDIOBJ SelectObject(void *hDC, void *hObject)
      SelectObject: gdi32.func('void *SelectObject(void *hDC, void *hObject)'),
      // BOOL DeleteObject(void *hObject)
      DeleteObject: gdi32.func('int DeleteObject(void *hObject)'),
      // BOOL BitBlt(void *hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, void *hdcSrc, int nXSrc, int nYSrc, unsigned long dwRop)
      // SRCCOPY = 0x00CC0020
      BitBlt: gdi32.func('int BitBlt(void *hDestDC, int xDest, int yDest, int wDest, int hDest, void *hSrcDC, int xSrc, int ySrc, unsigned long rop)'),
      // HBITMAP CreateCompatibleBitmap(void *hDC, int nWidth, int nHeight)
      CreateCompatibleBitmap: gdi32.func('void *CreateCompatibleBitmap(void *hDC, int w, int h)'),
      // HDC CreateCompatibleDC(void *hDC)
      CreateCompatibleDC: gdi32.func('void *CreateCompatibleDC(void *hDC)'),
      // BOOL DeleteDC(void *hDC)
      DeleteDC: gdi32.func('int DeleteDC(void *hDC)'),
      // BOOL GetDIBits(void *hDC, void *hBitmap, uint32_t uStartScan, uint32_t cScanLines, uint8_t *lpvBits, void *lpbmi, uint32_t uUsage)
      GetDIBits: gdi32.func('int GetDIBits(void *hdc, void *hbitmap, uint32_t startScan, uint32_t numScans, uint8_t *bits, void *bmInfo, uint32_t usage)')
    }
    logger.info('ScreenshotService', 'koffi Win32 GDI API 初始化成功')
  } catch (err) {
    logger.warn('ScreenshotService', `koffi GDI 初始化失败: ${err.message}`)
    gdiApi = false
  }
  return gdiApi || null
}

/**
 * 用 Windows GDI BitBlt 截矩形区域（极速，<10ms），返回原始 RGBA buffer
 * 绕开 desktopCapturer.getSources 在 ~1740ms 的延迟瓶颈
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Buffer} RGBA 原始像素（BGRA 转 RGBA）
 */
function captureAreaWithGdi (x, y, w, h) {
  const api = initGdiApi()
  if (!api) throw new Error('GDI BitBlt 不可用')
  const SRCCOPY = 0x00CC0020
  // bmih size for BITMAPINFOHEADER
  const BMIH_SIZE = 40

  const hDesk = api.GetDesktopWindow()
  const hSrcDC = api.GetDC(hDesk)
  const hMemDC = api.CreateCompatibleDC(hSrcDC)
  const hBitmap = api.CreateCompatibleBitmap(hSrcDC, w, h)
  const oldObj = api.SelectObject(hMemDC, hBitmap)

  // BitBlt 把屏幕区域复制到内存 DC
  const ok = api.BitBlt(hMemDC, 0, 0, w, h, hSrcDC, x, y, SRCCOPY)
  if (!ok) {
    api.DeleteObject(oldObj)
    api.DeleteObject(hBitmap)
    api.DeleteDC(hMemDC)
    api.ReleaseDC(hDesk, hSrcDC)
    throw new Error('BitBlt 失败')
  }

  // 读取 DIB（BITMAPINFOHEADER + 像素）
  // BITMAPINFOHEADER 必须正确填写，否则 GetDIBits 返回 0
  const infoBuf = Buffer.alloc(BMIH_SIZE + 8)   // 40 + 8 字节颜色掩码（兼容）
  infoBuf.writeUInt32LE(BMIH_SIZE, 0)           // biSize
  infoBuf.writeInt32LE(w, 4)                    // biWidth
  infoBuf.writeInt32LE(h, 8)                    // biHeight（正数 = bottom-up）
  infoBuf.writeUInt16LE(1, 12)                  // biPlanes
  infoBuf.writeUInt16LE(32, 14)                 // biBitCount（32bpp BGRA）
  infoBuf.writeUInt32LE(0, 16)                  // biCompression = BI_RGB
  const pixelSize = w * h * 4                    // BGRA
  const pixelBuf = Buffer.alloc(pixelSize)

  const rows = api.GetDIBits(hMemDC, hBitmap, 0, h, pixelBuf, infoBuf, 0)
  if (rows <= 0) {
    api.DeleteObject(oldObj)
    api.DeleteObject(hBitmap)
    api.DeleteDC(hMemDC)
    api.ReleaseDC(hDesk, hSrcDC)
    throw new Error('GetDIBits 失败')
  }

  // BGRA → RGBA（PNG 编码器期望 RGBA），但 PowerShelLockBits Format32bppArgb 需要 BGRA，所以保留原始 buffer
  const bgra = pixelBuf

  api.DeleteObject(oldObj)
  api.DeleteObject(hBitmap)
  api.DeleteDC(hMemDC)
  api.ReleaseDC(hDesk, hSrcDC)
  return bgra
}

// ============================================================
// 配置
// ============================================================

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'starst-screenshots')

// ============================================================
// 工具函数
// ============================================================

/**
 * 确保截图目录存在
 * @returns {Promise<void>}
 */
async function ensureScreenshotDir () {
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true })
    logger.debug('ScreenshotService', `截图目录已就绪: ${SCREENSHOT_DIR}`)
  } catch (err) {
    logger.error('ScreenshotService', `创建截图目录失败: ${err.message}`)
    throw err
  }
}

/**
 * Windows 平台专用：用 GDI BitBlt 截指定矩形区域（<10ms，无 desktopCapturer 延迟）
 * GetDIBits 默认 BI_RGB 返回 BGRA（B,G,R,A），与 nativeImage.createFromBuffer pixelFormat: 'bgra' 一致
 * 用 Electron nativeImage 直接编码 PNG，无需 PowerShell
 * @param {number} x 屏幕坐标
 * @param {number} y 屏幕坐标
 * @param {number} width
 * @param {number} height
 * @returns {Promise<object>} { buffer, width, height }
 */
async function captureAreaWindows (x, y, width, height) {
  const t0 = Date.now()
  const bgra = captureAreaWithGdi(x, y, width, height)
  logger.info('SHOT-PERF', `GDI BitBlt ${Date.now() - t0}ms (${width}x${height})`)

  // 用 Electron nativeImage 直接编码 PNG（绕过 desktopCapturer 的 1.7s，也绕开 PowerShell）
  const { nativeImage } = require('electron')
  const img = nativeImage.createFromBuffer(bgra, { width, height, flatness: 8, pixelFormat: 'bgra' })
  const pngBuffer = img.toPNG()
  return { buffer: pngBuffer, width, height }
}

/**
 * 生成唯一文件名
 * @param {string} format - 文件格式
 * @returns {string}
 */
function generateFileName (format = 'png') {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `screenshot_${timestamp}_${random}.${format}`
}

// ============================================================
// 截图方法
// ============================================================

/**
 * 全屏截图
 * @returns {Promise<object>} { buffer, filePath, width, height }
 */
async function captureFull () {
  try {
    await ensureScreenshotDir()

    const display = screen.getPrimaryDisplay()
    const { width, height } = display.size

    logger.info('ScreenshotService', `开始全屏截图: ${width}x${height}`)

    // 首选：使用 Electron 内置 desktopCapturer API（跨平台、无需外部命令）
    let buffer
    try {
      buffer = await captureWithDesktopCapturer()
    } catch (dcErr) {
      logger.warn('ScreenshotService', `desktopCapturer 截图失败，回退到系统命令: ${dcErr.message}`)
      // 回退：使用平台特定的系统命令
      if (process.platform === 'win32') {
        buffer = await captureWithPowerShell()
      } else if (process.platform === 'darwin') {
        buffer = await captureWithScreencapture()
      } else {
        buffer = await captureWithLinuxTool()
      }
    }

    const fileName = generateFileName('png')
    const filePath = path.join(SCREENSHOT_DIR, fileName)

    await fs.writeFile(filePath, buffer)
    logger.info('ScreenshotService', `全屏截图已保存: ${filePath}`)

    return { buffer, filePath, width, height }
  } catch (error) {
    logger.error('ScreenshotService', `captureFull 失败: ${error.message}`)
    throw error
  }
}

/**
 * 截取指定窗口
 * @param {BrowserWindow} win
 * @returns {Promise<object>} { buffer, filePath, width, height }
 */
async function captureWindow (win) {
  try {
    if (!win || win.isDestroyed()) {
      throw new Error('无效的窗口对象')
    }

    await ensureScreenshotDir()

    logger.info('ScreenshotService', `开始窗口截图`)

    let buffer

    if (process.platform === 'win32') {
      buffer = await captureWindowWithWin32(win)
    } else if (process.platform === 'darwin') {
      buffer = await captureWindowWithMac(win)
    } else {
      buffer = await captureWindowWithLinux(win)
    }

    const { width, height } = win.getBounds()
    const fileName = generateFileName('png')
    const filePath = path.join(SCREENSHOT_DIR, fileName)

    await fs.writeFile(filePath, buffer)
    logger.info('ScreenshotService', `窗口截图已保存: ${filePath}`)

    return { buffer, filePath, width, height }
  } catch (error) {
    logger.error('ScreenshotService', `captureWindow 失败: ${error.message}`)
    throw error
  }
}

/**
 * 区域截图
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {Promise<object>} { buffer, filePath, width, height }
 */
async function captureArea (x, y, width, height) {
  try {
    await ensureScreenshotDir()

    logger.info('ScreenshotService', `开始区域截图: (${x},${y}) ${width}x${height}`)

    let buffer

    if (process.platform === 'win32') {
      buffer = await captureAreaWithWin32(x, y, width, height)
    } else if (process.platform === 'darwin') {
      buffer = await captureAreaWithMac(x, y, width, height)
    } else {
      buffer = await captureAreaWithLinux(x, y, width, height)
    }

    const fileName = generateFileName('png')
    const filePath = path.join(SCREENSHOT_DIR, fileName)

    await fs.writeFile(filePath, buffer)
    logger.info('ScreenshotService', `区域截图已保存: ${filePath}`)

    return { buffer, filePath, width, height }
  } catch (error) {
    logger.error('ScreenshotService', `captureArea 失败: ${error.message}`)
    throw error
  }
}

// ============================================================
// 平台特定实现
// ============================================================

/**
 * 使用 Electron 内置 desktopCapturer API 截图（首选方案）
 * 跨平台、无需外部命令、返回原始分辨率 PNG buffer
 * @returns {Promise<Buffer>}
 */
async function captureWithDesktopCapturer () {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.size

  // thumbnailSize 设为屏幕完整尺寸，获取全分辨率截图
  const tSrc = Date.now()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  logger.info('SHOT-PERF', `desktopCapturer.getSources ${Date.now() - tSrc}ms`)

  if (!sources || sources.length === 0) {
    throw new Error('desktopCapturer 未返回任何屏幕源')
  }

  // 取第一个屏幕源（主屏幕）
  const source = sources[0]
  if (!source.thumbnail || source.thumbnail.isEmpty()) {
    throw new Error('desktopCapturer 返回的缩略图为空')
  }

  // thumbnail 是 NativeImage，toPNG() 返回 Buffer
  const tPng = Date.now()
  const png = source.thumbnail.toPNG()
  logger.info('SHOT-PERF', `toPNG ${Date.now() - tPng}ms (${png.length} bytes)`)
  return png
}

/**
 * Windows PowerShell 全屏截图（备选方案）
 * 将脚本写入临时 .ps1 文件执行，避免命令行换行符破坏
 * @returns {Promise<Buffer>}
 */
async function captureWithPowerShell () {
  const scriptPath = path.join(os.tmpdir(), `starst_screenshot_${Date.now()}.ps1`)
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $stream.ToArray()
[Convert]::ToBase64String($bytes)
`.trim()

  try {
    // 将脚本写入临时文件，避免命令行换行符问题
    await fs.writeFile(scriptPath, script, 'utf8')

    const base64 = execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
      timeout: 10000,
      encoding: 'utf8'
    }).trim()

    return Buffer.from(base64, 'base64')
  } catch (error) {
    logger.error('ScreenshotService', `PowerShell 截图失败: ${error.message}`)
    throw error
  } finally {
    // 清理临时脚本文件
    try { await fs.unlink(scriptPath) } catch {}
  }
}

/**
 * macOS screencapture 全屏截图
 * @returns {Promise<Buffer>}
 */
async function captureWithScreencapture () {
  try {
    const tempFile = path.join(os.tmpdir(), `temp_screenshot_${Date.now()}.png`)
    execSync(`screencapture -x "${tempFile}"`, { timeout: 10000 })

    const buffer = await fs.readFile(tempFile)
    await fs.unlink(tempFile)

    return buffer
  } catch (error) {
    logger.error('ScreenshotService', `screencapture 失败: ${error.message}`)
    throw error
  }
}

/**
 * Linux 截图（尝试 scrot 或 gnome-screenshot）
 * @returns {Promise<Buffer>}
 */
async function captureWithLinuxTool () {
  try {
    // 尝试 scrot
    try {
      const tempFile = path.join(os.tmpdir(), `temp_screenshot_${Date.now()}.png`)
      execSync(`scrot -e 'mv $f ${tempFile}'`, { timeout: 10000 })
      const buffer = await fs.readFile(tempFile)
      await fs.unlink(tempFile)
      return buffer
    } catch {
      // 回退到 gnome-screenshot
      const tempFile = path.join(os.tmpdir(), `temp_screenshot_${Date.now()}.png`)
      execSync(`gnome-screenshot -f "${tempFile}"`, { timeout: 10000 })
      const buffer = await fs.readFile(tempFile)
      await fs.unlink(tempFile)
      return buffer
    }
  } catch (error) {
    logger.error('ScreenshotService', `Linux 截图失败: ${error.message}`)
    throw error
  }
}

/**
 * Windows 窗口截图
 * @param {BrowserWindow} win
 * @returns {Promise<Buffer>}
 */
async function captureWindowWithWin32 (win) {
  const bounds = win.getBounds()
  const { x, y, width, height } = bounds

  const scriptPath = path.join(os.tmpdir(), `starst_win_screenshot_${Date.now()}.ps1`)
  const script = `
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(${width}, ${height})
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen(${x}, ${y}, 0, 0, $bitmap.Size)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $stream.ToArray()
[Convert]::ToBase64String($bytes)
`.trim()

  try {
    await fs.writeFile(scriptPath, script, 'utf8')
    const base64 = execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
      timeout: 10000,
      encoding: 'utf8'
    }).trim()

    return Buffer.from(base64, 'base64')
  } catch (error) {
    logger.error('ScreenshotService', `窗口截图 PowerShell 失败: ${error.message}`)
    throw error
  } finally {
    try { await fs.unlink(scriptPath) } catch {}
  }
}

/**
 * macOS 窗口截图
 * @param {BrowserWindow} win
 * @returns {Promise<Buffer>}
 */
async function captureWindowWithMac (win) {
  const bounds = win.getBounds()
  const { x, y, width, height } = bounds

  try {
    // macOS 没有直接的窗口截图命令，使用 screencapture 指定区域
    const tempFile = path.join(os.tmpdir(), `temp_window_${Date.now()}.png`)
    execSync(`screencapture -x -R${x},${y},${width},${height} "${tempFile}"`, { timeout: 10000 })

    const buffer = await fs.readFile(tempFile)
    await fs.unlink(tempFile)

    return buffer
  } catch (error) {
    logger.error('ScreenshotService', `窗口截图 macOS 失败: ${error.message}`)
    throw error
  }
}

/**
 * Linux 窗口截图
 * @param {BrowserWindow} win
 * @returns {Promise<Buffer>}
 */
async function captureWindowWithLinux (win) {
  const bounds = win.getBounds()
  const { x, y, width, height } = bounds

  try {
    const tempFile = path.join(os.tmpdir(), `temp_window_${Date.now()}.png`)
    execSync(`gnome-screenshot -a -f "${tempFile}" --area=${x},${y},${width},${height}`, { timeout: 10000 })

    const buffer = await fs.readFile(tempFile)
    await fs.unlink(tempFile)

    return buffer
  } catch (error) {
    logger.error('ScreenshotService', `窗口截图 Linux 失败: ${error.message}`)
    throw error
  }
}

/**
 * Windows 区域截图
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Buffer>}
 */
async function captureAreaWithWin32 (x, y, width, height) {
  const scriptPath = path.join(os.tmpdir(), `starst_area_screenshot_${Date.now()}.ps1`)
  const script = `
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(${width}, ${height})
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen(${x}, ${y}, 0, 0, $bitmap.Size)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $stream.ToArray()
[Convert]::ToBase64String($bytes)
`.trim()

  try {
    await fs.writeFile(scriptPath, script, 'utf8')
    const base64 = execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
      timeout: 10000,
      encoding: 'utf8'
    }).trim()

    return Buffer.from(base64, 'base64')
  } catch (error) {
    logger.error('ScreenshotService', `区域截图 PowerShell 失败: ${error.message}`)
    throw error
  } finally {
    try { await fs.unlink(scriptPath) } catch {}
  }
}

/**
 * macOS 区域截图
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Buffer>}
 */
async function captureAreaWithMac (x, y, width, height) {
  try {
    const tempFile = path.join(os.tmpdir(), `temp_area_${Date.now()}.png`)
    execSync(`screencapture -x -R${x},${y},${width},${height} "${tempFile}"`, { timeout: 10000 })

    const buffer = await fs.readFile(tempFile)
    await fs.unlink(tempFile)

    return buffer
  } catch (error) {
    logger.error('ScreenshotService', `区域截图 macOS 失败: ${error.message}`)
    throw error
  }
}

/**
 * Linux 区域截图
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Buffer>}
 */
async function captureAreaWithLinux (x, y, width, height) {
  try {
    const tempFile = path.join(os.tmpdir(), `temp_area_${Date.now()}.png`)
    execSync(`gnome-screenshot -a -f "${tempFile}" --area=${x},${y},${width},${height}`, { timeout: 10000 })

    const buffer = await fs.readFile(tempFile)
    await fs.unlink(tempFile)

    return buffer
  } catch (error) {
    logger.error('ScreenshotService', `区域截图 Linux 失败: ${error.message}`)
    throw error
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  captureFull,
  captureWindow,
  captureArea,
  captureAreaWindows,   // Windows GDI 区域截图，无 desktopCapturer 延迟
  SCREENSHOT_DIR,
  ensureScreenshotDir
}