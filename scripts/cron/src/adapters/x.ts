import { fetch } from "undici";
import type { Monitor, PlatformAdapter, PlatformResult, RawContent } from "./types.js";

const RSSHUB_URL = process.env.RSSHUB_URL || "http://127.0.0.1:1200";

export class XAdapter implements PlatformAdapter {
  readonly platform = "x" as const;

  async fetchLatest(monitor: Monitor): Promise<RawContent[]> {
    console.log(`[X] Fetching latest posts for Monitor (Monitor ID: ${monitor.id}, Handle: ${monitor.native_id})`);
    const handle = monitor.native_id.replace(/^@/, "").trim();
    const rssUrl = `${RSSHUB_URL}/twitter/user/${encodeURIComponent(handle)}`;

    try {
      const res = await fetch(rssUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/xml, text/xml, */*",
        },
      });

      if (!res.ok) {
        console.error(`[X] RSSHub fetch failed for Monitor (Monitor ID: ${monitor.id}): HTTP ${res.status}`);
        throw new Error(`HTTP ${res.status}`);
      }

      const xmlText = await res.text();
      return this.parseRssFeed(xmlText, handle);
    } catch (err: any) {
      console.error(`[X] Error fetching posts for Monitor (Monitor ID: ${monitor.id}):`, err.message);
      throw err;
    }
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
      } catch (err: any) {
        results.push({ monitor, contents: [], error: err.message });
      }
    }

    return {
      skipped: false,
      monitors,
      results,
    };
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
      const rawDesc = descMatch ? descMatch[1] : "";

      if (!rawLink) continue;

      // Extract Tweet ID from link: status/123456789
      const tweetIdMatch = rawLink.match(/status\/(\d+)/);
      const tweetId = tweetIdMatch ? tweetIdMatch[1] : `tweet-${Date.now()}`;

      // Extract first image URL if present in description HTML
      const imgMatch = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i);
      const coverUrl = imgMatch ? imgMatch[1] : null;

      // Clean HTML tags and XML entities from title
      let cleanTitle = rawTitle.replace(/<[^>]+>/g, "").trim();
      cleanTitle = unescapeXml(cleanTitle) || "X Post";

      const publishedAt = rawPubDate ? new Date(rawPubDate).toISOString() : new Date().toISOString();

      items.push({
        platform: "x",
        native_id: tweetId,
        content_type: "post",
        title: cleanTitle,
        cover_url: coverUrl,
        original_url: rawLink || `https://x.com/${handle}/status/${tweetId}`,
        published_at: publishedAt,
      });
    }

    return items;
  }
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
