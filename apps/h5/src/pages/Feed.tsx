import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import ContentCard from "../components/ContentCard";

interface Content {
  id: number;
  platform: string;
  native_id: string;
  content_type: string;
  title: string;
  cover_url: string | null;
  original_url: string;
  published_at: string;
  monitor_native_id?: string | null;
}

const PAGE_SIZE = 20;

interface Props {
  platform: string | null;
}

export default function Feed({ platform }: Props) {
  const [contents, setContents] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [hidingIds, setHidingIds] = useState<Set<number>>(new Set());
  const observerRef = useRef<HTMLDivElement | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchPage = useCallback(
    async (offset: number): Promise<void> => {
      setLoading(true);
      setError(null);
      const isHiddenTab = platform === "hidden";
      let query = supabase
        .from("contents")
        .select("id,platform,native_id,content_type,title,cover_url,original_url,published_at,monitors(native_id)")
        .eq("is_display", isHiddenTab ? false : true)
        .order("published_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (platform && !isHiddenTab) {
        query = query.eq("platform", platform);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Failed to fetch contents:", error.message);
        setError("加载失败，请重试");
        setLoading(false);
        return;
      }

      const items = (data ?? []).map((item: any) => ({
        id: item.id,
        platform: item.platform,
        native_id: item.native_id,
        content_type: item.content_type,
        title: item.title,
        cover_url: item.cover_url,
        original_url: item.original_url,
        published_at: item.published_at,
        monitor_native_id: item.monitors?.native_id ?? null,
      })) as Content[];

      if (offset === 0) {
        setContents(items);
      } else {
        setContents((prev) => [...prev, ...items]);
      }
      setHasMore(items.length === PAGE_SIZE);
      setLoading(false);
    },
    [platform],
  );

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage]);

  // Infinite scroll observer
  useEffect(() => {
    if (!observerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !error) {
          fetchPage(contents.length);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, error, contents.length, fetchPage]);

  if (loading && contents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        加载中...
      </div>
    );
  }

  if (contents.length === 0 && error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-sm">
        <span className="text-red-500">{error}</span>
        <button
          onClick={() => fetchPage(0)}
          className="px-4 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600"
        >
          点击重试
        </button>
      </div>
    );
  }

  if (!loading && contents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 text-sm px-4 text-center">
        <span>{platform === "hidden" ? "暂无隐藏内容" : "暂无内容，请先在管理端添加博主"}</span>
        {platform === "hidden" && (
          <span className="text-xs text-gray-300 mt-2">已隐藏内容包含手动隐藏和 30 天前自动过期的内容</span>
        )}
      </div>
    );
  }

  const handleHide = async (id: number) => {
    const originalContents = [...contents];
    
    // 1. Optimistic Update
    setContents((prev) => prev.filter((c) => c.id !== id));
    setHidingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    try {
      const { error } = await supabase
        .from("contents")
        .update({ is_display: false })
        .eq("id", id);

      if (error) throw error;
      
      setHidingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: any) {
      console.error("Failed to hide content:", err.message);
      // 2. Rollback & Toast
      setContents(originalContents);
      setHidingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showToast("隐藏失败，请重试");
    }
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {platform === "hidden" && (
        <div className="text-center text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-md py-2 px-3 mb-2">
          已隐藏内容包含手动隐藏和 30 天前自动过期的内容
        </div>
      )}
      {contents.map((c) => (
        <ContentCard
          key={c.id}
          content={c}
          onHide={handleHide}
          showHideButton={platform !== "hidden"}
          isHiding={hidingIds.has(c.id)}
        />
      ))}
      {loading && (
        <div className="text-center text-gray-400 text-xs py-4">加载中...</div>
      )}
      {error && contents.length > 0 && (
        <div className="text-center py-4">
          <button
            onClick={() => fetchPage(contents.length)}
            className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-medium"
          >
            加载失败，点击重试
          </button>
        </div>
      )}
      {!hasMore && contents.length > 0 && (
        <div className="text-center text-gray-300 text-xs py-4">没有更多内容了</div>
      )}
      <div ref={observerRef} />
      
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-4 py-2 rounded-full shadow-lg z-50 animate-bounce">
          {toast}
        </div>
      )}
    </div>
  );
}
