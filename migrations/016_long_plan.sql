-- ============================================================
-- AI 长期计划功能 (schema_version = 11)
-- 内容：
--   1. 新增 long_plans 表（长期计划：周期性计划、路线图、复盘机制）
-- ============================================================

-- ============================================================
-- 1. 长期计划表
-- goal:            长期目标
-- title:           计划标题
-- summary:         计划摘要
-- duration_text:   持续时间描述（如"两个月"）
-- cycle_length_days: 每周期天数（默认 7）
-- total_cycles:    总周期数（默认 8）
-- current_cycle:   当前周期索引（从 0 开始）
-- roadmap:         JSON 数组，路线图概览
-- cycles:          JSON 数组，周期详情（含每日任务、复盘提示）
-- active:          是否激活（1=激活，0=已放弃/完成）
-- pending_review:  是否等待复盘（1=等待复盘）
-- started_at:      开始时间
-- ============================================================
CREATE TABLE IF NOT EXISTS long_plans (
    id              TEXT PRIMARY KEY,
    goal            TEXT NOT NULL,
    title           TEXT NOT NULL,
    summary         TEXT,
    duration_text   TEXT,
    cycle_length_days INTEGER NOT NULL DEFAULT 7,
    total_cycles    INTEGER NOT NULL DEFAULT 8,
    current_cycle   INTEGER NOT NULL DEFAULT 0,
    roadmap         TEXT NOT NULL DEFAULT '[]',
    cycles          TEXT NOT NULL DEFAULT '[]',
    active          INTEGER NOT NULL DEFAULT 1,
    pending_review  INTEGER NOT NULL DEFAULT 0,
    started_at      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_long_plans_active ON long_plans(active);
CREATE INDEX IF NOT EXISTS idx_long_plans_created ON long_plans(created_at DESC);