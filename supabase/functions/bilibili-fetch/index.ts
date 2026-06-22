import { corsHeaders } from "../_shared/cors.ts";

// Simple HTTP proxy — forwards requests from environments that can't reach B站 directly.
// The cloud Edge Runtime can access B站 API; local cron/GitHub Actions runners may not.

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { url: string; headers?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.url) {
    return new Response(JSON.stringify({ error: "Missing url" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only allow B站 API requests
  if (!body.url.includes("bilibili.com")) {
    return new Response(JSON.stringify({ error: "Only bilibili.com URLs allowed" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const fetchHeaders: Record<string, string> = {
      "User-Agent": "ContentHub/1.0",
      ...body.headers,
    };

    const res = await fetch(body.url, {
      method: "GET",
      headers: fetchHeaders,
    });

    const text = await res.text();

    return new Response(text, {
      status: res.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

Deno.serve(handleRequest);
