import { corsHeaders } from "../_shared/cors.ts";

function stripHtml(html: string): string {
  if (!html) return "";
  // Replace paragraph/line breaks with newlines to preserve readability
  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n");
  // Strip all other HTML tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return text.trim();
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { platform, native_id, content_type } = body;
  if (!platform || !native_id) {
    return new Response(JSON.stringify({ error: "Missing required fields: platform, native_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[ArticleFetcher] Fetching detail content for ${platform} ${content_type} (ID: ${native_id})`);

  if (platform === "zhihu") {
    const rsshubUrl = Deno.env.get("RSSHUB_URL");
    const rsshubApiKey = Deno.env.get("RSSHUB_API_KEY");

    if (!rsshubUrl) {
      console.error("[ArticleFetcher] RSSHUB_URL is not configured in environment variables");
      return new Response(JSON.stringify({ error: "RSSHUB_URL is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanId = native_id.replace("people:", "").replace("column:", "");
    const isColumn = content_type === "article" || native_id.startsWith("column:");
    const path = isColumn
      ? `/zhihu/zhuanlan/${cleanId}`
      : `/zhihu/people/activities/${cleanId}`;

    let url = `${rsshubUrl}${path}?format=json`;
    if (rsshubApiKey) {
      url += `&access_key=${rsshubApiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ContentHub/1.0" },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`RSSHub request failed with status ${res.status}`);
      }

      const data = await res.json();
      const items = data.items || [];
      let targetItem = null;

      // Try to find the matching item
      for (const item of items) {
        const itemUrl = item.url || "";
        const itemId = String(item.id || "");
        if (itemId.includes(cleanId) || itemUrl.includes(cleanId)) {
          targetItem = item;
          break;
        }
      }

      // Fallback to first item if none matched specifically
      if (!targetItem && items.length > 0) {
        targetItem = items[0];
      }

      const contentHtml = targetItem ? (targetItem.content_html || targetItem.description || "") : "";
      const cleanedText = stripHtml(contentHtml);

      return new Response(JSON.stringify({ content_text: cleanedText }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error(`[ArticleFetcher] Failed to fetch Zhihu content:`, err.message);
      return new Response(JSON.stringify({ error: `Zhihu fetch failed: ${err.message}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (platform === "bilibili") {
    // Only support article (read cv columns)
    if (content_type !== "article") {
      return new Response(JSON.stringify({ content_text: "" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const url = `https://api.bilibili.com/x/article/view?id=${native_id}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": `https://www.bilibili.com/read/cv${native_id}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Bilibili API returned status ${res.status}`);
      }

      const data = await res.json();
      if (data.code !== 0 || !data.data) {
        throw new Error(`B站 API returned error ${data.code}: ${data.message}`);
      }

      const contentHtml = data.data.content || "";
      const cleanedText = stripHtml(contentHtml);

      return new Response(JSON.stringify({ content_text: cleanedText }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error(`[ArticleFetcher] Failed to fetch Bilibili content:`, err.message);
      return new Response(JSON.stringify({ error: `Bilibili fetch failed: ${err.message}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Douyin, Xiaohongshu, or other platforms fallback to empty text (triggering Dify based-on-title workflow fallback)
  return new Response(JSON.stringify({ content_text: "" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
