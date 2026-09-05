-- ============================================================
-- 桌面小部件配置表 (schema_version = 2)
-- 实现 plan.md 2.5 节字段定义
-- 首期 4 种小部件：note / task / health / clock
-- 每种类型单实例（uk_widget_type UNIQUE 约束）
-- ============================================================

CREATE TABLE IF NOT EXISTS widgets (
    id            TEXT PRIMARY KEY,          -- 小部件实例 ID（首期通常等于 widget_type）
    widget_type   TEXT NOT NULL,             -- 小部件类型：note / task / health / clock
    is_enabled    INTEGER NOT NULL DEFAULT 1,-- 是否启用
    is_visible    INTEGER NOT NULL DEFAULT 1,-- 是否可见
    is_capsule    INTEGER NOT NULL DEFAULT 0,-- 是否胶囊形态
    capsule_mode  TEXT NOT NULL DEFAULT 'click', -- 胶囊展开模式：click / hover
    position_x    INTEGER NOT NULL DEFAULT 100,
    position_y    INTEGER NOT NULL DEFAULT 100,
    width         INTEGER NOT NULL DEFAULT 280,
    height        INTEGER NOT NULL DEFAULT 360,
    config_json   TEXT,                      -- 小部件私有配置（JSON）
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    CONSTRAINT chk_widget_type CHECK (
        widget_type IN ('note', 'task', 'health', 'clock')
    ),
    CONSTRAINT chk_widget_enabled CHECK (is_enabled IN (0, 1)),
    CONSTRAINT chk_widget_visible CHECK (is_visible IN (0, 1)),
    CONSTRAINT chk_widget_capsule CHECK (is_capsule IN (0, 1)),
    CONSTRAINT chk_capsule_mode CHECK (capsule_mode IN ('click', 'hover')),
    CONSTRAINT uk_widget_type UNIQUE (widget_type)  -- 首期每类型单实例
);

-- ============================================================
-- 索引设计
-- ============================================================

-- 启用小部件查询索引（启动时只加载 is_enabled = 1 的小部件）
CREATE INDEX IF NOT EXISTS idx_widgets_enabled ON widgets(is_enabled) WHERE is_enabled = 1;
-- 按类型查询索引
CREATE INDEX IF NOT EXISTS idx_widgets_type ON widgets(widget_type);

-- ============================================================
-- 默认数据：插入 4 种小部件的默认配置
-- 启用状态：note=1, task=1, health=0, clock=1（按 plan.md 4.1 节）
-- 默认位置错开排列，避免重叠
-- ============================================================

INSERT OR IGNORE INTO widgets (id, widget_type, is_enabled, is_visible, is_capsule, capsule_mode, position_x, position_y, width, height, config_json, created_at, updated_at)
VALUES
    ('note',   'note',   1, 1, 0, 'click', 100,  100, 280, 360, NULL, datetime('now'), datetime('now')),
    ('task',   'task',   1, 1, 0, 'click', 400,  100, 280, 400, NULL, datetime('now'), datetime('now')),
    ('health', 'health', 0, 1, 0, 'click', 700,  100, 260, 320, NULL, datetime('now'), datetime('now')),
    ('clock',  'clock',  1, 1, 0, 'click', 1000, 100, 240, 120, NULL, datetime('now'), datetime('now'));

-- ============================================================
-- 全局配置写入 app_settings 表
-- widget_hotkey: 全局热键（默认 Ctrl+Alt+D）
-- widget_enabled: 小部件功能总开关（默认 1）
-- widget_capsule_default_mode: 胶囊默认展开模式（默认 click）
-- ============================================================

INSERT OR IGNORE INTO app_settings (key, value, updated_at)
VALUES
    ('widget_hotkey', 'Ctrl+Alt+D', datetime('now')),
    ('widget_enabled', '1', datetime('now')),
    ('widget_capsule_default_mode', 'click', datetime('now'));