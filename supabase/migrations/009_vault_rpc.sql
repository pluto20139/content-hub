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
