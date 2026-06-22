-- 004_cron_locks: Cron 互斥锁表（固定单行）
CREATE TABLE cron_locks (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  locked_at   TIMESTAMPTZ,
  locked_by   TEXT
);

-- 初始化单行
INSERT INTO cron_locks (id, locked_at, locked_by) VALUES (1, NULL, NULL);
