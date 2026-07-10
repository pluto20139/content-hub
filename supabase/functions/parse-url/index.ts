import { corsHeaders } from "../_shared/cors.ts";

interface ParseRequest {
  url: string;
}

interface ParseSuccess {
  success: true;
  data: {
    platform: string;
    native_id: string;
    display_name: string;
    native_type?: string | null;
  };
}

interface ParseError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

type ParseResponse = ParseSuccess | ParseError;

const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Generic redirect resolver & DB Cache ─────────────

interface ResolveResult {
  url?: string;
  body?: string;
  status: number;
}

/** Resolve short links. Try HEAD first, then GET if the server doesn't cooperate. */
async function resolveLink(shortUrl: string): Promise<ResolveResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  const headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };

  try {
    // 1. Try HEAD first (cheap)
    const headRes = await fetch(shortUrl, {
      method: "HEAD",
      redirect: "manual",
      headers,
      signal: controller.signal,
    });

    const headLocation = headRes.headers.get("location");
    if (headLocation && [301, 302, 303, 307, 308].includes(headRes.status)) {
      return { url: headLocation, status: headRes.status };
    }

    // 2. HEAD didn't yield a redirect -> fetch the page body and follow redirects
    const getRes = await fetch(shortUrl, {
      method: "GET",
      redirect: "follow",
      headers,
      signal: controller.signal,
    });

    const body = await getRes.text();
    return { url: getRes.url, body, status: getRes.status };
  } catch (err) {
    console.error(`Failed to resolve link for ${shortUrl}:`, err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getCachedLink(shortCode: string): Promise<{ resolved_id: string; resolved_type: string | null } | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/short_link_cache?short_code=eq.${encodeURIComponent(shortCode)}&select=resolved_id,resolved_type,expires_at`, {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        if (new Date(item.expires_at) > new Date()) {
          return { resolved_id: item.resolved_id, resolved_type: item.resolved_type };
        }
      }
    }
  } catch (err) {
    console.error("Failed to query short_link_cache:", err);
  }
  return null;
}

async function cacheLink(shortCode: string, resolvedId: string, resolvedType: string | null): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/short_link_cache`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        short_code: shortCode,
        resolved_id: resolvedId,
        resolved_type: resolvedType,
        expires_at: expiresAt,
      }),
    });
  } catch (err) {
    console.error("Failed to write to short_link_cache:", err);
  }
}

// ── B站 ──────────────────────────────────────────────

const BILIBILI_SPACE_RE = /space\.bilibili\.com\/(\d+)/;
const BILIBILI_SHORT_RE = /b23\.tv\//;
const BILIBILI_DOMAIN_RE = /bilibili\.com/;

async function parseBilibili(mid: string): Promise<ParseResponse> {
  let displayName = `B站_${mid.slice(0, 8)}`;
  try {
    const res = await fetch(`https://api.bilibili.com/x/space/acc/info?mid=${mid}`, {
      headers: { "User-Agent": "ContentHub/1.0" },
    });
    if (res.ok) {
      const json = await res.json();
      if (json.code === 0 && json.data?.name) {
        displayName = json.data.name;
      }
    }
  } catch {
    // fall through to fallback name
  }
  return {
    success: true,
    data: { platform: "bilibili", native_id: mid, display_name: displayName, native_type: "user" },
  };
}

// ── YouTube ───────────────────────────────────────────

const YOUTUBE_HANDLE_RE = /youtube\.com\/@([^/?]+)/;
const YOUTUBE_CHANNEL_RE = /youtube\.com\/channel\/(UC[^/?]+)/;
const YOUTUBE_C_RE = /youtube\.com\/c\/([^/?]+)/;

