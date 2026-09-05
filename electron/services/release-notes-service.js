// ============================================================
// 发布说明服务（主进程）
// 职责：提供版本发布说明（changelog）
// 简化实现：内置 changelog，不依赖外部文件
// ============================================================

const logger = require('./../core/logger.js')

// ============================================================
// 内置发布说明（按版本号降序）
// ============================================================
const RELEASE_NOTES = [
  {
    version: '1.0.0',
    date: '2026-08-25',
    title: 'Starst Desk 1.0.0 发布',
    sections: [
      {
        title: '新增功能',
        items: [
          '便签提醒：支持创建带提醒的便签，颜色标签，置顶',
          '待办&规划：待办事项管理，支持截止日期、重复规则、颜色标签、附件',
          '定时任务：单次/重复任务，支持消息提醒、打开应用、执行命令、打开 URL',
          '健康提醒：六大健康模块（喝水、久坐、护眼、拉伸、睡眠、饮食）',
          'AI 对话：多模型支持（OpenAI/Anthropic/Gemini/DeepSeek/Ollama/Agnes）',
          '桌面小部件：9 种小部件（便签/任务/健康/待办/文件/随记/天气/音乐/桌面整理）',
          '桌宠：桌面宠物，支持健康提醒推送',
          '活动统计：键鼠活动、前台窗口采样、空闲检测',
          'AI 媒体生成：图像生成、视频生成（Agnes AI）',
          '全局搜索：聚合搜索便签/待办/任务/会话/设置/文件',
          '数据备份/恢复：完整数据备份与恢复'
        ]
      },
      {
        title: '技术栈',
        items: [
          'Electron + Vue 3 + Vite + Element Plus + better-sqlite3',
          'SCSS + Dart Sass，支持暗色主题',
          'Pinia 状态管理，Vue Router 路由'
        ]
      }
    ]
  }
]

/**
 * 获取所有发布说明
 * @returns {Array}
 */
function list () {
  return RELEASE_NOTES
}

/**
 * 获取当前版本的发布说明
 * @returns {object|null}
 */
function getCurrent () {
  return RELEASE_NOTES[0] || null
}

/**
 * 获取指定版本的发布说明
 * @param {string} version
 * @returns {object|null}
 */
function getByVersion (version) {
  return RELEASE_NOTES.find(n => n.version === version) || null
}

module.exports = {
  list,
  getCurrent,
  getByVersion
}