// ============================================================
// 快速捕获剪贴板服务
// 监听系统剪贴板变化，捕获内容并加入快速捕获列表
// 支持文本与图片，过滤自身写入、空内容、超限内容
// ============================================================

const { clipboard } = require('electron')
const logger = require('./logger.js')
const clipboardWriteScope = require('./clipboard-write-scope.js')

// 限制常量
const MAX_CLIPBOARD_TEXT_CHARACTERS = 20000
const MAX_CLIPBOARD_IMAGE_BYTES = 12 * 1024 * 1024

/**
 * 创建快速捕获剪贴板服务
 * @param {Object} options
 * @param {Object} options.settingsService 设置服务（需提供 getSettings() 与 onSettingsChanged）
 * @param {Object} options.quickCaptureService 快速捕获服务（需提供 addRecentClipboardItemAsync / addRecentClipboardImageAsync）
 * @param {Object} [options.clipboardReader] 自定义剪贴板读取器
 */
function createQuickCaptureClipboardService (options) {
  const { settingsService, quickCaptureService } = options
  const clipboardReader = options.clipboardReader || createDefaultClipboardReader()

  let isStarted = false
  let isProcessing = false
  let hasPendingCapture = false
  let lastStateLog = null
  let lastCapturedAt = null
  let lastReason = 'disabled:initial'
  let lastReasonAt = null

  // 诊断变更事件订阅
  const diagnosticsChangedListeners = []

  /**
   * 刷新监听状态
   */
  function refresh () {
    if (shouldCaptureClipboard()) {
      setReason('enabled')
      start()
    } else {
      setReason(buildDisabledReason())
      stop()
    }
  }

  /**
   * 获取诊断信息
   * @returns {Object}
   */
  function getDiagnostics () {
    return {
      isRecording: shouldCaptureClipboard(),
      isListening: isStarted,
      lastCapturedAt,
      lastReason,
      lastReasonAt
    }
  }

  /**
   * 捕获当前剪贴板
   */
  function captureCurrent () {
    captureCurrentClipboardAsync().catch(error => {
      logger.error('QuickCaptureClipboard', `captureCurrent failed: ${error && error.message}`)
    })
  }

  /**
   * 销毁
   */
  function dispose () {
    if (settingsService && typeof settingsService.offSettingsChanged === 'function') {
      settingsService.offSettingsChanged(onSettingsChanged)
    }
    stop()
  }

  /**
   * 订阅诊断变更
   * @param {Function} listener
   */
  function onDiagnosticsChanged (listener) {
    if (typeof listener === 'function') {
      diagnosticsChangedListeners.push(listener)
    }
  }

  /**
   * 取消订阅诊断变更
   * @param {Function} listener
   */
  function offDiagnosticsChanged (listener) {
    const index = diagnosticsChangedListeners.indexOf(listener)
    if (index >= 0) {
      diagnosticsChangedListeners.splice(index, 1)
    }
  }

  /**
   * 判断是否应当捕获剪贴板
   */
  function shouldCaptureClipboard () {
    const settings = settingsService.getSettings()
    return settings.quickCaptureEnabled && settings.quickCaptureClipboardEnabled
  }

  /**
   * 构造禁用原因
   */
  function buildDisabledReason () {
    const settings = settingsService.getSettings()
    if (!settings.quickCaptureEnabled) return 'disabled:quick-capture-off'
    if (!settings.quickCaptureClipboardEnabled) return 'disabled:clipboard-off'
    return 'disabled:unknown'
  }

  /**
   * 记算规范化最近项上限
   */
  function normalizeRecentLimit (value) {
    const n = Math.max(1, Math.min(100, parseInt(value, 10) || 10))
    return n
  }

  /**
   * 记算状态日志
   */
  function logState (state) {
    if (lastStateLog === state) return
    lastStateLog = state
    logger.debug('QuickCaptureClipboard', `State ${state}`)
  }

  /**
   * 设置变更回调
   */
  function onSettingsChanged () {
    refresh()
  }

  /**
   * 启动监听
   */
  function start () {
    if (isStarted) return
    clipboardReader.onContentChanged(clipboardContentChanged)
    isStarted = true
    logger.info('QuickCaptureClipboard', 'Started')
    captureCurrentClipboardAsync().catch(error => {
      logger.error('QuickCaptureClipboard', `initial capture failed: ${error && error.message}`)
    })
  }

  /**
   * 停止监听
   */
  function stop () {
    if (!isStarted) return
    clipboardReader.offContentChanged(clipboardContentChanged)
    isStarted = false
    logger.info('QuickCaptureClipboard', 'Stopped')
  }

  /**
   * 剪贴板内容变化回调
   */
  function clipboardContentChanged () {
    logger.debug('QuickCaptureClipboard', 'ContentChanged')
    captureCurrentClipboardAsync().catch(error => {
      logger.error('QuickCaptureClipboard', `content changed capture failed: ${error && error.message}`)
    })
  }

  /**
   * 异步捕获当前剪贴板
   */
  async function captureCurrentClipboardAsync () {
    if (!shouldCaptureClipboard()) {
      setReason(buildDisabledReason())
      return
    }

    if (isProcessing) {
      hasPendingCapture = true
      return
    }

    isProcessing = true
    try {
      do {
        hasPendingCapture = false
        if (!shouldCaptureClipboard()) {
          setReason(buildDisabledReason())
          return
        }

        const content = await clipboardReader.readContentAsync()
        if (!content || (!content.hasImage && !content.text)) {
          setReason('ignored:empty-or-unsupported')
          continue
        }

        if (clipboardWriteScope.shouldIgnore(content)) {
          setReason('ignored:widget-write')
          continue
        }

        const settings = settingsService.getSettings()
        const maxItems = normalizeRecentLimit(settings.quickCaptureRecentLimit)
        let item = null
        if (content.hasImage) {
          if (!settings.quickCaptureImageClipboardEnabled) {
            setReason('ignored:image-recording-off')
            continue
          }

          if (!content.imagePngBytes || content.imagePngBytes.length > MAX_CLIPBOARD_IMAGE_BYTES) {
            setReason('ignored:image-too-large')
            continue
          }

          item = await quickCaptureService.addRecentClipboardImageAsync(content.imagePngBytes, maxItems)
        } else {
          const text = content.text
          if (text.length > MAX_CLIPBOARD_TEXT_CHARACTERS) {
            setReason('ignored:text-too-large')
            continue
          }

          item = await quickCaptureService.addRecentClipboardItemAsync(text, maxItems)
        }

        if (!item) {
          setReason('ignored:duplicate-or-app-write')
        } else {
          lastCapturedAt = new Date()
          setReason(`captured:${item.type}`)
        }
      } while (hasPendingCapture)
    } catch (error) {
      setReason('failed:read-or-save')
      logger.error('QuickCaptureClipboard', `Failed to capture clipboard: ${error && error.message}`)
    } finally {
      isProcessing = false
    }
  }

  /**
   * 设置原因
   */
  function setReason (reason) {
    lastReason = reason
    lastReasonAt = new Date()
    logState(reason)
    for (const listener of diagnosticsChangedListeners) {
      try {
        listener()
      } catch (error) {
        logger.warn('QuickCaptureClipboard', `diagnostics listener failed: ${error && error.message}`)
      }
    }
  }

  // 订阅设置变更
  if (settingsService && typeof settingsService.onSettingsChanged === 'function') {
    settingsService.onSettingsChanged(onSettingsChanged)
  }

  return {
    refresh,
    getDiagnostics,
    captureCurrent,
    dispose,
    onDiagnosticsChanged,
    offDiagnosticsChanged
  }
}

