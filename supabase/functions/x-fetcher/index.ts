import { corsHeaders } from "../_shared/cors.ts";

interface RawContent {
  platform: "x";
  native_id: string;
  content_type: "post";
  title: string;
  cover_url: string | null;
  original_url: string;
  published_at: string;
}

const RSS_ENDPOINTS = [
  (handle: string) => `https://nitter.unixfox.eu/${handle}/rss`,
  (handle: string) => `https://nitter.cz/${handle}/rss`,
  (handle: string) => `https://nitter.it/${handle}/rss`,
  (handle: string) => `https://nitter.moomoo.me/${handle}/rss`,
  (handle: string) => `https://nitter.privacydev.net/${handle}/rss`,
  (handle: string) => `https://nitter.poast.org/${handle}/rss`,
  (handle: string) => `https://rsshub.app/twitter/user/${handle}`,
];

function parseRssFeed(xmlText: string, handle: string): RawContent[] {
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

    const cleanTitle = rawTitle
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (!cleanTitle && !desc) continue;

    let nativeId = "";
    const statusMatch = rawLink.match(/status\/(\d+)/);
    if (statusMatch) {
      nativeId = statusMatch[1];
    } else {
      nativeId = cleanTitle.slice(0, 32);
    }

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let handle = "";
  if (req.method === "POST") {
    try {
      const body = await req.json();
      handle = body.handle || body.native_id || "";
    } catch {
      // ignore
    }
  }

  if (!handle) {
    const url = new URL(req.url);
    handle = url.searchParams.get("handle") || "";
  }

  handle = handle.replace(/^@/, "").trim();

  if (!handle) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing handle parameter" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[x-fetcher] Fetching tweets for handle @${handle}`);

  for (const getUrl of RSS_ENDPOINTS) {
    const targetUrl = getUrl(handle);
    try {
      console.log(`[x-fetcher] Trying endpoint: ${targetUrl}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/xml, text/xml, */*",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const xmlText = await res.text();
        const items = parseRssFeed(xmlText, handle);
        if (items.length > 0) {
          console.log(`[x-fetcher] Successfully fetched ${items.length} items for @${handle} via ${targetUrl}`);
          return new Response(
            JSON.stringify({ success: true, data: items }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } catch (err: unknown) {
      console.warn(`[x-fetcher] Endpoint ${targetUrl} failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  return new Response(
    JSON.stringify({ success: false, error: "All X/Twitter RSS endpoints failed or returned empty" }),
    { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
