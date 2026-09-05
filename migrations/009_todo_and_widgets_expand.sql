-- ============================================================
-- 待办表 + 小部件类型扩展 (schema_version = 9)
-- 内容：
--   1. 新增 todos 表（待办事项 CRUD）
--   2. 重建 widgets 表，更新 CHECK 约束：
--      - 移除 'clock' 类型（彻底清除时钟小部件残留）
--      - 新增 'todo', 'file', 'quick-capture', 'weather', 'music', 'desktop-organizer'
--      - 保留 'note', 'task', 'health'
--   3. 删除已存在的 clock 记录
-- ============================================================

-- ============================================================
-- 1. 新增 todos 表
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
        color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple')
    )
);

-- 待办索引
CREATE INDEX IF NOT EXISTS idx_todos_enabled ON todos(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_todos_updated ON todos(updated_at DESC);

-- ============================================================
-- 2. 重建 widgets 表，更新 CHECK 约束
-- SQLite 无法直接修改 CHECK 约束，需用"重建表"方式：
--   a. 创建带新约束的临时表 _widgets_new
--   b. 从 widgets 复制数据（排除 clock 记录）
--   c. 删除旧表
--   d. 重命名临时表为 widgets
--   e. 重建索引
-- ============================================================

-- 创建带新约束的临时表
CREATE TABLE _widgets_new (
    id            TEXT PRIMARY KEY,
    widget_type   TEXT NOT NULL,
    is_enabled    INTEGER NOT NULL DEFAULT 1,
    is_visible    INTEGER NOT NULL DEFAULT 1,
    is_capsule    INTEGER NOT NULL DEFAULT 0,
    capsule_mode  TEXT NOT NULL DEFAULT 'click',
    position_x    INTEGER NOT NULL DEFAULT 100,
    position_y    INTEGER NOT NULL DEFAULT 100,
    width         INTEGER NOT NULL DEFAULT 280,
    height        INTEGER NOT NULL DEFAULT 360,
    config_json   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    CONSTRAINT chk_widget_type_new CHECK (
        widget_type IN (
            'note', 'task', 'health', 'todo', 'file',
            'quick-capture', 'weather', 'music', 'desktop-organizer'
        )
    ),
    CONSTRAINT chk_widget_enabled_new CHECK (is_enabled IN (0, 1)),
    CONSTRAINT chk_widget_visible_new CHECK (is_visible IN (0, 1)),
    CONSTRAINT chk_widget_capsule_new CHECK (is_capsule IN (0, 1)),
    CONSTRAINT chk_capsule_mode_new CHECK (capsule_mode IN ('click', 'hover')),
    CONSTRAINT uk_widget_type_new UNIQUE (widget_type)
);

-- 从旧表复制数据，排除 clock 类型记录（彻底移除时钟小部件）
INSERT INTO _widgets_new (id, widget_type, is_enabled, is_visible, is_capsule, capsule_mode, position_x, position_y, width, height, config_json, created_at, updated_at)
SELECT id, widget_type, is_enabled, is_visible, is_capsule, capsule_mode, position_x, position_y, width, height, config_json, created_at, updated_at
FROM widgets
WHERE widget_type != 'clock';

-- 删除旧表
DROP TABLE widgets;

-- 重命名临时表为 widgets
ALTER TABLE _widgets_new RENAME TO widgets;

-- 重建索引（旧索引随 DROP TABLE 一并删除）
CREATE INDEX IF NOT EXISTS idx_widgets_enabled ON widgets(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_widgets_type ON widgets(widget_type);