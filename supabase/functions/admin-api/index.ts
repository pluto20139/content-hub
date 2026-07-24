import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Authenticate JWT and check is_admin
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return jsonResponse({ error: "Unauthorized: Missing token" }, 401);
  }

  const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !authData?.user) {
    return jsonResponse({ error: "Unauthorized: Invalid session" }, 401);
  }

  const user = authData.user;
  const isAdmin = user.app_metadata?.is_admin === true || user.email === "admin@mpchub.top";

  if (!isAdmin) {
    return jsonResponse({ error: "Forbidden: Super-Admin privileges required" }, 403);
  }

  const url = new URL(req.url);
  const pathname = url.pathname.replace(/\/+$/, "");
  const method = req.method;

  try {
    // 2. Route Dispatcher

    // GET /stats
    if (method === "GET" && pathname.endsWith("/stats")) {
      const [usersRes, monitorsRes, contentsRes, todayRes, rateLimitedRes] = await Promise.all([
        supabaseAdmin.auth.admin.listUsers(),
        supabaseAdmin.from("monitors").select("id, platform, is_active", { count: "exact" }),
        supabaseAdmin.from("contents").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("contents").select("id", { count: "exact", head: true })
          .gte("published_at", new Date(Date.now() - 86400000).toISOString()),
        supabaseAdmin.from("monitors").select("id", { count: "exact", head: true })
          .or("status.eq.rate_limited,fail_count.gte.5"),
      ]);

      const totalUsers = usersRes.data?.users?.length || 0;
      const totalMonitors = monitorsRes.count || 0;
      const totalContents = contentsRes.count || 0;
      const todayNewContent = todayRes.count || 0;
      const rateLimitedCount = rateLimitedRes.count || 0;

      // Platform distribution
      const platformDist: Record<string, number> = {
        bilibili: 0, youtube: 0, zhihu: 0, douyin: 0, xiaohongshu: 0, x: 0
      };
      (monitorsRes.data || []).forEach((m: any) => {
        if (platformDist[m.platform] !== undefined) {
          platformDist[m.platform]++;
        }
      });

      return jsonResponse({
        totalUsers,
        totalMonitors,
        totalContents,
        todayNewContent,
        rateLimitedCount,
        platformDist,
      });
    }

    // GET /users
    if (method === "GET" && pathname.endsWith("/users")) {
      const { data: usersData, error } = await supabaseAdmin.auth.admin.listUsers();
      if (error) throw error;

      const { data: monitorsData } = await supabaseAdmin.from("monitors").select("user_id");
      const monitorCounts: Record<string, number> = {};
      (monitorsData || []).forEach((m: any) => {
        if (m.user_id) {
          monitorCounts[m.user_id] = (monitorCounts[m.user_id] || 0) + 1;
        }
      });

      const usersList = (usersData.users || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        is_admin: u.app_metadata?.is_admin === true,
        monitor_count: monitorCounts[u.id] || 0,
        share_url: `https://mpchub.top?u=${u.id}`,
      }));

      return jsonResponse(usersList);
    }

    // POST /users/create
    if (method === "POST" && pathname.endsWith("/users/create")) {
      const body = await req.json();
      const { email, password } = body;
      if (!email || !password) {
        return jsonResponse({ error: "Missing email or password" }, 400);
      }

      const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (error) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({
        success: true,
        user: {
          id: newUser.user.id,
          email: newUser.user.email,
          created_at: newUser.user.created_at,
          share_url: `https://mpchub.top?u=${newUser.user.id}`,
        },
      });
    }

    // GET /monitors
    if (method === "GET" && pathname.endsWith("/monitors")) {
      const status = url.searchParams.get("status");
      const platform = url.searchParams.get("platform");
      const userId = url.searchParams.get("user_id");

      let query = supabaseAdmin.from("monitors").select("*").order("created_at", { ascending: false });
      if (status && status !== "all") query = query.eq("status", status);
      if (platform && platform !== "all") query = query.eq("platform", platform);
      if (userId && userId !== "all") query = query.eq("user_id", userId);

      const { data, error } = await query;
      if (error) throw error;

      // Fetch user emails map
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      const userEmailMap: Record<string, string> = {};
      (usersData?.users || []).forEach((u: any) => {
        userEmailMap[u.id] = u.email;
      });

      const enrichedMonitors = (data || []).map((m: any) => ({
        ...m,
        user_email: userEmailMap[m.user_id] || "未知用户",
      }));

      return jsonResponse(enrichedMonitors);
    }

    // PATCH /monitors/:id
    if (method === "PATCH" && pathname.includes("/monitors/")) {
      const parts = pathname.split("/");
      const monitorId = parts[parts.length - 1];
      const body = await req.json();

      const { data, error } = await supabaseAdmin
        .from("monitors")
        .update(body)
        .eq("id", monitorId)
        .select()
        .single();

      if (error) throw error;
      return jsonResponse({ success: true, data });
    }

    // DELETE /monitors/:id
    if (method === "DELETE" && pathname.includes("/monitors/")) {
      const parts = pathname.split("/");
      const monitorId = parts[parts.length - 1];

      const { error } = await supabaseAdmin.from("monitors").delete().eq("id", monitorId);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    // GET /contents
    if (method === "GET" && pathname.endsWith("/contents")) {
      const platform = url.searchParams.get("platform");
      const contentType = url.searchParams.get("content_type");
      const summaryStatus = url.searchParams.get("summary_status");
      const queryStr = url.searchParams.get("query");
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const pageSize = parseInt(url.searchParams.get("page_size") || "20", 10);

      let query = supabaseAdmin
        .from("contents")
        .select("id, user_id, platform, native_id, content_type, title, cover_url, original_url, published_at, is_display, summary, summary_status, monitors(display_name)", { count: "exact" })
        .order("published_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (platform && platform !== "all") query = query.eq("platform", platform);
      if (contentType && contentType !== "all") query = query.eq("content_type", contentType);
      if (summaryStatus && summaryStatus !== "all") query = query.eq("summary_status", summaryStatus);
      if (queryStr) query = query.ilike("title", `%${queryStr}%`);

      const { data, count, error } = await query;
      if (error) throw error;

      return jsonResponse({ data: data || [], total: count || 0, page, pageSize });
    }

    // PATCH /contents/:id
    if (method === "PATCH" && pathname.includes("/contents/")) {
      const parts = pathname.split("/");
      const contentId = parts[parts.length - 1];
      const body = await req.json();

      const { data, error } = await supabaseAdmin
        .from("contents")
        .update(body)
        .eq("id", contentId)
        .select()
        .single();

      if (error) throw error;
      return jsonResponse({ success: true, data });
    }

    // POST /contents/:id/retry-summary
    if (method === "POST" && pathname.includes("/retry-summary")) {
      const parts = pathname.split("/");
      const contentId = parts[parts.length - 2];

      const { data, error } = await supabaseAdmin
        .from("contents")
        .update({ summary_status: "pending", summary: null })
        .eq("id", contentId)
        .select()
        .single();

      if (error) throw error;
      return jsonResponse({ success: true, data });
    }

    // GET /settings/platform-configs
    if (method === "GET" && pathname.endsWith("/platform-configs")) {
      const { data, error } = await supabaseAdmin.from("platform_configs_admin").select("*");
      if (error) throw error;
      return jsonResponse(data || []);
    }

    // POST /settings/cron-trigger
    if (method === "POST" && pathname.endsWith("/cron-trigger")) {
      const { error } = await supabaseAdmin
        .from("cron_locks")
        .upsert({ id: 1, locked_at: null, locked_by: null });

      if (error) throw error;
      return jsonResponse({ success: true, message: "Cron lock reset successfully" });
    }

    return jsonResponse({ error: "Endpoint not found" }, 404);
  } catch (err: unknown) {
    console.error("[admin-api] Error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
