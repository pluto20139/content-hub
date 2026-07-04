-- 001_monitors: 监控目标表
CREATE TABLE monitors (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform        VARCHAR(20)  NOT NULL,
  native_id       VARCHAR(200) NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  name_auto       BOOLEAN      NOT NULL DEFAULT true,
  original_url    VARCHAR(500) NOT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  last_sync_at    TIMESTAMPTZ,
  last_content_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  fail_count      INTEGER      NOT NULL DEFAULT 0,
  status          VARCHAR(20)  NOT NULL DEFAULT 'normal',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT monitors_platform_check
    CHECK (platform IN ('bilibili', 'youtube', 'zhihu')),
  CONSTRAINT monitors_status_check
    CHECK (status IN ('normal', 'cookie_expired', 'rate_limited')),
  CONSTRAINT monitors_fail_count_check
    CHECK (fail_count >= 0),
  CONSTRAINT monitors_unique
    UNIQUE (platform, native_id)
);

COMMENT ON TABLE  monitors IS '监控目标表，记录需要追踪的博主';
COMMENT ON COLUMN monitors.platform     IS '平台标识：bilibili / youtube / zhihu';
COMMENT ON COLUMN monitors.native_id    IS '博主在平台内的唯一标识（B站 mid / YouTube channelId / 知乎 people_id 或 column_id）';
COMMENT ON COLUMN monitors.display_name IS '博主显示名称，添加时同步获取一次，管理员可手动编辑';
COMMENT ON COLUMN monitors.name_auto    IS '昵称是否为系统自动生成，true 时 Cron 会尝试刷新，管理员手动编辑后设为 false';
COMMENT ON COLUMN monitors.original_url IS '管理员原始粘贴的链接';
COMMENT ON COLUMN monitors.is_active    IS '是否开启监控，false 时 Cron 跳过';
COMMENT ON COLUMN monitors.last_sync_at IS '最后一次成功同步时间（API 请求成功，不代表有新内容）';
COMMENT ON COLUMN monitors.last_content_at IS '最后一次获得新内容的时间，初始值=创建时间';
COMMENT ON COLUMN monitors.fail_count   IS '连续失败次数，请求成功即归零';
COMMENT ON COLUMN monitors.status       IS '运行状态：normal / cookie_expired / rate_limited（注：cookie_expired 命名继承自 PRD，对 YouTube/知乎等非 Cookie 平台，语义为"抓取异常"）';
-- 002_contents: 内容卡片表
CREATE TABLE contents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform     VARCHAR(20)  NOT NULL,
  native_id    VARCHAR(200) NOT NULL,
  content_type VARCHAR(20)  NOT NULL,
  title        VARCHAR(300) NOT NULL,
  cover_url    VARCHAR(500),
  original_url VARCHAR(500) NOT NULL,
  published_at TIMESTAMPTZ  NOT NULL,
  monitor_id   BIGINT,
  is_display   BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT contents_platform_check
    CHECK (platform IN ('bilibili', 'youtube', 'zhihu')),
  CONSTRAINT contents_content_type_check
    CHECK (content_type IN ('video', 'article', 'question', 'answer', 'post')),
  CONSTRAINT contents_unique
    UNIQUE (platform, native_id),
  CONSTRAINT contents_monitor_fk
    FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE SET NULL
);

COMMENT ON TABLE  contents IS '内容卡片表，存储抓取到的博主最新内容';
COMMENT ON COLUMN contents.content_type IS '内容类型，用于 Deep Link Schema 选择';
COMMENT ON COLUMN contents.is_display   IS '是否在 H5 信息流展示，超 30 天自动软删除为 false';
COMMENT ON COLUMN contents.created_at   IS '入库时间，软删除基于此字段判断';
-- 003_platform_configs: 平台级配置表
-- 启用 Supabase Vault 扩展用于敏感信息加密存储
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE TABLE platform_configs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform     VARCHAR(20) NOT NULL,
  config_key   VARCHAR(50) NOT NULL,
  config_value TEXT        NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT platform_configs_platform_check
    CHECK (platform IN ('bilibili', 'youtube', 'zhihu')),
  CONSTRAINT platform_configs_unique
    UNIQUE (platform, config_key)
);

COMMENT ON TABLE  platform_configs IS '平台级配置表，存储 B站 Cookie 等敏感信息';
COMMENT ON COLUMN platform_configs.config_key   IS '配置键名，如 cookie / api_key';
COMMENT ON COLUMN platform_configs.config_value IS '配置值，敏感信息需加密存储（Supabase Vault）';

