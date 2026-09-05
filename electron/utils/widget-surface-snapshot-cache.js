// ============================================================
// 小部件表面快照缓存（纯逻辑）
// 职责：表面切换过渡视觉用的像素预算 LRU 缓存
//   - 不持有活动成员的 ViewModel 或 XAML 树
//   - 同时受像素总预算与条目数上限约束
// 类型映射：
//   C# TSnapshot : class   → JS 任意对象（引用语义）
//   C# long pixels           → JS number（安全整数）
//   C# LinkedList<string>   → JS 数组模拟双向链表（用 Map 维护节点引用）
//   C# lock _gate           → JS 串行调用约定（Node 单线程）
// 纯逻辑模块：不依赖 Vue/Electron，可独立单元测试
// ============================================================

// ------------------------------------------------------------
// 工具：参数校验
// ------------------------------------------------------------

/**
 * 校验非空字符串
 * @param {string} value
 * @param {string} name
 */
function throwIfNullOrWhiteSpace (value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    throw new Error(`${name} 不能为空字符串`)
  }
}

/**
 * 校验非空对象
 * @param {*} value
 * @param {string} name
 */
function throwIfNull (value, name) {
  if (value === null || value === undefined) {
    throw new Error(`${name} 不能为 null / undefined`)
  }
}

// ------------------------------------------------------------
// 简易双向链表（用于 LRU 顺序维护）
// ------------------------------------------------------------

/**
 * 创建双向链表
 * @returns {object}
 */
function createDoublyLinkedList () {
  // 头节点（哨兵），next 指向首元素，prev 指向尾元素
  const head = { value: null, prev: null, next: null }
  head.prev = head
  head.next = head
  const nodeMap = new Map()

  return {
    /**
     * 把 value 加到链表头部，返回节点句柄
     * @param {string} value
     * @returns {object}
     */
    addFirst (value) {
      const node = { value, prev: head, next: head.next }
      head.next.prev = node
      head.next = node
      nodeMap.set(value, node)
      return node
    },

    /**
     * 移除节点
     * @param {object} node
     */
    removeNode (node) {
      node.prev.next = node.next
      node.next.prev = node.prev
      nodeMap.delete(node.value)
    },

    /**
     * 把指定 value 移到头部（若存在）
     * @param {string} value
     */
    touchFirst (value) {
      const node = nodeMap.get(value)
      if (!node) return
      if (node === head.next) return
      this.removeNode(node)
      this.addFirst(value)
    },

    /**
     * 移除指定 value 的节点
     * @param {string} value
     * @returns {boolean} 是否成功移除
     */
    remove (value) {
      const node = nodeMap.get(value)
      if (!node) return false
      this.removeNode(node)
      return true
    },

    /**
     * 取尾节点 value（最近最少使用）
     * @returns {string|null}
     */
    lastValue () {
      return head.prev === head ? null : head.prev.value
    },

    /**
     * 清空
     */
    clear () {
      head.prev = head
      head.next = head
      nodeMap.clear()
    },

    /**
     * 当前大小
     * @returns {number}
     */
    get size () {
      return nodeMap.size
    }
  }
}

// ------------------------------------------------------------
// WidgetSurfaceSnapshotCache：表面快照缓存
// ------------------------------------------------------------

/**
 * 创建表面快照缓存
 * 移植自 C# sealed class WidgetSurfaceSnapshotCache<TSnapshot>
 * @param {number} pixelBudget - 像素总预算（必须 > 0）
 * @param {number} [entryLimit=3] - 条目数上限（必须 > 0）
 * @returns {object} 缓存实例
 */
function createSurfaceSnapshotCache (pixelBudget, entryLimit = 3) {
  if (pixelBudget <= 0) {
    throw new Error('pixelBudget 必须大于 0')
  }
  if (entryLimit <= 0) {
    throw new Error('entryLimit 必须大于 0')
  }

  // memberId -> { snapshot, pixels, node }
  const entries = new Map()
  const lru = createDoublyLinkedList()
  let totalPixels = 0

  /**
   * 内部移除
   * 移植自 C# RemoveCore
   * @param {string} memberId
   * @returns {boolean}
   */
  function removeCore (memberId) {
    const entry = entries.get(memberId)
    if (!entry) return false
    entries.delete(memberId)
    lru.remove(memberId)
    totalPixels -= entry.pixels
    return true
  }

  return {
    /**
     * 像素预算
     * 对齐 C# PixelBudget
     * @returns {number}
     */
    get pixelBudget () {
      return pixelBudget
    },

    /**
     * 当前总像素
     * 对齐 C# TotalPixels
     * @returns {number}
     */
    get totalPixels () {
      return totalPixels
    },

    /**
     * 当前条目数
     * 对齐 C# Count
     * @returns {number}
     */
    get count () {
      return entries.size
    },

    /**
     * 添加或更新快照
     * 移植自 C# AddOrUpdate
     * 算法：
     *   1. 计算像素（至少 1x1）
     *   2. 移除旧条目
     *   3. 若单条超过预算，直接丢弃
     *   4. 加入头部，循环淘汰尾部直到满足预算与条目上限
     * @param {string} memberId
     * @param {*} snapshot
     * @param {number} pixelWidth
     * @param {number} pixelHeight
     */
    addOrUpdate (memberId, snapshot, pixelWidth, pixelHeight) {
      throwIfNullOrWhiteSpace(memberId, 'memberId')
      throwIfNull(snapshot, 'snapshot')
      // C# checked((long)Math.Max(1, pixelWidth) * Math.Max(1, pixelHeight))
      const pixels = Math.max(1, pixelWidth) * Math.max(1, pixelHeight)

      removeCore(memberId)
      if (pixels > pixelBudget) return

      const node = lru.addFirst(memberId)
      entries.set(memberId, { snapshot, pixels, node })
      totalPixels += pixels
      // 淘汰尾部直到满足预算与条目上限
      while ((totalPixels > pixelBudget || entries.size > entryLimit)) {
        const lastValue = lru.lastValue()
        if (lastValue === null) break
        removeCore(lastValue)
      }
    },

    /**
     * 尝试获取快照
     * 移植自 C# TryGet
     * 命中后把条目移到 LRU 头部
     * @param {string} memberId
     * @returns {{found: boolean, snapshot: *}}
     */
    tryGet (memberId) {
      const entry = entries.get(memberId)
      if (!entry) return { found: false, snapshot: null }
      lru.touchFirst(memberId)
      return { found: true, snapshot: entry.snapshot }
    },

    /**
     * 移除条目
     * 移植自 C# Remove
     * @param {string} memberId
     * @returns {boolean}
     */
    remove (memberId) {
      return removeCore(memberId)
    },

    /**
     * 清空
     * 移植自 C# Clear
     */
    clear () {
      entries.clear()
      lru.clear()
      totalPixels = 0
    }
  }
}

// ------------------------------------------------------------
// 模块导出
// ------------------------------------------------------------

module.exports = {
  createSurfaceSnapshotCache,
  // 导出内部工具便于单元测试
  createDoublyLinkedList
}