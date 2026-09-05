-- ============================================================
-- 小部件位置锁/大小锁/置顶/内容模式字段 (schema_version = 13)
-- 为 widgets 表添加 position_lock、size_lock、always_on_top、compact_content_mode 字段

-- ============================================================

-- SQLite 支持 ALTER TABLE ADD COLUMN，无需重建表
ALTER TABLE widgets ADD COLUMN position_lock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE widgets ADD COLUMN size_lock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE widgets ADD COLUMN always_on_top INTEGER NOT NULL DEFAULT 0;
ALTER TABLE widgets ADD COLUMN compact_content_mode TEXT NOT NULL DEFAULT 'summary';