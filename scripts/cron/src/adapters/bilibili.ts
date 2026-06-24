import { createHash } from "node:crypto";
import type { PlatformAdapter, Monitor, RawContent, PlatformResult } from "./types.js";
import { withPlatformThrottle } from "../lib/throttle.js";

const BILIBILI_PROXY_URL = process.env.BILIBILI_PROXY_URL ?? "";
const CRON_API_KEY = process.env.CRON_API_KEY ?? "";
const BILIBILI_NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const BILIBILI_SPACE_API = "https://api.bilibili.com/x/space/wbi/arc/search";
const BILIBILI_ARTICLE_API = "https://api.bilibili.com/x/space/article/list";
const BILIBILI_ACC_API = "https://api.bilibili.com/x/space/acc/info";

/** Fetch via cloud proxy if configured, otherwise direct. */
async function proxyFetch(url: string, headers: Record<string, string>): Promise<Response> {
  if (BILIBILI_PROXY_URL) {
    const proxyHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (CRON_API_KEY) proxyHeaders["x-cron-api-key"] = CRON_API_KEY;
    // Pass service_role key for auth
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (svcKey) proxyHeaders["Authorization"] = `Bearer ${svcKey}`;
    const res = await fetch(BILIBILI_PROXY_URL, {
      method: "POST",
      headers: proxyHeaders,
      body: JSON.stringify({ url, headers }),
    });
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      json: () => res.json(),
      text: () => res.text(),
    } as Response;
  }
  return fetch(url, { headers });
}

const MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

interface WbiCache {
  mixinKey: string;
  expiresAt: number;
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

let wbiCache: WbiCache | null = null;

async function getMixinKey(cookie: string): Promise<string> {
  if (wbiCache && wbiCache.expiresAt > Date.now()) {
    return wbiCache.mixinKey;
  }

  const res = await proxyFetch(BILIBILI_NAV_URL, { Cookie: cookie, "User-Agent": "ContentHub/1.0" });
  const data = await res.json();
  const { img_url, sub_url } = data.data?.wbi_img ?? {};

  if (!img_url || !sub_url) {
    throw new Error("Failed to fetch WBI keys from nav API");
  }

  const imgKey = img_url.split("/").pop()?.split(".")[0] ?? "";
  const subKey = sub_url.split("/").pop()?.split(".")[0] ?? "";
  const combined = imgKey + subKey;
  let mixinKey = "";
  for (let i = 0; i < 32; i++) {
    mixinKey += combined[MIXIN_KEY_TABLE[i]] ?? "";
  }

  wbiCache = { mixinKey, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  return mixinKey;
}

async function wbiSign(params: Record<string, string>, mixinKey: string): Promise<string> {
  const sorted = Object.keys(params).sort();
  const query = sorted.map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&");
  return md5(query + mixinKey);
}

function parseCookieJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    // Convert JSON to cookie header format
    return Object.entries(parsed)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  } catch {
    return raw;
  }
}

export class BilibiliAdapter implements PlatformAdapter {
  readonly platform = "bilibili" as const;

  async fetchLatest(monitor: Monitor): Promise<RawContent[]> {
    const cookie = await this.loadCookie();
    if (!cookie) throw new Error("B站 Cookie 未配置");

    const cookieStr = parseCookieJson(cookie);
    const mixinKey = await getMixinKey(cookieStr);

    const params: Record<string, string> = {
      mid: monitor.native_id,
      ps: "6",
      pn: "1",
    };

    const wts = String(Math.floor(Date.now() / 1000));
    const w_rid = await wbiSign({ ...params, wts }, mixinKey);

    const url = `${BILIBILI_SPACE_API}?mid=${params.mid}&ps=${params.ps}&pn=${params.pn}&wts=${wts}&w_rid=${w_rid}`;

    const res = await proxyFetch(url, { Cookie: cookieStr, "User-Agent": "ContentHub/1.0", Referer: "https://space.bilibili.com/" });

    if (res.status === 401 || res.status === 403) {
      const err = new Error("B站 Cookie 已失效");
      (err as any).isPlatformLevel = true;
      throw err;
    }

    const data = await res.json();
    const videos: RawContent[] = (data.data?.list?.vlist ?? data.data?.list ?? []).map((v: any) => ({
      platform: "bilibili" as const,
      native_id: String(v.bvid ?? v.aid ?? ""),
      content_type: "video" as const,
      title: v.title ?? "",
      cover_url: (v.pic ?? "").replace(/^http:/, "https:") || null,
      original_url: v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : "",
      published_at: new Date((v.created ?? 0) * 1000).toISOString(),
    }));

    // Also fetch articles (专栏)
    let articles: RawContent[] = [];
    try {
      const articleUrl = `${BILIBILI_ARTICLE_API}?mid=${monitor.native_id}&pn=1&ps=6`;
      const artRes = await proxyFetch(articleUrl, { Cookie: cookieStr, "User-Agent": "ContentHub/1.0", Referer: "https://space.bilibili.com/" });
      if (artRes.ok) {
        const artData = await artRes.json();
        articles = (artData.data?.articles ?? []).map((a: any) => ({
          platform: "bilibili" as const,
          native_id: String(a.id ?? ""),
          content_type: "article" as const,
          title: a.title ?? "",
          cover_url: (a.image_urls?.[0] ?? "").replace(/^http:/, "https:") || null,
          original_url: `https://www.bilibili.com/read/cv${a.id}`,
          published_at: new Date((a.publish_time ?? 0) * 1000).toISOString(),
        }));
      }
    } catch {
      // Articles are non-critical, return videos only
    }

    const allContents = [...videos, ...articles]
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .slice(0, 6);

    return allContents;
  }

  async fetchDisplayName(monitor: Monitor): Promise<string | null> {
    try {
      const res = await proxyFetch(`${BILIBILI_ACC_API}?mid=${monitor.native_id}`, { "User-Agent": "ContentHub/1.0" });
      const data = await res.json();
      return data.data?.name ?? null;
    } catch {
      return null;
    }
  }

  async fetchAll(monitors: Monitor[]): Promise<PlatformResult> {
    if (monitors.length === 0) return { skipped: false, monitors: [], results: [] };

    // Probe first monitor for platform-level errors
    let probeContents: RawContent[] | null = null;
    let probeError: string | null = null;
    try {
      probeContents = await this.fetchLatest(monitors[0]);
    } catch (err: any) {
      if (err.isPlatformLevel) {
        return { skipped: true, reason: "B站 Cookie 已失效，跳过整组", monitors, results: [] };
      }
      probeError = err.message;
    }

    // Build results starting with the probe monitor (success or error)
    const results: PlatformResult["results"] = [];
    if (probeError) {
      results.push({ monitor: monitors[0], contents: [], error: probeError });
    } else {
      results.push({ monitor: monitors[0], contents: probeContents! });
    }

    for (let i = 1; i < monitors.length; i++) {
      await withPlatformThrottle("bilibili", async () => {
        try {
          const contents = await this.fetchLatest(monitors[i]);
          results.push({ monitor: monitors[i], contents });
        } catch (err: any) {
          results.push({ monitor: monitors[i], contents: [], error: err.message });
        }
      });
    }

    return { skipped: false, monitors, results };
  }

  private async loadCookie(): Promise<string | null> {
    // Cookie is loaded from environment variable set by Cron's content-writer
    // which fetches it from Vault via get_bilibili_cookie RPC
    return process.env.BILIBILI_COOKIE ?? null;
  }
}
