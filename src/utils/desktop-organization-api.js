// ============================================================
// IPC 客户端扩展 - Desktop Organization API
// ============================================================

// 净化 IPC 传输数据：将 Vue reactive Proxy 转为纯普通对象
// Electron 结构化克隆算法无法克隆 Proxy，会报 "An object could not be cloned."
function sanitize (data) {
  if (data == null) return data
  return JSON.parse(JSON.stringify(data))
}

export const desktopOrgApi = {
  // 扫描桌面文件
  scan: () => window.electronAPI.invoke('desktop-organization:scan'),
  // 预览整理方案
  preview: (data) => window.electronAPI.invoke('desktop-organization:preview', sanitize(data)),
  // 执行整理
  execute: (data) => window.electronAPI.invoke('desktop-organization:execute', sanitize(data)),
  // 撤销整理
  undo: (data) => window.electronAPI.invoke('desktop-organization:undo', sanitize(data)),
  // 获取历史
  history: () => window.electronAPI.invoke('desktop-organization:history')
}