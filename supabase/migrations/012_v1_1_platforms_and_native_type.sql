-- 012_v1_1_platforms_and_native_type: V1.1 数据库结构升级

-- 1. 更新 monitors 表的 platform 约束并新增 native_type 列及约束
ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_platform_check;
ALTER TABLE monitors ADD CONSTRAINT monitors_platform_check
  CHECK (platform IN ('bilibili', 'youtube', 'zhihu', 'douyin', 'xiaohongshu'));

ALTER TABLE monitors ADD COLUMN IF NOT EXISTS native_type VARCHAR(20);
ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_native_type_check;
ALTER TABLE monitors ADD CONSTRAINT monitors_native_type_check
  CHECK (native_type IS NULL OR native_type IN ('people', 'column'));

ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_zhihu_native_type_check;
ALTER TABLE monitors ADD CONSTRAINT monitors_zhihu_native_type_check
  CHECK (platform != 'zhihu' OR native_type IN ('people', 'column'));

-- 2. 更新 contents 表的 platform 约束
ALTER TABLE contents DROP CONSTRAINT IF EXISTS contents_platform_check;
ALTER TABLE contents ADD CONSTRAINT contents_platform_check
  CHECK (platform IN ('bilibili', 'youtube', 'zhihu', 'douyin', 'xiaohongshu'));

-- 3. 更新 platform_configs 表的 platform 约束
ALTER TABLE platform_configs DROP CONSTRAINT IF EXISTS platform_configs_platform_check;
ALTER TABLE platform_configs ADD CONSTRAINT platform_configs_platform_check
  CHECK (platform IN ('bilibili', 'youtube', 'zhihu', 'douyin', 'xiaohongshu'));

-- 4. 建立 contents_anon_hide RLS 策略（匿名用户隐藏逻辑）
-- 先清理旧的策略
DROP POLICY IF EXISTS contents_anon_hide ON contents;
DROP POLICY IF EXISTS contents_anon_update ON contents;

-- 创建隐藏策略：只允许 anon 将 is_display 更改为 false
CREATE POLICY contents_anon_hide ON contents
  FOR UPDATE TO anon
  USING (is_display = true)
  WITH CHECK (is_display = false);

-- 授予 anon 更新 is_display 列的权限，Postgres 将阻止更新其他列
GRANT UPDATE (is_display) ON public.contents TO anon;

-- 5. 创建索引以优化“已隐藏”标签页的查询速度
CREATE INDEX IF NOT EXISTS idx_contents_is_display_published 
  ON contents (is_display, published_at DESC);

-- 6. 创建短链解析结果的缓存表 short_link_cache
CREATE TABLE IF NOT EXISTS short_link_cache (
  short_code    TEXT PRIMARY KEY,
  resolved_id   TEXT NOT NULL,
  resolved_type TEXT,  -- people / column / sec_uid / uid
  expires_at    TIMESTAMPTZ NOT NULL
);

-- 仅对 service_role 开放读写权限，anon 和 authenticated 默认阻断
ALTER TABLE short_link_cache ENABLE ROW LEVEL SECURITY;

-- 7. 扩展平台配置脱敏视图 platform_configs_admin
CREATE OR REPLACE VIEW platform_configs_admin AS
  SELECT 
    id,
    platform,
    config_key,
    updated_at,
    CASE 
      WHEN config_key IN ('cookie', 'proxy_list') THEN NULL
      ELSE config_value 
    END AS config_value
  FROM platform_configs;