async function youtubeApi(path: string): Promise<unknown> {
  const url = `https://www.googleapis.com/youtube/v3/${path}${path.includes("?") ? "&" : "?"}key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function resolveChannelId(
  type: "handle" | "channel" | "username",
  value: string,
): Promise<{ channelId: string; title: string }> {
  let json: any;

  if (type === "channel") {
    json = await youtubeApi(`channels?id=${value}&part=snippet`);
    const item = json.items?.[0];
    if (!item) throw new Error("Channel not found");
    return { channelId: value, title: item.snippet?.title ?? "" };
  }

  if (type === "handle") {
    json = await youtubeApi(`channels?part=snippet&forHandle=@${value}`);
  } else {
    json = await youtubeApi(`channels?part=snippet&forUsername=${value}`);
  }

  const item = json.items?.[0];
  if (!item) throw new Error("Channel not found");
  return { channelId: item.id, title: item.snippet?.title ?? "" };
}

async function resolveYoutubeC(cName: string): Promise<string | null> {
  const url = `https://www.youtube.com/c/${cName}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
      },
    });
    if (res.ok) {
      const html = await res.text();
      const canonicalMatch = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[^"]+)"/.exec(html);
      if (canonicalMatch) return canonicalMatch[1];

      const metaMatch = /<meta itemprop="channelId" content="(UC[^"]+)"/.exec(html);
      if (metaMatch) return metaMatch[1];

      const jsonMatch = /"channelId":"(UC[^"]+)"/.exec(html);
      if (jsonMatch) return jsonMatch[1];
    }
  } catch (err) {
    console.error(`Failed to resolve YouTube /c/ link for ${cName}:`, err);
  }
  return null;
}

async function parseYoutube(url: string): Promise<ParseResponse> {
  if (!YOUTUBE_API_KEY) {
    return { success: false, error: { code: "INTERNAL_ERROR", message: "YouTube API key not configured" } };
  }

  let match: RegExpExecArray | null;
  let type: "handle" | "channel" | "username";
  let value: string;

  if ((match = YOUTUBE_CHANNEL_RE.exec(url))) {
    type = "channel";
    value = match[1];
  } else if ((match = YOUTUBE_HANDLE_RE.exec(url))) {
    type = "handle";
    value = match[1];
  } else if ((match = YOUTUBE_C_RE.exec(url))) {
    type = "channel";
    const cId = await resolveYoutubeC(match[1]);
    if (!cId) {
      return { success: false, error: { code: "INVALID_URL", message: "无法解析该 YouTube /c/ 链接，请改用包含 @handle 或 /channel/UC... 的链接" } };
    }
    value = cId;
  } else {
    return { success: false, error: { code: "UNKNOWN_PLATFORM", message: "无法识别该 YouTube 链接格式" } };
  }

  try {
    const { channelId, title } = await resolveChannelId(type, value);
    const displayName = title || `YouTube_${channelId.slice(0, 8)}`;
    return {
      success: true,
      data: { platform: "youtube", native_id: channelId, display_name: displayName, native_type: null },
    };
  } catch {
    return { success: false, error: { code: "YOUTUBE_API_ERROR", message: "YouTube API 调用失败，请稍后重试" } };
  }
}

// ── 知乎 ──────────────────────────────────────────────

