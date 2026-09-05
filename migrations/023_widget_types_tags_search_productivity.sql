-- ============================================================
-- 迁移 023：新增 tags / search / productivity 三种小部件类型 + tags 表
-- 内容：
--   1. 重建 widgets 表，更新 CHECK 约束以支持 'tags' / 'search' / 'productivity' 类型
--   2. 创建 tags 表（标签管理：id/name/color/created_at/updated_at）
--   3. 为新类型插入初始 widgets 记录
-- 使用 INSERT OR IGNORE 确保幂等（已存在则跳过）
-- 默认 is_enabled=0（用户手动启用），is_visible=1（列表中可见）
-- ============================================================

-- ============================================================
-- 1. 重建 widgets 表，更新 CHECK 约束
-- SQLite 无法直接修改 CHECK 约束，需用"重建表"方式
-- ============================================================

CREATE TABLE _widgets_new (
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
    CONSTRAINT chk_widget_type_new CHECK (
        widget_type IN (
            'note', 'task', 'health', 'todo', 'file',
            'quick-capture', 'weather', 'music', 'desktop-organizer',
            'system-monitor', 'tags', 'search', 'productivity'
        )
    ),
    CONSTRAINT chk_widget_enabled_new CHECK (is_enabled IN (0, 1)),
    CONSTRAINT chk_widget_visible_new CHECK (is_visible IN (0, 1)),
    CONSTRAINT chk_widget_capsule_new CHECK (is_capsule IN (0, 1)),
    CONSTRAINT chk_position_lock_new CHECK (position_lock IN (0, 1)),
    CONSTRAINT chk_size_lock_new CHECK (size_lock IN (0, 1)),
    CONSTRAINT chk_always_on_top_new CHECK (always_on_top IN (0, 1)),
    CONSTRAINT chk_content_mode_new CHECK (compact_content_mode IN ('minimal', 'summary', 'smart')),
    CONSTRAINT chk_collapse_behavior_new CHECK (collapse_behavior IN ('expanded', 'click', 'smart')),
    CONSTRAINT uk_widget_type_new UNIQUE (widget_type)
);

-- 从旧表复制所有数据
INSERT INTO _widgets_new (
    id, widget_type, is_enabled, is_visible, is_capsule,
    position_x, position_y, width, height, config_json,
    display_name, position_lock, size_lock, always_on_top,
    compact_content_mode, collapse_behavior, created_at, updated_at
)
SELECT
    id, widget_type, is_enabled, is_visible, is_capsule,
    position_x, position_y, width, height, config_json,
    display_name, position_lock, size_lock, always_on_top,
    compact_content_mode, collapse_behavior, created_at, updated_at
FROM widgets;

-- 删除旧表并重命名
DROP TABLE widgets;
ALTER TABLE _widgets_new RENAME TO widgets;

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_widgets_enabled ON widgets(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_widgets_type ON widgets(widget_type);

-- ============================================================
-- 2. 创建 tags 表（标签管理）
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
-- 3. 为新类型插入初始记录
-- ============================================================

INSERT OR IGNORE INTO widgets (
    id, widget_type, is_enabled, is_visible, is_capsule,
    position_x, position_y, width, height, config_json,
    display_name, position_lock, size_lock, always_on_top,
    compact_content_mode, collapse_behavior, created_at, updated_at
)
VALUES
    -- 标签小部件
    ('tags', 'tags', 0, 1, 0, 100, 500, 280, 400, NULL,
     NULL, 0, 0, 0, 'summary', 'click', datetime('now'), datetime('now')),
    -- 搜索小部件
    ('search', 'search', 0, 1, 0, 500, 500, 360, 480, NULL,
     NULL, 0, 0, 0, 'summary', 'click', datetime('now'), datetime('now')),
    -- 生产力小部件
    ('productivity', 'productivity', 0, 1, 0, 900, 500, 320, 420, NULL,
     NULL, 0, 0, 0, 'summary', 'click', datetime('now'), datetime('now'));