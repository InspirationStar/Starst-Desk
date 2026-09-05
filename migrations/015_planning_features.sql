-- ============================================================
-- focus_sessions 表增量增强 (schema_version = 15)
-- 内容：
--   1. focus_sessions 表添加 updated_at 字段
--   2. focus_sessions 添加 task/group/project 关联索引
-- 说明：010_planning_features.sql 已创建基础表结构与 todos.meta 字段，
--   本迁移仅补充 010 遗漏的 focus_sessions.updated_at 列与关联索引
-- ============================================================

-- 1. focus_sessions 表添加 updated_at 字段
ALTER TABLE focus_sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

-- 2. focus_sessions 关联索引（加速按任务/任务流/项目查询）
CREATE INDEX IF NOT EXISTS idx_focus_sessions_task ON focus_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_group ON focus_sessions(group_id);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_project ON focus_sessions(project_id);
