-- RLS 列级限制：限制 service_role 只能更新 monitors 表的特定字段
-- 防止 cron 误更新 platform、native_id 等敏感字段

GRANT UPDATE (status, fail_count, last_sync_at, last_content_at, display_name) ON public.monitors TO service_role;
