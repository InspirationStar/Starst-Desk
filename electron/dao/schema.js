// ============================================================
// 建表 DDL 定义
// 包含所有 11 张表的 CREATE TABLE 语句及索引定义
// 用于 schema.js 常量导出，供迁移服务调用
// ============================================================

/**
 * 初始建表 DDL（对应 migrations/001_initial.sql 的内容）
 */
const SCHEMA_DDL = `
-- ============================================================
-- Starst Desk 初始建表脚本 (schema_version = 1)
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
        action_type IN ('message', 'open_app', 'exec_command', 'open_url', 'shutdown')
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
-- 包含 schema_version 3/4/6 累积的字段与约束：
--   v3: context_tokens(原context_length)、enable_thinking、enable_vision
--   v4: context_tokens 重命名、max_tokens 新增
--   v6: extra_config、model_category、provider_type 扩展 agnes-*
CREATE TABLE IF NOT EXISTS ai_configs (
    id                 TEXT PRIMARY KEY,
    provider_type      TEXT NOT NULL,
    name               TEXT NOT NULL,
    api_endpoint       TEXT NOT NULL,
    api_key_encrypted  TEXT,
    model_name         TEXT NOT NULL,
    is_active          INTEGER NOT NULL DEFAULT 0,
    context_tokens     INTEGER DEFAULT 0,
    max_tokens         INTEGER NOT NULL DEFAULT 0,
    enable_thinking    INTEGER NOT NULL DEFAULT 0,
    enable_vision      INTEGER NOT NULL DEFAULT 0,
    extra_config       TEXT,
    model_category     TEXT NOT NULL DEFAULT 'language',
    created_at         TEXT NOT NULL,
    CONSTRAINT chk_provider_type CHECK (
        provider_type IN (
            'ollama', 'deepseek', 'custom', 'openai', 'anthropic', 'gemini',
            'agnes-image', 'agnes-video', 'agnes-all'
        )
    ),
    CONSTRAINT chk_ai_active CHECK (is_active IN (0, 1)),
    CONSTRAINT chk_ai_thinking CHECK (enable_thinking IN (0, 1)),
    CONSTRAINT chk_ai_vision CHECK (enable_vision IN (0, 1)),
    CONSTRAINT chk_model_category CHECK (
        model_category IN ('language', 'image', 'video')
    )
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

-- ============================================================
-- 桌面小部件配置表 (schema_version = 2/9/23)
-- 12 种小部件：note / task / health / todo / file / quick-capture / weather / music
--              / desktop-organizer / system-monitor / tags / search / productivity
-- 已彻底移除 clock 类型（schema_version = 9）
-- 每种类型单实例（uk_widget_type UNIQUE 约束）
-- ============================================================

CREATE TABLE IF NOT EXISTS widgets (
    id            TEXT PRIMARY KEY,
    widget_type   TEXT NOT NULL,
    is_enabled    INTEGER NOT NULL DEFAULT 1,
    is_visible    INTEGER NOT NULL DEFAULT 1,
    is_capsule    INTEGER NOT NULL DEFAULT 0,

    position_x    INTEGER NOT NULL DEFAULT 100,
    position_y    INTEGER NOT NULL DEFAULT 100,
    width         INTEGER NOT NULL DEFAULT 280,
    height        INTEGER NOT NULL DEFAULT 360,
    config_json   TEXT,
    display_name  TEXT,
    position_lock INTEGER NOT NULL DEFAULT 0,
    size_lock     INTEGER NOT NULL DEFAULT 0,
    always_on_top INTEGER NOT NULL DEFAULT 0,
    compact_content_mode TEXT NOT NULL DEFAULT 'summary',
    collapse_behavior TEXT NOT NULL DEFAULT 'click',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    CONSTRAINT chk_widget_type CHECK (
        widget_type IN (
            'note', 'task', 'health', 'todo', 'file',
            'quick-capture', 'weather', 'music', 'desktop-organizer',
            'system-monitor', 'tags', 'search', 'productivity'
        )
    ),
    CONSTRAINT chk_widget_enabled CHECK (is_enabled IN (0, 1)),
    CONSTRAINT chk_widget_visible CHECK (is_visible IN (0, 1)),
    CONSTRAINT chk_widget_capsule CHECK (is_capsule IN (0, 1)),

    CONSTRAINT chk_position_lock CHECK (position_lock IN (0, 1)),
    CONSTRAINT chk_size_lock CHECK (size_lock IN (0, 1)),
    CONSTRAINT chk_always_on_top CHECK (always_on_top IN (0, 1)),
    CONSTRAINT chk_content_mode CHECK (compact_content_mode IN ('minimal', 'summary', 'smart')),
    CONSTRAINT chk_collapse_behavior CHECK (collapse_behavior IN ('expanded', 'click', 'smart')),
    CONSTRAINT uk_widget_type UNIQUE (widget_type)
);

-- 小部件索引
CREATE INDEX IF NOT EXISTS idx_widgets_enabled ON widgets(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_widgets_type ON widgets(widget_type);

-- ============================================================
-- 标签表 (schema_version = 23)
-- 用途：存储用户自定义标签（名称 + 颜色），用于便签/待办/文件分类
-- ============================================================

CREATE TABLE IF NOT EXISTS tags (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT 'blue',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    CONSTRAINT chk_tag_color CHECK (
        color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white')
    )
);

-- 标签索引
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_tags_updated ON tags(updated_at DESC);

-- ============================================================
-- 待办表 (schema_version = 9)
-- 用途：待办事项管理（标题、完成状态、颜色、截止日期、重复规则、附件）
-- is_enabled: 1=未完成（激活），0=已完成
-- ============================================================

CREATE TABLE IF NOT EXISTS todos (
    id          TEXT PRIMARY KEY,
    title       TEXT,
    is_enabled  INTEGER NOT NULL DEFAULT 1,
    color       TEXT NOT NULL DEFAULT 'blue',
    due_date    TEXT,
    recurrence  TEXT,
    attachments TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    CONSTRAINT chk_todo_enabled CHECK (is_enabled IN (0, 1)),
    CONSTRAINT chk_todo_color CHECK (
        color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white')
    )
);

-- 待办索引
CREATE INDEX IF NOT EXISTS idx_todos_enabled ON todos(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_todos_updated ON todos(updated_at DESC);

-- ============================================================
-- 媒体资产表 (schema_version = 8)
-- 用途：存储 AI 生成的图片/视频资产记录（Agnes / DALL-E / Stability 等）
-- ============================================================

CREATE TABLE IF NOT EXISTS media_assets (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK(type IN ('image', 'video')),
  url           TEXT NOT NULL,
  thumbnail_url TEXT,
  prompt        TEXT,
  model_name    TEXT,
  config_id     TEXT,
  session_id    TEXT,
  message_id    TEXT,
  file_path     TEXT,
  file_size     INTEGER DEFAULT 0,
  metadata      TEXT,
  created_at    TEXT NOT NULL
);

-- 媒体资产索引
CREATE INDEX IF NOT EXISTS idx_media_assets_type ON media_assets(type);
CREATE INDEX IF NOT EXISTS idx_media_assets_session ON media_assets(session_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets(created_at DESC);

-- ============================================================
-- 成就表 (schema_version = 10/24)
-- code: 唯一标识符，用于触发判断
-- unlocked: 0=未解锁, 1=已解锁
-- is_custom: 0=预置成就, 1=用户自定义成就
-- category: 分支分类（task=任务达人, focus=专注大师, plan=规划能手, custom=自定义分支）
-- parent_code: 前置依赖成就的 code（NULL=无前置/分支根节点）
-- position: 同分支内的排序位置
-- ============================================================

CREATE TABLE IF NOT EXISTS achievements (
    id          TEXT PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    icon        TEXT DEFAULT 'Trophy',
    target      INTEGER NOT NULL DEFAULT 1,
    current     INTEGER NOT NULL DEFAULT 0,
    unlocked    INTEGER NOT NULL DEFAULT 0,
    unlocked_at TEXT,
    created_at  TEXT NOT NULL,
    is_custom   INTEGER NOT NULL DEFAULT 0,
    category    TEXT,
    parent_code TEXT,
    position    INTEGER NOT NULL DEFAULT 0
);

-- 成就索引
CREATE INDEX IF NOT EXISTS idx_achievements_code ON achievements(code);
CREATE INDEX IF NOT EXISTS idx_achievements_category ON achievements(category);
CREATE INDEX IF NOT EXISTS idx_achievements_custom ON achievements(is_custom);
`

module.exports = {
  SCHEMA_DDL
}
