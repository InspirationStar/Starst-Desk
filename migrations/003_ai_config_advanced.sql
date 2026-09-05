-- ============================================================
-- AI 配置高级设置扩展 (schema_version = 3)
-- 任务：ai_configs 表新增高级设置字段并扩展 provider_type 约束
--
-- 变更内容：
--   1. 新增 context_length 字段（上下文轮数，0 表示不限制）
--   2. 新增 enable_thinking 字段（是否启用思考模式，0/1）
--   3. 新增 enable_vision 字段（是否启用图片输入，0/1）
--   4. provider_type 约束新增 openai / anthropic / gemini
--
-- 实现策略：
--   SQLite 不支持 ALTER TABLE 修改 CHECK 约束，
--   且 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS 语法。
--   采用重建表策略一次性完成字段新增与约束扩展，
--   避免分步 ADD COLUMN 在重复执行时因字段已存在而报错。
--   迁移系统(database.js)通过 schema_version 机制保证每个脚本仅执行一次。
--
-- 外键处理：
--   chat_sessions 表有外键引用 ai_configs(id) ON DELETE RESTRICT，
--   重建表时 DROP TABLE 会触发隐式 DELETE，可能因外键约束失败。
--   使用 PRAGMA defer_foreign_keys = ON 延迟外键检查到事务提交，
--   提交时新表已就位、数据已就绪，外键引用完整，检查通过。
--   该 pragma 在事务内有效，事务结束自动重置为 OFF。
-- ============================================================

-- 延迟外键约束检查到事务提交，避免重建表过程中外键违反
PRAGMA defer_foreign_keys = ON;

-- 步骤 1：清理可能残留的临时表（保证可重复执行不报错）
DROP TABLE IF EXISTS ai_configs_v3_tmp;

-- 步骤 2：创建新表，包含原有字段 + 三个新增字段 + 扩展后的 provider_type 约束
CREATE TABLE ai_configs_v3_tmp (
    id                 TEXT PRIMARY KEY,
    provider_type      TEXT NOT NULL,
    name               TEXT NOT NULL,
    api_endpoint       TEXT NOT NULL,
    api_key_encrypted  TEXT,
    model_name         TEXT NOT NULL,
    is_active          INTEGER NOT NULL DEFAULT 0,
    context_length     INTEGER DEFAULT 0,           -- 上下文轮数（0 表示不限制）
    enable_thinking    INTEGER NOT NULL DEFAULT 0,  -- 是否启用思考模式（0/1）
    enable_vision      INTEGER NOT NULL DEFAULT 0,  -- 是否启用图片输入（0/1）
    created_at         TEXT NOT NULL,
    CONSTRAINT chk_provider_type_v3 CHECK (
        provider_type IN ('ollama', 'deepseek', 'custom', 'openai', 'anthropic', 'gemini')
    ),
    CONSTRAINT chk_ai_active_v3 CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_ai_thinking CHECK (enable_thinking IN (0, 1)),
    CONSTRAINT chk_ai_vision CHECK (enable_vision IN (0, 1))
);

-- 步骤 3：从旧表复制数据到临时表，新增字段使用默认值 0
INSERT INTO ai_configs_v3_tmp (
    id, provider_type, name, api_endpoint, api_key_encrypted,
    model_name, is_active, context_length, enable_thinking, enable_vision, created_at
)
SELECT
    id, provider_type, name, api_endpoint, api_key_encrypted,
    model_name, is_active, 0, 0, 0, created_at
FROM ai_configs;

-- 步骤 4：删除旧表（外键检查已延迟，不会在此处报错）
DROP TABLE ai_configs;

-- 步骤 5：将临时表重命名为正式表名，外键引用按表名自动恢复
ALTER TABLE ai_configs_v3_tmp RENAME TO ai_configs;