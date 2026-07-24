import { useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (userId: string) => void;
}

export default function LoginModal({ isOpen, onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
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
        setError("密码长度至少 6 位");
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

      if (data.user && data.session) {
        onSuccess(data.user.id);
        onClose();
        setLoading(false);
        return;
      }

      const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
      if (loginErr) {
        setError("注册成功，请使用新密码登录");
        setMode("login");
      } else if (loginData.user) {
        onSuccess(loginData.user.id);
        onClose();
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
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md transition-all">
      <div
        className="w-full max-w-sm p-6 rounded-3xl shadow-2xl relative animate-in fade-in zoom-in duration-200"
        style={{
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "0.5px solid rgba(0, 0, 0, 0.1)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-gray-900 flex items-center justify-center font-semibold text-sm transition"
        >
          ✕
        </button>

        <div className="text-center mb-5">
          <div className="w-10 h-10 bg-black text-white rounded-2xl flex items-center justify-center mx-auto mb-2 font-bold text-lg shadow-md">
            M
          </div>
          <h2 className="text-lg font-bold text-gray-900">登录账号管理订阅</h2>
          <p className="text-xs text-gray-500 mt-1">
            登录后可解析添加博主、管理个人订阅与专属 H5 链接
          </p>
        </div>

        <div className="flex mb-4 bg-gray-200/60 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
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
          <div className="mb-3.5 p-2.5 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
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
            className="w-full py-2.5 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 transition shadow-sm mt-2"
          >
            {loading ? "处理中..." : mode === "login" ? "确认登录" : "注册账号"}
          </button>
        </form>
      </div>
    </div>
  );
}
