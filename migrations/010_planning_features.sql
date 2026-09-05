-- ============================================================
-- 待办&规划功能增强 (schema_version = 10)
-- 内容：
--   1. 新增 groups 表（任务流）
--   2. 新增 projects 表（项目与里程碑）
--   3. 新增 focus_sessions 表（专注会话）
--   4. 新增 achievements 表（成就系统）
--   5. 新增 ai_plans 表（AI规划历史）
--   6. 新增 todos 表的 meta 字段（备注）
-- ============================================================

-- ============================================================
-- 1. 任务流表
-- steps: JSON 数组 [{name, duration, type}]
-- ============================================================
CREATE TABLE IF NOT EXISTS groups (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    steps        TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_updated ON groups(updated_at DESC);

-- ============================================================
-- 2. 项目表
-- milestones: JSON 数组 [{title, done}]
-- progress: 0.0 ~ 1.0
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    progress    REAL NOT NULL DEFAULT 0,
    milestones  TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

-- ============================================================
-- 3. 专注会话表
-- mode: single / group / project
-- result: started / completed / cancelled
-- ============================================================
CREATE TABLE IF NOT EXISTS focus_sessions (
    id                TEXT PRIMARY KEY,
    task_id           TEXT,
    group_id          TEXT,
    project_id        TEXT,
    mode              TEXT NOT NULL DEFAULT 'single',
    title             TEXT,
    total_seconds     INTEGER NOT NULL DEFAULT 1500,
    remaining_seconds INTEGER NOT NULL DEFAULT 1500,
    started_at        TEXT,
    completed_at      TEXT,
    result            TEXT NOT NULL DEFAULT 'started',
    created_at        TEXT NOT NULL,
    CONSTRAINT fk_focus_task FOREIGN KEY (task_id) REFERENCES todos(id) ON DELETE SET NULL,
    CONSTRAINT fk_focus_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL,
    CONSTRAINT fk_focus_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_started ON focus_sessions(started_at DESC);

-- ============================================================
-- 4. 成就表
-- code: 唯一标识符，用于触发判断
-- unlocked: 0=未解锁, 1=已解锁
-- ============================================================
CREATE TABLE IF NOT EXISTS achievements (
    id          TEXT PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    icon        TEXT DEFAULT ' Trophy',
    target      INTEGER NOT NULL DEFAULT 1,
    current     INTEGER NOT NULL DEFAULT 0,
    unlocked    INTEGER NOT NULL DEFAULT 0,
    unlocked_at TEXT,
    created_at  TEXT NOT NULL
);

-- 预置成就数据
INSERT OR IGNORE INTO achievements (id, code, title, description, icon, target, current, unlocked, created_at)
VALUES
    ('ach_001', 'first_task', '初次完成', '完成第一个待办任务', 'Trophy', 1, 0, 0, datetime('now')),
    ('ach_002', 'ten_tasks', '十步之遥', '累计完成 10 个待办任务', 'Trophy', 10, 0, 0, datetime('now')),
    ('ach_003', 'five_groups', '流程大师', '创建 5 个任务流', 'Flow', 5, 0, 0, datetime('now')),
    ('ach_004', 'three_projects', '项目管理者', '创建 3 个项目', 'Board', 3, 0, 0, datetime('now')),
    ('ach_005', 'first_focus', '专注初体验', '完成第一次专注会话', 'Timer', 1, 0, 0, datetime('now')),
    ('ach_006', 'thirty_focus_min', '半小时专注', '累计专注 30 分钟', 'Timer', 1800, 0, 0, datetime('now')),
    ('ach_007', 'hour_focus', '一小时专注', '累计专注 1 小时', 'Timer', 3600, 0, 0, datetime('now')),
    ('ach_008', 'plan_generator', '规划者', '使用 AI 生成分期计划', 'Sparkle', 1, 0, 0, datetime('now')),
    ('ach_009', 'all_colors', '彩虹达人', '为所有颜色的待办各完成一个', 'Palette', 6, 0, 0, datetime('now')),
    ('ach_010', 'streak_7', '一周坚持', '连续 7 天有待办记录', 'Calendar', 7, 0, 0, datetime('now'));

-- ============================================================
-- 5. AI规划历史表
-- plan_json: JSON 格式的规划结果
-- applied: 是否已导入到系统中
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_plans (
    id         TEXT PRIMARY KEY,
    prompt     TEXT NOT NULL,
    plan_json  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    applied    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ai_plans_created ON ai_plans(created_at DESC);

-- ============================================================
-- 6. todos 表添加 meta 字段（备注）
-- ============================================================
ALTER TABLE todos ADD COLUMN meta TEXT;