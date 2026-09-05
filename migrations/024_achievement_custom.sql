-- ============================================================
-- 成就自定义功能扩展 (schema_version = 24)
-- 内容：
--   1. achievements 表新增 4 个字段：
--      is_custom  - 标记是否用户自定义成就（0=预置, 1=自定义）
--      category   - 分支分类（task/focus/plan/custom）
--      parent_code- 前置依赖成就的 code（NULL=无前置/分支根节点）
--      position   - 同分支内的排序位置
--   2. 为预置成就设置 category 与 parent_code，形成三条分支：
--      任务达人(task) / 专注大师(focus) / 规划能手(plan)
-- 说明：SQLite 不支持 ADD COLUMN IF NOT EXISTS，依赖 schema_version 保证不重复执行
-- ============================================================

-- 1. achievements 表新增字段
ALTER TABLE achievements ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0;
ALTER TABLE achievements ADD COLUMN category TEXT;
ALTER TABLE achievements ADD COLUMN parent_code TEXT;
ALTER TABLE achievements ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- 2. 任务达人分支
UPDATE achievements SET category='task', position=0 WHERE code='first_task';
UPDATE achievements SET category='task', parent_code='first_task', position=1 WHERE code='ten_tasks';
UPDATE achievements SET category='task', parent_code='ten_tasks', position=2 WHERE code='all_colors';
UPDATE achievements SET category='task', parent_code='all_colors', position=3 WHERE code='streak_7';

-- 3. 专注大师分支
UPDATE achievements SET category='focus', position=0 WHERE code='first_focus';
UPDATE achievements SET category='focus', parent_code='first_focus', position=1 WHERE code='thirty_focus_min';
UPDATE achievements SET category='focus', parent_code='thirty_focus_min', position=2 WHERE code='hour_focus';

-- 4. 规划能手分支
UPDATE achievements SET category='plan', position=0 WHERE code='plan_generator';
UPDATE achievements SET category='plan', parent_code='plan_generator', position=1 WHERE code='five_groups';
UPDATE achievements SET category='plan', parent_code='five_groups', position=2 WHERE code='three_projects';