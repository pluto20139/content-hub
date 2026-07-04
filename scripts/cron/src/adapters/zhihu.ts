import { createHash } from "node:crypto";
import { ProxyAgent } from "undici";
import type { PlatformAdapter, Monitor, RawContent, PlatformResult, ContentType } from "./types.js";
import { supabase } from "../lib/supabase.js";
import { DatabaseProxyPool } from "../lib/proxy.js";
import { withPlatformThrottle } from "../lib/throttle.js";

export class ZhihuAdapter implements PlatformAdapter {
  readonly platform = "zhihu" as const;
  private proxyPool: DatabaseProxyPool;

  constructor() {
    this.proxyPool = new DatabaseProxyPool("zhihu");
  }

  private get rsshubUrl(): string {
    return process.env.RSSHUB_URL ?? "";
  }

  async fetchLatest(monitor: Monitor): Promise<RawContent[]> {
    const cleanId = monitor.native_id.replace("people:", "").replace("column:", "");

    // Fallback mock logic for local testing in development/test environments
    if (!this.rsshubUrl) {
      if (process.env.NODE_ENV !== "production" && process.env.USE_MOCK === "true") {
        console.log(`[ZhihuAdapter] RSSHub URL not configured, returning mock data for monitor ${monitor.display_name}`);
        return [
          {
            platform: "zhihu" as const,
            native_id: `mock-zhihu-${cleanId}-1`,
            content_type: "answer" as const,
            title: `如何评价最新发布的多平台内容中枢 v1.1 迭代版本？ — ${monitor.display_name}`,
            cover_url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80",
            original_url: monitor.original_url,
            published_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
          },
          {
            platform: "zhihu" as const,
            native_id: `mock-zhihu-${cleanId}-2`,
            content_type: "article" as const,
            title: `【专栏】多平台内容中枢系统设计 with TypeScript — ${monitor.display_name}`,
            cover_url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80",
            original_url: monitor.original_url,
            published_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
          }
        ];
      }
      const error = new Error("Zhihu RSSHUB_URL is not configured");
      (error as any).isPlatformLevel = true;
      throw error;
    }

    const isColumn = monitor.native_type === "column" || monitor.native_id.startsWith("column:");
    const path = isColumn
      ? `/zhihu/zhuanlan/${cleanId}`
      : `/zhihu/people/activities/${cleanId}`;

    const url = `${this.rsshubUrl}${path}?format=json`;

    let res: Response;
    const selectedProxy = this.proxyPool.getHealthyProxy();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const fetchOpts: any = {
        headers: { "User-Agent": "ContentHub/1.0" },
        signal: controller.signal,
      };
      if (selectedProxy) {
        fetchOpts.dispatcher = new ProxyAgent(selectedProxy);
      }
      res = await fetch(url, fetchOpts);
    } catch (err: any) {
      if (selectedProxy) {
        this.proxyPool.markFailed(selectedProxy);
      }
      const error = new Error(`RSSHub connection failed: ${err.message}`);
      (error as any).isPlatformLevel = true;
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      if (selectedProxy) {
        this.proxyPool.markFailed(selectedProxy);
      }
      if (res.status === 404 || res.status === 403 || res.status >= 500) {
        const error = new Error(`RSSHub returned status ${res.status}`);
        (error as any).isPlatformLevel = true;
        throw error;
      }
      throw new Error(`Zhihu fetch failed with status ${res.status}`);
    }

    const data = await res.json();
    const items = data.items ?? [];
    const rawContents: RawContent[] = [];

    for (const item of items) {
      const itemUrl = item.url || "";
      let native_id = item.id || "";
      let content_type: ContentType = "post";

      if (isColumn) {
        content_type = "article";
        const match = /\/p\/(\d+)/.exec(itemUrl);
        if (match) {
          native_id = match[1];
        } else {
          const rawId = item.id || itemUrl || String(Math.random());
          native_id = createHash("sha256").update(rawId).digest("hex").slice(0, 16);
        }
      } else {
        // Parse activity type from url structure
        if (itemUrl.includes("/answer/")) {
          const match = /\/answer\/(\d+)/.exec(itemUrl);
          if (match) {
            native_id = match[1];
            content_type = "answer";
          }
        } else if (itemUrl.includes("/question/")) {
          const match = /\/question\/(\d+)/.exec(itemUrl);
          if (match) {
            native_id = match[1];
            content_type = "question";
          }
        } else if (itemUrl.includes("/pin/")) {
          const match = /\/pin\/(\d+)/.exec(itemUrl);
          if (match) {
            native_id = match[1];
            content_type = "post";
          }
        } else if (itemUrl.includes("zhuanlan.zhihu.com/p/")) {
          const match = /\/p\/(\d+)/.exec(itemUrl);
          if (match) {
            native_id = match[1];
            content_type = "article";
          }
        } else {
          // Discard follow, vote, or other non-creation activities
          continue;
        }
      }

      let cover_url: string | null = item.image || null;
      if (!cover_url && item.content_html) {
        const imgMatch = /<img[^>]+src="([^">]+)"/.exec(item.content_html);
        if (imgMatch) {
          cover_url = imgMatch[1];
        }
      }

      const published_at = item.date_published || item.date_modified || item.published || new Date().toISOString();

      rawContents.push({
        platform: "zhihu" as const,
        native_id,
        content_type,
        title: item.title || "知乎动态",
        cover_url,
        original_url: itemUrl || `https://www.zhihu.com`,
        published_at,
      });
    }

    return rawContents;
  }

  async fetchDisplayName(monitor: Monitor): Promise<string | null> {
    if (!this.rsshubUrl) return null;
    try {
      const cleanId = monitor.native_id.replace("people:", "").replace("column:", "");
      const isColumn = monitor.native_type === "column" || monitor.native_id.startsWith("column:");
      const path = isColumn
        ? `/zhihu/zhuanlan/${cleanId}`
        : `/zhihu/people/activities/${cleanId}`;
      const url = `${this.rsshubUrl}${path}?format=json`;

      const selectedProxy = this.proxyPool.getHealthyProxy();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const fetchOpts: any = { signal: controller.signal };
        if (selectedProxy) {
          fetchOpts.dispatcher = new ProxyAgent(selectedProxy);
        }
        const res = await fetch(url, fetchOpts);
        if (res.ok) {
          const data = await res.json();
          return data.title?.replace("知乎专栏 - ", "")?.replace("的知乎动态", "") || null;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      // ignore and return null
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
            platform: "zhihu",
            config_key: "platform_status",
            config_value: `paused:until=${pauseUntil}`
          });
        return { skipped: true, reason: `Zhihu RSSHub platform error: ${err.message}`, monitors, results: [] };
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
              platform: "zhihu",
              config_key: "platform_status",
              config_value: `paused:until=${pauseUntil}`
            });
          for (let j = i + 1; j < monitors.length; j++) {
            results.push({ monitor: monitors[j], contents: [], error: `知乎平台因风控暂停: ${err.message}` });
          }
          break;
        }
      }
    }

    return { skipped: false, monitors, results };
  }
}
