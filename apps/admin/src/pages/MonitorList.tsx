import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { PLATFORMS, getDaysSinceActivity } from "@content-hub/shared";
import QRCode from "qrcode";

import type { User } from "@supabase/supabase-js";

interface Monitor {
  id: number;
  platform: string;
  native_id: string;
  display_name: string;
  name_auto: boolean;
  original_url: string;
  is_active: boolean;
  last_sync_at: string | null;
  last_content_at: string;
  fail_count: number;
  status: "normal" | "cookie_expired" | "rate_limited";
  created_at: string;
  native_type?: string | null;
}

const STATUS_FILTERS = [
  { key: "all", label: "全部" },
  { key: "normal", label: "正常" },
  { key: "rate_limited", label: "异常" },
  { key: "inactive", label: "已关闭" },
];

const STATUS_BADGES: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  normal: { label: "正常运行", bg: "bg-emerald-500/10", text: "text-emerald-700", dot: "bg-emerald-500" },
  cookie_expired: { label: "Cookie已失效", bg: "bg-amber-500/10", text: "text-amber-700", dot: "bg-amber-500" },
  rate_limited: { label: "触发限流", bg: "bg-rose-500/10", text: "text-rose-700", dot: "bg-rose-500" },
};

function formatSyncTime(ts: string | null): string {
  if (!ts) return "从未同步";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function freshnessWarning(lastContentAt: string | null): { text: string; red: boolean } | null {
  if (!lastContentAt) return null;
  const days = getDaysSinceActivity(new Date(lastContentAt));
  if (days <= 30) return null;
  const red = days > 90;
  return { text: `⚪ ${days} 天未更新${red ? " (建议移除)" : ""}`, red };
}

export default function MonitorList() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [urlInput, setUrlInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [pollStatus, setPollStatus] = useState("");
  const [cookieUpdated, setCookieUpdated] = useState<string | null>(null);
  const [cookieStatus, setCookieStatus] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [nowTimestamp] = useState(() => Date.now());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUser(data.user);
      }
    });
  }, []);

  const fetchMonitors = useCallback(async () => {
    setError(null);
    const { data, error } = await supabase
      .from("monitors")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch monitors:", error.message);
      setError("加载监控列表失败，请刷新重试");
      setLoading(false);
      return;
    }

    setMonitors((data ?? []) as Monitor[]);
    setLoading(false);
  }, []);

  const fetchCookieInfo = useCallback(async () => {
    const { data, error } = await supabase
      .from("platform_configs_admin")
      .select("config_key,config_value,updated_at")
      .eq("platform", "bilibili");

    if (error) {
      console.error("Failed to fetch platform configs:", error.message);
      setError("加载配置信息失败，请刷新重试");
      return;
    }

    const cookie = (data ?? []).find((r: { config_key: string; updated_at?: string }) => r.config_key === "cookie_meta");
    const status = (data ?? []).find((r: { config_key: string; config_value?: string }) => r.config_key === "cookie_status");

    if (cookie) {
      setCookieUpdated(cookie.updated_at ?? null);
    }
    if (status) {
      setCookieStatus(status.config_value ?? null);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      if (ignore) return;
      await fetchMonitors();
      await fetchCookieInfo();
    }
    loadData();
    return () => {
      ignore = true;
    };
  }, [fetchMonitors, fetchCookieInfo]);

  // Filter monitors
  const filtered = monitors.filter((m) => {
    if (statusFilter === "normal" && m.status !== "normal") return false;
    if (statusFilter === "rate_limited" && m.status === "normal") return false;
    if (statusFilter === "inactive" && m.is_active) return false;
    if (platformFilter !== "all" && m.platform !== platformFilter) return false;
    return true;
  });

  const addMonitor = async (): Promise<void> => {
    if (!urlInput.trim() || adding) return;
    setAdding(true);
    setAddError("");

    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token ?? "";

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-url`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ url: urlInput.trim() }),
        },
      );

      const json = await res.json();
      if (!json.success) {
        setAddError(json.error?.message ?? "域名解析失败");
        setAdding(false);
        return;
      }

      const { platform, native_id, display_name, original_url, native_type } = json.data;

      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        setAddError("未登录或登录已失效");
        setAdding(false);
        return;
      }

      const { error: postErr } = await supabase.from("monitors").insert({
        user_id: user.id,
        platform,
        native_id,
        display_name,
        original_url,
        native_type,
      });

      if (postErr) {
        if (postErr.code === "23505") {
          setAddError("该博主已在您的监控列表中");
        } else {
          setAddError(postErr.message);
        }
        setAdding(false);
        return;
      }

      setUrlInput("");
      setAdding(false);
      fetchMonitors();
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : String(err));
      setAdding(false);
    }
  };

  const toggleActive = async (id: number, current: boolean): Promise<void> => {
    const { error } = await supabase.from("monitors").update({ is_active: !current }).eq("id", id);
    if (error) {
      alert("操作失败：" + error.message);
      return;
    }
    fetchMonitors();
  };

  const resetMonitor = async (id: number): Promise<void> => {
    const { error } = await supabase.from("monitors").update({ status: "normal", fail_count: 0 }).eq("id", id);
    if (error) {
      alert("重置失败：" + error.message);
      return;
    }
    fetchMonitors();
  };

  const deleteMonitor = async (id: number): Promise<void> => {
    const { error } = await supabase.from("monitors").delete().eq("id", id);
    if (error) {
      alert("删除失败：" + error.message);
      return;
    }
    setDeletingId(null);
    fetchMonitors();
  };

  const renameMonitor = async (id: number, newName: string): Promise<void> => {
    const { error } = await supabase
      .from("monitors")
      .update({ display_name: newName, name_auto: false })
      .eq("id", id);
    if (error) {
      alert("修改失败：" + error.message);
      return;
    }
    fetchMonitors();
  };

  const startBilibiliAuth = async (): Promise<void> => {
    setShowQr(true);
    setQrDataUrl("");
    setPollStatus("获取二维码中...");

    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token ?? "";

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bilibili-auth`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ action: "qrcode" }),
        },
      );

      const json = await res.json();
      if (!json.success) {
        setPollStatus("获取二维码失败: " + (json.error?.message ?? ""));
        return;
      }

      setPollStatus("请使用B站 App 扫码");

      QRCode.toDataURL(json.data.qr_url, { width: 200, margin: 2 })
        .then(setQrDataUrl)
        .catch(() => {});

      const qrcodeKey = json.data.qrcode_key;
      let attempts = 0;

      const pollInterval = setInterval(async () => {
        attempts++;
        if (attempts > 90) {
          clearInterval(pollInterval);
          setPollStatus("二维码已过期，请重新获取");
          return;
        }

        try {
          const pollRes = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bilibili-auth`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({ action: "poll", qrcode_key: qrcodeKey }),
            },
          );

          const pollJson = await pollRes.json();
          if (pollJson.data?.status === "success") {
            clearInterval(pollInterval);
            setPollStatus("登录成功！");
            setTimeout(() => {
              setShowQr(false);
              setQrDataUrl("");
              fetchCookieInfo();
            }, 1500);
          } else if (pollJson.data?.status === "expired") {
            clearInterval(pollInterval);
            setPollStatus("二维码已过期，请重新获取");
          }
        } catch (_err) {
          void _err;
        }
      }, 2000);
    } catch {
      setPollStatus("请求失败");
    }
  };

  const cookieAge = cookieUpdated
    ? Math.floor((nowTimestamp - new Date(cookieUpdated).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F2F2F7" }}>
        <div className="text-sm text-gray-400 animate-pulse">加载监控配置...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#F2F2F7" }}>
        <div className="bg-white/90 backdrop-blur-xl p-6 rounded-2xl shadow-xl max-w-sm text-center border border-black/5">
          <p className="text-sm text-rose-600 font-medium mb-4">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              fetchMonitors();
              fetchCookieInfo();
            }}
            className="px-5 py-2 bg-black text-white rounded-xl text-xs font-semibold hover:bg-gray-800 transition"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const copyH5Link = () => {
    if (!currentUser) return;
    const origin = window.location.origin.includes("admin.") 
      ? window.location.origin.replace("admin.", "")
      : window.location.origin;
    const shareUrl = `${origin}/?u=${currentUser.id}`;
    navigator.clipboard.writeText(shareUrl);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="min-h-screen" style={{ background: "#F2F2F7" }}>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Header Bar */}
        <div
          className="p-4 rounded-2xl shadow-sm flex flex-wrap items-center justify-between gap-3"
          style={{
            background: "rgba(255, 255, 255, 0.85)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "0.5px solid rgba(0, 0, 0, 0.08)",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center font-bold text-base shadow-sm">
              M
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">监控配置中心</h1>
              {currentUser && (
                <p className="text-xs text-gray-500 mt-0.5">
                  账号: <span className="font-medium text-gray-800">{currentUser.email}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentUser && (
              <button
                onClick={copyH5Link}
                className="px-3.5 py-2 bg-black text-white rounded-xl text-xs font-medium hover:bg-gray-800 transition-all shadow-sm flex items-center gap-1.5 active:scale-95"
              >
                {copySuccess ? "✓ 已复制专属 H5 链接" : "🔗 复制我的 H5 链接"}
              </button>
            )}
            <button
              onClick={() => supabase.auth.signOut()}
              className="px-3.5 py-2 bg-gray-200/80 text-gray-600 rounded-xl text-xs font-medium hover:bg-gray-300 transition-all active:scale-95"
            >
              退出
            </button>
          </div>
        </div>

        {/* Add Monitor Input Card */}
        <div
          className="p-4 rounded-2xl shadow-sm"
          style={{
            background: "rgba(255, 255, 255, 0.85)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "0.5px solid rgba(0, 0, 0, 0.08)",
          }}
        >
          <div className="text-xs font-semibold text-gray-500 mb-2">添加订阅博主</div>
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="粘贴主页链接：B站 / YouTube / 知乎 / 抖音 / 小红书 / X (推特 x.com/xxx 或 @username)"
              className="flex-1 px-3.5 py-2.5 bg-gray-100/80 border border-black/10 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/20 focus:bg-white transition-all"
              onKeyDown={(e) => e.key === "Enter" && addMonitor()}
            />
            <button
              onClick={addMonitor}
              disabled={adding || !urlInput.trim()}
              className="px-5 py-2.5 bg-black text-white rounded-xl text-sm font-medium hover:bg-gray-800 disabled:opacity-50 shrink-0 transition-all shadow-sm active:scale-95"
            >
              {adding ? "解析中..." : "添加"}
            </button>
          </div>
          {addError && <div className="mt-2 text-rose-500 text-xs font-medium">{addError}</div>}
        </div>

        {/* Bilibili Cookie Status Banner */}
        <div
          className="p-4 rounded-2xl shadow-sm flex flex-wrap items-center justify-between gap-3"
          style={{
            background: "rgba(255, 255, 255, 0.85)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "0.5px solid rgba(0, 0, 0, 0.08)",
          }}
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-gray-700">B站 Cookie 状态:</span>
            {cookieStatus === "expired" ? (
              <span className="text-rose-600 font-medium px-2 py-0.5 bg-rose-500/10 rounded-full">已失效，请重新扫码</span>
            ) : cookieUpdated ? (
              <span className="text-gray-600">
                更新时间: {formatSyncTime(cookieUpdated)}
                {cookieAge !== null && cookieAge > 25 && (
                  <span className="text-amber-600 font-medium ml-2 px-2 py-0.5 bg-amber-500/10 rounded-full">即将在 {30 - cookieAge} 天内过期</span>
                )}
              </span>
            ) : (
              <span className="text-gray-400">未配置</span>
            )}
          </div>
          <button
            onClick={startBilibiliAuth}
            className="px-3.5 py-1.5 bg-[#FB7299] text-white rounded-xl text-xs font-semibold hover:opacity-90 transition-all shadow-sm active:scale-95"
          >
            B站扫码授权
          </button>

          {/* QR Modal */}
          {showQr && (
            <div className="w-full pt-3 mt-2 border-t border-black/5 text-center">
              {qrDataUrl && (
                <img src={qrDataUrl} alt="B站二维码" className="mx-auto mb-2 w-44 h-44 rounded-xl shadow-md border" />
              )}
              <p className="text-xs text-gray-500 font-medium">{pollStatus}</p>
              <button
                onClick={() => setShowQr(false)}
                className="mt-2 px-3 py-1 text-xs text-gray-400 hover:text-gray-600"
              >
                关闭
              </button>
            </div>
          )}
        </div>

        {/* Filter Segmented Control Bar */}
        <div className="space-y-2">
          {/* Status Filter */}
          <div className="flex gap-1 overflow-x-auto no-scrollbar" style={{ background: "#E5E5EA", borderRadius: "12px", padding: "3px" }}>
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className="flex-1 py-1.5 px-3 text-center whitespace-nowrap transition-all duration-200"
                style={{
                  borderRadius: "9px",
                  fontSize: "12px",
                  fontWeight: statusFilter === f.key ? 500 : 400,
                  color: statusFilter === f.key ? "#1C1C1E" : "#8E8E93",
                  background: statusFilter === f.key ? "#FFF" : "transparent",
                  boxShadow: statusFilter === f.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Platform Filter */}
          <div className="flex gap-1 overflow-x-auto no-scrollbar" style={{ background: "#E5E5EA", borderRadius: "12px", padding: "3px" }}>
            {["all", "bilibili", "youtube", "zhihu", "douyin", "xiaohongshu", "x"].map((p) => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className="flex-1 py-1.5 px-3 text-center whitespace-nowrap transition-all duration-200"
                style={{
                  borderRadius: "9px",
                  fontSize: "12px",
                  fontWeight: platformFilter === p ? 500 : 400,
                  color: platformFilter === p ? "#1C1C1E" : "#8E8E93",
                  background: platformFilter === p ? "#FFF" : "transparent",
                  boxShadow: platformFilter === p ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  minWidth: "44px",
                }}
              >
                {p === "all" ? "全部平台" : (PLATFORMS[p]?.name ?? p)}
              </button>
            ))}
          </div>
        </div>

        {/* Monitor Cards List */}
        <div className="space-y-2.5">
          {filtered.map((m) => {
            const freshness = freshnessWarning(m.last_content_at);
            const statusInfo = STATUS_BADGES[m.status] ?? STATUS_BADGES.normal;

            return (
              <div
                key={m.id}
                className="bg-white/90 backdrop-blur-md rounded-2xl p-4 border border-black/5 shadow-sm hover:shadow-md transition-all duration-200 flex flex-wrap items-center gap-3"
              >
                {/* Platform Pill Badge */}
                <span
                  className="text-xs px-2.5 py-1 rounded-full text-white font-medium shrink-0 shadow-xs"
                  style={{ backgroundColor: PLATFORMS[m.platform]?.brandColor ?? "#999" }}
                >
                  {PLATFORMS[m.platform]?.name ?? m.platform}
                </span>

                {m.platform === "zhihu" && m.native_type && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium shrink-0">
                    {m.native_type === "people" ? "个人主页" : "专栏"}
                  </span>
                )}

                {/* Display Name Edit Component */}
                <EditableName
                  name={m.display_name}
                  onSave={(newName) => renameMonitor(m.id, newName)}
                />

                {/* Status Dot Badge */}
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 flex items-center gap-1.5 ${statusInfo.bg} ${statusInfo.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot}`} />
                  {statusInfo.label}
                </span>

                {/* Last sync time */}
                <span className="text-xs text-gray-400 shrink-0 hidden md:inline">
                  {formatSyncTime(m.last_sync_at)}
                </span>

                {/* Freshness Warning */}
                {freshness && (
                  <span className={`text-xs shrink-0 ${freshness.red ? "text-rose-500 font-medium" : "text-gray-400"}`}>
                    {freshness.text}
                  </span>
                )}

                {/* Actions Group */}
                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  <button
                    onClick={() => toggleActive(m.id, m.is_active)}
                    className={`text-xs px-3 py-1 rounded-xl font-medium transition-all ${
                      m.is_active
                        ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25"
                        : "bg-gray-200/80 text-gray-500 hover:bg-gray-300/80"
                    }`}
                  >
                    {m.is_active ? "监控中" : "已暂停"}
                  </button>
                  <button
                    onClick={() => resetMonitor(m.id)}
                    className="text-xs px-2.5 py-1 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all font-medium"
                  >
                    重置
                  </button>
                  <button
                    onClick={() => setDeletingId(m.id)}
                    className="text-xs px-2.5 py-1 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all font-medium"
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-12 text-sm bg-white/50 backdrop-blur-sm rounded-2xl border border-black/5">
            暂无监控博主
          </div>
        )}

        {/* Modal Delete Confirmation */}
        {deletingId !== null && (
          <div className="fixed inset-0 backdrop-blur-md bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white/95 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-black/10">
              <h3 className="text-base font-bold text-gray-900 mb-2">确认删除该监控？</h3>
              <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                删除后该博主的定时任务将被清除。关联抓取的历史内容仍保留在数据库中，但不再自动刷新。
              </p>
              <div className="flex justify-end gap-2.5">
                <button
                  onClick={() => setDeletingId(null)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    const id = deletingId;
                    setDeletingId(null);
                    await deleteMonitor(id);
                  }}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition shadow-sm"
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline-editable display name component
function EditableName({
  name,
  onSave,
}: {
  name: string;
  onSave: (newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  const handleSave = (): void => {
    if (value.trim() && value !== name) {
      onSave(value);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") setEditing(false);
        }}
        className="flex-1 min-w-0 px-2 py-1 bg-white border border-black/20 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-black/20"
        autoFocus
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="flex-1 min-w-0 text-sm font-semibold text-gray-900 cursor-pointer hover:text-blue-600 truncate transition-colors"
      title="点击改名"
    >
      {name} ✏️
    </span>
  );
}
