import { supabase } from "./supabase.js";
import type { RawContent, MonitorStatus } from "../adapters/types.js";

const UPSERT_COLUMNS =
  "platform,native_id,content_type,title,cover_url,original_url,published_at,monitor_id,user_id";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * UPSERT a single content item into the contents table.
 * Uses native PostgREST fetch with ?columns= to prevent
 * re-animating soft-deleted records (is_display remains false).
 */
export async function upsertContent(
  content: RawContent,
  monitorId: number,
  userId?: string | null,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    platform: content.platform,
    native_id: content.native_id,
    content_type: content.content_type,
    title: content.title,
    cover_url: content.cover_url,
    original_url: content.original_url,
    published_at: content.published_at,
    monitor_id: monitorId,
  };

  if (userId) {
    body.user_id = userId;
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/contents?columns=${encodeURIComponent(UPSERT_COLUMNS)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(`UPSERT content ${content.native_id} failed:`, text);
    return false;
  }
  return true;
}

/**
 * Update monitor status fields after a fetch cycle.
 */
export async function updateMonitorStatus(
  monitorId: number,
  updates: {
    status: MonitorStatus;
    failCount: number;
    lastSync: boolean;
    newContent: boolean;
    lastContentAt?: string;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: updates.status,
    fail_count: updates.failCount,
  };

  if (updates.lastSync) {
    patch.last_sync_at = new Date().toISOString();
  }

  if (updates.newContent) {
    patch.last_content_at = updates.lastContentAt || new Date().toISOString();
  }

  const { error } = await supabase
    .from("monitors")
    .update(patch)
    .eq("id", monitorId);

  if (error) {
    console.error(`Update monitor ${monitorId} status failed:`, error.message);
  }
}

/**
 * Update monitor display_name (Cron name_auto=true refresh).
 */
export async function updateDisplayName(
  monitorId: number,
  displayName: string,
): Promise<void> {
  const { error } = await supabase
    .from("monitors")
    .update({ display_name: displayName })
    .eq("id", monitorId);

  if (error) {
    console.error(`Update monitor ${monitorId} display_name failed:`, error.message);
  }
}

/**
 * Verify a monitor still exists and is active before writing back.
 */
export async function verifyMonitorActive(
  monitorId: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("monitors")
    .select("id,is_active")
    .eq("id", monitorId)
    .maybeSingle();

  if (error || !data) return false;
  return data.is_active === true;
}

/**
 * Load B站 cookie from vault for adapter use.
 */
export async function loadBilibiliCookie(): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_bilibili_cookie`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
    },
  );

  if (!res.ok) return null;
  const text = await res.text();
  // RPC returns a text result wrapped in quotes
  return text ? JSON.parse(text) : null;
}
