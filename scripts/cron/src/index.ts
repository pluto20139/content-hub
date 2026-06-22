import { acquireLock, releaseLock } from "./lib/lock";
import { queryActiveMonitors } from "./lib/monitors-query";
import { withPlatformThrottle } from "./lib/throttle";
import { cleanContent, filterNewContent } from "./lib/cleaner";
import {
  upsertContent,
  updateMonitorStatus,
  updateDisplayName,
  verifyMonitorActive,
  loadBilibiliCookie,
} from "./lib/content-writer";
import { sendAlert } from "./lib/alert";
import { BilibiliAdapter } from "./adapters/bilibili";
import { YoutubeAdapter } from "./adapters/youtube";
import { ZhihuAdapter } from "./adapters/zhihu";
import type { Monitor, CronResult, MonitorStatus, PlatformAdapter, PlatformResult } from "./adapters/types";

const RUN_ID = `run-${process.env.GITHUB_RUN_ID ?? Date.now()}`;

function createAdapter(platform: string): PlatformAdapter | null {
  switch (platform) {
    case "bilibili":
      return new BilibiliAdapter();
    case "youtube":
      return new YoutubeAdapter();
    case "zhihu":
      return new ZhihuAdapter();
    default:
      return null;
  }
}

function computeStatus(
  currentStatus: MonitorStatus,
  currentFailCount: number,
  success: boolean,
): { status: MonitorStatus; failCount: number } {
  if (success) {
    return { status: "normal", failCount: 0 };
  }

  const failCount = currentFailCount + 1;

  if (currentStatus === "normal") {
    return { status: "cookie_expired", failCount };
  }

  if (currentStatus === "cookie_expired") {
    if (failCount >= 3) return { status: "rate_limited", failCount };
    return { status: "cookie_expired", failCount };
  }

  if (currentStatus === "rate_limited") {
    return { status: "rate_limited", failCount };
  }

  return { status: currentStatus, failCount };
}

async function processPlatformGroup(
  adapter: PlatformAdapter,
  monitors: Monitor[],
): Promise<{ successCount: number; failCount: number; newContentCount: number }> {
  let successCount = 0;
  let failCount = 0;
  let newContentCount = 0;

  const result: PlatformResult = await adapter.fetchAll(monitors);

  if (result.skipped) {
    console.log(`[CRON] Platform ${adapter.platform}: skipped (${result.reason})`);
    // Update B站 cookie_status to expired on platform-level failure
    if (adapter.platform === "bilibili") {
      try {
        const { supabase } = await import("./lib/supabase");
        await supabase
          .from("platform_configs")
          .upsert(
            { platform: "bilibili", config_key: "cookie_status", config_value: "expired", updated_at: new Date().toISOString() },
            { onConflict: "platform,config_key" },
          );
      } catch {
        // non-critical
      }
    }
    return { successCount, failCount, newContentCount };
  }

  // B站 success → update cookie_status to valid
  if (adapter.platform === "bilibili") {
    try {
      const { supabase } = await import("./lib/supabase");
      await supabase
        .from("platform_configs")
        .upsert(
          { platform: "bilibili", config_key: "cookie_status", config_value: "valid", updated_at: new Date().toISOString() },
          { onConflict: "platform,config_key" },
        );
    } catch {
      // non-critical
    }
  }

  for (const { monitor, contents, error } of result.results) {
    await withPlatformThrottle(adapter.platform, async () => {
      try {
        if (error) throw new Error(error);

        // Pre-write verify: monitor still exists and active
        const active = await verifyMonitorActive(monitor.id);
        if (!active) {
          console.log(`[CRON] Monitor ${monitor.id} deleted or inactive, skipping write-back`);
          return;
        }

        // Filter pinned/old content
        const newContents = filterNewContent(contents, monitor.last_content_at);

        // Clean and upsert each piece
        let inserted = 0;
        for (const raw of newContents) {
          const cleaned = cleanContent(raw);
          if (!cleaned) continue;
          const ok = await upsertContent(cleaned, monitor.id);
          if (ok) inserted++;
        }

        // Status write-back
        const { status, failCount } = computeStatus(monitor.status, monitor.fail_count, true);
        await updateMonitorStatus(monitor.id, {
          status,
          failCount,
          lastSync: true,
          newContent: inserted > 0,
          lastContentAt: inserted > 0 ? newContents[newContents.length - 1]?.published_at : undefined,
        });

        // Name refresh (name_auto=true only)
        if (monitor.name_auto) {
          const name = await adapter.fetchDisplayName(monitor);
          if (name && name !== monitor.display_name) {
            await updateDisplayName(monitor.id, name);
          }
        }

        successCount++;
        newContentCount += inserted;
      } catch (err: any) {
        console.error(`[CRON] Monitor ${monitor.id} failed:`, err.message);
        const newState = computeStatus(monitor.status, monitor.fail_count, false);
        try {
          await updateMonitorStatus(monitor.id, {
            status: newState.status,
            failCount: newState.failCount,
            lastSync: false,
            newContent: false,
          });
        } catch {
          // ignore status update failure
        }

        failCount++;

        // Alert on rate_limited
        if (newState.status === "rate_limited") {
          await sendAlert({ ...monitor, status: newState.status, fail_count: newState.failCount });
        }
      }
    });
  }

  return { successCount, failCount, newContentCount };
}

