-- 013_v1_1_allow_anon_read_hidden: 允许匿名用户读取已隐藏的内容卡片并显式声明短链缓存 RLS 策略

DROP POLICY IF EXISTS contents_anon_read ON contents;

CREATE POLICY contents_anon_read ON contents
  FOR SELECT TO anon
  USING (true);

-- P2-3: 为 short_link_cache 添加显式 RLS policy，仅 service_role 可读写访问
DROP POLICY IF EXISTS short_link_cache_service_only ON short_link_cache;
CREATE POLICY short_link_cache_service_only ON short_link_cache
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
