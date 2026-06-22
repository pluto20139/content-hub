-- 007_rls: Row Level Security 策略

-- ========== monitors 表 ==========
ALTER TABLE monitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY monitors_admin_all ON monitors
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
-- anon 角色：无策略，默认拒绝

-- ========== contents 表 ==========
ALTER TABLE contents ENABLE ROW LEVEL SECURITY;

CREATE POLICY contents_admin_all ON contents
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY contents_anon_read ON contents
  FOR SELECT TO anon
  USING (is_display = true);

-- ========== platform_configs 表 ==========
ALTER TABLE platform_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_configs_admin_read ON platform_configs
  FOR SELECT TO authenticated
  USING (true);
-- 管理员只能读取，不能直接修改（通过 Edge Function 间接写入）
-- anon 角色：无策略，默认拒绝

-- ========== cron_locks 表 ==========
ALTER TABLE cron_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY cron_locks_cron_only ON cron_locks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
-- 仅 Cron (service_role) 可操作，其他角色无权限

-- ========== cron_soft_delete_logs 表 ==========
ALTER TABLE cron_soft_delete_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY soft_delete_logs_admin_read ON cron_soft_delete_logs
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY soft_delete_logs_cron_insert ON cron_soft_delete_logs
  FOR INSERT TO service_role
  WITH CHECK (true);
-- 管理员可查看日志，Cron 可写入日志

-- ========== GRANT 权限 ==========
-- PostgREST 需要显式 GRANT 权限，RLS 策略只做行级过滤
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- contents: anon 读取 is_display=true（RLS 过滤）
GRANT SELECT ON public.contents TO anon;
GRANT SELECT, INSERT, UPDATE ON public.contents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.contents TO service_role;

-- monitors: authenticated 完全控制
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitors TO authenticated;
GRANT SELECT, UPDATE ON public.monitors TO service_role;

-- platform_configs: authenticated 只读，service_role 可读写
GRANT SELECT ON public.platform_configs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.platform_configs TO service_role;

-- cron_locks: service_role 专享
GRANT SELECT, UPDATE ON public.cron_locks TO service_role;

-- cron_soft_delete_logs: authenticated 查看，service_role 写入
GRANT SELECT ON public.cron_soft_delete_logs TO authenticated;
GRANT SELECT, INSERT ON public.cron_soft_delete_logs TO service_role;
