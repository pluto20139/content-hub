import { fetch, ProxyAgent } from "undici";
import type { Monitor, PlatformAdapter, PlatformResult, RawContent } from "./types.js";
import { DatabaseProxyPool } from "../lib/proxy.js";

const RSSHUB_URL = process.env.RSSHUB_URL || "http://127.0.0.1:1200";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const FALLBACK_ENDPOINTS = [
  (handle: string) => `https://nitter.privacydev.net/${handle}/rss`,
  (handle: string) => `https://nitter.poast.org/${handle}/rss`,
  (handle: string) => `https://rsshub.app/twitter/user/${handle}`,
];

export class XAdapter implements PlatformAdapter {
  readonly platform = "x" as const;
  private proxyPool: DatabaseProxyPool;

  constructor() {
    this.proxyPool = new DatabaseProxyPool("x");
  }

  async fetchLatest(monitor: Monitor): Promise<RawContent[]> {
    console.log(`[X] Fetching latest posts for Monitor (Monitor ID: ${monitor.id}, Handle: ${monitor.native_id})`);
    await this.proxyPool.load();
    const handle = monitor.native_id.replace(/^@/, "").trim();

    // 1. Try Supabase Edge Function x-fetcher (runs on Singapore/US cloud nodes)
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        console.log(`[X] Requesting Edge Function x-fetcher for @${handle}...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const edgeRes = await fetch(`${SUPABASE_URL}/functions/v1/x-fetcher`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({ handle }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (edgeRes.ok) {
          const body: any = await edgeRes.json();
          if (body.success && Array.isArray(body.data) && body.data.length > 0) {
            console.log(`[X] Successfully fetched ${body.data.length} posts for @${handle} via Edge Function x-fetcher`);
            return body.data as RawContent[];
          }
        } else {
          console.warn(`[X] Edge Function x-fetcher returned status ${edgeRes.status} for @${handle}`);
        }
      } catch (edgeErr: unknown) {
        console.warn(`[X] Edge Function x-fetcher failed for @${handle}:`, edgeErr instanceof Error ? edgeErr.message : String(edgeErr));
      }
    }

    const primaryUrl = `${RSSHUB_URL}/twitter/user/${encodeURIComponent(handle)}`;
    const selectedProxy = this.proxyPool.getHealthyProxy();

    // 2. Try primary local RSSHub endpoint with timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const fetchOpts: any = {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/xml, text/xml, */*",
        },
        signal: controller.signal,
      };

      if (selectedProxy) {
        fetchOpts.dispatcher = new ProxyAgent(selectedProxy);
      }

      const res = await fetch(primaryUrl, fetchOpts);
      clearTimeout(timeoutId);

      if (res.ok) {
        const xmlText = await res.text();
        const items = this.parseRssFeed(xmlText, handle);
        if (items.length > 0) return items;
      } else {
        if (selectedProxy) this.proxyPool.markFailed(selectedProxy);
        console.warn(`[X] Primary RSSHub returned HTTP ${res.status} for handle @${handle}, trying fallbacks...`);
      }
    } catch (err: unknown) {
      if (selectedProxy) this.proxyPool.markFailed(selectedProxy);
      console.warn(`[X] Primary RSSHub fetch failed for @${handle}:`, err instanceof Error ? err.message : String(err));
    }

    // 3. Try fallback public RSS endpoints
    for (const getFallbackUrl of FALLBACK_ENDPOINTS) {
      const fallbackUrl = getFallbackUrl(handle);
      try {
        console.log(`[X] Trying fallback RSS endpoint for @${handle}: ${fallbackUrl}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const fetchOpts: any = {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/xml, text/xml, */*",
          },
          signal: controller.signal,
        };

        if (selectedProxy) {
          fetchOpts.dispatcher = new ProxyAgent(selectedProxy);
        }

        const res = await fetch(fallbackUrl, fetchOpts);
        clearTimeout(timeoutId);

        if (res.ok) {
          const xmlText = await res.text();
          const items = this.parseRssFeed(xmlText, handle);
          if (items.length > 0) {
            console.log(`[X] Successfully fetched ${items.length} posts for @${handle} via fallback RSS`);
            return items;
          }
        }
      } catch (fallbackErr: unknown) {
        console.warn(`[X] Fallback ${fallbackUrl} failed:`, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
      }
    }

    throw new Error(`X (Twitter) RSS 抓取失败：所有镜像节点暂不可用`);
  }

  async fetchDisplayName(monitor: Monitor): Promise<string | null> {
    return `@${monitor.native_id.replace(/^@/, "")}`;
  }

  async fetchAll(monitors: Monitor[]): Promise<PlatformResult> {
    const results: PlatformResult["results"] = [];

    for (const monitor of monitors) {
      try {
        const contents = await this.fetchLatest(monitor);
        results.push({ monitor, contents });
      } catch (err: unknown) {
        results.push({ monitor, contents: [], error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { skipped: false, monitors, results };
  }

  private parseRssFeed(xmlText: string, handle: string): RawContent[] {
    const items: RawContent[] = [];
    const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/gi) || [];

    for (const itemXml of itemMatches) {
      const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      const pubDateMatch = itemXml.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i);
      const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);

      const rawTitle = titleMatch ? titleMatch[1].trim() : "";
      const rawLink = linkMatch ? linkMatch[1].trim() : "";
      const rawPubDate = pubDateMatch ? pubDateMatch[1].trim() : "";
      const desc = descMatch ? descMatch[1].trim() : "";

      // HTML unescape
      const cleanTitle = rawTitle
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, "")
        .trim();

      if (!cleanTitle && !desc) continue;

      // Extract native ID (tweet status ID)
      let nativeId = "";
      const statusMatch = rawLink.match(/status\/(\d+)/);
      if (statusMatch) {
        nativeId = statusMatch[1];
      } else {
        nativeId = cleanTitle.slice(0, 32);
      }

      // Extract cover image
      let coverUrl: string | null = null;
      const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) {
        coverUrl = imgMatch[1];
      }

      let pubDateIso = new Date().toISOString();
      if (rawPubDate) {
        try {
          const parsed = new Date(rawPubDate);
          if (!isNaN(parsed.getTime())) {
            pubDateIso = parsed.toISOString();
          }
        } catch {
          // ignore
        }
      }

      items.push({
        platform: "x",
        native_id: nativeId,
        content_type: "post",
        title: cleanTitle || `推文由 @${handle} 发布`,
        cover_url: coverUrl,
        original_url: `https://x.com/${handle}/status/${nativeId}`,
        published_at: pubDateIso,
      });
    }

    return items;
  }
}
