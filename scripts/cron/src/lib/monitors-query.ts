import { supabase } from "./supabase.js";
import type { Monitor } from "../adapters/types.js";

const YOUTUBE_THROTTLE_HOURS = 4;

/**
 * Query active monitors, applying YouTube 4-hour throttle.
 * Returns { youtube: Monitor[], others: Monitor[] } where 'others' = bilibili.
 */
export async function queryActiveMonitors(): Promise<{
  youtube: Monitor[];
  others: Monitor[];
}> {
  // YouTube: with 4-hour debounce filter
  const fourHoursAgo = new Date(Date.now() - YOUTUBE_THROTTLE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: youtube, error: ytError } = await supabase
    .from("monitors")
    .select("*")
    .eq("is_active", true)
    .eq("platform", "youtube")
    .or(`last_sync_at.is.null,last_sync_at.lt.${fourHoursAgo}`);

  if (ytError) {
    console.error("Failed to query YouTube monitors:", ytError.message);
    throw ytError;
  }

  // B站: full set every run
  const { data: others, error: otherError } = await supabase
    .from("monitors")
    .select("*")
    .eq("is_active", true)
    .eq("platform", "bilibili");

  if (otherError) {
    console.error("Failed to query other monitors:", otherError.message);
    throw otherError;
  }

  return {
    youtube: (youtube ?? []) as Monitor[],
    others: (others ?? []) as Monitor[],
  };
}
