import { supabase } from "./supabase";

const LOCK_ID = 1;
const STALE_MINUTES = 15;

/**
 * Try to acquire the cron row-level lock.
 * Returns true if lock was acquired, false if it's already held by another run.
 */
export async function acquireLock(runId: string): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

  const { data, error } = await supabase
    .from("cron_locks")
    .update({ locked_at: new Date().toISOString(), locked_by: runId })
    .eq("id", LOCK_ID)
    .or(`locked_at.is.null,locked_at.lt.${staleThreshold.toISOString().replaceAll(":", "%3A")}`)
    .select();

  if (error) {
    console.error("Failed to acquire lock:", error.message);
    return false;
  }

  // Non-empty response means the update matched a row → lock acquired
  return Array.isArray(data) && data.length > 0;
}

/**
 * Release the cron row-level lock.
 */
export async function releaseLock(): Promise<void> {
  const { error } = await supabase
    .from("cron_locks")
    .update({ locked_at: null, locked_by: null })
    .eq("id", LOCK_ID);

  if (error) {
    console.error("Failed to release lock:", error.message);
  }
}