-- 预置状态行：B站 Cookie 状态（平台级短路状态持久化）
INSERT INTO platform_configs (platform, config_key, config_value) VALUES ('bilibili', 'cookie_status', 'valid');
-- 004_cron_locks: Cron 互斥锁表（固定单行）
CREATE TABLE cron_locks (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  locked_at   TIMESTAMPTZ,
  locked_by   TEXT
);

-- 初始化单行
INSERT INTO cron_locks (id, locked_at, locked_by) VALUES (1, NULL, NULL);
-- 005_cron_soft_delete_logs: 软删除执行日志表
CREATE TABLE cron_soft_delete_logs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  executed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  affected_rows INTEGER NOT NULL,
  duration_ms  INTEGER
);

COMMENT ON TABLE cron_soft_delete_logs IS 'pg_cron 软删除任务执行日志';
-- 006_indexes: 索引迁移

-- monitors 表索引
CREATE INDEX idx_monitors_is_active ON monitors (is_active);
CREATE INDEX idx_monitors_platform  ON monitors (platform);
CREATE INDEX idx_monitors_status    ON monitors (status);

-- contents 表索引
CREATE INDEX idx_contents_published_at ON contents (published_at DESC);
CREATE INDEX idx_contents_is_display   ON contents (is_display);
CREATE INDEX idx_contents_monitor_id   ON contents (monitor_id);
CREATE INDEX idx_contents_platform_display
  ON contents (platform, is_display, published_at DESC);
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
CREATE OR REPLACE VIEW platform_configs_admin AS
  SELECT 
    id,
    platform,
    config_key,
    updated_at,
    CASE 
      WHEN config_key = 'cookie' THEN NULL
      ELSE config_value 
    END AS config_value
  FROM platform_configs;

ALTER TABLE platform_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_configs_admin_read ON platform_configs
  FOR SELECT TO authenticated
  USING (false);
-- 管理员只能读取视图，不能直接读取物理表
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

-- platform_configs: authenticated 只能读视图，service_role 可读写原表
GRANT SELECT ON public.platform_configs_admin TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.platform_configs TO service_role;

-- cron_locks: service_role 专享
GRANT SELECT, UPDATE ON public.cron_locks TO service_role;

-- cron_soft_delete_logs: authenticated 查看，service_role 写入
GRANT SELECT ON public.cron_soft_delete_logs TO authenticated;
GRANT SELECT, INSERT ON public.cron_soft_delete_logs TO service_role;
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
-- Cookie Vault: encrypted storage for B站 cookie
-- Requires Supabase Vault extension (enable in Dashboard: Database → Extensions → supabase_vault)

CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

-- RPC: read decrypted bilibili cookie from vault
CREATE OR REPLACE FUNCTION get_bilibili_cookie()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  secret_text text;
BEGIN
  SELECT decrypted_secret INTO secret_text
  FROM vault.decrypted_secrets
  WHERE name = 'bilibili_cookie'
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN secret_text;
END;
$$;

-- RPC: upsert bilibili cookie into vault (delete old, create new)
CREATE OR REPLACE FUNCTION upsert_bilibili_cookie(new_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_id uuid;
BEGIN
  -- Find existing secret id
  SELECT id INTO existing_id
  FROM vault.decrypted_secrets
  WHERE name = 'bilibili_cookie'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Delete old secret if exists
  IF existing_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = existing_id;
  END IF;

  -- Create new secret
  PERFORM vault.create_secret(new_secret, 'bilibili_cookie', 'B站 Cookie');
END;
$$;

-- Grant execute to service_role
GRANT EXECUTE ON FUNCTION get_bilibili_cookie TO service_role;
GRANT EXECUTE ON FUNCTION upsert_bilibili_cookie(text) TO service_role;

-- Revoke from all others (functions default to PUBLIC EXECUTE)
REVOKE EXECUTE ON FUNCTION get_bilibili_cookie FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION upsert_bilibili_cookie(text) FROM PUBLIC;
-- RLS 列级限制：限制 service_role 只能更新 monitors 表的特定字段
-- 防止 cron 误更新 platform、native_id 等敏感字段

GRANT UPDATE (status, fail_count, last_sync_at, last_content_at, display_name) ON public.monitors TO service_role;
-- platform_configs: add service_role RLS policy
-- Without this, service_role writes via PostgREST are denied by RLS (policy > GRANT)

CREATE POLICY platform_configs_service_all ON platform_configs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
