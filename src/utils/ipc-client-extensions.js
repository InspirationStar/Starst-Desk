// ============================================================
// IPC 客户端扩展
// 添加天气和音乐相关的 API
// ============================================================

// 天气 API
export const weatherApi = {
  // 获取天气数据
  getWeather: (city, units = 'metric') => invoke('weather:get-weather', { city, units }),
  // 搜索城市
  searchCities: (query) => invoke('weather:search-cities', { query }),
  // 清除缓存
  clearCache: () => invoke('weather:clear-cache')
}

// 音乐 API
export const musicApi = {
  // 获取播放状态
  getStatus: () => invoke('music:get-status'),
  // 切换播放/暂停
  togglePlay: () => invoke('music:toggle-play'),
  // 播放
  play: () => invoke('music:play'),
  // 暂停
  pause: () => invoke('music:pause'),
  // 下一首
  nextTrack: () => invoke('music:next-track'),
  // 上一首
  prevTrack: () => invoke('music:prev-track'),
  // 设置音量
  setVolume: (volume) => invoke('music:set-volume', { volume }),
  // 更新进度
  updateProgress: (position) => invoke('music:update-progress', { position }),
  // 打开媒体应用
  openApp: () => invoke('music:open-app')
}

// 桌面整理 API
export const desktopOrgApi = {
  // 扫描桌面
  scan: () => invoke('desktop-organization:scan'),
  // 预览整理
  preview: (data) => invoke('desktop-organization:preview', data),
  // 执行整理
  execute: (data) => invoke('desktop-organization:execute', data),
  // 撤销整理
  undo: (data) => invoke('desktop-organization:undo', data),
  // 获取历史
  history: () => invoke('desktop-organization:history')
}

// 更新默认导出
export default {
  invoke,
  send,
  on,
  once,
  removeAllListeners,
  note: noteApi,
  task: taskApi,
  health: healthApi,
  ai: aiApi,
  chat: chatApi,
  system: systemApi,
  widget: widgetApi,
  pet: petApi,
  file: fileApi,
  weather: weatherApi,
  music: musicApi,
  desktopOrg: desktopOrgApi
}