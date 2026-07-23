import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    if (mode === "register") {
      if (!email.trim()) {
        setError("请输入邮箱地址");
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致");
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError("密码长度至少为 6 位");
        setLoading(false);
        return;
      }

      const { data, error: err } = await supabase.auth.signUp({ email, password });
      if (err) {
        const msg = err.message.toLowerCase();
        if (msg.includes("already registered") || msg.includes("already exists")) {
          setError("该邮箱已被注册，请直接登录");
        } else {
          setError(err.message);
        }
        setLoading(false);
        return;
      }

      if (data.session) {
        window.location.hash = "#/monitors";
        setLoading(false);
        return;
      }

      // If Supabase requires explicit sign-in fallback
      const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
      if (loginErr) {
        setSuccess("注册成功，请切换至登录页输入密码登录。");
        setMode("login");
      } else if (loginData.session) {
        window.location.hash = "#/monitors";
      }
      setLoading(false);
      return;
    }

    // Login mode
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    window.location.hash = "#/monitors";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm border border-gray-100">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">多平台内容中枢</h1>
          <p className="text-xs text-gray-500 mt-1">V2.0 多租户管理端</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex mb-6 bg-gray-100 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
              setSuccess("");
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
              mode === "login"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            账号登录
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError("");
              setSuccess("");
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
              mode === "register"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            免费注册
          </button>
        </div>

        {error && (
          <div className="mb-4 p-2.5 bg-red-50 text-red-600 text-xs rounded-md border border-red-100">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-2.5 bg-green-50 text-green-700 text-xs rounded-md border border-green-100">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">邮箱地址</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              placeholder="your@email.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              placeholder="••••••••"
              required
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">确认密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                placeholder="••••••••"
                required
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 transition"
          >
            {loading ? "处理中..." : mode === "login" ? "登录" : "立即注册"}
          </button>
        </form>
      </div>
    </div>
  );
}
