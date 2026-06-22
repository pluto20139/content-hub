import type { PlatformAdapter, Monitor, RawContent, PlatformResult } from "./types.js";

const RSSHUB_URL = process.env.RSSHUB_URL ?? "";
const RSSHUB_API_KEY = process.env.RSSHUB_API_KEY ?? "";

export class ZhihuAdapter implements PlatformAdapter {
  readonly platform = "zhihu" as const;

  async fetchLatest(monitor: Monitor): Promise<RawContent[]> {
    if (!RSSHUB_URL) throw new Error("RSSHub URL 未配置");

    const nativeId = monitor.native_id;
    const isColumn = nativeId.startsWith("c_");
    const path = isColumn
      ? `zhihu/column/${nativeId}`
      : `zhihu/people/${nativeId}/articles`;

    const url = `${RSSHUB_URL}/${path}`;
    const headers: Record<string, string> = { "User-Agent": "ContentHub/1.0" };
    if (RSSHUB_API_KEY) {
      headers["Authorization"] = `Bearer ${RSSHUB_API_KEY}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      // Platform-level: RSSHub instance unreachable
      if (res.status >= 500 || res.status === 0) {
        const err = new Error("RSSHub 实例不可达");
        (err as any).isPlatformLevel = true;
        throw err;
      }
      throw new Error(`RSSHub error: ${res.status}`);
    }

    const text = await res.text();
    let data: any;
    try {
      // RSSHub may return JSON or RSS/Atom XML
      data = JSON.parse(text);
    } catch {
      data = await this.parseXml(text);
    }

    const items = data?.items ?? data?.data?.items ?? [];
    return items.slice(0, 6).map((item: any) => ({
      platform: "zhihu" as const,
      native_id: String(item.id ?? item.guid ?? ""),
      content_type: this.mapContentType(item),
      title: item.title ?? "",
      cover_url: null, // RSSHub doesn't always provide covers
      original_url: item.link ?? item.url ?? "",
      published_at: new Date(item.pubDate ?? item.date_published ?? Date.now()).toISOString(),
    }));
  }

  async fetchDisplayName(_monitor: Monitor): Promise<string | null> {
    // Name comes from parse-url at creation time; RSSHub feeds include author info
    // We could re-fetch but it's expensive; return null to keep existing name
    return null;
  }

  async fetchAll(monitors: Monitor[]): Promise<PlatformResult> {
    if (monitors.length === 0) return { skipped: false, monitors: [], results: [] };

    try {
      await this.fetchLatest(monitors[0]);
    } catch (err: any) {
      if (err.isPlatformLevel) {
        return { skipped: true, reason: "RSSHub 实例不可达，跳过整组", monitors, results: [] };
      }
    }

    const results: PlatformResult["results"] = [];
    for (const monitor of monitors) {
      try {
        const contents = await this.fetchLatest(monitor);
        results.push({ monitor, contents });
      } catch (err: any) {
        results.push({ monitor, contents: [], error: err.message });
      }
    }

    return { skipped: false, monitors, results };
  }

  private mapContentType(item: any): RawContent["content_type"] {
    const title = (item.title ?? "").toLowerCase();
    const category = item.category ?? "";
    if (title.includes("回答") || category === "answer") return "answer";
    if (title.includes("提问") || category === "question") return "question";
    if (title.includes("想法") || category === "pin") return "post";
    return "article";
  }

  private async parseXml(_text: string): Promise<any> {
    // Basic RSS XML parsing fallback — extract items via regex
    // In production, use a proper XML parser. For MVP, regex extraction suffices.
    const items: any[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(_text)) !== null) {
      const block = match[1];
      const title = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block)?.[1] ?? "";
      const link = /<link>([\s\S]*?)<\/link>/i.exec(block)?.[1] ?? "";
      const pubDate = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block)?.[1] ?? "";
      const guid = /<guid>([\s\S]*?)<\/guid>/i.exec(block)?.[1] ?? "";
      items.push({ title, link, pubDate, guid });
    }
    return { items };
  }
}
