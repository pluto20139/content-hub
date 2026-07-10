import { corsHeaders } from "../_shared/cors.ts";

const ALLOWED_DOMAINS = [
  "bilibili.com",
  "hdslb.com",             // Bilibili CDN
  "youtube.com",
  "ytimg.com",             // YouTube CDN
  "googleusercontent.com",
  "zhihu.com",
  "zhimg.com",             // Zhihu CDN
  "xiaohongshu.com",
  "xhscdn.com",            // Xiaohongshu CDN
  "douyin.com",
  "pstatp.com",            // Douyin/ByteDance CDN
  "amemv.com",
  "douyincdn.com",
];

function isUrlAllowed(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(domain => hostname === domain || hostname.endsWith("." + domain));
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const urlObj = new URL(req.url);
  const targetUrl = urlObj.searchParams.get("url");

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "Missing url parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!isUrlAllowed(targetUrl)) {
    return new Response(JSON.stringify({ error: "Domain not allowed (SSRF protection)" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: {
        // Strip Referer header to bypass CDN hotlinking block
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
      },
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch image: status ${res.status}` }),
        {
          status: res.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const contentType = res.headers.get("Content-Type") || "image/jpeg";
    
    // Safety check on content type
    if (!contentType.startsWith("image/") && !contentType.startsWith("application/octet-stream")) {
      return new Response(
        JSON.stringify({ error: "Only image files are allowed" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "public, max-age=86400"); // Cache for 24 hours (86400 seconds)

    // Apply CORS headers
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }

    return new Response(res.body, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error("Image proxy error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
