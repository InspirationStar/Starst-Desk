-- ============================================================
-- 成就节点位置存储 (schema_version = 26)
-- 新增 pos_x/pos_y 字段，支持自由画布布局中节点位置持久化
-- 说明：SQLite 不支持 ADD COLUMN IF NOT EXISTS，依赖 schema_version 保证不重复执行
-- ============================================================

ALTER TABLE achievements ADD COLUMN pos_x REAL;
ALTER TABLE achievements ADD COLUMN pos_y REAL;