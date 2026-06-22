import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

    // Write cookie to platform_configs via Supabase
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Use service_role to bypass RLS and directly UPSERT
      const { error } = await supabase
        .from("platform_configs")
        .upsert(
          {
            platform: "bilibili",
            config_key: "cookie",
            config_value: cookies,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "platform,config_key" },
        );

      if (error) throw error;

      // Also update the cookie_status to valid
      await supabase
        .from("platform_configs")
        .upsert(
          {
            platform: "bilibili",
            config_key: "cookie_status",
            config_value: "valid",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "platform,config_key" },
        );
    } catch {
      return json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "登录成功但 Cookie 保存失败，请重试",
        },
      }, 500);
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
    return json({ success: false, error: { code: "INVALID_URL", message: "仅支持 POST 请求" } }, 405);
  }

  let body: AuthRequest;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: { code: "INVALID_URL", message: "请求体格式无效" } }, 400);
  }

  if (body.action === "qrcode") {
    return handleQrcode();
  }

  if (body.action === "poll") {
    if (!body.qrcode_key) {
      return json({ success: false, error: { code: "INVALID_URL", message: "缺少 qrcode_key 参数" } }, 400);
    }
    return handlePoll(body.qrcode_key);
  }

  return json({ success: false, error: { code: "INVALID_URL", message: "无效的 action，仅支持 qrcode / poll" } }, 400);
}

Deno.serve(handleRequest);
