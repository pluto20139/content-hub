import type { Monitor } from "../adapters/types.js";

const WEBHOOK_URL = process.env.WECOM_WEBHOOK_URL ?? "";

/**
 * Send an alert via WeCom webhook.
 * No-op if WECOM_WEBHOOK_URL is not configured.
 */
export async function sendAlert(monitor: Monitor): Promise<void> {
  const platformNames: Record<string, string> = {
    bilibili: "B站",
    youtube: "YouTube",
    zhihu: "知乎",
    douyin: "抖音",
    xiaohongshu: "小红书"
  };

  const platformName = platformNames[monitor.platform] || monitor.platform;

  const content = [
    `⚠️ [${platformName}] 博主 [${monitor.display_name}] 已连续 ${monitor.fail_count} 次抓取失败`,
    `最后成功时间：${monitor.last_sync_at ?? "从未成功同步"}`,
    `当前状态：${monitor.status}`,
    `请检查 Cookie 或网络。`,
  ].join("\n");

  console.log(`[ALERT] ${content}`);

  if (!WEBHOOK_URL) {
    console.log("[ALERT] WECOM_WEBHOOK_URL not configured, alert logged only");
    return;
  }

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content },
      }),
    });
  } catch (err) {
    console.error("Failed to send WeCom webhook:", err);
  }
}
