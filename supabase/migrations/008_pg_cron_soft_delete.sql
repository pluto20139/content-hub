-- 008_pg_cron_soft_delete: pg_cron 软删除任务

-- 启用 pg_cron 扩展
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 每日凌晨 3:00 UTC 执行软删除（带日志记录）
SELECT cron.schedule(
  'soft-delete-30d',
  '0 3 * * *',
  $$
    DO $block$
    DECLARE
      v_count INTEGER;
      v_start TIMESTAMPTZ := clock_timestamp();
    BEGIN
      UPDATE contents
      SET is_display = false
      WHERE created_at < NOW() - INTERVAL '30 days'
        AND is_display = true;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      INSERT INTO cron_soft_delete_logs (affected_rows, duration_ms)
      VALUES (v_count, EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000);
    END $block$;
  $$
);
