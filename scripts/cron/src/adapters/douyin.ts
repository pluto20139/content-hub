import { ProxyAgent } from "undici";
import { supabase } from "../lib/supabase.js";
import { DatabaseProxyPool } from "../lib/proxy.js";
import type { PlatformAdapter, Monitor, RawContent, PlatformResult } from "./types.js";
import { withPlatformThrottle } from "../lib/throttle.js";

export class DouyinAdapter implements PlatformAdapter {
  readonly platform = "douyin" as const;
  private proxyPool: DatabaseProxyPool;

  constructor() {
    this.proxyPool = new DatabaseProxyPool("douyin");
  }

  private get rsshubUrl(): string {
    return process.env.RSSHUB_URL ?? "";
  }

  async fetchLatest(monitor: Monitor): Promise<RawContent[]> {
    const cleanId = monitor.native_id;

    // Fallback mock logic for local testing in development/test environments
    if (!this.rsshubUrl) {
      if (process.env.NODE_ENV !== "production" && process.env.USE_MOCK === "true") {
        console.log(`[DouyinAdapter] RSSHub URL not configured, returning mock data for monitor ${monitor.display_name}`);
        return [
          {
            platform: "douyin" as const,
            native_id: `mock-douyin-${cleanId}-1`,
            content_type: "video" as const,
            title: `【抖音日常】今天教大家如何在 10 分钟内开发一个多平台内容聚合中枢 — ${monitor.display_name}`,
            cover_url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&q=80",
            original_url: monitor.original_url,
            published_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
          },
          {
            platform: "douyin" as const,
            native_id: `mock-douyin-${cleanId}-2`,
            content_type: "video" as const,
            title: `吹爆这个系统！所有关注博主更新一页看完，太爽了 — ${monitor.display_name}`,
            cover_url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&q=80",
            original_url: monitor.original_url,
            published_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
          }
        ];
      }
      const error = new Error("Douyin RSSHUB_URL is not configured");
      (error as any).isPlatformLevel = true;
      throw error;
    }

    const url = `${this.rsshubUrl}/douyin/user/${cleanId}?format=json`;

    let res: Response | null = null;
    const selectedProxy = this.proxyPool.getHealthyProxy();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const fetchOpts: any = { signal: controller.signal };
      if (selectedProxy) {
        fetchOpts.dispatcher = new ProxyAgent(selectedProxy);
      }
      res = await fetch(url, fetchOpts);
    } catch (err: any) {
      if (selectedProxy) {
        this.proxyPool.markFailed(selectedProxy);
      }
      // Retry via crawler fallback on connection errors
    } finally {
      clearTimeout(timeoutId);
    }

