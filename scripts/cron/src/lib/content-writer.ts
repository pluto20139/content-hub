import { supabase } from "./supabase";
import type { RawContent, MonitorStatus } from "../adapters/types";

const UPSERT_COLUMNS =
  "platform,native_id,content_type,title,cover_url,original_url,published_at,monitor_id";

/**
 * UPSERT a single content item into the contents table.
 * Uses resolution=merge-duplicates + limited columns to prevent
 * re-animating soft-deleted records (is_display remains false).
 */
export async function upsertContent(
  content: RawContent,
  monitorId: number,
): Promise<boolean> {
  const { error } = await supabase
    .from("contents")
    .upsert(
      {
        platform: content.platform,
        native_id: content.native_id,
        content_type: content.content_type,
        title: content.title,
        cover_url: content.cover_url,
        original_url: content.original_url,
        published_at: content.published_at,
        monitor_id: monitorId,
      },
      {
        onConflict: "platform,native_id",
      },
    )
    .select();

  if (error) {
    console.error(`UPSERT content ${content.native_id} failed:`, error.message);
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

  if (updates.newContent && updates.lastContentAt) {
    patch.last_content_at = updates.lastContentAt;
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
 * Load B站 cookie from platform_configs for adapter use.
 */
export async function loadBilibiliCookie(): Promise<string | null> {
  const { data, error } = await supabase
    .from("platform_configs")
    .select("config_value")
    .eq("platform", "bilibili")
    .eq("config_key", "cookie")
    .maybeSingle();

  if (error || !data) return null;
  return data.config_value;
}
