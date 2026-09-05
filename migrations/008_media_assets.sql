-- ============================================================
-- 媒体资产表 (schema_version = 8)
-- 用途：存储 AI 生成的图片/视频资产记录（Agnes / DALL-E / Stability 等）
--       记录生成结果 URL、缩略图、提示词、关联的配置/会话/消息等信息
--
-- 关联关系：
--   config_id  -> ai_configs.id      (软关联，不强制外键)
--   session_id -> chat_sessions.id   (软关联，不强制外键)
--   message_id -> chat_messages.id   (软关联，不强制外键)
-- ============================================================

CREATE TABLE IF NOT EXISTS media_assets (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK(type IN ('image', 'video')),
  url           TEXT NOT NULL,           -- 生成结果的 URL
  thumbnail_url TEXT,                    -- 缩略图 URL（可选）
  prompt        TEXT,                    -- 生成提示词
  model_name    TEXT,                    -- 使用的模型名称
  config_id     TEXT,                    -- 关联的 AI 配置 ID
  session_id    TEXT,                    -- 关联的聊天会话 ID
  message_id    TEXT,                    -- 关联的消息 ID
  file_path     TEXT,                    -- 本地存储路径（可选）
  file_size     INTEGER DEFAULT 0,       -- 文件大小
  metadata      TEXT,                    -- JSON 格式的额外元数据
  created_at    TEXT NOT NULL
);

-- 索引：按类型筛选
CREATE INDEX IF NOT EXISTS idx_media_assets_type ON media_assets(type);
-- 索引：按会话查询
CREATE INDEX IF NOT EXISTS idx_media_assets_session ON media_assets(session_id);
-- 索引：按创建时间排序（默认列表顺序）
CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets(created_at DESC);