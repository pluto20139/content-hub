-- 015_anon_read_tighten: 收紧匿名用户读取权限，仅允许读取 is_display = true 的记录

DROP POLICY IF EXISTS contents_anon_read ON contents;

CREATE POLICY contents_anon_read ON contents
  FOR SELECT TO anon
  USING (is_display = true);
