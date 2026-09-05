// ============================================================
// 托盘切换请求队列
// 串行化托盘切换请求，按奇偶性折叠突发请求
// 一次切换是一种意图，而非在前一动画准备期间再启动一次动画
// 折叠挂起的突发请求可避免快速按键重复造成无界动画积压
// ============================================================

const logger = require('./logger.js')

/**
 * 创建托盘切换请求队列
 * @param {Function} toggleAsync 异步切换回调 (source: string) => Promise<void>
 * @returns {Object} 队列实例
 */
function createTrayToggleRequestQueue (toggleAsync) {
  if (typeof toggleAsync !== 'function') {
    throw new TypeError('toggleAsync 必须是函数')
  }

  // 同步原语：Node 单线程下用布尔标志 + 队列即可
  const pending = []
  let workerRunning = false
  let totalRequests = 0
  let effectiveToggles = 0
  let foldedNoOpBatches = 0
  let lastSource = null
  let lastError = null

  /**
   * 入队一次切换请求
   * @param {string} source 来源标识
   * @returns {Promise<void>}
   */
  async function enqueueAsync (source) {
    const completion = createPromiseCompletion()
    pending.push({ source, completion })
    totalRequests++
    lastSource = source
    const pendingCount = pending.length
    const startWorker = !workerRunning
    workerRunning = true

    logger.debug('TrayToggle', `queued source=${source} pending=${pendingCount} startWorker=${startWorker}`)

    if (startWorker) {
      processAsync().catch(error => {
        logger.error('TrayToggle', `worker crashed: ${error && error.message}`)
      })
    }

    return completion.promise
  }

  /**
   * 获取队列快照
   * @returns {Object}
   */
  function getSnapshot () {
    return {
      pendingCount: pending.length,
      workerRunning,
      totalRequests,
      effectiveToggles,
      foldedNoOpBatches,
      lastSource,
      lastError
    }
  }

  /**
   * 处理循环：每次取走整批挂起请求，按奇偶性折叠
   */
  async function processAsync () {
    while (true) {
      if (pending.length === 0) {
        workerRunning = false
        return
      }

      const batch = pending.splice(0, pending.length)

      try {
        // 偶数次切换回到同一请求状态
        // 在批处理 accounted 之后完成所有请求，使调用方不会观察到请求仍在队列中
        if ((batch.length & 1) !== 0) {
          const source = batch[batch.length - 1].source
          effectiveToggles++
          lastSource = source
          logger.debug('TrayToggle', `processing source=${source} batch=${batch.length} effective=toggle`)
          await toggleAsync(source)
        } else {
          foldedNoOpBatches++
          logger.debug('TrayToggle', `processing batch=${batch.length} effective=no-op`)
        }

        for (const request of batch) {
          request.completion.resolve()
        }
      } catch (error) {
        lastError = error && error.message
        logger.error('TrayToggle', `processing failed batch=${batch.length}: ${error && error.message}`)
        for (const request of batch) {
          request.completion.reject(error)
        }
      }
    }
  }

  return {
    enqueueAsync,
    getSnapshot
  }
}

/**
 * 创建一个可外部 resolve/reject 的 Promise
 */
function createPromiseCompletion () {
  let resolveFn
  let rejectFn
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })
  return {
    promise,
    resolve: resolveFn,
    reject: rejectFn
  }
}

module.exports = {
  createTrayToggleRequestQueue
}