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

async function handlePoll(qrcodeKey: string): Promise<Response> {
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

  if (data.code === 86038) {
    return json({ success: true, data: { status: "expired" } });
  }

  if (data.code === 86039) {
    return json({ success: true, data: { status: "waiting" } });
  }

  if (data.code === 86101) {
    return json({ success: true, data: { status: "waiting" } });
  }

  if (data.code === 0) {
    // ── Scan successful, extract cookies from response headers ──
    const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
    const cookies = setCookieHeaders.map((h) => h.split(";")[0]).join("; ");

    if (!cookies) {
      return json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "登录成功但 Cookie 保存失败，请重试" },
      });
    }

    const now = new Date().toISOString();

    // Write cookie to vault
    const cookieOk = await vaultUpsertCookie(cookies);

    if (!cookieOk) {
      return json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "登录成功但 Cookie 保存失败，请重试",
        },
      }, 500);
    }

    // Update cookie_status to valid (non-critical, warn on failure)
    const { ok: statusOk } = await postgrestUpsert("platform_configs", {
      platform: "bilibili",
      config_key: "cookie_status",
      config_value: "valid",
      updated_at: now,
    });
    // Write cookie_meta (timestamp only, non-sensitive) for Admin display
    const { ok: metaOk } = await postgrestUpsert("platform_configs", {
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

  // Unknown code
  return json({
    success: false,
    error: {
      code: "BILIBILI_QRCODE_EXPIRED",
      message: "二维码已过期，请重新获取",
    },
  }, 400);
}

// ── Main handler ──────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
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
    return handlePoll(body.qrcode_key);
  }

  return json({ success: false, error: { code: "INTERNAL_ERROR", message: "无效的 action，仅支持 qrcode / poll" } }, 400);
}

Deno.serve(handleRequest);