    if (res && res.ok) {
      try {
        const data = await res.json();
        const items = data.items ?? [];
        return items.map((item: any) => {
          const itemUrl = item.url || "";
          let native_id = item.id || "";
          const videoMatch = /\/video\/(\d+)/.exec(itemUrl);
          if (videoMatch) {
            native_id = videoMatch[1];
          }

          let cover_url: string | null = item.image || null;
          if (!cover_url && item.content_html) {
            const imgMatch = /<img[^>]+src="([^">]+)"/.exec(item.content_html);
            if (imgMatch) {
              cover_url = imgMatch[1];
            }
          }

          return {
            platform: "douyin" as const,
            native_id,
            content_type: "video" as const,
            title: item.title || "抖音作品",
            cover_url,
            original_url: itemUrl || `https://www.douyin.com/video/${native_id}`,
            published_at: item.date_published || new Date().toISOString(),
          };
        });
      } catch {
        // Fallback to crawler if JSON parsing fails
      }
    } else {
      if (selectedProxy && res) {
        this.proxyPool.markFailed(selectedProxy);
      }
    }

    return this.fetchLatestFromMobileWeb(monitor);
  }

  /** Mobile page crawler fallback when RSSHub fails */
  private async fetchLatestFromMobileWeb(monitor: Monitor): Promise<RawContent[]> {
    const webUrl = `https://m.douyin.com/user/${monitor.native_id}`;
    let selectedProxy = this.proxyPool.getHealthyProxy();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const fetchOpts: any = {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        },
        signal: controller.signal,
      };
      if (selectedProxy) {
        fetchOpts.dispatcher = new ProxyAgent(selectedProxy);
      }
      const res = await fetch(webUrl, fetchOpts);
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Mobile web request failed with status ${res.status}`);
      }

      const html = await res.text();
      const stateMatch = /<script id="RENDER_DATA" type="application\/json">(.+?)<\/script>/.exec(html);
      if (stateMatch) {
        const decoded = decodeURIComponent(stateMatch[1]);
        const renderData = JSON.parse(decoded);
        
        // Locate user video list in structure
        const userVideoKey = Object.keys(renderData).find(k => renderData[k]?.userPostHeaders);
        const awemeList = userVideoKey ? renderData[userVideoKey]?.post?.data : null;

        if (Array.isArray(awemeList)) {
          return awemeList.map((aweme: any) => ({
            platform: "douyin" as const,
            native_id: aweme.aweme_id,
            content_type: "video" as const,
            title: aweme.desc || "抖音作品",
            cover_url: aweme.video?.cover?.url_list?.[0] || null,
            original_url: `https://www.douyin.com/video/${aweme.aweme_id}`,
            published_at: new Date(aweme.create_time * 1000).toISOString(),
          }));
        }
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (selectedProxy) {
        this.proxyPool.markFailed(selectedProxy);
      }
      if (err.isPlatformLevel) {
        throw err;
      }
      console.warn(`[DouyinAdapter] Mobile Web fallback failed: ${err.message}`);
    }

    const error = new Error("Douyin RSSHub and Mobile Web crawlers both failed");
    (error as any).isPlatformLevel = true;
    throw error;
  }

  async fetchDisplayName(monitor: Monitor): Promise<string | null> {
    if (!this.rsshubUrl) return null;
    try {
      const selectedProxy = this.proxyPool.getHealthyProxy();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const fetchOpts: any = { signal: controller.signal };
        if (selectedProxy) {
          fetchOpts.dispatcher = new ProxyAgent(selectedProxy);
        }
        const res = await fetch(`${this.rsshubUrl}/douyin/user/${monitor.native_id}?format=json`, fetchOpts);
        if (res.ok) {
          const data = await res.json();
          return data.title?.replace("的抖音视频", "") || null;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      // ignore
    }
    return null;
  }

  async fetchAll(monitors: Monitor[]): Promise<PlatformResult> {
    if (monitors.length === 0) return { skipped: false, monitors: [], results: [] };

    // Initialize proxy pool before starting the run
    await this.proxyPool.load();

    let probeContents: RawContent[] | null = null;
    let probeError: string | null = null;
    try {
      probeContents = await withPlatformThrottle(this.platform, () => this.fetchLatest(monitors[0]));
    } catch (err: any) {
      if (err.isPlatformLevel) {
        const pauseUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await supabase
          .from("platform_configs")
          .upsert({
            platform: "douyin",
            config_key: "platform_status",
            config_value: `paused:until=${pauseUntil}`
          });
        return { skipped: true, reason: `Douyin platform error: ${err.message}. Paused for 30 minutes.`, monitors, results: [] };
      }
      probeError = err.message;
    }

    const results: PlatformResult["results"] = [];
    if (probeError) {
      results.push({ monitor: monitors[0], contents: [], error: probeError });
    } else {
      results.push({ monitor: monitors[0], contents: probeContents! });
    }

    for (let i = 1; i < monitors.length; i++) {
      try {
        const contents = await withPlatformThrottle(this.platform, () => this.fetchLatest(monitors[i]));
        results.push({ monitor: monitors[i], contents });
      } catch (err: any) {
        results.push({ monitor: monitors[i], contents: [], error: err.message });
        if (err.isPlatformLevel) {
          const pauseUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          await supabase
            .from("platform_configs")
            .upsert({
              platform: "douyin",
              config_key: "platform_status",
              config_value: `paused:until=${pauseUntil}`
            });
          for (let j = i + 1; j < monitors.length; j++) {
            results.push({ monitor: monitors[j], contents: [], error: `抖音平台因风控暂停: ${err.message}` });
          }
          break;
        }
      }
    }

    return { skipped: false, monitors, results };
  }
}
