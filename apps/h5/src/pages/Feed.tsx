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
  const observerRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback(
    async (offset: number): Promise<void> => {
      setLoading(true);
      setError(null);
      let query = supabase
        .from("contents")
        .select("id,platform,native_id,content_type,title,cover_url,original_url,published_at")
        .eq("is_display", true)
        .order("published_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (platform) {
        query = query.eq("platform", platform);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Failed to fetch contents:", error.message);
        setError("加载失败，请重试");
        setLoading(false);
        return;
      }

      const items = (data ?? []) as Content[];
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
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        暂无内容，请先在管理端添加博主
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {contents.map((c) => (
        <ContentCard key={c.id} content={c} />
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
    </div>
  );
}
