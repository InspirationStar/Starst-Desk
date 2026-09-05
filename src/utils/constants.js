// ============================================================
// 渲染进程常量定义
// 职责：颜色标签、模块类型等业务常量
// ============================================================

// 便签颜色标签
export const NOTE_COLORS = [
  { value: 'yellow', label: '黄色', color: '#fef0c7' },
  { value: 'red', label: '红色', color: '#fde2e2' },
  { value: 'orange', label: '橙色', color: '#fde8d4' },
  { value: 'green', label: '绿色', color: '#d4f0d4' },
  { value: 'blue', label: '蓝色', color: '#d4e4f7' },
  { value: 'purple', label: '紫色', color: '#e4d4f7' }
]

// 健康提醒子模块类型
export const HEALTH_MODULES = [
  { value: 'water', label: '喝水', icon: 'Cup' },
  { value: 'sedentary', label: '久坐', icon: 'Postcard' },
  { value: 'eye', label: '护眼', icon: 'View' },
  { value: 'stretch', label: '运动伸展', icon: 'Basketball' },
  { value: 'sleep', label: '睡眠', icon: 'Moon' },
  { value: 'diet', label: '饮食', icon: 'Food' }
]

// 定时任务类型
export const TASK_TYPES = [
  { value: 'one_shot', label: '一次性任务' },
  { value: 'recurring', label: '循环任务' }
]

// 定时任务动作类型
export const ACTION_TYPES = [
  { value: 'message', label: '显示消息' },
  { value: 'open_app', label: '打开应用' },
  { value: 'exec_command', label: '执行系统命令' },
  { value: 'open_url', label: '打开网址' },
  { value: 'shutdown', label: '关机' }
]

// AI 模型提供商类型
export const AI_PROVIDERS = [
  { value: 'ollama', label: 'Ollama（本地）' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'custom', label: '自定义（OpenAI 兼容）' }
]

// 主题类型
export const THEMES = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

export default {
  NOTE_COLORS,
  HEALTH_MODULES,
  TASK_TYPES,
  ACTION_TYPES,
  AI_PROVIDERS,
  THEMES
}