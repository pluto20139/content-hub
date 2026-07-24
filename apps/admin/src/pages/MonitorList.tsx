import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { PLATFORMS } from "@content-hub/shared";

interface Monitor {
  id: number;
  user_id: string;
  user_email?: string;
  platform: string;
  native_id: string;
  display_name: string;
  original_url: string;
  is_active: boolean;
  last_sync_at: string | null;
  last_content_at: string | null;
  fail_count: number;
  status: "normal" | "cookie_expired" | "rate_limited";
  created_at: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

if (!SUPABASE_URL) {
  throw new Error("Missing VITE_SUPABASE_URL");
}

const STATUS_FILTERS = [
  { key: "all", label: "全部状态" },
  { key: "normal", label: "正常运行" },
  { key: "rate_limited", label: "触发限流" },
  { key: "cookie_expired", label: "Cookie失效" },
];

function formatSyncTime(ts: string | null): string {
  if (!ts) return "从未同步";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function MonitorList() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const fetchMonitors = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (platformFilter !== "all") params.set("platform", platformFilter);
      if (userFilter !== "all") params.set("user_id", userFilter);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-api/monitors?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `获取博主失败 (${res.status})`);
      }

      const data = await res.json();
      setMonitors(data);
    } catch (err: any) {
      console.error("Fetch monitors error:", err);
      setError(err.message || "加载博主列表失败");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, platformFilter, userFilter]);

  useEffect(() => {
    fetchMonitors();
  }, [fetchMonitors]);

  const handleToggleActive = async (m: Monitor) => {
    const nextState = !m.is_active;
    setMonitors((prev) =>
      prev.map((item) => (item.id === m.id ? { ...item, is_active: nextState } : item))
    );

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch(`${SUPABASE_URL}/functions/v1/admin-api/monitors/${m.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ is_active: nextState }),
      });
    } catch {
      fetchMonitors();
    }
  };

  const handleSaveName = async (id: number) => {
    if (!editingName.trim()) return;
    setMonitors((prev) =>
      prev.map((item) => (item.id === id ? { ...item, display_name: editingName.trim() } : item))
    );
    setEditingId(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch(`${SUPABASE_URL}/functions/v1/admin-api/monitors/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ display_name: editingName.trim(), name_auto: false }),
      });
    } catch {
      fetchMonitors();
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定要删除博主 [${name}] 吗？此操作将不可撤销。`)) return;

    setMonitors((prev) => prev.filter((item) => item.id !== id));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch(`${SUPABASE_URL}/functions/v1/admin-api/monitors/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    } catch {
      fetchMonitors();
    }
  };

  // Extract unique users
  const uniqueUsers = Array.from(
    new Set(monitors.map((m) => JSON.stringify({ id: m.user_id, email: m.user_email })))
  ).map((str) => JSON.parse(str));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">博主监控中枢</h1>
          <p className="text-xs text-gray-500 mt-1">跨租户全网博主监控列表、状态检测与全局控盘</p>
        </div>
      </div>

      {/* 筛选区 */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap gap-3 items-center text-xs">
        <div>
          <label className="text-gray-500 mr-2">状态筛选：</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-gray-500 mr-2">平台筛选：</label>
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl"
          >
            <option value="all">全平台</option>
            {Object.entries(PLATFORMS).map(([k, p]) => (
              <option key={k} value={k}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-gray-500 mr-2">所属用户：</label>
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl"
          >
            <option value="all">全量用户</option>
            {uniqueUsers.map((u: any) => (
              <option key={u.id} value={u.id}>{u.email}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-600 text-xs rounded-xl">{error}</div>}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-xs">全网博主数据加载中...</div>
        ) : monitors.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-xs">暂无匹配的博主记录</div>
        ) : (
          <table className="w-full text-left text-xs text-gray-600">
            <thead className="bg-gray-50/80 border-b border-gray-100 text-gray-500 font-medium">
              <tr>
                <th className="py-3.5 px-4">平台</th>
                <th className="py-3.5 px-4">博主显示名称</th>
                <th className="py-3.5 px-4">归属用户</th>
                <th className="py-3.5 px-4">运行状态</th>
                <th className="py-3.5 px-4">失败次数</th>
                <th className="py-3.5 px-4">最后同步时间</th>
                <th className="py-3.5 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {monitors.map((m) => {
                const platMeta = PLATFORMS[m.platform];
                const isEditing = editingId === m.id;

                return (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition">
                    <td className="py-3.5 px-4">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-bold"
                        style={{ backgroundColor: platMeta?.tagBg || "#F1F1F1", color: platMeta?.tagText || "#1C1C1E" }}
                      >
                        {platMeta?.name || m.platform}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {isEditing ? (
                        <div className="flex items-center space-x-1">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="px-2 py-1 border rounded text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveName(m.id)}
                            className="text-blue-600 font-bold text-[11px]"
                          >
                            保存
                          </button>
                        </div>
                      ) : (
                        <div>
                          <span
                            onClick={() => {
                              setEditingId(m.id);
                              setEditingName(m.display_name);
                            }}
                            className="font-semibold text-gray-900 cursor-pointer hover:text-blue-600"
                            title="点击修改名称"
                          >
                            {m.display_name}
                          </span>
                          <p className="text-[10px] text-gray-400">ID: {m.native_id}</p>
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-gray-700">{m.user_email}</td>
                    <td className="py-3.5 px-4">
                      {m.status === "normal" ? (
                        <span className="inline-flex items-center text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px] font-medium">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1"></span> 正常
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full text-[10px] font-medium animate-pulse">
                          <span className="w-1.5 h-1.5 bg-rose-500 rounded-full mr-1"></span> 限流/异常
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold">{m.fail_count} 次</td>
                    <td className="py-3.5 px-4 text-gray-400">{formatSyncTime(m.last_sync_at)}</td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(m)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition ${
                          m.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {m.is_active ? "已开启" : "已停用"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id, m.display_name)}
                        className="px-2.5 py-1 text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
