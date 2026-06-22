import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { PLATFORMS, getDaysSinceActivity } from "@content-hub/shared";

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
}

const STATUS_FILTERS = [
  { key: "all", label: "全部" },
  { key: "normal", label: "正常" },
  { key: "cookie_expired+rate_limited", label: "异常" },
  { key: "inactive", label: "已关闭" },
];

const STATUS_ICON: Record<string, string> = {
  normal: "🟢",
  cookie_expired: "🟡",
  rate_limited: "🔴",
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

function freshnessWarning(lastContentAt: string): { text: string; red: boolean } | null {
  const days = getDaysSinceActivity(new Date(lastContentAt));
  if (days <= 30) return null;
  const red = days > 90;
  return { text: `该博主已超过 ${days} 天未更新`, red };
}

export default function MonitorList() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [urlInput, setUrlInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [pollStatus, setPollStatus] = useState("");
  const [cookieUpdated, setCookieUpdated] = useState<string | null>(null);
  const [cookieStatus, setCookieStatus] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchMonitors = useCallback(async () => {
    const { data } = await supabase
      .from("monitors")
      .select("*")
      .order("created_at", { ascending: false });

    setMonitors((data ?? []) as Monitor[]);
    setLoading(false);
  }, []);

  const fetchCookieInfo = useCallback(async () => {
    const { data } = await supabase
      .from("platform_configs")
      .select("config_key,config_value,updated_at")
      .eq("platform", "bilibili");

    const cookie = (data ?? []).find((r: any) => r.config_key === "cookie");
    const status = (data ?? []).find((r: any) => r.config_key === "cookie_status");

    if (cookie) {
      setCookieUpdated(cookie.updated_at);
    }
    if (status) {
      setCookieStatus(status.config_value);
    }
  }, []);

  useEffect(() => {
    fetchMonitors();
    fetchCookieInfo();
  }, [fetchMonitors, fetchCookieInfo]);

  // Filter monitors
  const filtered = monitors.filter((m) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "inactive") return !m.is_active;
    if (statusFilter === "cookie_expired+rate_limited")
      return m.status === "cookie_expired" || m.status === "rate_limited";
    return m.status === statusFilter;
  });

  // CRUD operations
  const addMonitor = async (): Promise<void> => {
    if (!urlInput.trim()) return;
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
        setAddError(json.error?.message ?? "无法识别该平台");
        setAdding(false);
        return;
      }

      const { platform, native_id, display_name } = json.data;

      // POST to monitors
      const { error: postErr } = await supabase.from("monitors").insert({
        platform,
        native_id,
        display_name,
        original_url: urlInput.trim(),
        is_active: true,
        name_auto: true,
        status: "normal",
        fail_count: 0,
        last_content_at: new Date().toISOString(),
      });

      if (postErr) {
        if (postErr.code === "23505") {
          setAddError("该博主已添加");
        } else {
          setAddError(postErr.message);
        }
        setAdding(false);
        return;
      }

      setUrlInput("");
      setAdding(false);
      fetchMonitors();
    } catch (err: any) {
      setAddError(err.message);
      setAdding(false);
    }
  };

  const toggleActive = async (id: number, current: boolean): Promise<void> => {
    await supabase.from("monitors").update({ is_active: !current }).eq("id", id);
    fetchMonitors();
  };

  const resetMonitor = async (id: number): Promise<void> => {
    await supabase.from("monitors").update({ status: "normal", fail_count: 0 }).eq("id", id);
    fetchMonitors();
  };

  const deleteMonitor = async (id: number): Promise<void> => {
    await supabase.from("monitors").delete().eq("id", id);
    setDeletingId(null);
    fetchMonitors();
  };

  const renameMonitor = async (id: number, newName: string): Promise<void> => {
    if (!newName.trim()) return;
    await supabase
      .from("monitors")
      .update({ display_name: newName.trim(), name_auto: false })
      .eq("id", id);
    fetchMonitors();
  };

  // B站 QR code flow
  const startBilibiliAuth = async (): Promise<void> => {
    setShowQr(true);
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

      setQrUrl(json.data.qr_url);
      setPollStatus("请使用B站 App 扫码");

      // Start polling
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
              setQrUrl("");
              fetchCookieInfo();
            }, 1500);
          } else if (pollJson.data?.status === "expired") {
            clearInterval(pollInterval);
            setPollStatus("二维码已过期，请重新获取");
          }
        } catch {
          // retry on next poll
        }
      }, 2000);
    } catch {
      setPollStatus("请求失败");
    }
  };

  // Cookie display helpers
  const cookieAge = cookieUpdated
    ? Math.floor((Date.now() - new Date(cookieUpdated).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  if (loading) return <div className="p-6 text-gray-400">加载中...</div>;

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-4">监控管理</h1>

      {/* Add monitor */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 border">
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="粘贴 B站/YouTube/知乎 博主主页链接..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => e.key === "Enter" && addMonitor()}
          />
          <button
            onClick={addMonitor}
            disabled={adding || !urlInput.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md text-sm font-medium hover:bg-blue-600 disabled:opacity-50 shrink-0"
          >
            {adding ? "添加中..." : "添加"}
          </button>
        </div>
        {addError && <div className="mt-2 text-red-500 text-xs">{addError}</div>}
      </div>

      {/* B站 Cookie 状态 */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 border">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium">B站 Cookie 状态: </span>
            {cookieStatus === "expired" ? (
              <span className="text-red-500 text-sm font-medium">Cookie 已失效，请重新扫码</span>
            ) : cookieUpdated ? (
              <span className="text-gray-600 text-sm">
                最后更新: {formatSyncTime(cookieUpdated)}
                {cookieAge !== null && cookieAge > 25 && (
                  <span className="text-yellow-500 ml-2">Cookie 即将过期，建议重新扫码</span>
                )}
              </span>
            ) : (
              <span className="text-gray-400 text-sm">未配置</span>
            )}
          </div>
          <button
            onClick={startBilibiliAuth}
            className="px-3 py-1.5 bg-pink-500 text-white rounded text-sm hover:bg-pink-600"
          >
            扫码登录
          </button>
        </div>

        {/* QR modal */}
        {showQr && (
          <div className="mt-4 text-center">
            {qrUrl && (
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`} alt="B站二维码" className="mx-auto mb-2 w-48 h-48" />
            )}
            <p className="text-sm text-gray-500">{pollStatus}</p>
            <button
              onClick={() => setShowQr(false)}
              className="mt-2 px-3 py-1 text-sm text-gray-500 hover:text-gray-700"
            >
              关闭
            </button>
          </div>
        )}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              statusFilter === f.key
                ? "bg-blue-500 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Monitor list */}
      <div className="space-y-2">
        {filtered.map((m) => {
          const freshness = freshnessWarning(m.last_content_at);
          return (
            <div
              key={m.id}
              className="bg-white rounded-lg shadow-sm border p-4 flex items-center gap-3"
            >
              {/* Platform tag */}
              <span
                className="text-xs px-2 py-0.5 rounded text-white font-medium shrink-0"
                style={{ backgroundColor: PLATFORMS[m.platform]?.brandColor ?? "#999" }}
              >
                {PLATFORMS[m.platform]?.name ?? m.platform}
              </span>

              {/* Display name (inline edit) */}
              <EditableName
                name={m.display_name}
                onSave={(newName) => renameMonitor(m.id, newName)}
              />

              {/* Status icon */}
              <span className="shrink-0" title={m.status}>
                {STATUS_ICON[m.status] ?? "🟢"}
              </span>

              {/* Last sync */}
              <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">
                {formatSyncTime(m.last_sync_at)}
              </span>

              {/* Freshness warning */}
              {freshness && (
                <span
                  className={`text-xs shrink-0 ${freshness.red ? "text-red-500" : "text-gray-400"}`}
                >
                  {freshness.text}
                </span>
              )}

              {/* Actions */}
              <div className="flex gap-1 ml-auto shrink-0">
                <button
                  onClick={() => toggleActive(m.id, m.is_active)}
                  className={`text-xs px-2 py-1 rounded ${
                    m.is_active
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {m.is_active ? "开" : "关"}
                </button>
                <button
                  onClick={() => resetMonitor(m.id)}
                  className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                >
                  重置
                </button>
                {deletingId === m.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => deleteMonitor(m.id)}
                      className="text-xs px-2 py-1 rounded bg-red-500 text-white"
                    >
                      确认
                    </button>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="text-xs px-2 py-1 rounded bg-gray-200"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeletingId(m.id)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 text-red-500 hover:bg-gray-200"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center text-gray-400 py-8 text-sm">暂无监控</div>
      )}
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
        className="flex-1 min-w-0 px-1 py-0.5 border border-blue-300 rounded text-sm focus:outline-none"
        autoFocus
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="flex-1 min-w-0 text-sm font-medium cursor-pointer hover:text-blue-500 truncate"
      title="点击编辑"
    >
      {name}
    </span>
  );
}
