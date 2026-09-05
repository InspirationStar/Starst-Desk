-- ============================================================
-- 小部件分组表 (schema_version = 17)
-- 用途：将多个桌面小部件合并为一组，组内可切换活跃成员
--       同一时间只显示一个成员，支持分离成员、解散分组

-- 字段说明：
--   id                分组实例 ID（UUID）
--   name              分组名称（可为空字符串）
--   member_ids        成员小部件类型数组（JSON 数组，最多 8 个）
--   active_member     当前活跃成员 widget_type（同一时间只显示一个）
--   is_visible        分组是否可见（组级状态，成员跟随）
--   position_x/y      分组窗口左上角坐标
--   width/height      分组窗口尺寸
--   is_position_locked  位置锁定
--   is_size_locked      尺寸锁定
--   is_collapsed      折叠状态
--   navigation_style  标题导航样式：follow-default / stack / auto / tabs
--   title_display_mode 标题显示模式：follow-default / icon-and-text / icon-only / text-only
--   wheel_switch_enabled 滚轮切换（NULL 跟随默认）
--   hover_switch_enabled 悬停切换（NULL 跟随默认）
--   chrome_mode       标题栏样式：standard / compact
--   collapse_behavior 折叠行为：system / expanded / click / smart
-- ============================================================

CREATE TABLE IF NOT EXISTS widget_groups (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL DEFAULT '',
    member_ids           TEXT NOT NULL DEFAULT '[]',
    active_member        TEXT NOT NULL DEFAULT '',
    is_visible           INTEGER NOT NULL DEFAULT 1,
    position_x           REAL NOT NULL DEFAULT 100,
    position_y           REAL NOT NULL DEFAULT 100,
    width                REAL NOT NULL DEFAULT 300,
    height               REAL NOT NULL DEFAULT 400,
    is_position_locked   INTEGER NOT NULL DEFAULT 0,
    is_size_locked       INTEGER NOT NULL DEFAULT 0,
    is_collapsed         INTEGER NOT NULL DEFAULT 0,
    navigation_style     TEXT NOT NULL DEFAULT 'stack',
    title_display_mode   TEXT NOT NULL DEFAULT 'standard',
    wheel_switch_enabled INTEGER,
    hover_switch_enabled INTEGER,
    chrome_mode          TEXT NOT NULL DEFAULT 'standard',
    collapse_behavior    TEXT NOT NULL DEFAULT 'system',
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    CONSTRAINT chk_wg_visible CHECK (is_visible IN (0, 1)),
    CONSTRAINT chk_wg_position_lock CHECK (is_position_locked IN (0, 1)),
    CONSTRAINT chk_wg_size_lock CHECK (is_size_locked IN (0, 1)),
    CONSTRAINT chk_wg_collapsed CHECK (is_collapsed IN (0, 1)),
    CONSTRAINT chk_wg_wheel CHECK (wheel_switch_enabled IS NULL OR wheel_switch_enabled IN (0, 1)),
    CONSTRAINT chk_wg_hover CHECK (hover_switch_enabled IS NULL OR hover_switch_enabled IN (0, 1)),
    CONSTRAINT chk_wg_nav_style CHECK (
        navigation_style IN ('follow-default', 'stack', 'auto', 'tabs')
    ),
    CONSTRAINT chk_wg_title_mode CHECK (
        title_display_mode IN ('follow-default', 'icon-and-text', 'icon-only', 'text-only', 'standard')
    ),
    CONSTRAINT chk_wg_chrome CHECK (chrome_mode IN ('standard', 'compact')),
    CONSTRAINT chk_wg_collapse CHECK (
        collapse_behavior IN ('system', 'expanded', 'click', 'smart')
    )
);

-- 索引设计
CREATE INDEX IF NOT EXISTS idx_widget_groups_visible ON widget_groups(is_visible) WHERE is_visible = 1;
CREATE INDEX IF NOT EXISTS idx_widget_groups_active ON widget_groups(active_member) WHERE active_member IS NOT NULL AND active_member != '';
CREATE INDEX IF NOT EXISTS idx_widget_groups_updated ON widget_groups(updated_at DESC);