async function run(): Promise<CronResult> {
  const startTime = Date.now();

  // Step 1: Acquire lock
  const locked = await acquireLock(RUN_ID);
  if (!locked) {
    console.log("[CRON] Lock not acquired — previous run still in progress, skipping");
    return { totalMonitors: 0, successCount: 0, failCount: 0, newContentCount: 0, duration: Date.now() - startTime };
  }

  try {
    // Step 2: Load B站 cookie into env var for adapter access
    try {
      const cookie = await loadBilibiliCookie();
      if (cookie) process.env.BILIBILI_COOKIE = cookie;
    } catch {
      console.warn("[CRON] Failed to load B站 cookie from platform_configs");
    }

    // Step 3: Query monitors
    const { youtube, others } = await queryActiveMonitors();

    // Group by platform
    const platformGroups: Array<{ monitors: Monitor[]; adapter: PlatformAdapter | null }> = [];

    // B站 group
    const bilibiliMonitors = others.filter((m) => m.platform === "bilibili");
    if (bilibiliMonitors.length > 0) {
      platformGroups.push({ monitors: bilibiliMonitors, adapter: createAdapter("bilibili") });
    }

    // 知乎 group
    const zhihuMonitors = others.filter((m) => m.platform === "zhihu");
    if (zhihuMonitors.length > 0) {
      platformGroups.push({ monitors: zhihuMonitors, adapter: createAdapter("zhihu") });
    }

    // YouTube group
    if (youtube.length > 0) {
      platformGroups.push({ monitors: youtube, adapter: createAdapter("youtube") });
    }

    const totalMonitors = platformGroups.reduce((sum, g) => sum + g.monitors.length, 0);

    console.log(`[CRON] Starting fetch for ${totalMonitors} monitors across ${platformGroups.length} platforms`);

    // Step 4: Parallel platform group execution
    const results = await Promise.allSettled(
      platformGroups.map(async ({ monitors, adapter }) => {
        if (!adapter) {
          console.warn(`[CRON] No adapter for monitors group, skipping`);
          return { successCount: 0, failCount: 0, newContentCount: 0 };
        }
        console.log(`[CRON] Processing platform ${adapter.platform} (${monitors.length} monitors)`);
        try {
          return await processPlatformGroup(adapter, monitors);
        } catch (err: any) {
          console.error(`[CRON] Platform group ${adapter.platform} failed:`, err.message);
          return { successCount: 0, failCount: monitors.length, newContentCount: 0 };
        }
      }),
    );

    // Aggregate results
    let successCount = 0;
    let failCount = 0;
    let newContentCount = 0;

    for (const r of results) {
      if (r.status === "fulfilled") {
        successCount += r.value.successCount;
        failCount += r.value.failCount;
        newContentCount += r.value.newContentCount;
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[CRON] Complete: total=${totalMonitors} success=${successCount} fail=${failCount} newContent=${newContentCount} duration=${duration}ms`,
    );

    return { totalMonitors, successCount, failCount, newContentCount, duration };
  } finally {
    // Step 6: Release lock (always)
    try {
      await releaseLock();
    } catch (err) {
      console.error("[CRON] Failed to release lock:", err);
    }
  }
}

// Entry point
run()
  .then((result) => {
    console.log("[CRON] Result:", JSON.stringify(result));
    process.exit(0);
  })
  .catch((err) => {
    console.error("[CRON] Fatal error:", err);
    process.exit(1);
  });
