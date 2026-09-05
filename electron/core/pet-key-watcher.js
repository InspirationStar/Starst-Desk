// ============================================================
// 桌宠键盘敲击监听服务
// 职责：轮询检测全局键盘敲击，按粗粒度分类后推送到桌宠窗口，
//       用于科技球等桌宠形象的敲击反馈动画
// 数据安全：仅推送按键分类（letter/number/space/...），
//           不上传具体按键字符、不落库、不记录，符合去敏感化要求
// 依赖：koffi FFI 调用 GetAsyncKeyState（无 PowerShell、无外部进程）
// 实现选择：轮询常用键集（约 60 键），而非低级键盘钩子
//   - 无消息泵兼容性问题，稳定可靠，零新依赖
//   - 覆盖字母/数字/空格/回车/退格/Tab/方向键/修饰键，足够"不同键区别反馈"
// ============================================================

const logger = require('./logger.js')

// 轮询间隔（毫秒）：50ms = 20Hz，足以捕捉连续敲击的按下沿（人类最快敲击约 10Hz）
const POLL_INTERVAL = 50

// 虚拟键码工具：生成 [start, end] 闭区间数组
function vkRange (start, end) {
  const arr = []
  for (let i = start; i <= end; i++) arr.push(i)
  return arr
}

// 按键分类与虚拟键码映射（仅覆盖常用键集，只检测"按下沿"）
// 分类语义（供渲染层做差异化反馈）：
//   letter 字母 / number 数字 / space 空格 / enter 回车 / backspace 退格
//   tab Tab / arrow 方向键 / modifier 修饰键(Shift/Ctrl/Alt/Win) / escape Esc
const KEY_MAP = [
  { category: 'letter', codes: vkRange(0x41, 0x5A) },               // A-Z
  { category: 'number', codes: vkRange(0x30, 0x39) },               // 0-9
  { category: 'space', codes: [0x20] },                              // VK_SPACE
  { category: 'enter', codes: [0x0D] },                              // VK_RETURN
  { category: 'backspace', codes: [0x08] },                          // VK_BACK
  { category: 'tab', codes: [0x09] },                                // VK_TAB
  { category: 'escape', codes: [0x1B] },                             // VK_ESCAPE
  { category: 'arrow', codes: [0x25, 0x26, 0x27, 0x28] },            // ← ↑ → ↓
  { category: 'modifier', codes: [0x10, 0x11, 0x12, 0x5B, 0x5C] }    // Shift/Ctrl/Alt/Win
]

// koffi Win32 API 句柄（懒加载，首次调用时初始化）
let win32Api = null
// 轮询定时器
let timer = null
// 上一帧按键按下状态（vk -> boolean），用于检测按下沿
let prevDown = new Map()
// 桌宠窗口管理器（start 时注入，避免模块循环依赖）
let petWindowManager = null

/**
 * 初始化 koffi Win32 API 绑定
 * 仅在 Windows 平台首次调用时加载 user32.dll
 * @returns {Object|null} API 函数集合，null 表示不可用
 */
function initWin32Api () {
  if (win32Api !== null) return win32Api
  if (process.platform !== 'win32') return null

  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    // GetAsyncKeyState 返回 SHORT，高位（bit15）表示当前是否按下
    win32Api = {
      GetAsyncKeyState: user32.func('int16_t GetAsyncKeyState(int vKey)')
    }
    logger.info('PetKeyWatcher', 'koffi Win32 API 初始化成功，键盘敲击监听将使用 FFI')
  } catch (err) {
    logger.warn('PetKeyWatcher', `koffi 初始化失败: ${err.message}，键盘敲击监听不可用`)
    win32Api = false
  }

  return win32Api && win32Api.GetAsyncKeyState ? win32Api : null
}

/**
 * 获取桌宠目标窗口（仅在窗口存在且可见时推送）
 * @returns {BrowserWindow|null}
 */
function getTargetWindow () {
  if (!petWindowManager) return null
  const win = petWindowManager.getPetWindow()
  if (!win || win.isDestroyed() || !win.isVisible()) return null
  return win
}

/**
 * 每帧轮询：读取所有关注键的按下状态，检测按下沿并推送
 */
function poll () {
  const api = win32Api
  if (!api) return

  // 提前检查目标窗口，避免无窗口时 FFI 调用空转
  const target = getTargetWindow()
  if (!target) return

  // 收集本帧触发的按下沿（按分类去重，同分类一次敲击只推一次）
  const triggered = {}
  for (const { category, codes } of KEY_MAP) {
    for (const vk of codes) {
      const down = (api.GetAsyncKeyState(vk) & 0x8000) !== 0
      const wasDown = prevDown.get(vk) === true
      if (down && !wasDown) {
        triggered[category] = true
      }
      prevDown.set(vk, down)
    }
  }

  const categories = Object.keys(triggered)
  if (categories.length === 0) return

  for (const category of categories) {
    target.webContents.send('pet:key-input', { category })
  }
}

/**
 * 启动键盘敲击监听
 */
function start () {
  if (timer !== null) {
    logger.warn('PetKeyWatcher', '键盘敲击监听已在运行，跳过启动')
    return
  }
  if (!initWin32Api()) {
    logger.warn('PetKeyWatcher', 'koffi 不可用，键盘敲击监听无法启动')
    return
  }
  // 延迟注入桌宠窗口管理器，避免模块加载顺序导致的循环依赖
  petWindowManager = require('./pet-window-manager.js')
  prevDown.clear()
  timer = setInterval(poll, POLL_INTERVAL)
  logger.info('PetKeyWatcher', '键盘敲击监听已启动')
}

/**
 * 停止键盘敲击监听
 */
function stop () {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
  prevDown.clear()
  petWindowManager = null
  logger.info('PetKeyWatcher', '键盘敲击监听已停止')
}

module.exports = { start, stop }