-- ============================================================
-- 聊天附件表 (schema_version = 5)
-- 用途：存储 AI 对话中的图片、视频、文件等附件记录
--
-- 表关系：
--   message_id -> chat_messages.id (ON DELETE CASCADE)
--   session_id -> chat_sessions.id (ON DELETE CASCADE)
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_attachments (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('image', 'video', 'file')),
  name        TEXT NOT NULL,
  file_path   TEXT,
  file_url    TEXT,
  file_size   INTEGER NOT NULL DEFAULT 0,
  mime_type   TEXT,
  width       INTEGER,
  height      INTEGER,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- 索引：按消息 ID 查询附件
CREATE INDEX IF NOT EXISTS idx_attachment_message ON chat_attachments(message_id);

-- 索引：按会话 ID 查询附件
CREATE INDEX IF NOT EXISTS idx_attachment_session ON chat_attachments(session_id);