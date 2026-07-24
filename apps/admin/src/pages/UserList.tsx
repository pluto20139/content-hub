import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

interface UserItem {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_admin: boolean;
  monitor_count: number;
  share_url: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

if (!SUPABASE_URL) {
  throw new Error("Missing VITE_SUPABASE_URL");
}

export default function UserList() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      setError(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-api/users`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `获取用户列表失败 (${res.status})`);
      }

      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      console.error("Fetch users error:", err);
      setError(err.message || "加载用户列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("未登录或 Session 失效");

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-api/users/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email: emailInput.trim(), password: passwordInput.trim() }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `开通失败 (${res.status})`);
      }

      setEmailInput("");
      setPasswordInput("");
      setShowModal(false);
      await fetchUsers();
    } catch (err: any) {
      setCreateError(err.message || "开通账号失败");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyLink = async (userId: string, shareUrl: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedId(userId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Copy link failed:", err);
      setError("复制链接失败，请手动复制");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">用户管理与账号开通</h1>
          <p className="text-xs text-gray-500 mt-1">管理系统全量账号，为新用户开通授权并生成专属 H5 链接</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-black text-white text-xs font-semibold rounded-xl hover:bg-gray-800 transition shadow-sm"
        >
          + 开通新账号
        </button>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-600 text-xs rounded-xl">{error}</div>}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-xs">加载全量用户数据中...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-xs">暂无用户账号</div>
        ) : (
          <table className="w-full text-left text-xs text-gray-600">
            <thead className="bg-gray-50/80 border-b border-gray-100 text-gray-500 font-medium">
              <tr>
                <th className="py-3.5 px-4">用户邮箱</th>
                <th className="py-3.5 px-4">身份</th>
                <th className="py-3.5 px-4">订阅博主数</th>
                <th className="py-3.5 px-4">注册时间</th>
                <th className="py-3.5 px-4 text-right">专属 H5 链接</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50/50 transition">
                  <td className="py-3.5 px-4 font-semibold text-gray-900">{u.email}</td>
                  <td className="py-3.5 px-4">
                    {u.is_admin ? (
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 font-bold text-[10px] rounded-full">
                        超级管理员
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 font-medium text-[10px] rounded-full">
                        普通用户
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-gray-900">{u.monitor_count} 个</td>
                  <td className="py-3.5 px-4 text-gray-400">
                    {new Date(u.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleCopyLink(u.id, u.share_url)}
                      className="px-3 py-1 bg-gray-100 text-gray-700 hover:bg-gray-200 text-[11px] font-medium rounded-lg transition"
                    >
                      {copiedId === u.id ? "已复制链接 ✓" : "复制专属链接"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 开通新账号 Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm p-6 bg-white rounded-2xl shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-sm text-gray-900">开通新用户账号</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-700 text-sm"
              >
                ✕
              </button>
            </div>

            {createError && (
              <p className="text-xs text-red-500 bg-red-50 p-2.5 rounded-xl">{createError}</p>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">用户邮箱</label>
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 bg-gray-50 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-black"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">初始密码</label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-gray-50 border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-black"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full py-2.5 bg-black text-white rounded-xl text-xs font-semibold hover:bg-gray-800 disabled:opacity-50 transition"
              >
                {creating ? "建号中..." : "确认开通"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