const ZHIHU_PEOPLE_RE = /zhihu\.com\/people\/([^/?#]+)/;
const ZHIHU_COLUMN_RE = /zhuanlan\.zhihu\.com\/((?!p\/)[^/?#]+)/;
const ZHIHU_COLUMN_ALT_RE = /zhihu\.com\/column\/([^/?#]+)/;
const ZHIHU_COLUMN_C_RE = /zhuanlan\.zhihu\.com\/c\/([^/?#]+)/;

async function parseZhihu(url: string): Promise<ParseResponse> {
  let match: RegExpExecArray | null;
  let native_id = "";
  let displayName = "";
  let native_type = "";

  if ((match = ZHIHU_PEOPLE_RE.exec(url))) {
    const peopleId = match[1];
    native_id = peopleId;
    displayName = `知乎用户_${peopleId}`;
    native_type = "people";
  } else if ((match = ZHIHU_COLUMN_C_RE.exec(url))) {
    const columnId = match[1];
    native_id = columnId;
    displayName = `知乎专栏_${columnId}`;
    native_type = "column";
  } else if ((match = ZHIHU_COLUMN_RE.exec(url)) || (match = ZHIHU_COLUMN_ALT_RE.exec(url))) {
    const columnId = match[1];
    native_id = columnId;
    displayName = `知乎专栏_${columnId}`;
    native_type = "column";
  } else {
    return { success: false, error: { code: "INVALID_URL", message: "知乎链接格式不正确" } };
  }

  return {
    success: true,
    data: { platform: "zhihu", native_id, display_name: displayName, native_type },
  };
}

// ── 抖音 ──────────────────────────────────────────────

const DOUYIN_SHORT_RE = /v\.douyin\.com\//;
const DOUYIN_USER_RE = /douyin\.com\/user\/([^/?#]+)/;

function extractDouyinSecUid(url: string): string | null {
  try {
    const parsed = new URL(url);
    const secUid = parsed.searchParams.get("sec_uid");
    if (secUid) return secUid;

    const pathMatch = parsed.pathname.match(/\/user\/([^/?#]+)/);
    if (pathMatch) return pathMatch[1];

    // 兼容 iesdouyin.com/share/user/... 路径形式
    const shareMatch = parsed.pathname.match(/\/share\/user\/([^/?#]+)/);
    if (shareMatch) return shareMatch[1];
  } catch {
    // invalid URL
  }
  return null;
}

async function parseDouyin(url: string): Promise<ParseResponse> {
  let resolvedUrl = url;

  if (DOUYIN_SHORT_RE.test(url)) {
    const cached = await getCachedLink(url);
    if (cached) {
      return {
        success: true,
        data: {
          platform: "douyin",
          native_id: cached.resolved_id,
          display_name: `抖音用户_${cached.resolved_id.slice(0, 8)}`,
          native_type: null,
        },
      };
    }

    const resolved = await resolveLink(url);
    if (!resolved || !resolved.url) {
      return { success: false, error: { code: "INVALID_URL", message: "无法解析该抖音短链接，请使用完整链接" } };
    }
    resolvedUrl = resolved.url;
  }

  const secUid = extractDouyinSecUid(resolvedUrl);
  if (!secUid) {
    return { success: false, error: { code: "INVALID_URL", message: "请粘贴抖音个人主页链接" } };
  }

  if (url !== resolvedUrl) {
    await cacheLink(url, secUid, "sec_uid");
  }

  return {
    success: true,
    data: {
      platform: "douyin",
      native_id: secUid,
      display_name: `抖音用户_${secUid.slice(0, 8)}`,
      native_type: null,
    },
  };
}

// ── 小红书 ────────────────────────────────────────────

const XIAOHONGSHU_SHORT_RE = /(xhslink\.com\/|sns\.xiaohongshu\.com\/t\/)/;
const XIAOHONGSHU_USER_RE = /xiaohongshu\.com\/user\/profile\/([^/?#]+)/;

function extractXiaohongshuUserId(url: string, body?: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/user\/profile\/([^/?#]+)/);
    if (match) return match[1];
  } catch {
    // invalid URL
  }

  if (body) {
    // 常见嵌入方式：window.__INITIAL_STATE__ 中的 userId
    const patterns = [
      /"userId":"([a-f0-9]+)"/i,
      /"userId":"([^"]+)"/,
      /"user_id":"([a-f0-9]+)"/i,
      /user\/profile\/([a-f0-9]+)/i,
    ];
    for (const re of patterns) {
      const match = re.exec(body);
      if (match) return match[1];
    }
  }

  return null;
}

async function parseXiaohongshu(url: string): Promise<ParseResponse> {
  let resolvedUrl = url;
  let resolvedBody: string | undefined;

  if (XIAOHONGSHU_SHORT_RE.test(url)) {
    const cached = await getCachedLink(url);
    if (cached) {
      return {
        success: true,
        data: {
          platform: "xiaohongshu",
          native_id: cached.resolved_id,
          display_name: `小红书用户_${cached.resolved_id.slice(0, 8)}`,
          native_type: null,
        },
      };
    }

    const resolved = await resolveLink(url);
    if (!resolved) {
      return { success: false, error: { code: "INVALID_URL", message: "无法解析该小红书短链接，请使用完整链接" } };
    }
    if (resolved.status === 404) {
      return { success: false, error: { code: "INVALID_URL", message: "该短链已失效或不存在，请重新获取" } };
    }

    resolvedUrl = resolved.url || url;
    resolvedBody = resolved.body;
  }

  const userId = extractXiaohongshuUserId(resolvedUrl, resolvedBody);
  if (!userId) {
    return {
      success: false,
      error: {
        code: "INVALID_URL",
        message: "该短链无法定位到小红书个人主页，请使用完整链接，例如 https://www.xiaohongshu.com/user/profile/xxx",
      },
    };
  }

  if (XIAOHONGSHU_SHORT_RE.test(url)) {
    await cacheLink(url, userId, "uid");
  }

  return {
    success: true,
    data: {
      platform: "xiaohongshu",
      native_id: userId,
      display_name: `小红书用户_${userId.slice(0, 8)}`,
      native_type: null,
    },
  };
}

// ── URL validation ────────────────────────────────────

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

// ── Main handler ──────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "仅支持 POST 请求" } }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: ParseRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "请求体格式无效" } }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const url = body.url?.trim();
  if (!url || !isValidUrl(url)) {
    return new Response(
      JSON.stringify({ success: false, error: { code: "INVALID_URL", message: "URL 格式不合法" } }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let result: ParseResponse | undefined;

  try {
    let resolvedUrl = url;
    // Resolve B站 short links first using generic redirect resolver
    if (BILIBILI_SHORT_RE.test(url)) {
      const resolved = await resolveLink(url);
      if (!resolved || !resolved.url) {
        result = { success: false, error: { code: "UNKNOWN_PLATFORM", message: "无法解析 B站短链接，请使用完整链接" } };
      } else {
        resolvedUrl = resolved.url;
      }
    }

    if (result) {
      // result already set
    } else if (BILIBILI_SPACE_RE.test(resolvedUrl)) {
      result = await parseBilibili(BILIBILI_SPACE_RE.exec(resolvedUrl)![1]);
    } else if (BILIBILI_DOMAIN_RE.test(resolvedUrl) && !BILIBILI_SPACE_RE.test(resolvedUrl)) {
      result = { success: false, error: { code: "UNKNOWN_PLATFORM", message: "请粘贴 B站 个人空间链接（space.bilibili.com/数字ID），而非视频或文章链接" } };
    } else if (
      YOUTUBE_HANDLE_RE.test(resolvedUrl) ||
      YOUTUBE_CHANNEL_RE.test(resolvedUrl) ||
      YOUTUBE_C_RE.test(resolvedUrl)
    ) {
      result = await parseYoutube(resolvedUrl);
    } else if (resolvedUrl.includes("zhuanlan.zhihu.com/p/")) {
      result = { success: false, error: { code: "INVALID_URL", message: "暂不支持添加知乎单篇文章为监控目标，请粘贴博主主页或专栏主页链接" } };
    } else if (
      ZHIHU_PEOPLE_RE.test(resolvedUrl) ||
      ZHIHU_COLUMN_RE.test(resolvedUrl) ||
      ZHIHU_COLUMN_ALT_RE.test(resolvedUrl) ||
      ZHIHU_COLUMN_C_RE.test(resolvedUrl)
    ) {
      result = await parseZhihu(resolvedUrl);
    } else if (DOUYIN_SHORT_RE.test(resolvedUrl) || DOUYIN_USER_RE.test(resolvedUrl)) {
      result = await parseDouyin(resolvedUrl);
    } else if (XIAOHONGSHU_SHORT_RE.test(resolvedUrl) || XIAOHONGSHU_USER_RE.test(resolvedUrl)) {
      result = await parseXiaohongshu(resolvedUrl);
    } else {
      result = { success: false, error: { code: "UNKNOWN_PLATFORM", message: "无法识别该平台，目前支持 B站 / YouTube / 知乎 / 抖音 / 小红书" } };
    }
  } catch (err) {
    console.error("parse-url internal error:", err);
    result = { success: false, error: { code: "INTERNAL_ERROR", message: "服务器内部错误，请稍后重试" } };
  }

  const status = result.success ? 200
    : result.error.code === "UNKNOWN_PLATFORM" || result.error.code === "INVALID_URL" ? 400
    : result.error.code === "YOUTUBE_API_ERROR" ? 502
    : 500;

  return new Response(JSON.stringify(result), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(handleRequest);
