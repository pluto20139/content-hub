import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { PLATFORMS } from "@content-hub/shared";

interface ContentItem {
  id: number;
  user_id: string;
  platform: string;
  native_id: string;
  content_type: string;
  title: string;
  cover_url: string | null;
  original_url: string;
  published_at: string;
  is_display: boolean;
  summary: string | null;
  summary_status: "pending" | "success" | "failed";
  monitors?: { display_name: string } | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

if (!SUPABASE_URL) {
  throw new Error("Missing VITE_SUPABASE_URL");
}

export default function ContentList() {
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [summaryFilter, setSummaryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const fetchContents = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const params = new URLSearchParams();
      if (platformFilter !== "all") params.set("platform", platformFilter);
      if (typeFilter !== "all") params.set("content_type", typeFilter);
      if (summaryFilter !== "all") params.set("summary_status", summaryFilter);
      if (searchQuery.trim()) params.set("query", searchQuery.trim());
      params.set("page", String(page));
      params.set("page_size", "15");

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-api/contents?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `获取数据仓库失败 (${res.status})`);
      }

      const json = await res.json();
      setContents(json.data || []);
      setTotal(json.total || 0);
    } catch (err: any) {
      console.error("Fetch contents error:", err);
      setError(err.message || "加载数据仓库失败");
    } finally {
      setLoading(false);
    }
  }, [platformFilter, typeFilter, summaryFilter, searchQuery, page]);

  useEffect(() => {
    fetchContents();
  }, [fetchContents]);

  const handleToggleDisplay = async (item: ContentItem) => {
    const nextDisplay = !item.is_display;
    setContents((prev) =>
      prev.map((c) => (c.id === item.id ? { ...c, is_display: nextDisplay } : c))
    );

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch(`${SUPABASE_URL}/functions/v1/admin-api/contents/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ is_display: nextDisplay }),
      });
    } catch {
      fetchContents();
    }
  };

  const handleRetrySummary = async (contentId: number) => {
    setRetryingId(contentId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-api/contents/${contentId}/retry-summary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        fetchContents();
      }
    } catch (err) {
      console.error("Retry summary error:", err);
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">数据仓库与 AI 摘要控制台</h1>
          <p className="text-xs text-gray-500 mt-1">全量爬取数据检索、Dify 大模型 AI 摘要状态检测与重试干预</p>
        </div>
      </div>

      {/* 多维检索区 */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap gap-3 items-center text-xs">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          placeholder="搜索动态标题关键词..."
          className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl w-60"
        />

        <div>
          <label className="text-gray-500 mr-1.5">平台：</label>
          <select
            value={platformFilter}
            onChange={(e) => { setPlatformFilter(e.target.value); setPage(1); }}
            className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl"
          >
            <option value="all">全平台</option>
            {Object.entries(PLATFORMS).map(([k, p]) => (
              <option key={k} value={k}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-gray-500 mr-1.5">类型：</label>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl"
          >
            <option value="all">全类型</option>
            <option value="video">视频 (Video)</option>
            <option value="article">文章 (Article)</option>
            <option value="post">动态/推文 (Post)</option>
          </select>
        </div>

        <div>
          <label className="text-gray-500 mr-1.5">摘要状态：</label>
          <select
            value={summaryFilter}
            onChange={(e) => { setSummaryFilter(e.target.value); setPage(1); }}
            className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl"
          >
            <option value="all">全部状态</option>
            <option value="success">生成成功 (success)</option>
            <option value="pending">生成中 (pending)</option>
            <option value="failed">生成失败 (failed)</option>
          </select>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-600 text-xs rounded-xl">{error}</div>}

      {/* 数据表格 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-xs">加载数据仓库中...</div>
        ) : contents.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-xs">暂无匹配的内容数据</div>
        ) : (
          <table className="w-full text-left text-xs text-gray-600">
            <thead className="bg-gray-50/80 border-b border-gray-100 text-gray-500 font-medium">
              <tr>
                <th className="py-3.5 px-4">平台</th>
                <th className="py-3.5 px-4">标题 / 链接</th>
                <th className="py-3.5 px-4">所属博主</th>
                <th className="py-3.5 px-4">发布时间</th>
                <th className="py-3.5 px-4">AI 摘要</th>
                <th className="py-3.5 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contents.map((item) => {
                const platMeta = PLATFORMS[item.platform];

                return (
                  <tr key={item.id} className="hover:bg-gray-50/50 transition">
                    <td className="py-3.5 px-4">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-bold"
                        style={{ backgroundColor: platMeta?.tagBg || "#F1F1F1", color: platMeta?.tagText || "#1C1C1E" }}
                      >
                        {platMeta?.name || item.platform}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      <a
                        href={item.original_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-gray-900 hover:text-blue-600 line-clamp-1"
                      >
                        {item.title}
                      </a>
                      <span className="text-[10px] text-gray-400">ID: {item.native_id} ({item.content_type})</span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-gray-700">
                      {item.monitors?.display_name || "未知博主"}
                    </td>
                    <td className="py-3.5 px-4 text-gray-400">
                      {new Date(item.published_at).toLocaleString("zh-CN")}
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      {item.summary_status === "success" ? (
                        <span className="text-[11px] text-gray-700 bg-gray-100 p-1.5 rounded-lg line-clamp-2 block" title={item.summary || ""}>
                          💡 {item.summary}
                        </span>
                      ) : item.summary_status === "pending" ? (
                        <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium animate-pulse">
                          ⏳ 生成中...
                        </span>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full font-medium">
                            ❌ 失败
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRetrySummary(item.id)}
                            disabled={retryingId === item.id}
                            className="text-[10px] text-blue-600 hover:underline font-bold"
                          >
                            {retryingId === item.id ? "重试中..." : "重试 AI 摘要"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleToggleDisplay(item)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition ${
                          item.is_display ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        {item.is_display ? "正常显示" : "已隐藏"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页控制 */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>共 {total} 条内容记录</span>
        <div className="flex space-x-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 bg-white border rounded-lg disabled:opacity-40"
          >
            上一页
          </button>
          <span className="py-1 font-semibold text-gray-900">第 {page} 页</span>
          <button
            type="button"
            disabled={contents.length < 15}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 bg-white border rounded-lg disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
