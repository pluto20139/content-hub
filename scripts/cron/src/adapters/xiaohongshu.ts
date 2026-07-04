import { ProxyAgent } from "undici";
import type { PlatformAdapter, Monitor, RawContent, PlatformResult, ContentType } from "./types.js";
import { supabase } from "../lib/supabase.js";
import { DatabaseProxyPool } from "../lib/proxy.js";
import { withPlatformThrottle } from "../lib/throttle.js";

export class XiaohongshuAdapter implements PlatformAdapter {
  readonly platform = "xiaohongshu" as const;
  private proxyPool: DatabaseProxyPool;

  constructor() {
    this.proxyPool = new DatabaseProxyPool("xiaohongshu");
  }

  private get rsshubUrl(): string {
    return process.env.RSSHUB_URL ?? "";
  }

  private async loadXiaohongshuCookie(): Promise<string | null> {
    try {
      const { data } = await supabase
        .from("platform_configs")
        .select("config_value")
        .eq("platform", "xiaohongshu")
        .eq("config_key", "cookie")
        .maybeSingle();
      return data?.config_value || null;
    } catch {
      return null;
    }
  }

  async fetchLatest(monitor: Monitor): Promise<RawContent[]> {
    const cleanId = monitor.native_id;

    // Fallback mock logic for local testing in development/test environments
    if (!this.rsshubUrl) {
      if (process.env.NODE_ENV !== "production" && process.env.USE_MOCK === "true") {
        console.log(`[XiaohongshuAdapter] RSSHub URL not configured, returning mock data for monitor ${monitor.display_name}`);
        return [
          {
            platform: "xiaohongshu" as const,
            native_id: `mock-xiaohongshu-${cleanId}-1`,
            content_type: "post" as const,
            title: `吹爆这个开源多平台内容中枢！所有关注博主更新一页看完，太爽了 — ${monitor.display_name}`,
            cover_url: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=400&q=80",
            original_url: monitor.original_url,
            published_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
          },
          {
            platform: "xiaohongshu" as const,
            native_id: `mock-xiaohongshu-${cleanId}-2`,
            content_type: "video" as const,
            title: `我的首支 Vlog：程序员的一天，自建信息聚合流大公开 — ${monitor.display_name}`,
            cover_url: "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=400&q=80",
            original_url: monitor.original_url,
            published_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
          }
        ];
      }
      const error = new Error("Xiaohongshu RSSHUB_URL is not configured");
      (error as any).isPlatformLevel = true;
      throw error;
    }

    const url = `${this.rsshubUrl}/xiaohongshu/user/${cleanId}/notes?format=json`;

    let res: Response;
    let selectedProxy = this.proxyPool.getHealthyProxy();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const cookie = await this.loadXiaohongshuCookie();
      const headers: Record<string, string> = { "User-Agent": "ContentHub/1.0" };
      if (cookie) {
        headers["Cookie"] = cookie;
      }
      const fetchOpts: any = { headers, signal: controller.signal };
      if (selectedProxy) {
        fetchOpts.dispatcher = new ProxyAgent(selectedProxy);
      }
      res = await fetch(url, fetchOpts);
    } catch (err: any) {
      if (selectedProxy) {
        this.proxyPool.markFailed(selectedProxy);
      }
      return this.fetchLatestFromMobileWeb(monitor);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      if (selectedProxy) {
        this.proxyPool.markFailed(selectedProxy);
      }
      return this.fetchLatestFromMobileWeb(monitor);
    }

    try {
      const data = await res.json();
      const items = data.items ?? [];
      return items.map((item: any) => {
        const itemUrl = item.url || "";
        let native_id = item.id || "";
        const noteMatch = /\/explore\/([a-zA-Z0-9]+)/.exec(itemUrl);
        if (noteMatch) {
          native_id = noteMatch[1];
        }

        let content_type: ContentType = "post";
        if (item.content_html && (item.content_html.includes("<video") || item.content_html.includes(".mp4"))) {
          content_type = "video";
        }

        let cover_url: string | null = item.image || null;
        if (!cover_url && item.content_html) {
          const imgMatch = /<img[^>]+src="([^">]+)"/.exec(item.content_html);
          if (imgMatch) {
            cover_url = imgMatch[1];
          }
        }

        return {
          platform: "xiaohongshu" as const,
          native_id,
          content_type,
          title: item.title || "小红书笔记",
          cover_url,
          original_url: itemUrl || `https://www.xiaohongshu.com/explore/${native_id}`,
          published_at: item.date_published || new Date().toISOString(),
        };
      });
    } catch {
      return this.fetchLatestFromMobileWeb(monitor);
    }
  }

  /** Mobile page crawler fallback when RSSHub fails */
  private async fetchLatestFromMobileWeb(monitor: Monitor): Promise<RawContent[]> {
    const profileUrl = `https://www.xiaohongshu.com/user/profile/${monitor.native_id}`;
    let selectedProxy = this.proxyPool.getHealthyProxy();
    try {
      const cookie = await this.loadXiaohongshuCookie();
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      };
      if (cookie) {
        headers["Cookie"] = cookie;
      }
      const fetchOpts: any = { headers };
      if (selectedProxy) {
        fetchOpts.dispatcher = new ProxyAgent(selectedProxy);
      }
      const res = await fetch(profileUrl, fetchOpts);

      if (!res.ok) {
        throw new Error(`Mobile web request failed with status ${res.status}`);
      }

      const html = await res.text();
      const stateMatch = /window\.__INITIAL_STATE__\s*=\s*({.+?})<\/script>/.exec(html);
      if (stateMatch) {
        const state = JSON.parse(stateMatch[1]);
        const notes = state.user?.notes?.[0] || [];
        if (Array.isArray(notes)) {
          return notes.map((n: any) => {
            const isVideo = n.type === "video";
            return {
              platform: "xiaohongshu" as const,
              native_id: n.id || n.noteId,
              content_type: isVideo ? ("video" as const) : ("post" as const),
              title: n.title || n.desc || "无标题",
              cover_url: n.cover?.url || null,
              original_url: `https://www.xiaohongshu.com/explore/${n.id || n.noteId}`,
              published_at: new Date().toISOString(),
            };
          });
        }
      }
    } catch (err: any) {
      if (selectedProxy) {
        this.proxyPool.markFailed(selectedProxy);
      }
      console.warn(`[XiaohongshuAdapter] Mobile Web fallback failed: ${err.message}`);
    }

    const error = new Error("Xiaohongshu RSSHub and Mobile Web crawlers both failed");
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
        const res = await fetch(`${this.rsshubUrl}/xiaohongshu/user/${monitor.native_id}/notes?format=json`, fetchOpts);
        if (res.ok) {
          const data = await res.json();
          return data.title?.replace("的小红书笔记", "") || null;
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

    // Load proxy pool
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
            platform: "xiaohongshu",
            config_key: "platform_status",
            config_value: `paused:until=${pauseUntil}`
          });
        return { skipped: true, reason: `Xiaohongshu platform error: ${err.message}`, monitors, results: [] };
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
              platform: "xiaohongshu",
              config_key: "platform_status",
              config_value: `paused:until=${pauseUntil}`
            });
          for (let j = i + 1; j < monitors.length; j++) {
            results.push({ monitor: monitors[j], contents: [], error: `小红书平台因风控暂停: ${err.message}` });
          }
          break;
        }
      }
    }

    return { skipped: false, monitors, results };
  }
}
