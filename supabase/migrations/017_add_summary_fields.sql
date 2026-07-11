-- 017_add_summary_fields: 新增视频 AI 总结完成时间与耗时字段
ALTER TABLE contents ADD COLUMN IF NOT EXISTS summary_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE contents ADD COLUMN IF NOT EXISTS summary_duration_ms INT DEFAULT NULL;

COMMENT ON COLUMN contents.summary_at IS 'AI 总结完成时间';
COMMENT ON COLUMN contents.summary_duration_ms IS 'AI 总结生成耗时(毫秒)';
