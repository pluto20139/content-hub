-- 005_cron_soft_delete_logs: 软删除执行日志表
CREATE TABLE cron_soft_delete_logs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  executed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  affected_rows INTEGER NOT NULL,
  duration_ms  INTEGER
);

COMMENT ON TABLE cron_soft_delete_logs IS 'pg_cron 软删除任务执行日志';
