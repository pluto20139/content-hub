-- platform_configs: add service_role RLS policy
-- Without this, service_role writes via PostgREST are denied by RLS (policy > GRANT)

CREATE POLICY platform_configs_service_all ON platform_configs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
