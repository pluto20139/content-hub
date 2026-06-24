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

// ── B站 ──────────────────────────────────────────────

const BILIBILI_SPACE_RE = /space\.bilibili\.com\/(\d+)/;
const BILIBILI_SHORT_RE = /b23\.tv\//;
const BILIBILI_DOMAIN_RE = /bilibili\.com/;

/** Resolve b23.tv short links by following the redirect. */
async function resolveB23ShortLink(shortUrl: string): Promise<string | null> {
  try {
    const res = await fetch(shortUrl, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": "ContentHub/1.0" },
    });
    const location = res.headers.get("location");
    return location ?? null;
  } catch {
    return null;
  }
}

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
    data: { platform: "bilibili", native_id: mid, display_name: displayName },
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
    json = await youtubeApi(`channels?part=snippet&forHandle=${value}`);
  } else {
    json = await youtubeApi(`channels?part=snippet&forUsername=${value}`);
  }

  const item = json.items?.[0];
  if (!item) throw new Error("Channel not found");
  return { channelId: item.id, title: item.snippet?.title ?? "" };
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
    type = "username";
    value = match[1];
  } else {
    return { success: false, error: { code: "UNKNOWN_PLATFORM", message: "无法识别该 YouTube 链接格式" } };
  }

  try {
    const { channelId, title } = await resolveChannelId(type, value);
    const displayName = title || `YouTube_${channelId.slice(0, 8)}`;
    return {
      success: true,
      data: { platform: "youtube", native_id: channelId, display_name: displayName },
    };
  } catch {
    return { success: false, error: { code: "YOUTUBE_API_ERROR", message: "YouTube API 调用失败，请稍后重试" } };
  }
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
  // CORS preflight
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
    // Resolve b23.tv short links first
    let resolvedUrl = url;
    if (BILIBILI_SHORT_RE.test(url)) {
      const redirect = await resolveB23ShortLink(url);
      if (!redirect) {
        result = { success: false, error: { code: "UNKNOWN_PLATFORM", message: "无法解析 B站短链接，请使用完整链接" } };
      } else {
        resolvedUrl = redirect;
      }
    }

    if (result) {
      // result already set above (error case)
    } else if (BILIBILI_SPACE_RE.test(resolvedUrl)) {
      result = await parseBilibili(BILIBILI_SPACE_RE.exec(resolvedUrl)![1]);
    } else if (BILIBILI_DOMAIN_RE.test(resolvedUrl) && !BILIBILI_SPACE_RE.test(resolvedUrl)) {
      // It's a bilibili.com link but not a space page (e.g. video page from short link)
      result = { success: false, error: { code: "UNKNOWN_PLATFORM", message: "请粘贴 B站 个人空间链接（space.bilibili.com/数字ID），而非视频或文章链接" } };
    } else if (
      YOUTUBE_HANDLE_RE.test(resolvedUrl) ||
      YOUTUBE_CHANNEL_RE.test(resolvedUrl) ||
      YOUTUBE_C_RE.test(resolvedUrl)
    ) {
      result = await parseYoutube(resolvedUrl);
    } else {
      result = { success: false, error: { code: "UNKNOWN_PLATFORM", message: "无法识别该平台，目前支持 B站 / YouTube" } };
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
