import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { PLATFORMS } from "@content-hub/shared";
import type { User } from "@supabase/supabase-js";

interface Monitor {
  id: number;
  platform: string;
  native_id: string;
  display_name: string;
  is_active: boolean;
  last_sync_at: string | null;
  last_content_at: string | null;
  fail_count: number;
  status: "normal" | "cookie_expired" | "rate_limited";
  created_at: string;
}

interface Props {
  onBack: () => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SITE_URL = import.meta.env.VITE_SITE_URL || window.location.origin;

if (!SUPABASE_URL) {
  throw new Error("Missing VITE_SUPABASE_URL");
}

export default function MyMonitors({ onBack }: Props) {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCurrentUser(data.user);
      }
    });
  }, []);

  const fetchMonitors = useCallback(async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("monitors")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch monitors:", error.message);
      setError("加载订阅列表失败");
    } else {
      setMonitors((data || []) as Monitor[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMonitors();
  }, [fetchMonitors]);

  const handleAddMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setAdding(true);
    setAddError("");

    try {
      const parseRes = await fetch(`${SUPABASE_URL}/functions/v1/parse-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });

      if (!parseRes.ok) {
        const errJson = await parseRes.json().catch(() => ({}));
        throw new Error(errJson.error || `解析接口错误 (${parseRes.status})`);
      }

      const parseResult = await parseRes.json();
      const { platform, native_id, display_name, native_type, original_url } = parseResult;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("用户身份异常，请重新登录");

      const insertPayload: any = {
        user_id: user.id,
        platform,
        native_id,
        display_name: display_name || native_id,
        name_auto: true,
        original_url: original_url || urlInput.trim(),
        is_active: true,
      };

      if (native_type) insertPayload.native_type = native_type;

      const { error: insertErr } = await supabase.from("monitors").insert([insertPayload]);

      if (insertErr) {
        if (insertErr.code === "23505") {
          throw new Error("您已添加过此博主，无需重复添加");
        }
        throw new Error(insertErr.message);
      }

      setUrlInput("");
      fetchMonitors();
    } catch (err: any) {
      setAddError(err.message || "解析添加失败");
    } finally {
      setAdding(false);
    }
  };

  const handleToggleActive = async (monitor: Monitor) => {
    const nextState = !monitor.is_active;
    setMonitors((prev) =>
      prev.map((m) => (m.id === monitor.id ? { ...m, is_active: nextState } : m))
    );

    const { error } = await supabase
      .from("monitors")
      .update({ is_active: nextState })
      .eq("id", monitor.id);

    if (error) {
      console.error("Toggle active error:", error.message);
      fetchMonitors();
    }
  };

  const handleSaveName = async (id: number) => {
    if (!editingName.trim()) return;
    setMonitors((prev) =>
      prev.map((m) => (m.id === id ? { ...m, display_name: editingName.trim() } : m))
    );
    setEditingId(null);

    const { error } = await supabase
      .from("monitors")
      .update({ display_name: editingName.trim(), name_auto: false })
      .eq("id", id);

    if (error) {
      console.error("Save name error:", error.message);
      fetchMonitors();
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定要取消关注博主 [${name}] 吗？`)) return;

    setMonitors((prev) => prev.filter((m) => m.id !== id));
    const { error } = await supabase.from("monitors").delete().eq("id", id);
    if (error) {
      console.error("Delete error:", error.message);
      fetchMonitors();
    }
  };

  const handleCopyShareUrl = () => {
    if (!currentUser) return;
    const url = `${SITE_URL.replace(/\/$/, "")}?u=${currentUser.id}`;
    navigator.clipboard.writeText(url);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7] pb-12">
      {/* 顶部 iOS 毛玻璃 Sticky 导航栏 */}
      <header
        className="sticky top-0 z-30 px-4 py-3 flex items-center justify-between shadow-sm"
        style={{
          background: "rgba(255, 255, 255, 0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "0.5px solid rgba(0, 0, 0, 0.08)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center text-sm font-medium text-black hover:opacity-70 transition py-1 px-2.5 rounded-full bg-gray-100/80"
        >
          <span className="mr-1 text-base">←</span> 返回信息流
        </button>
        <h1 className="text-base font-bold text-gray-900">我的订阅管理</h1>
        <div className="w-16"></div>
      </header>

      <main className="max-w-md mx-auto px-4 mt-4 space-y-4">
        {/* 1. 添加订阅卡片 */}
        <section className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 mb-2.5 flex items-center">
            <span className="text-lg mr-1.5">➕</span> 添加博主订阅
          </h2>
          <form onSubmit={handleAddMonitor} className="space-y-2.5">
            <div>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="粘贴 B站/YouTube/知乎/抖音/小红书/推特 链接"
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-black transition"
              />
            </div>
            {addError && (
              <p className="text-xs text-red-500 bg-red-50 p-2 rounded-lg">{addError}</p>
            )}
            <button
              type="submit"
              disabled={adding || !urlInput.trim()}
              className="w-full py-2.5 bg-black text-white text-xs font-semibold rounded-xl hover:bg-gray-800 disabled:opacity-50 transition shadow-sm"
            >
              {adding ? "解析添加中..." : "解析并添加"}
            </button>
          </form>
        </section>

        {/* 2. 我的订阅列表 */}
        <section className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900 flex items-center">
              <span className="text-lg mr-1.5">📡</span> 订阅列表 ({monitors.length})
            </h2>
            {loading && <span className="text-xs text-gray-400">更新中...</span>}
          </div>

          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

          {!loading && monitors.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-xs">
              <p className="mb-1 text-base">📭</p>
              暂无订阅博主，在上方粘贴链接即可开始追踪
            </div>
          ) : (
            <div className="space-y-2.5">
              {monitors.map((m) => {
                const platMeta = PLATFORMS[m.platform];
                const isEditing = editingId === m.id;

                return (
                  <div
                    key={m.id}
                    className="p-3 bg-gray-50/80 rounded-xl flex items-center justify-between border border-gray-100/80"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md flex-shrink-0" style={{ backgroundColor: platMeta?.tagBg || '#F1F1F1', color: platMeta?.tagText || '#1C1C1E' }}>
                        {platMeta?.name || m.platform}
                      </span>

                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="flex items-center space-x-1">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="px-2 py-1 text-xs border rounded bg-white w-full"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveName(m.id)}
                              className="text-xs text-blue-600 font-medium px-1.5 py-0.5"
                            >
                              保存
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1.5">
                            <span
                              onClick={() => {
                                setEditingId(m.id);
                                setEditingName(m.display_name);
                              }}
                              className="text-xs font-semibold text-gray-900 truncate hover:text-blue-600 cursor-pointer"
                              title="点击修改昵称"
                            >
                              {m.display_name}
                            </span>
                            <span className="text-[10px] text-gray-400 uppercase bg-gray-200/60 px-1.5 py-0.5 rounded">
                              {m.platform}
                            </span>
                          </div>
                        )}

                        <p className="text-[10px] text-gray-400 truncate mt-0.5">
                          ID: {m.native_id}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(m)}
                        className={`px-2.5 py-1 text-[11px] rounded-full font-medium transition ${
                          m.is_active
                            ? "bg-green-100 text-green-700 hover:bg-green-200"
                            : "bg-gray-200 text-gray-500 hover:bg-gray-300"
                        }`}
                      >
                        {m.is_active ? "已开启" : "已暂停"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(m.id, m.display_name)}
                        className="text-gray-400 hover:text-red-500 p-1 text-xs transition"
                        title="取消关注"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 3. 个人账号中心 */}
        {currentUser && (
          <section className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
            <h2 className="text-sm font-bold text-gray-900 flex items-center">
              <span className="text-lg mr-1.5">👤</span> 个人账号中心
            </h2>
            <div className="p-3 bg-gray-50 rounded-xl space-y-2 text-xs text-gray-600">
              <div className="flex items-center justify-between">
                <span>登录邮箱：</span>
                <span className="font-semibold text-gray-900">{currentUser.email}</span>
              </div>
              <div className="pt-2 border-t border-gray-200/60 flex items-center justify-between">
                <span>专属 H5 链接：</span>
                <button
                  type="button"
                  onClick={handleCopyShareUrl}
                  className="px-2.5 py-1 bg-black text-white text-[11px] font-medium rounded-lg hover:bg-gray-800 transition"
                >
                  {copySuccess ? "已复制链接 ✓" : "复制专属链接"}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full py-2 bg-red-50 text-red-600 text-xs font-semibold rounded-xl hover:bg-red-100 transition"
            >
              安全退出登录
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
