import { fetch } from "undici";
import type { Monitor, PlatformAdapter, PlatformResult, RawContent } from "./types.js";

const RSSHUB_URL = process.env.RSSHUB_URL || "http://127.0.0.1:1200";

const FALLBACK_ENDPOINTS = [
  (handle: string) => `https://nitter.privacydev.net/${handle}/rss`,
  (handle: string) => `https://nitter.poast.org/${handle}/rss`,
  (handle: string) => `https://rsshub.app/twitter/user/${handle}`,
];

export class XAdapter implements PlatformAdapter {
  readonly platform = "x" as const;

  async fetchLatest(monitor: Monitor): Promise<RawContent[]> {
    console.log(`[X] Fetching latest posts for Monitor (Monitor ID: ${monitor.id}, Handle: ${monitor.native_id})`);
    const handle = monitor.native_id.replace(/^@/, "").trim();
    const primaryUrl = `${RSSHUB_URL}/twitter/user/${encodeURIComponent(handle)}`;

    // Try primary RSSHub endpoint first
    try {
      const res = await fetch(primaryUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/xml, text/xml, */*",
        },
      });

      if (res.ok) {
        const xmlText = await res.text();
        const items = this.parseRssFeed(xmlText, handle);
        if (items.length > 0) return items;
      } else {
        console.warn(`[X] Primary RSSHub returned HTTP ${res.status} for handle @${handle}, trying fallbacks...`);
      }
    } catch (err: unknown) {
      console.warn(`[X] Primary RSSHub fetch failed for @${handle}:`, err instanceof Error ? err.message : String(err));
    }

    // Fallback endpoints
    for (const getFallbackUrl of FALLBACK_ENDPOINTS) {
      const fallbackUrl = getFallbackUrl(handle);
      try {
        console.log(`[X] Trying fallback RSS endpoint for @${handle}: ${fallbackUrl}`);
        const res = await fetch(fallbackUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/xml, text/xml, */*",
          },
        });

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

    throw new Error(`X (Twitter) RSS 抓取失败：RSSHub 及镜像源暂无数据，请检查网络或配置 TWITTER_AUTH_TOKEN`);
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
      let coverUrl = "";
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
        cover_url: coverUrl || null,
        original_url: `https://x.com/${handle}/status/${nativeId}`,
        published_at: pubDateIso,
      });
    }

    return items;
  }
}
