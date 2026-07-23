import { fileURLToPath } from "node:url";
import { acquireLock, releaseLock } from "./lib/lock.js";
import { queryActiveMonitors } from "./lib/monitors-query.js";
import { withPlatformThrottle } from "./lib/throttle.js";
import { cleanContent, filterNewContent } from "./lib/cleaner.js";
import {
  upsertContent,
  updateMonitorStatus,
  updateDisplayName,
  verifyMonitorActive,
  loadBilibiliCookie,
} from "./lib/content-writer.js";
import { sendAlert } from "./lib/alert.js";
import { processSummaries } from "./lib/dify.js";
import { BilibiliAdapter } from "./adapters/bilibili.js";
import { YoutubeAdapter } from "./adapters/youtube.js";
import { ZhihuAdapter } from "./adapters/zhihu.js";
import { DouyinAdapter } from "./adapters/douyin.js";
import { XiaohongshuAdapter } from "./adapters/xiaohongshu.js";
import { XAdapter } from "./adapters/x.js";
import type { Monitor, CronResult, MonitorStatus, PlatformAdapter, PlatformResult } from "./adapters/types.js";

const RUN_ID = `run-${Date.now()}`;

async function isPlatformPaused(platform: string): Promise<boolean> {
  try {
    const { supabase } = await import("./lib/supabase.js");
    const { data } = await supabase
      .from("platform_configs")
      .select("config_value")
      .eq("platform", platform)
      .eq("config_key", "platform_status")
      .maybeSingle();

    if (data?.config_value?.startsWith("paused:until=")) {
      const untilStr = data.config_value.replace("paused:until=", "");
      const until = new Date(untilStr);
      if (until > new Date()) {
        console.log(`[CRON] Platform ${platform} is paused until ${until.toISOString()}`);
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function createAdapter(platform: string): PlatformAdapter | null {
  switch (platform) {
    case "bilibili":
      return new BilibiliAdapter();
    case "youtube":
      return new YoutubeAdapter();
    case "zhihu":
      return new ZhihuAdapter();
    case "douyin":
      return new DouyinAdapter();
    case "xiaohongshu":
      return new XiaohongshuAdapter();
    case "x":
      return new XAdapter();
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
    return failCount >= 3 ? { status: "rate_limited", failCount } : { status: "cookie_expired", failCount };
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

  const paused = await isPlatformPaused(adapter.platform);
  if (paused) {
    console.log(`[CRON] Platform ${adapter.platform} is paused, skipping group`);
    return { successCount, failCount, newContentCount };
  }

  const result: PlatformResult = await adapter.fetchAll(monitors);

  if (result.skipped) {
    console.log(`[CRON] Platform ${adapter.platform}: skipped (${result.reason})`);
    // Update B站 cookie_status to expired on platform-level failure
    if (adapter.platform === "bilibili") {
      try {
        const { supabase } = await import("./lib/supabase");
        const nowIso = new Date().toISOString();
        await supabase
          .from("platform_configs")
          .upsert(
            { platform: "bilibili", config_key: "cookie_status", config_value: "expired", updated_at: nowIso },
            { onConflict: "platform,config_key" },
          );
      } catch {
        // non-critical
      }
    }
    return { successCount, failCount, newContentCount };
  }

  for (const { monitor, contents, error } of result.results) {
    try {
      if (error) throw new Error(error);

      // Pre-write verify: monitor still exists and active
      const active = await verifyMonitorActive(monitor.id);
      if (!active) {
        console.log(`[CRON] Monitor (Monitor ID: ${monitor.id}) deleted or inactive, skipping write-back`);
        continue;
      }

      // Filter pinned/old content
      const newContents = filterNewContent(contents, monitor.last_content_at);

      // Clean and upsert each piece
      let inserted = 0;
      for (const raw of newContents) {
        const cleaned = cleanContent(raw);
        if (!cleaned) continue;
        const ok = await upsertContent(cleaned, monitor.id, monitor.user_id);
        if (ok) inserted++;
      }

      // Status write-back
      const { status, failCount } = computeStatus(monitor.status, monitor.fail_count, true);

      await updateMonitorStatus(monitor.id, {
        status,
        failCount,
        lastSync: true,
        newContent: inserted > 0,
        lastContentAt: inserted > 0 ? new Date().toISOString() : undefined,
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
      console.error(`[CRON] Monitor (Monitor ID: ${monitor.id}) failed:`, err.message);
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
  }

  // B站 success → update cookie_status to valid (only if at least 1 monitor succeeded)
  if (adapter.platform === "bilibili" && successCount > 0) {
    try {
      const { supabase } = await import("./lib/supabase");
      const nowIso = new Date().toISOString();
      await supabase
        .from("platform_configs")
        .upsert(
          { platform: "bilibili", config_key: "cookie_status", config_value: "valid", updated_at: nowIso },
          { onConflict: "platform,config_key" },
        );
      await supabase
        .from("platform_configs")
        .upsert(
          { platform: "bilibili", config_key: "cookie_meta", config_value: nowIso, updated_at: nowIso },
          { onConflict: "platform,config_key" },
        );
    } catch {
      // non-critical
    }
  }

  return { successCount, failCount, newContentCount };
}

export async function run(): Promise<CronResult> {
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

    // 抖音 group
    const douyinMonitors = others.filter((m) => m.platform === "douyin");
    if (douyinMonitors.length > 0) {
      platformGroups.push({ monitors: douyinMonitors, adapter: createAdapter("douyin") });
    }

    // 小红书 group
    const xiaohongshuMonitors = others.filter((m) => m.platform === "xiaohongshu");
    if (xiaohongshuMonitors.length > 0) {
      platformGroups.push({ monitors: xiaohongshuMonitors, adapter: createAdapter("xiaohongshu") });
    }

    // X (Twitter) group
    const xMonitors = others.filter((m) => m.platform === "x");
    if (xMonitors.length > 0) {
      platformGroups.push({ monitors: xMonitors, adapter: createAdapter("x") });
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

    // Call processSummaries to process all pending content AI summaries
    try {
      await processSummaries("all");
    } catch (difyErr: any) {
      console.error("[CRON] processSummaries failed:", difyErr.message);
    }

    const duration = Date.now() - startTime;
    console.log(
      `[CRON] Complete: total=${totalMonitors} success=${successCount} fail=${failCount} newContent=${newContentCount} duration=${duration}ms`,
    );

    return { totalMonitors, successCount, failCount, newContentCount, duration };
  } finally {
    // Step 6: Release lock (always with ownership verification)
    try {
      await releaseLock(RUN_ID);
    } catch (err) {
      console.error("[CRON] Failed to release lock:", err);
    }
  }
}

// Entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run()
    .then((result) => {
      console.log("[CRON] Result:", JSON.stringify(result));
      process.exit(0);
    })
    .catch((err) => {
      console.error("[CRON] Fatal error:", err);
      process.exit(1);
    });
}
