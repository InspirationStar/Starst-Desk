# 变更日志

本项目遵循 [约定式提交](https://www.conventionalcommits.org/zh-hans/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- 开源发布准备：补充 LICENSE、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY 等文档
- GitHub Issue / PR 模板与 CI 工作流

## [1.0.0] - 2026

### 新增
- 便签提醒：富文本便签管理与定时提醒
- 待办与规划：今日任务、任务流、项目、专注模式、专注护盾、AI 规划、成就系统
- 定时任务：一次性/循环任务调度与命令执行
- 健康提醒：喝水、久坐、护眼、伸展、睡眠、饮食六大提醒及统计
- AI 对话：支持 Ollama / DeepSeek / OpenAI / Anthropic / Gemini / 自定义模型的流式对话，附件与资产盒子
- 桌面小部件：多种小部件、全局热键、材质管理、胶囊模式
- 桌宠：桌面宠物与键盘敲击反馈
- 灵动岛：通知与状态展示
- 活动统计：活动监测与键盘统计
- 全局搜索、新手引导、发布说明
- 应用设置：数据目录可配置、备份/恢复、缓存管理、开机自启
- 桌面整理、标签搜索、生产力小组件
- 托盘动画与 widget 表面管理

### 技术栈
- Electron + Vue 3 + Vite + Element Plus + Pinia + Vue Router
- better-sqlite3 本地数据库，按序号迁移
- contextBridge 安全隔离，IPC 白名单通道