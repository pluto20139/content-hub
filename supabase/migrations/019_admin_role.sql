-- 019_admin_role.sql: 超级管理员 (is_admin) 角色识别与安全辅助函数

-- 1. 创建 is_admin 辅助判定函数
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT (raw_app_meta_data->>'is_admin')::boolean 
     FROM auth.users 
     WHERE id = user_id),
    false
  );
$$;

-- 2. 超级管理员 RLS 扩展策略（允许 is_admin === true 的用户全局读取/管理）
CREATE POLICY monitors_super_admin_all ON monitors
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY contents_super_admin_all ON contents
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 3. 说明与创建指引：
-- 超级管理员账号创建由部署脚本通过 Supabase Auth Admin API 完成：
--
-- POST /auth/v1/admin/users
-- Headers:
--   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
--   Content-Type: application/json
-- Body:
--   {
--     "email": "admin@mpchub.top",
--     "password": "Admin123456!",
--     "email_confirm": true,
--     "app_metadata": { "is_admin": true }
--   }
