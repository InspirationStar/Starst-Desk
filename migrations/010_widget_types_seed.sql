-- ============================================================
-- 小部件类型种子数据 (schema_version = 10)
-- 为 009 迁移扩展的新类型插入初始 widgets 记录
-- 009 仅更新了 CHECK 约束并复制旧数据，未为新类型插入记录
-- 导致小部件管理页列表缺少 todo/file/quick-capture/weather/music/desktop-organizer
-- 本迁移使用 INSERT OR IGNORE 确保幂等（已存在则跳过）
-- 默认 is_enabled=0（用户手动启用），is_visible=1（列表中可见）
-- 默认位置/尺寸取自 widget-registry.js 中各类型的 defaultX/Y/Width/Height
-- ============================================================

INSERT OR IGNORE INTO widgets (id, widget_type, is_enabled, is_visible, is_capsule, capsule_mode, position_x, position_y, width, height, config_json, created_at, updated_at)
VALUES
    -- 待办（侧边栏已有入口，小部件默认禁用）
    ('todo',              'todo',              0, 1, 0, 'click', 1000, 100, 300, 400, NULL, datetime('now'), datetime('now')),
    -- 文件管理
    ('file',              'file',              0, 1, 0, 'click', 200,  200, 320, 400, NULL, datetime('now'), datetime('now')),
    -- 快速记录
    ('quick-capture',     'quick-capture',     0, 1, 0, 'click', 550,  200, 300, 200, NULL, datetime('now'), datetime('now')),
    -- 天气
    ('weather',           'weather',           0, 1, 0, 'click', 900,  200, 280, 380, NULL, datetime('now'), datetime('now')),
    -- 音乐
    ('music',             'music',             0, 1, 0, 'click', 200,  500, 320, 180, NULL, datetime('now'), datetime('now')),
    -- 桌面整理
    ('desktop-organizer', 'desktop-organizer', 0, 1, 0, 'click', 600,  500, 360, 440, NULL, datetime('now'), datetime('now'));