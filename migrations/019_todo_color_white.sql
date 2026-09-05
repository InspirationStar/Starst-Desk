-- ============================================================
-- 待办颜色扩展：新增 'white' 选项 (schema_version = 19)
-- 内容：
--   1. 重建 todos 表，CHECK 约束加入 'white' 值
--   2. 迁移存量数据：color='' 的记录设为 'blue'（无颜色 → 默认蓝色）
-- ============================================================

-- 创建带新约束的临时表
CREATE TABLE _todos_new (
    id          TEXT PRIMARY KEY,
    title       TEXT,
    is_enabled  INTEGER NOT NULL DEFAULT 1,
    color       TEXT NOT NULL DEFAULT 'blue',
    due_date    TEXT,
    recurrence  TEXT,
    attachments TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    meta        TEXT,
    CONSTRAINT chk_todo_enabled_new CHECK (is_enabled IN (0, 1)),
    CONSTRAINT chk_todo_color_new CHECK (
        color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white')
    )
);

-- 从旧表复制数据，color='' 的空值映射为 'blue'
INSERT INTO _todos_new (id, title, is_enabled, color, due_date, recurrence, attachments, created_at, updated_at, meta)
SELECT id, title, is_enabled,
       CASE WHEN color = '' OR color IS NULL THEN 'blue' ELSE color END,
       due_date, recurrence, attachments, created_at, updated_at, meta
FROM todos;

-- 删除旧表
DROP TABLE todos;

-- 重命名临时表为 todos
ALTER TABLE _todos_new RENAME TO todos;

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_todos_enabled ON todos(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_todos_updated ON todos(updated_at DESC);