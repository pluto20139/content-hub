-- seed.sql: 初始化预置配置数据

-- 预置 B站 Cookie 状态
INSERT INTO platform_configs (platform, config_key, config_value) VALUES 
  ('bilibili', 'cookie_status', 'valid')
ON CONFLICT (platform, config_key) DO NOTHING;

-- 预置 知乎 配置行
INSERT INTO platform_configs (platform, config_key, config_value) VALUES 
  ('zhihu', 'rsshub_route', '/zhihu/people/activities/{id}'),
  ('zhihu', 'cookie', '')
ON CONFLICT (platform, config_key) DO NOTHING;

-- 预置 抖音 配置行
INSERT INTO platform_configs (platform, config_key, config_value) VALUES 
  ('douyin', 'rsshub_route', '/douyin/user/{id}'),
  ('douyin', 'proxy_list', ''),
  ('douyin', 'platform_status', 'normal')
ON CONFLICT (platform, config_key) DO NOTHING;

-- 预置 小红书 配置行
INSERT INTO platform_configs (platform, config_key, config_value) VALUES 
  ('xiaohongshu', 'rsshub_route', '/xiaohongshu/user/{id}/notes'),
  ('xiaohongshu', 'proxy_list', ''),
  ('xiaohongshu', 'platform_status', 'normal')
ON CONFLICT (platform, config_key) DO NOTHING;