/**
 * 创建默认剪贴板读取器（基于 Electron clipboard）
 * 注意：Electron clipboard 没有原生内容变化事件，需轮询
 */
function createDefaultClipboardReader () {
  let pollTimer = null
  let lastText = null
  let lastImageHash = null
  const contentChangedListeners = []

  /**
   * 启动轮询
   */
  function startPolling () {
    if (pollTimer) return
    pollTimer = setInterval(checkForChanges, 500)
  }

  /**
   * 停止轮询
   */
  function stopPolling () {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /**
   * 检查剪贴板变化
   */
  function checkForChanges () {
    const content = readContentSync()
    if (!content) return

    const currentText = content.text || ''
    const currentImageHash = content.hasImage ? (content.imagePngBytes ? content.imagePngBytes.length.toString() + ':' + (content.imagePngBytes[0] || 0).toString() : '') : ''

    if (currentText !== lastText || currentImageHash !== lastImageHash) {
      lastText = currentText
      lastImageHash = currentImageHash
      for (const listener of contentChangedListeners) {
        try {
          listener()
        } catch {
          // 忽略监听器错误
        }
      }
    }
  }

  /**
   * 同步读取剪贴板内容
   */
  function readContentSync () {
    try {
      const text = clipboard.readText()
      const imageBuffer = clipboard.readImage().toPNG()
      const hasImage = imageBuffer && imageBuffer.length > 0
      return {
        text,
        hasImage,
        imagePngBytes: hasImage ? imageBuffer : null
      }
    } catch (error) {
      logger.warn('QuickCaptureClipboard', `readContent failed: ${error && error.message}`)
      return null
    }
  }

  return {
    /**
     * 异步读取内容
     * @returns {Promise<Object>}
     */
    async readContentAsync () {
      return readContentSync()
    },

    /**
     * 订阅内容变化
     * @param {Function} listener
     */
    onContentChanged (listener) {
      if (typeof listener === 'function') {
        contentChangedListeners.push(listener)
        startPolling()
      }
    },

    /**
     * 取消订阅内容变化
     * @param {Function} listener
     */
    offContentChanged (listener) {
      const index = contentChangedListeners.indexOf(listener)
      if (index >= 0) {
        contentChangedListeners.splice(index, 1)
      }
      if (contentChangedListeners.length === 0) {
        stopPolling()
      }
    }
  }
}

module.exports = {
  MAX_CLIPBOARD_TEXT_CHARACTERS,
  MAX_CLIPBOARD_IMAGE_BYTES,
  createQuickCaptureClipboardService,
  createDefaultClipboardReader
}