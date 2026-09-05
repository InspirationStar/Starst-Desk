-- ============================================================
-- AI 配置上下文设置字段调整 (schema_version = 4)
-- 任务：
--   1. context_length（消息条数）重命名为 context_tokens（输入Token上限，0 表示不限制）
--   2. 新增 max_tokens（输出Token上限，0 表示使用模型默认）
--
-- 背景：
--   003 migration 已引入 context_length（按消息条数截断）。
--   实际使用中按 Token 限制更精确，且需要单独控制输出长度。
--   SQLite 3.25+ 支持 ALTER TABLE RENAME COLUMN，
--   better-sqlite3 11.x 内置 SQLite 3.40+，可直接使用。
--
-- 执行顺序保证：
--   migration 按版本号顺序执行，003 先于 004。
--   003 执行后 context_length 列必定存在，RENAME COLUMN 安全。
-- ============================================================

-- 重命名 context_length -> context_tokens（语义从"消息条数"改为"输入Token上限"）
ALTER TABLE ai_configs RENAME COLUMN context_length TO context_tokens;

-- 新增 max_tokens 字段（输出Token上限，0 表示使用模型默认值）
ALTER TABLE ai_configs ADD COLUMN max_tokens INTEGER NOT NULL DEFAULT 0;