-- ============================================================
-- 系统监控小部件 (schema_version = 11)
-- 内容：
--   1. 重建 widgets 表，更新 CHECK 约束以支持 'system-monitor' 类型
--   2. 为新类型插入初始 widgets 记录
-- 使用 INSERT OR IGNORE 确保幂等（已存在则跳过）
-- 默认 is_enabled=0（用户手动启用），is_visible=1（列表中可见）
-- ============================================================

-- ============================================================
-- 1. 重建 widgets 表，更新 CHECK 约束
-- SQLite 无法直接修改 CHECK 约束，需用"重建表"方式
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
            'quick-capture', 'weather', 'music', 'desktop-organizer',
            'system-monitor'
        )
    ),
    CONSTRAINT chk_widget_enabled_new CHECK (is_enabled IN (0, 1)),
    CONSTRAINT chk_widget_visible_new CHECK (is_visible IN (0, 1)),
    CONSTRAINT chk_widget_capsule_new CHECK (is_capsule IN (0, 1)),
    CONSTRAINT chk_capsule_mode_new CHECK (capsule_mode IN ('click', 'hover')),
    CONSTRAINT uk_widget_type_new UNIQUE (widget_type)
);

-- 从旧表复制所有数据（排除 glance，若存在）
INSERT INTO _widgets_new (id, widget_type, is_enabled, is_visible, is_capsule, capsule_mode, position_x, position_y, width, height, config_json, created_at, updated_at)
SELECT id, widget_type, is_enabled, is_visible, is_capsule, capsule_mode, position_x, position_y, width, height, config_json, created_at, updated_at
FROM widgets
WHERE widget_type != 'glance';

-- 删除旧表
DROP TABLE widgets;

-- 重命名临时表为 widgets
ALTER TABLE _widgets_new RENAME TO widgets;

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_widgets_enabled ON widgets(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_widgets_type ON widgets(widget_type);

-- ============================================================
-- 2. 为新类型插入初始记录
-- ============================================================

INSERT OR IGNORE INTO widgets (id, widget_type, is_enabled, is_visible, is_capsule, capsule_mode, position_x, position_y, width, height, config_json, created_at, updated_at)
VALUES
    -- 系统监控（CPU/内存/磁盘）
    ('system-monitor', 'system-monitor', 0, 1, 0, 'click', 300, 200, 300, 360, NULL, datetime('now'), datetime('now'));
