-- ============================================================
-- AI 消息上下文注入持久化 (schema_version = 18)
-- 用途：将每轮调用模型时的上下文注入信息和工具调用上下文持久化到数据库
--       使切换会话后切回来仍能显示上下文注入详情
-- 字段说明：
--   context_injections    上下文注入记录（JSON 数组，每轮调用一条）
--   tool_call_contexts    工具调用上下文记录（JSON 数组，每次工具调用一条）
-- ============================================================

ALTER TABLE chat_messages ADD COLUMN context_injections TEXT;
ALTER TABLE chat_messages ADD COLUMN tool_call_contexts TEXT;