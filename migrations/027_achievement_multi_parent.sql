-- ============================================================
-- 成就多前置依赖扩展 (schema_version = 27)
-- 内容：
--   1. achievements 表新增 parent_codes 字段（逗号分隔的 code 字符串）
--      支持交叉节点：一个成就可依赖多个前置成就，所有前置解锁后才 available
--   2. 将现有 parent_code 单值迁移到 parent_codes，保持向后兼容
-- 说明：SQLite 不支持 ADD COLUMN IF NOT EXISTS，依赖 schema_version 保证不重复执行
-- ============================================================

-- 1. 新增 parent_codes 字段
ALTER TABLE achievements ADD COLUMN parent_codes TEXT;

-- 2. 将现有 parent_code 迁移到 parent_codes
UPDATE achievements SET parent_codes = parent_code WHERE parent_code IS NOT NULL AND parent_code != '';