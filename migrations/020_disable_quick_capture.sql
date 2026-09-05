-- ============================================================
-- 禁用 quick-capture 小部件 (schema_version = 20)
-- 背景：quick-capture（随记）与 note（随记便笺）功能重叠，
--   数据库中 quick-capture 记录仍存在且 is_enabled=1，导致 initAllWidgets
--   为它创建多余窗口。本迁移将其禁用，配合代码层跳过逻辑彻底消除重复便签。
-- ============================================================

UPDATE widgets SET is_enabled = 0 WHERE widget_type = 'quick-capture';