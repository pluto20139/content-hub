import { useState } from "react";
import { TABS } from "./constants/tabs";
import Feed from "./pages/Feed";

export default function App() {
  const [activeTab, setActiveTab] = useState("all");

  const currentTab = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Platform tabs */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="flex px-2 py-2 gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? "bg-blue-500 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <Feed platform={currentTab.platform} />
    </div>
  );
}
