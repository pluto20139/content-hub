import { useState, useEffect } from "react";
import { TABS } from "./constants/tabs";
import Feed from "./pages/Feed";
import H5Auth from "./components/H5Auth";
import LoginModal from "./components/LoginModal";
import MyMonitors from "./pages/MyMonitors";
import { supabase } from "./lib/supabase";

function getInitialUserId(): string | null {
  const urlParams = new URLSearchParams(window.location.search);
  let u = urlParams.get("u");

  if (!u && window.location.hash.includes("?")) {
    const hashQuery = window.location.hash.split("?")[1];
    const hashParams = new URLSearchParams(hashQuery);
    u = hashParams.get("u");
  }

  return u || null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("all");
  const [targetUserId, setTargetUserId] = useState<string | null>(getInitialUserId);
  const [checkingAuth, setCheckingAuth] = useState(() => !getInitialUserId());
  const [viewMode, setViewMode] = useState<"feed" | "monitors">("feed");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [feedKey, setFeedKey] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setSessionUserId(data.session.user.id);
        if (!targetUserId) {
          setTargetUserId(data.session.user.id);
        }
      }
      setCheckingAuth(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setSessionUserId(session.user.id);
        if (!targetUserId) {
          setTargetUserId(session.user.id);
        }
      } else {
        setSessionUserId(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [targetUserId]);

  const isOwnSession = Boolean(sessionUserId && targetUserId === sessionUserId);
  const currentTab = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  const handleSettingsClick = () => {
    if (isOwnSession) {
      setViewMode("monitors");
    } else {
      setShowLoginModal(true);
    }
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400" style={{ background: "#F2F2F7" }}>
        <div className="text-sm">加载中...</div>
      </div>
    );
  }

  // If no u param and not logged in, show H5 Auth page
  if (!targetUserId) {
    return (
      <H5Auth
        onSuccess={(userId) => {
          setTargetUserId(userId);
          setSessionUserId(userId);
          window.history.replaceState(null, "", `?u=${userId}`);
        }}
      />
    );
  }

  // Render MyMonitors full-screen secondary page
  if (viewMode === "monitors") {
    return (
      <MyMonitors
        onBack={() => {
          setViewMode("feed");
          setFeedKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#F2F2F7" }}>
      <div
        className="sticky top-0 z-10"
        style={{
          background: "rgba(242,242,247,0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "0.5px solid rgba(0,0,0,0.06)",
        }}
      >
        <div className="px-3 py-2 flex items-center justify-between gap-2">
          <div className="flex gap-1 overflow-x-auto no-scrollbar flex-1" style={{ background: "#E5E5EA", borderRadius: "9px", padding: "2px" }}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex-1 py-1.5 text-center whitespace-nowrap transition-all duration-200"
                style={{
                  borderRadius: "7px",
                  fontSize: "13px",
                  fontWeight: activeTab === tab.key ? 500 : 400,
                  color: activeTab === tab.key ? "#1C1C1E" : "#8E8E93",
                  background: activeTab === tab.key ? "#FFF" : "transparent",
                  boxShadow: activeTab === tab.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  minWidth: "44px",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 顶栏右侧 ⚙️ 设置/订阅管理按钮 */}
          <button
            type="button"
            onClick={handleSettingsClick}
            className="w-8 h-8 rounded-full bg-[#E5E5EA] flex items-center justify-center text-sm hover:bg-gray-300 transition flex-shrink-0"
            title={isOwnSession ? "管理我的订阅" : "登录管理订阅"}
          >
            ⚙️
          </button>
        </div>
      </div>

      <Feed key={feedKey} platform={currentTab.platform} userId={targetUserId} />

      {/* 匿名模式下点击 ⚙️ 唤起的登录 Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={(userId) => {
          setSessionUserId(userId);
          setTargetUserId(userId);
          window.history.replaceState(null, "", `?u=${userId}`);
          setViewMode("monitors");
        }}
      />
    </div>
  );
}
