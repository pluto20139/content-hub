import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  currentHash: string;
}

const NAV_ITEMS = [
  { key: "#/dashboard", label: "概览仪表盘", icon: "📊" },
  { key: "#/users", label: "用户管理", icon: "👥" },
  { key: "#/monitors", label: "博主监控", icon: "📡" },
  { key: "#/contents", label: "数据仓库", icon: "📰" },
  { key: "#/settings", label: "系统设置", icon: "⚙️" },
];

export default function Sidebar({ currentHash }: Props) {
  const [adminEmail, setAdminEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        setAdminEmail(data.user.email);
      }
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.hash = "#/login";
  };

  const activeKey = NAV_ITEMS.some((item) => item.key === currentHash)
    ? currentHash
    : "#/dashboard";

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col min-h-screen flex-shrink-0 border-r border-gray-800 shadow-xl">
      {/* Header */}
      <div className="p-5 border-b border-gray-800 flex items-center space-x-3">
        <div className="w-9 h-9 bg-white text-black font-bold rounded-xl flex items-center justify-center text-lg shadow">
          M
        </div>
        <div>
          <h2 className="font-bold text-sm text-gray-100">多平台中枢</h2>
          <p className="text-[10px] text-gray-400 font-mono mt-0.5">超级管理控制台</p>
        </div>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 p-3 space-y-1.5">
        {NAV_ITEMS.map((item) => {
          const isActive = activeKey === item.key;
          return (
            <a
              key={item.key}
              href={item.key}
              className={`flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                isActive
                  ? "bg-white/10 text-white shadow-sm border border-white/10"
                  : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>

      {/* Footer / User info */}
      <div className="p-4 border-t border-gray-800 bg-gray-950/50">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1 mr-2">
            <p className="text-[11px] font-medium text-gray-300 truncate" title={adminEmail}>
              {adminEmail || "超级管理员"}
            </p>
            <p className="text-[9px] text-emerald-400 flex items-center mt-0.5">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full mr-1 animate-pulse"></span>
              Super Admin
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="p-1.5 text-xs text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
            title="退出登录"
          >
            🚪
          </button>
        </div>
      </div>
    </aside>
  );
}
