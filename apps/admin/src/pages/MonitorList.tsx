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

function freshnessWarning(lastContentAt: string | null): { text: string; red: boolean } | null {
  if (!lastContentAt) return null;
  const days = getDaysSinceActivity(new Date(lastContentAt));
  if (days <= 30) return null;
  const red = days > 90;
  return { text: `⚪ 该博主已超过 ${days} 天未更新${red ? "，建议关闭监控或移除" : ""}`, red };
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
    if (platformFilter !== "all" && m.platform !== platformFilter) return false;
    if (statusFilter === "all") return true;
    if (statusFilter === "inactive") return !m.is_active;
    if (statusFilter === "rate_limited") return m.status !== "normal";
    return m.status === statusFilter;
  });

  // CRUD operations
  const addMonitor = async (): Promise<void> => {
    setAddError("");
    if (!urlInput.trim()) return;

    setAdding(true);
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

      const { platform, native_id, display_name, native_type } = json.data;

      if (platform === "zhihu" && !native_type) {
        setAddError("知乎链接解析类型不能为空（必须是用户主页或专栏）");
        setAdding(false);
        return;
      }

      const { data: userData } = await supabase.auth.getUser();

      // POST to monitors with user_id
      const { error: postErr } = await supabase.from("monitors").insert({
        user_id: userData.user?.id,
        platform,
        native_id,
        display_name,
        original_url: urlInput.trim(),
        is_active: true,
        name_auto: true,
        status: "normal",
        fail_count: 0,
        last_content_at: new Date().toISOString(),
        native_type,
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

  if (loading) return <div className="p-6 text-gray-400">加载中...</div>;

  if (error) {
    return (
      <div className="p-6 text-red-500 flex flex-col items-center gap-4">
        <span>{error}</span>
        <button
          onClick={() => {
            setLoading(true);
            setError(null);
            fetchMonitors();
            fetchCookieInfo();
          }}
          className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
        >
          重试
        </button>
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
    <div className="p-4 max-w-4xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between bg-white rounded-lg shadow-sm p-4 mb-4 border gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">监控管理</h1>
          {currentUser && (
            <p className="text-xs text-gray-500 mt-0.5">
              当前账号: <span className="font-medium text-gray-700">{currentUser.email}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {currentUser && (
            <button
              onClick={copyH5Link}
              className="px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded text-xs font-semibold hover:bg-blue-100 transition flex items-center gap-1"
            >
              {copySuccess ? "✓ 已复制专属 H5 链接" : "🔗 复制我的 H5 链接"}
            </button>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded text-xs font-semibold hover:bg-gray-200 transition"
          >
            退出登录
          </button>
        </div>
      </div>

      {/* Add monitor */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 border">
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="粘贴博主主页链接：B站(space.bilibili.com/xxx)、YouTube(@xxx)、知乎(people/xxx)、抖音(user/xxx)、小红书(user/xxx)、X/推特(x.com/xxx 或 @xxx)"
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
            {qrDataUrl && (
              <img src={qrDataUrl} alt="B站二维码" className="mx-auto mb-2 w-48 h-48" />
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
      <div className="flex gap-2 mb-2">
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

      {/* Platform filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {["all", "bilibili", "youtube", "zhihu", "douyin", "xiaohongshu", "x"].map((p) => (
          <button
            key={p}
            onClick={() => setPlatformFilter(p)}
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              platformFilter === p
                ? "bg-gray-700 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {p === "all" ? "全部平台" : (PLATFORMS[p]?.name ?? p)}
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

              {m.platform === "zhihu" && m.native_type && (
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium shrink-0">
                  {m.native_type === "people" ? "个人主页" : "专栏"}
                </span>
              )}

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
                <button
                  onClick={() => setDeletingId(m.id)}
                  className="text-xs px-2 py-1 rounded bg-gray-100 text-red-500 hover:bg-gray-200"
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center text-gray-400 py-8 text-sm">暂无监控</div>
      )}

      {/* Modal 弹窗二次确认 */}
      {deletingId !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-medium text-gray-900 mb-2">确认删除监控？</h3>
            <p className="text-sm text-gray-500 mb-6">
              删除后将无法恢复，关联的抓取内容仍会保留在数据库中，但不再更新。
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm font-medium"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  const id = deletingId;
                  setDeletingId(null);
                  await deleteMonitor(id);
                }}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-medium"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
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
