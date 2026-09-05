# 贡献指南

感谢你对 Starst Desk 的关注！欢迎参与项目共建。请先阅读本文档。

## 行为准则

参与本项目即表示你同意遵守 [《贡献者公约》](CODE_OF_CONDUCT.md)。请保持友善、尊重的交流氛围。

## 开发环境

| 项 | 要求 |
|----|------|
| 操作系统 | Windows 10 / 11（目标平台） |
| Node.js | >= 18 |
| 包管理器 | pnpm（项目使用 pnpm-lock.yaml 锁定版本） |
| Python | 仅在重新编译原生模块异常时可能需要 |

### 准备工作

```bash
# 启用 pnpm（若未安装）
npm install -g pnpm

# 安装依赖（会自动执行 electron-rebuild 编译 better-sqlite3）
pnpm install

# 启动开发环境（Vite + Electron，支持 HMR）
pnpm dev
```

> 若 `better-sqlite3` 报兼容性错误，执行 `pnpm rebuild` 重新编译。

## 项目结构速览

```
electron/   主进程（CommonJS，可访问 Node API）
  ├── core/       核心服务（窗口/托盘/调度/通知等）
  ├── dao/        数据访问层（better-sqlite3）
  ├── ipc/        IPC 通道处理器
  ├── adapters/   AI 模型适配器
  ├── services/   业务服务
  ├── modules/    业务模块
  └── utils/      工具函数
src/        渲染进程（Vue 3，ES modules，禁止直接访问 Node API）
migrations/ 数据库迁移脚本（按序号递增，不可修改已发布迁移）
tests/      单元测试（node:test）
```

## 编码规范

- **命名**：JavaScript/TypeScript 使用 camelCase；Vue 组件文件使用 PascalCase；样式使用 SCSS + Dart Sass。
- **缩进**：2 空格，行尾 LF，文件末尾保留空行（详见 `.editorconfig`）。
- **IPC 通道**：命名格式 `module:action`，统一响应 `{ ok, data }` 或 `{ ok: false, error }`。
- **安全**：渲染进程禁止直接访问 Node API，所有跨进程调用经 `preload.js` 的 contextBridge 白名单暴露。
- **注释与风格**：与所在文件保持一致，不引入无关依赖。
- **不随意添加注释**，除非确有必要。

## 提交规范

采用约定式提交（Conventional Commits）：

```
<type>: <subject>

[可选正文]
```

| type | 含义 |
|------|------|
| feat | 新功能 |
| fix | 缺陷修复 |
| refactor | 重构（不改行为） |
| perf | 性能优化 |
| docs | 文档 |
| test | 测试 |
| chore | 构建/工具/杂项 |
| style | 格式（不影响逻辑） |

示例：`feat: 新增桌宠键盘敲击反馈动画`

## 数据库迁移

- 新增迁移在 `migrations/` 下创建 `0XX_描述.sql`，序号递增、不复用。
- **已发布的迁移文件不可修改**，如需变更请新增迁移。
- 迁移由 `electron/core/migration.js` 在启动时按序执行。

## 测试

```bash
pnpm test              # 全量
pnpm test:dao          # 数据访问层
pnpm test:core         # 核心模块
pnpm test:adapters     # AI 适配器
pnpm test:utils        # 工具函数
pnpm test:modules      # 业务模块
```

提交前请确保相关测试通过。

## 提交 Pull Request

1. 基于 `main` 创建特性分支：`git checkout -b feat/xxx`
2. 保持分支聚焦，一个 PR 解决一个问题
3. 确保本地测试通过：`pnpm test`
4. 提交前请自测应用能正常启动：`pnpm dev`
5. 在 PR 中说明改动内容、动机与测试方式
6. 若涉及 UI 变更，附上前后对比截图

## 报告缺陷

请使用 GitHub Issue 模板提交，并附上复现步骤、系统环境与日志（位于 `%APPDATA%\StarstDesk\logs`）。**请勿在 Issue 中粘贴 API Key 等敏感信息。**

## 安全问题

若发现安全漏洞，请勿公开 Issue，参见 [SECURITY.md](SECURITY.md) 私密上报。