-- ============================================================
-- 活动统计键盘维度扩展 (schema_version = 21)
-- 用途：在原有 keystroke_count 基础上增加快捷键次数与键盘活动时长，
--       供活动统计页与鼠标统计并列展示
--
-- 字段说明：
--   hotkey_count           本分钟快捷键使用次数（Ctrl/Alt/Shift/Win + 其他键组合按下沿）
--   keyboard_active_ms     本分钟键盘活动时长（毫秒，按键活跃窗口累加）
--   total_hotkeys          每日快捷键总次数
--   total_keyboard_active_seconds  每日键盘活动总时长（秒）
-- ============================================================

-- activity_log 增加快捷键次数与键盘活动时长
ALTER TABLE activity_log ADD COLUMN hotkey_count INTEGER DEFAULT 0;
ALTER TABLE activity_log ADD COLUMN keyboard_active_ms INTEGER DEFAULT 0;

-- daily_activity_summary 增加快捷键次数与键盘活动时长
ALTER TABLE daily_activity_summary ADD COLUMN total_hotkeys INTEGER DEFAULT 0;
ALTER TABLE daily_activity_summary ADD COLUMN total_keyboard_active_seconds INTEGER DEFAULT 0;