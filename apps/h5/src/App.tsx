import { useState } from "react";
import { TABS } from "./constants/tabs";
import Feed from "./pages/Feed";

export default function App() {
  const [activeTab, setActiveTab] = useState("all");

  const currentTab = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  return (
    <div className="min-h-screen" style={{ background: "#F2F2F7" }}>
      <div className="sticky top-0 z-10" style={{ background: "rgba(242,242,247,0.85)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "0.5px solid rgba(0,0,0,0.06)" }}>
        <div className="px-3 py-2">
          <div className="flex gap-1 overflow-x-auto no-scrollbar" style={{ background: "#E5E5EA", borderRadius: "9px", padding: "2px" }}>
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
        </div>
      </div>
      <Feed platform={currentTab.platform} />
    </div>
  );
}
