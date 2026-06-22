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
