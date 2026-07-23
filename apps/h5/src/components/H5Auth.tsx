import { useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  onSuccess: (userId: string) => void;
}

export default function H5Auth({ onSuccess }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    setLoading(true);

    if (mode === "register") {
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致");
        setLoading(false);
        return;
      }
      if (password.length < 6) {
        setError("密码长度至少 6 位");
        setLoading(false);
        return;
      }

      const { data, error: err } = await supabase.auth.signUp({ email, password });
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      if (data.user) {
        if (data.session) {
          onSuccess(data.user.id);
        } else {
          setSuccessMsg("注册成功！如果配置了邮件确认，请验证后登录。");
          setMode("login");
        }
      }
      setLoading(false);
      return;
    }

    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      onSuccess(data.user.id);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#F2F2F7" }}>
      <div
        className="w-full max-w-sm p-6 rounded-2xl shadow-xl"
        style={{
          background: "rgba(255, 255, 255, 0.9)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "0.5px solid rgba(0, 0, 0, 0.08)",
        }}
      >
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-black text-white rounded-2xl flex items-center justify-center mx-auto mb-3 font-bold text-xl shadow-md">
            M
          </div>
          <h2 className="text-xl font-bold text-gray-900">多平台内容中枢</h2>
          <p className="text-xs text-gray-500 mt-1">
            请打开包含专属链接的 URL 或登录查看您的订阅 Feed
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex mb-5 bg-gray-200/60 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
              setSuccessMsg("");
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mode === "login"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            登录账号
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError("");
              setSuccessMsg("");
            }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mode === "register"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            免费注册
          </button>
        </div>

        {error && (
          <div className="mb-4 p-2.5 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-2.5 bg-green-50 text-green-700 text-xs rounded-xl border border-green-100">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">邮箱地址</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black transition"
              placeholder="name@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black transition"
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
                className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black transition"
                placeholder="••••••••"
                required
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 transition shadow-sm mt-2"
          >
            {loading ? "处理中..." : mode === "login" ? "登录查看 Feed" : "注册账号"}
          </button>
        </form>
      </div>
    </div>
  );
}
