-- ============================================================
-- 迁移 014：为 widgets 表添加 collapse_behavior 字段
-- 用途：支持 Smart 自动折叠行为（鼠标离开自动折叠，进入展开）
-- ============================================================

ALTER TABLE widgets ADD COLUMN collapse_behavior TEXT NOT NULL DEFAULT 'click';
ALTER TABLE widgets ADD CONSTRAINT chk_collapse_behavior CHECK (collapse_behavior IN ('expanded', 'click', 'smart'));