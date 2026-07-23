import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
// Use runtime-provided service_role key (auto-injected by Supabase cloud / config.toml for local)
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const BILIBILI_QRCODE_URL =
  "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const BILIBILI_POLL_URL =
  "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";

interface AuthRequest {
  action: "qrcode" | "poll";
  qrcode_key?: string;
}

// ── Helpers ───────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function postgrestUpsert(
  table: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, error: `PostgREST error ${res.status}: ${await res.text()}` };
  }
  return { ok: true };
}

async function vaultUpsertCookie(cookieValue: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_bilibili_cookie`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ new_secret: cookieValue }),
  });
  return res.ok;
}

// ── QR code generation ────────────────────────────────

async function handleQrcode(): Promise<Response> {
  const res = await fetch(BILIBILI_QRCODE_URL, {
    headers: { "User-Agent": "ContentHub/1.0" },
  });

  if (!res.ok) {
    return json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "B站二维码接口调用失败" },
    }, 500);
  }

  const data = await res.json();
  if (data.code !== 0 || !data.data?.url || !data.data?.qrcode_key) {
    return json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "B站二维码接口返回异常" },
    }, 500);
  }

  return json({
    success: true,
    data: { qr_url: data.data.url, qrcode_key: data.data.qrcode_key },
  });
}

// ── Poll ──────────────────────────────────────────────

async function handlePoll(qrcodeKey: string, userId?: string): Promise<Response> {
  const res = await fetch(`${BILIBILI_POLL_URL}?qrcode_key=${encodeURIComponent(qrcodeKey)}`, {
    headers: { "User-Agent": "ContentHub/1.0" },
  });

  if (!res.ok) {
    return json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "B站轮询接口调用失败" },
    }, 500);
  }

  const data = await res.json();
  if (data.code !== 0 || !data.data) {
    return json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "B站轮询接口返回异常" },
    }, 500);
  }

  const pollCode = data.data.code;

  if (pollCode === 86101) {
    return json({ success: true, data: { status: "not_scanned" } });
  }

  if (pollCode === 86090) {
    return json({ success: true, data: { status: "scanned_not_confirmed" } });
  }

  if (pollCode === 86038) {
    return json({ success: true, data: { status: "expired" } });
  }

  if (pollCode === 0) {
    const cookieHeader = res.headers.get("set-cookie") ?? "";
    const urlStr = data.data.url ?? "";
    const combined = [cookieHeader, urlStr].filter(Boolean).join("; ");

    const now = new Date().toISOString();
    const vaultOk = await vaultUpsertCookie(combined);
    if (!vaultOk) {
      return json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "登录成功但 Cookie 保存失败，请重试",
        },
      }, 500);
    }

    const { ok: statusOk } = await postgrestUpsert("platform_configs", {
      user_id: userId,
      platform: "bilibili",
      config_key: "cookie_status",
      config_value: "valid",
      updated_at: now,
    });
    const { ok: metaOk } = await postgrestUpsert("platform_configs", {
      user_id: userId,
      platform: "bilibili",
      config_key: "cookie_meta",
      config_value: now,
      updated_at: now,
    });
    if (!statusOk || !metaOk) {
      console.warn("Failed to update cookie_status/meta, but cookie was saved successfully");
    }

    return json({ success: true, data: { status: "success" } });
  }

  return json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: `扫码异常(Code: ${data.code})，请重试`,
    },
  });
}

// ── Main handler ──────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return json({ success: false, error: { code: "INTERNAL_ERROR", message: "仅支持 POST 请求" } }, 405);
    }

    let body: AuthRequest;
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: { code: "INTERNAL_ERROR", message: "请求体格式无效" } }, 400);
    }

    if (body.action === "qrcode") {
      return handleQrcode();
    }

    if (body.action === "poll") {
      if (!body.qrcode_key) {
        return json({ success: false, error: { code: "INTERNAL_ERROR", message: "缺少 qrcode_key 参数" } }, 400);
      }
      const userId = getUserIdFromAuthHeader(req);
      return handlePoll(body.qrcode_key, userId);
    }

    return json({ success: false, error: { code: "INTERNAL_ERROR", message: "无效的 action，仅支持 qrcode / poll" } }, 400);
  } catch (err) {
    return json({
      success: false,
      error: {
        code: "UNCAUGHT_EXCEPTION",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      }
    }, 500);
  }
}

Deno.serve(handleRequest);
