import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    
    // We want to forward requests to googleapis.com/youtube/v3/...
    // Example: /functions/v1/youtube-proxy/channels?part=... -> https://www.googleapis.com/youtube/v3/channels?part=...
    const cleanPath = url.pathname.replace(/^\/youtube-proxy/, "");
    
    const targetUrl = new URL(`https://www.googleapis.com/youtube/v3${cleanPath}`);
    targetUrl.search = url.search;

    console.log(`[Proxy] Forwarding to: ${targetUrl.toString()}`);

    const headers = new Headers();
    // Copy essential headers
    for (const [key, value] of req.headers.entries()) {
      if (key.toLowerCase() !== "host") {
        headers.set(key, value);
      }
    }

    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body: req.body,
    });

    const responseHeaders = new Headers(response.headers);
    // Add CORS headers
    for (const [key, value] of Object.entries(corsHeaders)) {
      responseHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error(`[Proxy] Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
