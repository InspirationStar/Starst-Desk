-- ============================================================
-- Starst Desk 初始建表脚本 (schema_version = 1)
-- 对应 design.md 2.4.3 节
-- ============================================================

-- 便签表
CREATE TABLE IF NOT EXISTS notes (
    id            TEXT PRIMARY KEY,
    title         TEXT,
    body          TEXT,
    color_tag     TEXT NOT NULL DEFAULT 'yellow',
    reminder_time TEXT,
    is_pinned     INTEGER NOT NULL DEFAULT 0,
    is_completed  INTEGER NOT NULL DEFAULT 0,
    is_reminded   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    CONSTRAINT chk_note_content CHECK (
        (title IS NOT NULL AND length(title) > 0) OR
        (body IS NOT NULL AND length(body) > 0)
    ),
    CONSTRAINT chk_color_tag CHECK (
        color_tag IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple')
    ),
    CONSTRAINT chk_note_pinned CHECK (is_pinned IN (0, 1)),
    CONSTRAINT chk_note_completed CHECK (is_completed IN (0, 1)),
    CONSTRAINT chk_note_reminded CHECK (is_reminded IN (0, 1))
);

-- 定时任务表
CREATE TABLE IF NOT EXISTS tasks (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    task_type        TEXT NOT NULL,
    schedule_config  TEXT NOT NULL,
    action_type      TEXT NOT NULL,
    action_payload   TEXT NOT NULL,
    is_enabled       INTEGER NOT NULL DEFAULT 1,
    last_executed_at TEXT,
    created_at       TEXT NOT NULL,
    CONSTRAINT chk_task_type CHECK (task_type IN ('one_shot', 'recurring')),
    CONSTRAINT chk_action_type CHECK (
        action_type IN ('message', 'open_app', 'exec_command', 'open_url')
    ),
    CONSTRAINT chk_task_enabled CHECK (is_enabled IN (0, 1))
);

-- 任务执行历史表
CREATE TABLE IF NOT EXISTS task_executions (
    id            TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL,
    executed_at   TEXT NOT NULL,
    result        TEXT NOT NULL,
    error_message TEXT,
    created_at    TEXT NOT NULL,
    CONSTRAINT chk_exec_result CHECK (result IN ('success', 'failed')),
    CONSTRAINT fk_exec_task FOREIGN KEY (task_id)
        REFERENCES tasks(id) ON DELETE NO ACTION
);

-- 健康提醒配置表
CREATE TABLE IF NOT EXISTS health_configs (
    id          TEXT PRIMARY KEY,
    module_type TEXT NOT NULL,
    is_enabled  INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    CONSTRAINT chk_health_module CHECK (
        module_type IN ('water', 'sedentary', 'eye', 'stretch', 'sleep', 'diet')
    ),
    CONSTRAINT chk_health_enabled CHECK (is_enabled IN (0, 1)),
    CONSTRAINT uk_health_module UNIQUE (module_type)
);

-- 健康数据记录表
CREATE TABLE IF NOT EXISTS health_records (
    id          TEXT PRIMARY KEY,
    module_type TEXT NOT NULL,
    record_date TEXT NOT NULL,
    record_time TEXT NOT NULL,
    value       REAL,
    content     TEXT,
    created_at  TEXT NOT NULL,
    CONSTRAINT chk_rec_module CHECK (
        module_type IN ('water', 'sedentary', 'eye', 'stretch', 'sleep', 'diet')
    )
);

-- AI 模型配置表
CREATE TABLE IF NOT EXISTS ai_configs (
    id                 TEXT PRIMARY KEY,
    provider_type      TEXT NOT NULL,
    name               TEXT NOT NULL,
    api_endpoint       TEXT NOT NULL,
    api_key_encrypted  TEXT,
    model_name         TEXT NOT NULL,
    is_active          INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    CONSTRAINT chk_provider_type CHECK (
        provider_type IN ('ollama', 'deepseek', 'custom')
    ),
    CONSTRAINT chk_ai_active CHECK (is_active IN (0, 1))
);

-- AI 会话表
CREATE TABLE IF NOT EXISTS chat_sessions (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    model_config_id  TEXT NOT NULL,
    system_prompt    TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    CONSTRAINT fk_session_model FOREIGN KEY (model_config_id)
        REFERENCES ai_configs(id) ON DELETE RESTRICT
);

-- AI 消息表
CREATE TABLE IF NOT EXISTS chat_messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    is_complete INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    CONSTRAINT chk_msg_role CHECK (role IN ('user', 'assistant')),
    CONSTRAINT chk_msg_complete CHECK (is_complete IN (0, 1)),
    CONSTRAINT fk_msg_session FOREIGN KEY (session_id)
        REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- 应用设置表（键值对存储）
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ============================================================
-- 索引设计
-- ============================================================

-- 便签索引
CREATE INDEX IF NOT EXISTS idx_notes_reminder ON notes(reminder_time) WHERE reminder_time IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(is_pinned, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_color ON notes(color_tag);

-- 任务索引
CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON tasks(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type);

-- 执行历史索引
CREATE INDEX IF NOT EXISTS idx_exec_task ON task_executions(task_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_time ON task_executions(executed_at DESC);

-- 健康记录索引
CREATE INDEX IF NOT EXISTS idx_health_rec_date ON health_records(module_type, record_date);
CREATE INDEX IF NOT EXISTS idx_health_rec_time ON health_records(record_time);

-- AI 会话索引
CREATE INDEX IF NOT EXISTS idx_session_updated ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_model ON chat_sessions(model_config_id);

-- AI 消息索引
CREATE INDEX IF NOT EXISTS idx_msg_session ON chat_messages(session_id, created_at);