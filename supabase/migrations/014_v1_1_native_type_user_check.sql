-- 014_v1_1_native_type_user_check: 扩展 native_type 允许 'user' 状态值（用于 B站）

ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_native_type_check;
ALTER TABLE monitors ADD CONSTRAINT monitors_native_type_check
  CHECK (native_type IS NULL OR native_type IN ('people', 'column', 'user'));

ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_zhihu_native_type_check;
ALTER TABLE monitors ADD CONSTRAINT monitors_zhihu_native_type_check
  CHECK (platform != 'zhihu' OR native_type IN ('people', 'column'));
