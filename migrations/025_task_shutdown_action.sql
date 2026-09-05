-- ============================================================
-- 定时任务新增 shutdown 动作类型 (schema_version = 25)
-- 内容：放宽 tasks 表 chk_action_type 约束，新增 'shutdown'
-- 说明：SQLite 不支持直接修改 CHECK 约束，需重建表
-- ============================================================

-- 1. 创建带新约束的临时表
CREATE TABLE IF NOT EXISTS tasks_new (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    task_type        TEXT NOT NULL,
    schedule_config  TEXT NOT NULL,
    action_type      TEXT NOT NULL,
    action_payload   TEXT NOT NULL,
    is_enabled       INTEGER NOT NULL DEFAULT 1,
    last_executed_at TEXT,
    created_at       TEXT NOT NULL,
    CONSTRAINT chk_task_type CHECK (task_type IN ('one_shot', 'recurring')),
    CONSTRAINT chk_action_type CHECK (
        action_type IN ('message', 'open_app', 'exec_command', 'open_url', 'shutdown')
    ),
    CONSTRAINT chk_task_enabled CHECK (is_enabled IN (0, 1))
);

-- 2. 复制数据
INSERT INTO tasks_new (id, name, task_type, schedule_config, action_type, action_payload, is_enabled, last_executed_at, created_at)
SELECT id, name, task_type, schedule_config, action_type, action_payload, is_enabled, last_executed_at, created_at
FROM tasks;

-- 3. 删除旧表
DROP TABLE tasks;

-- 4. 重命名新表
ALTER TABLE tasks_new RENAME TO tasks;

-- 5. 重建索引
CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON tasks(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type);