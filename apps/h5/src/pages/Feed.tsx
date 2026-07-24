import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import ContentCard from "../components/ContentCard";
import { getCached, setCached } from "../lib/cache";
import { SkeletonCard } from "../components/SkeletonCard";
import { getHiddenIds, addHiddenId, removeHiddenId, asSupabaseIdList } from "../lib/hidden-storage";

interface Content {
  id: number;
  platform: string;
  native_id: string;
  content_type: string;
  title: string;
  cover_url: string | null;
  original_url: string;
  published_at: string;
  summary?: string | null;
  summary_status?: string | null;
  monitor_native_id?: string | null;
}

const PAGE_SIZE = 20;

interface Props {
  platform: string | null;
  userId?: string | null;
}

// Memory cache object to preserve tab switching states instantly
const memoryCache: Record<string, { contents: Content[]; hasMore: boolean }> = {};

export default function Feed({ platform, userId }: Props) {
  const [contents, setContents] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [hidingIds, setHidingIds] = useState<Set<number>>(new Set());
  const observerRef = useRef<HTMLDivElement | null>(null);

  // Sync ref to avoid rebuild of fetchPage / IntersectionObserver dependencies
  const contentsRef = useRef<Content[]>([]);
  useEffect(() => {
    contentsRef.current = contents;
  }, [contents]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchPage = useCallback(
    async (offset: number): Promise<void> => {
      // If we are reloading the first page and already have cached data showing, we refresh silently
      const isSilent = offset === 0 && contentsRef.current.length > 0;
      if (!isSilent) {
        setLoading(true);
      }
      setError(null);
      const isHiddenTab = platform === "hidden";
      const hiddenIds = getHiddenIds();
      let query = supabase
        .from("contents")
        .select("id,platform,native_id,content_type,title,cover_url,original_url,published_at,summary,summary_status,monitors(native_id)")
        .order("published_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (userId) {
        query = query.or(`user_id.eq.${userId},user_id.is.null`);
      }

      if (isHiddenTab) {
        // Hidden tab: show auto-expired (is_display=false) OR manually hidden (localStorage)
        if (hiddenIds.size > 0) {
          query = query.or(`is_display.eq.false,id.in.${asSupabaseIdList(hiddenIds)}`);
        } else {
          query = query.eq("is_display", false);
        }
      } else {
        // Main feed: only is_display=true AND not in localStorage hidden
        query = query.eq("is_display", true);
        if (hiddenIds.size > 0) {
          query = query.not("id", "in", asSupabaseIdList(hiddenIds));
        }
      }

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

      const items = (data ?? []).map((item: Record<string, unknown>) => ({
        id: item.id as number,
        platform: item.platform as string,
        native_id: item.native_id as string,
        content_type: item.content_type as string,
        title: item.title as string,
        cover_url: (item.cover_url as string | null) ?? null,
        original_url: item.original_url as string,
        published_at: item.published_at as string,
        summary: (item.summary as string | null) ?? null,
        summary_status: (item.summary_status as string | null) ?? null,
        monitor_native_id: (item.monitors as { native_id?: string } | null)?.native_id ?? null,
      })) as Content[];

      if (offset === 0) {
        setContents(items);
        // Write to caches
        const cacheKey = `${userId || 'anon'}:${platform ?? "all"}`;
        memoryCache[cacheKey] = { contents: items, hasMore: items.length === PAGE_SIZE };
        setCached(`feed:${cacheKey}:offset:0`, items);
      } else {
        setContents((prev) => [...prev, ...items]);
      }
      setHasMore(items.length === PAGE_SIZE);
      setLoading(false);
    },
    [platform, userId],
  );

  // Tab switching cache restore and query initialization
  useEffect(() => {
    let ignore = false;
    async function initFeed() {
      if (ignore) return;
      const cacheKey = `${userId || 'anon'}:${platform ?? "all"}`;
      const cached = memoryCache[cacheKey]?.contents ?? getCached<Content[]>(`feed:${cacheKey}:offset:0`) ?? [];
      setContents(cached);
      setHasMore(memoryCache[cacheKey]?.hasMore ?? true);
      setLoading(cached.length === 0);
      setError(null);
      await fetchPage(0);
    }
    initFeed();
    return () => {
      ignore = true;
    };
  }, [platform, userId, fetchPage]);

  // Infinite scroll observer - dependencies minimized (doesn't depend on contents.length)
  useEffect(() => {
    if (!observerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !error) {
          fetchPage(contentsRef.current.length);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, error, fetchPage]);

  if (loading && contents.length === 0) {
    return (
      <div className="flex flex-col gap-2 px-3 py-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (contents.length === 0 && error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-sm">
        <span className="text-red-500">{error}</span>
        <button
          onClick={() => fetchPage(0)}
          className="px-4 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 cursor-pointer"
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
    // Anon RLS policy forbids writing to contents.is_display, so persist hide
    // state in localStorage and filter from the in-memory list.
    const originalContents = [...contents];

    setContents((prev) => prev.filter((c) => c.id !== id));
    setHidingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    try {
      addHiddenId(id);

      const cacheKey = `${userId || 'anon'}:${platform ?? "all"}`;
      const updated = originalContents.filter((c) => c.id !== id);
      memoryCache[cacheKey] = { contents: updated, hasMore };
      setCached(`feed:${cacheKey}:offset:0`, updated);
    } catch (err: unknown) {
      console.error("Failed to hide content:", err instanceof Error ? err.message : String(err));
      setContents(originalContents);
      showToast("隐藏失败，请重试");
    } finally {
      setHidingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleUnhide = async (id: number) => {
    removeHiddenId(id);
    setContents((prev) => prev.filter((c) => c.id !== id));
    const cacheKey = `${userId || 'anon'}:${platform ?? "all"}`;
    const updated = contentsRef.current.filter((c) => c.id !== id);
    memoryCache[cacheKey] = { contents: updated, hasMore };
    setCached(`feed:${cacheKey}:offset:0`, updated);
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {platform === "hidden" && (
        <div
          className="text-center text-xs py-2 px-3 mb-2"
          style={{ color: "#8E8E93", background: "#FFF", border: "0.5px solid rgba(0,0,0,0.06)", borderRadius: "10px" }}
        >
          已隐藏内容包含手动隐藏和 30 天前自动过期的内容
        </div>
      )}
      {contents.map((c) => {
        const isManualHidden = getHiddenIds().has(c.id);
        return (
          <ContentCard
            key={c.id}
            content={c}
            onHide={handleHide}
            onUnhide={isManualHidden ? handleUnhide : undefined}
            showHideButton={platform !== "hidden"}
            showUnhideButton={platform === "hidden" && isManualHidden}
            isHiding={hidingIds.has(c.id)}
          />
        );
      })}
      {loading && (
        <div className="text-center text-xs py-4" style={{ color: "#8E8E93" }}>加载中...</div>
      )}
      {error && contents.length > 0 && (
        <div className="text-center py-4">
          <button
            onClick={() => fetchPage(contents.length)}
            className="px-4 py-1.5 rounded text-xs font-medium cursor-pointer"
            style={{ background: "#F2F2F7", color: "#1C1C1E", border: "0.5px solid rgba(0,0,0,0.06)" }}
          >
            加载失败，点击重试
          </button>
        </div>
      )}
      {!hasMore && contents.length > 0 && (
        <div className="text-center text-xs py-4" style={{ color: "#C7C7CC" }}>没有更多内容了</div>
      )}
      <div ref={observerRef} />
      
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 text-xs px-4 py-2 rounded-full z-50"
          style={{ background: "rgba(0,0,0,0.7)", color: "#FFF", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
