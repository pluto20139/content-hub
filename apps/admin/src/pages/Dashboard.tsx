import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface StatsData {
  totalUsers: number;
  totalMonitors: number;
  totalContents: number;
  todayNewContent: number;
  rateLimitedCount: number;
  platformDist: Record<string, number>;
}

const SUPABASE_URL = "https://betbudnsetunpmdhjipo.supabase.co";

const PLATFORM_LABELS: Record<string, { name: string; color: string }> = {
  bilibili: { name: "B站", color: "bg-[#FB7299]" },
  youtube: { name: "YouTube", color: "bg-[#FF0000]" },
  zhihu: { name: "知乎", color: "bg-[#0066FF]" },
  douyin: { name: "抖音", color: "bg-[#1C1C1E]" },
  xiaohongshu: { name: "小红书", color: "bg-[#FF2442]" },
  x: { name: "X (推特)", color: "bg-[#0F1419]" },
};

export default function Dashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-api/stats`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `请求失败 (${res.status})`);
        }

        const data = await res.json();
        setStats(data);
      } catch (err: any) {
        console.error("Fetch dashboard stats error:", err);
        setError(err.message || "加载仪表盘失败");
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-gray-400 text-sm">加载全站仪表盘指标中...</div>;
  }

  if (error || !stats) {
    return (
      <div className="p-8 bg-red-50 text-red-600 rounded-2xl border border-red-100 text-sm">
        {error || "获取全站指标异常"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">概览仪表盘</h1>
        <p className="text-xs text-gray-500 mt-1">全站多租户与抓取中枢实时运行指标</p>
      </div>

      {/* 5 大核心 KPI 卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-xs font-medium text-gray-500">👥 注册用户总数</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.totalUsers}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-xs font-medium text-gray-500">📡 监控博主总数</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.totalMonitors}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-xs font-medium text-gray-500">📰 归档内容总数</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.totalContents}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-xs font-medium text-gray-500">⚡ 24H 新增动态</p>
          <p className="text-2xl font-bold text-emerald-600 mt-2">+{stats.todayNewContent}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-xs font-medium text-gray-500">⚠️ 异常限流博主</p>
          <p className={`text-2xl font-bold mt-2 ${stats.rateLimitedCount > 0 ? "text-rose-600 animate-pulse" : "text-gray-900"}`}>
            {stats.rateLimitedCount}
          </p>
        </div>
      </div>

      {/* 平台监控分布 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-sm font-bold text-gray-900 flex items-center">
          <span className="text-base mr-2">🌐</span> 6 平台监控博主分布比例
        </h2>

        <div className="space-y-3">
          {Object.entries(PLATFORM_LABELS).map(([key, meta]) => {
            const count = stats.platformDist[key] || 0;
            const percent = stats.totalMonitors > 0 ? Math.round((count / stats.totalMonitors) * 100) : 0;

            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs font-medium text-gray-700">
                  <span>{meta.name}</span>
                  <span className="text-gray-500">{count} 个 ({percent}%)</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full ${meta.color} transition-all duration-500`}
                    style={{ width: `${percent}%` }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
