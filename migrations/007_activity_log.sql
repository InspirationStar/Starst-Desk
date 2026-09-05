-- ============================================================
-- 用户活动日志与每日汇总 (schema_version = 7)
-- 用途：记录键鼠活动、空闲/离开状态、当前活跃应用，
--       并按天汇总电脑使用时间，供活动统计页展示
--
-- 安全设计：
--   窗口标题、进程名可能包含用户名、文件路径等敏感信息，
--   使用 AES-256-GCM 加密后存储于 *_encrypted 字段，
--   同行 iv / auth_tag 保存加密参数，便于解密。
--   非敏感字段（空闲时间、鼠标距离、点击次数）明文存储。
-- ============================================================

-- 活动日志表：每分钟汇总一条记录
CREATE TABLE IF NOT EXISTS activity_log (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at            TEXT    NOT NULL,           -- ISO 时间戳（YYYY-MM-DD HH:mm:ss）
  activity_type          TEXT    NOT NULL,           -- 'active'/'idle'/'away'/'locked'
  duration_seconds       INTEGER DEFAULT 0,          -- 该状态持续时间（秒）
  mouse_distance         INTEGER DEFAULT 0,          -- 鼠标移动距离（像素）
  click_count            INTEGER DEFAULT 0,          -- 点击次数（估算）
  keystroke_count        INTEGER DEFAULT 0,          -- 按键次数（当前未采集，预留）
  active_app_encrypted   TEXT,                       -- 加密的活跃进程名
  active_window_encrypted TEXT,                      -- 加密的窗口标题
  iv                     TEXT,                       -- AES-GCM 初始化向量（base64）
  auth_tag               TEXT,                       -- AES-GCM 认证标签（base64）
  CONSTRAINT chk_activity_type CHECK (
    activity_type IN ('active', 'idle', 'away', 'locked')
  )
);

-- 每日活动汇总表：按天聚合
CREATE TABLE IF NOT EXISTS daily_activity_summary (
  date                       TEXT    PRIMARY KEY,    -- YYYY-MM-DD
  total_active_seconds       INTEGER DEFAULT 0,     -- 总活跃时间（秒）
  total_idle_seconds         INTEGER DEFAULT 0,     -- 总空闲时间（秒）
  total_mouse_distance       INTEGER DEFAULT 0,     -- 鼠标移动总距离（像素）
  total_clicks               INTEGER DEFAULT 0,     -- 总点击次数
  total_keystrokes           INTEGER DEFAULT 0,     -- 总按键次数
  longest_continuous_active  INTEGER DEFAULT 0,     -- 最长连续活跃时间（秒）
  break_count                INTEGER DEFAULT 0      -- 离开/锁屏分钟数（每分钟 flush 一次，away/locked 时 +1）
);

-- 索引：按时间范围查询日志
CREATE INDEX IF NOT EXISTS idx_activity_log_recorded ON activity_log(recorded_at);
-- 索引：按活动类型筛选
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(activity_type);