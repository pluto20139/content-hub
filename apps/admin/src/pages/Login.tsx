import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const user = data.user;
    const isAdmin = user?.app_metadata?.is_admin === true;

    if (!isAdmin) {
      await supabase.auth.signOut();
      setError("当前账号非超级管理员，无权访问平台管理控制台");
      setLoading(false);
      return;
    }

    window.location.hash = "#/dashboard";
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#F2F2F7" }}>
      <div
        className="w-full max-w-sm p-8 rounded-3xl shadow-xl"
        style={{
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "0.5px solid rgba(0, 0, 0, 0.08)",
        }}
      >
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-black text-white rounded-2xl flex items-center justify-center mx-auto mb-3 font-bold text-2xl shadow-lg">
            M
          </div>
          <h1 className="text-xl font-bold text-gray-900">多平台内容中枢</h1>
          <p className="text-xs text-gray-500 mt-1 font-medium">平台管理控制台</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">管理员邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black focus:bg-white transition-all"
              placeholder="admin@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black focus:bg-white transition-all"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-black text-white text-sm font-semibold rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-all shadow-md mt-2"
          >
            {loading ? "验证中..." : "管理员登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
