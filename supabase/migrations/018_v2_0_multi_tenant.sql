-- 018_v2_0_multi_tenant.sql: V2.0 账号体系、数据隔离与 X (Twitter) 平台支持

-- 1. 更新各表的 platform 约束，添加 'x' 平台
ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_platform_check;
ALTER TABLE monitors ADD CONSTRAINT monitors_platform_check
  CHECK (platform IN ('bilibili', 'youtube', 'zhihu', 'douyin', 'xiaohongshu', 'x'));

ALTER TABLE contents DROP CONSTRAINT IF EXISTS contents_platform_check;
ALTER TABLE contents ADD CONSTRAINT contents_platform_check
  CHECK (platform IN ('bilibili', 'youtube', 'zhihu', 'douyin', 'xiaohongshu', 'x'));

ALTER TABLE platform_configs DROP CONSTRAINT IF EXISTS platform_configs_platform_check;
ALTER TABLE platform_configs ADD CONSTRAINT platform_configs_platform_check
  CHECK (platform IN ('bilibili', 'youtube', 'zhihu', 'douyin', 'xiaohongshu', 'x'));

-- 2. 增加 user_id 列到 monitors, contents, platform_configs
ALTER TABLE monitors 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE contents 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE platform_configs 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. 重现/修改 unique 约束，支持按租户 (user_id) 隔离数据
ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_unique;
ALTER TABLE monitors ADD CONSTRAINT monitors_unique UNIQUE (user_id, platform, native_id);

ALTER TABLE contents DROP CONSTRAINT IF EXISTS contents_unique;
ALTER TABLE contents ADD CONSTRAINT contents_unique UNIQUE (user_id, platform, native_id);

ALTER TABLE platform_configs DROP CONSTRAINT IF EXISTS platform_configs_unique;
ALTER TABLE platform_configs ADD CONSTRAINT platform_configs_unique UNIQUE (user_id, platform, config_key);

-- 4. 更新 RLS 策略，隔离 Authenticated 用户数据

-- 4.1 monitors 表
DROP POLICY IF EXISTS monitors_admin_all ON monitors;
CREATE POLICY monitors_user_all ON monitors
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4.2 contents 表
DROP POLICY IF EXISTS contents_admin_all ON contents;
CREATE POLICY contents_user_all ON contents
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- anon 可以在 H5 上按 is_display = true 浏览公开内容
DROP POLICY IF EXISTS contents_anon_read ON contents;
CREATE POLICY contents_anon_read ON contents
  FOR SELECT TO anon
  USING (is_display = true);

-- 4.3 platform_configs 表
DROP POLICY IF EXISTS platform_configs_user_all ON platform_configs;
CREATE POLICY platform_configs_user_all ON platform_configs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. 重建平台配置脱敏视图 platform_configs_admin
CREATE OR REPLACE VIEW platform_configs_admin AS
  SELECT 
    id,
    user_id,
    platform,
    config_key,
    updated_at,
    CASE 
      WHEN config_key IN ('cookie', 'proxy_list', 'auth_token', 'api_key') THEN NULL
      ELSE config_value 
    END AS config_value
  FROM platform_configs;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_configs_admin TO authenticated;

-- 6. 创建索引，优化多租户查询
CREATE INDEX IF NOT EXISTS idx_monitors_user_platform ON monitors (user_id, platform);
CREATE INDEX IF NOT EXISTS idx_contents_user_display_published ON contents (user_id, is_display, published_at DESC);
