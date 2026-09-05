# 安全策略

## 报告漏洞

若你发现 Starst Desk 的安全漏洞，请**不要**通过公开 Issue 提交。请通过 GitHub Security Advisory 私密上报：

1. 前往仓库页面，点击 **Security** → **Report a vulnerability**，或直接访问：
   `https://github.com/InspirationStar/Starst-Desk/security/advisories/new`
2. 描述漏洞、复现步骤与影响范围
3. 若可能，附上修复建议

我们会在收到报告后尽快确认并跟进。

## 敏感信息

- **请勿在 Issue、PR、截图或日志中包含 API Key、Token、密码等敏感信息。**
- 应用内的 AI 模型配置（API Key 等）仅存储于本地数据库 `%APPDATA%\StarstDesk`，不会上传至任何远端服务。
- 提交截图前请确认已遮挡配置中的密钥字段。

## 支持版本

安全更新仅针对最新的 `main` 分支与最近的发布版本。