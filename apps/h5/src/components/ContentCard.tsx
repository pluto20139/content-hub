import React, { useState } from "react";
import { PLATFORMS, formatRelativeTime, getDeepLink, detectEnvironment } from "@content-hub/shared";
import { HideButton } from "./HideButton.tsx";
import { FallbackModal } from "./FallbackModal.tsx";
import { supabase } from "../lib/supabase";

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

function getPlaceholderCover(platform: string): string {
  const color = PLATFORMS[platform]?.brandColor ?? "#999";
  const name = PLATFORMS[platform]?.name ?? "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" fill="${color}"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="20">${name}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

interface Props {
  content: Content;
  onHide?: (id: number) => void;
  showHideButton?: boolean;
  isHiding?: boolean;
}

export default function ContentCard({ content, onHide, showHideButton, isHiding }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [localStatus, setLocalStatus] = useState<string | null>(null);

  const info = PLATFORMS[content.platform];
  const summaryStatus = localStatus || content.summary_status || "none";

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    const img = e.currentTarget;
    if (content.cover_url && !img.src.includes("/functions/v1/image-proxy")) {
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/image-proxy?url=${encodeURIComponent(content.cover_url)}`;
      img.src = proxyUrl;
    } else {
      img.src = getPlaceholderCover(content.platform);
    }
  };

  const handleToggleSummary = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  };

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRetrying(true);
    try {
      const { error } = await supabase
        .from("contents")
        .update({ summary_status: "pending" })
        .eq("id", content.id);
      if (error) throw error;
      setLocalStatus("pending");
    } catch (err: any) {
      console.error("Failed to retry summary:", err.message);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleClick = (): void => {
    const ua = navigator.userAgent;
    const env = detectEnvironment(ua);
    const originalUrl = content.original_url;

    // WeChat / Alipay → skip Deep Link, show fallback directly
    if (env === "wechat" || env === "alipay") {
      navigator.clipboard.writeText(originalUrl).catch(() => {});
      setModalMessage("当前环境不支持直接打开 App，请复制链接到系统浏览器");
      setShowModal(true);
      return;
    }

    // System browser → try Deep Link
    const deepLink = getDeepLink(
      content.platform,
      content.content_type,
      content.native_id,
      {
        monitorNativeId: content.monitor_native_id || undefined,
        originalUrl: content.original_url,
      }
    );

    if (deepLink) {
      let timeoutId: ReturnType<typeof setTimeout>;

      const cleanup = (): void => {
        clearTimeout(timeoutId);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", onVisibilityChange);
        window.removeEventListener("blur", onBlur);
      };

      const onVisibilityChange = (): void => {
        if (document.hidden) {
          cleanup();
        }
      };

      const onBlur = (): void => {
        cleanup();
      };

      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("pagehide", onVisibilityChange);
      window.addEventListener("blur", onBlur);

      timeoutId = setTimeout(() => {
        cleanup();
        // Fallback scenario: write to clipboard and show modal
        navigator.clipboard.writeText(originalUrl).catch(() => {});
        setModalMessage("链接已自动复制，打开 App 即可直接看");
        setShowModal(true);
      }, 2500);

      window.location.href = deepLink;
    } else {
      // No Deep Link schema
      window.open(originalUrl, "_blank");
    }
  };

  const renderSummaryContent = () => {
    if (summaryStatus === "pending" || summaryStatus === "processing") {
      return (
        <div className="flex flex-col gap-1.5 p-2.5 rounded bg-indigo-50/40 border border-indigo-100/20">
          <div className="flex items-center gap-1.5 text-indigo-500 font-medium animate-pulse">
            <span className="inline-block animate-spin text-sm">🪄</span>
            <span>AI 正在对视频进行要点总结，请稍候...</span>
          </div>
          <div className="space-y-1.5 mt-1">
            <div className="h-2 rounded bg-indigo-100/50 animate-pulse w-full"></div>
            <div className="h-2 rounded bg-indigo-100/30 animate-pulse w-[85%]"></div>
          </div>
        </div>
      );
    }

    if (summaryStatus === "success") {
      const cleanSummary = (content.summary || "").replace(/<think>[\s\S]*?<\/think>/, "").trim();
      return (
        <div className="p-2.5 rounded bg-indigo-50/20 border border-indigo-100/30 text-gray-700 leading-relaxed text-[11px] font-normal select-text">
          <div className="flex items-center gap-1.5 font-semibold text-indigo-600/90 mb-1.5 select-none">
            <span>✨ AI 内容要点</span>
          </div>
          <p className="whitespace-pre-line text-gray-600 font-medium leading-snug">{cleanSummary}</p>
        </div>
      );
    }

    if (summaryStatus === "failed") {
      return (
        <div className="flex items-center justify-between p-2.5 rounded bg-red-50/40 border border-red-100/20 text-[11px]">
          <span className="text-red-500 font-medium">⚠️ 总结生成失败，可能由于接口超时或内容受限。</span>
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="px-2 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 transition-colors font-semibold active:scale-95 text-[10px]"
          >
            {isRetrying ? "重试中..." : "重新总结"}
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <>
      <div
        onClick={handleClick}
        onKeyDown={(e) => {
          // If keypress is inside summary section, do not trigger card link click
          if (e.target instanceof HTMLElement && e.target.closest(".summary-container")) {
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        role="button"
        tabIndex={0}
        className="relative flex flex-col gap-2 p-3 bg-white rounded-lg shadow-sm cursor-pointer active:bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <div className="flex gap-3">
          {showHideButton && onHide && (
            <HideButton onHide={() => onHide(content.id)} disabled={isHiding} />
          )}
          <img
            src={content.cover_url ?? getPlaceholderCover(content.platform)}
            alt={content.title}
            onError={handleImageError}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            width={80}
            height={56}
            className="w-20 h-14 rounded object-cover shrink-0 bg-gray-100"
          />
          <div className="flex flex-col flex-1 min-w-0 justify-between">
            <h3 className="text-sm font-medium leading-snug line-clamp-2 text-gray-900">
              {content.title}
            </h3>
            <div className="flex items-center gap-2 mt-1 select-none">
              <span
                className="text-xs px-1.5 py-0.5 rounded font-medium text-white shrink-0"
                style={{ backgroundColor: info?.brandColor ?? "#999" }}
              >
                {info?.name ?? content.platform}
              </span>
              <span className="text-xs text-gray-400">
                {formatRelativeTime(new Date(content.published_at))}
              </span>
              {summaryStatus !== "none" && (
                <button
                  onClick={handleToggleSummary}
                  className="ml-auto flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100/70 transition-all shadow-sm active:scale-95 shrink-0 z-10"
                >
                  <span>✨ AI 总结</span>
                  <span className={`transition-transform duration-200 text-[8px] ${isExpanded ? "rotate-180" : ""}`}>
                    ▼
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible AI Summary Section */}
        {isExpanded && summaryStatus !== "none" && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="summary-container border-t border-dashed border-gray-100 pt-2 mt-1 text-xs text-gray-600 cursor-default"
          >
            {renderSummaryContent()}
          </div>
        )}
      </div>

      {showModal && (
        <FallbackModal
          message={modalMessage}
          onOpenWeb={() => {
            window.open(content.original_url, "_blank");
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
