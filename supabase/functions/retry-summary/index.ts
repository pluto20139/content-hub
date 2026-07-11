import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface RetryRequest {
  content_id: number;
}

interface RetryResponse {
  success: boolean;
  data?: { content_id: number; previous_status: string };
  error?: { code: string; message: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }, 405);
  }

  let body: RetryRequest;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: { code: "INVALID_JSON", message: "Body must be JSON" } }, 400);
  }

  const contentId = body.content_id;
  if (!Number.isInteger(contentId) || contentId <= 0) {
    return json({ success: false, error: { code: "INVALID_ID", message: "content_id must be a positive integer" } }, 400);
  }

  // 1. Fetch current state with service_role (bypasses RLS)
  const fetchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/contents?id=eq.${contentId}&select=id,content_type,summary_status`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!fetchRes.ok) {
    return json({ success: false, error: { code: "DB_ERROR", message: `Fetch failed: ${fetchRes.status}` } }, 502);
  }

  const rows = await fetchRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ success: false, error: { code: "NOT_FOUND", message: "Content not found" } }, 404);
  }

  const row = rows[0];
  if (row.content_type !== "video") {
    return json({ success: false, error: { code: "NOT_VIDEO", message: "Only video content supports retry" } }, 400);
  }

  const currentStatus = row.summary_status ?? "none";
  if (currentStatus === "pending" || currentStatus === "processing") {
    return json(
      { success: false, error: { code: "ALREADY_QUEUED", message: `Already ${currentStatus}` } },
      409,
    );
  }
  if (currentStatus === "success") {
    return json(
      { success: false, error: { code: "ALREADY_DONE", message: "Already summarized; use trigger_summaries.ts --all to force re-run" } },
      409,
    );
  }

  // 2. Update to 'pending' with service_role
  const updateRes = await fetch(
    `${SUPABASE_URL}/rest/v1/contents?id=eq.${contentId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ summary_status: "pending" }),
    },
  );

  if (!updateRes.ok) {
    return json({ success: false, error: { code: "UPDATE_FAILED", message: `Update failed: ${updateRes.status}` } }, 502);
  }

  return json({ success: true, data: { content_id: contentId, previous_status: currentStatus } });
});

function json(body: RetryResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
