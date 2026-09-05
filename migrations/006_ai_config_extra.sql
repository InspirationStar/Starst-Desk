-- ============================================================
-- AI 配置扩展字段与 Agnes 媒体提供商支持 (schema_version = 6)
-- 任务：ai_configs 表新增 extra_config / model_category 字段，
--       并扩展 provider_type 约束以支持 agnes-* 类型
--
-- 变更内容：
--   1. 新增 extra_config 字段（TEXT，JSON 字符串，存储模型特定参数：
--      size、ratio、num_frames、frame_rate、aspect_ratio、seconds、mode 等）
--   2. 新增 model_category 字段（TEXT NOT NULL DEFAULT 'language'，
--      取值 language / image / video，用于区分模型类别）
--   3. provider_type 约束新增 agnes-image / agnes-video / agnes-all
--   4. 新增 model_category CHECK 约束
--
-- 实现策略：
--   SQLite 不支持 ALTER TABLE 修改 CHECK 约束，
--   采用重建表策略一次性完成字段新增与约束扩展。
--   迁移系统(database.js)通过 schema_version 机制保证每个脚本仅执行一次。
--
-- 外键处理：
--   chat_sessions 表有外键引用 ai_configs(id) ON DELETE RESTRICT，
--   使用 PRAGMA defer_foreign_keys = ON 延迟外键检查到事务提交。
--   该 pragma 在事务内有效，事务结束自动重置为 OFF。
--
-- 数据迁移：
--   extra_config 设为 NULL（旧配置无扩展参数）
--   model_category 根据 provider_type 推导：
--     agnes-image -> image, agnes-video -> video, 其余 -> language
-- ============================================================

-- 延迟外键约束检查到事务提交，避免重建表过程中外键违反
PRAGMA defer_foreign_keys = ON;

-- 步骤 1：清理可能残留的临时表（保证可重复执行不报错）
DROP TABLE IF EXISTS ai_configs_v6_tmp;

-- 步骤 2：创建新表，包含原有字段 + 两个新增字段 + 扩展后的约束
CREATE TABLE ai_configs_v6_tmp (
    id                 TEXT PRIMARY KEY,
    provider_type      TEXT NOT NULL,
    name               TEXT NOT NULL,
    api_endpoint       TEXT NOT NULL,
    api_key_encrypted  TEXT,
    model_name         TEXT NOT NULL,
    is_active          INTEGER NOT NULL DEFAULT 0,
    context_tokens     INTEGER DEFAULT 0,              -- 输入Token上限（0 表示不限制）
    max_tokens         INTEGER NOT NULL DEFAULT 0,     -- 输出Token上限（0 表示使用模型默认）
    enable_thinking    INTEGER NOT NULL DEFAULT 0,     -- 是否启用思考模式（0/1）
    enable_vision      INTEGER NOT NULL DEFAULT 0,     -- 是否启用图片输入（0/1）
    extra_config       TEXT,                           -- JSON 字符串，存储模型特定参数
    model_category     TEXT NOT NULL DEFAULT 'language', -- 模型类别：language / image / video
    created_at         TEXT NOT NULL,
    CONSTRAINT chk_provider_type_v6 CHECK (
        provider_type IN (
            'ollama', 'deepseek', 'custom', 'openai', 'anthropic', 'gemini',
            'agnes-image', 'agnes-video', 'agnes-all'
        )
    ),
    CONSTRAINT chk_ai_active_v6 CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_ai_thinking_v6 CHECK (enable_thinking IN (0, 1)),
    CONSTRAINT chk_ai_vision_v6 CHECK (enable_vision IN (0, 1)),
    CONSTRAINT chk_model_category_v6 CHECK (
        model_category IN ('language', 'image', 'video')
    )
);

-- 步骤 3：从旧表复制数据到临时表
--   extra_config 设为 NULL（旧配置无扩展参数）
--   model_category 根据 provider_type 推导
INSERT INTO ai_configs_v6_tmp (
    id, provider_type, name, api_endpoint, api_key_encrypted,
    model_name, is_active, context_tokens, max_tokens,
    enable_thinking, enable_vision, extra_config, model_category, created_at
)
SELECT
    id, provider_type, name, api_endpoint, api_key_encrypted,
    model_name, is_active, context_tokens, max_tokens,
    enable_thinking, enable_vision, NULL,
    CASE provider_type
        WHEN 'agnes-image' THEN 'image'
        WHEN 'agnes-video' THEN 'video'
        ELSE 'language'
    END,
    created_at
FROM ai_configs;

-- 步骤 4：删除旧表（外键检查已延迟，不会在此处报错）
DROP TABLE ai_configs;

-- 步骤 5：将临时表重命名为正式表名，外键引用按表名自动恢复
ALTER TABLE ai_configs_v6_tmp RENAME TO ai_configs;