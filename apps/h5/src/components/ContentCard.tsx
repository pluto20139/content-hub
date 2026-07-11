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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" fill="${color}"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="18" font-family="-apple-system,sans-serif">${name}</text></svg>`;
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
        <div className="flex items-center gap-2 p-3 rounded-lg text-[#8E8E93]" style={{ background: "#F9F9F9", border: "0.5px solid rgba(0,0,0,0.06)", fontSize: "13px" }}>
          <svg className="animate-spin h-4 w-4 text-[#8E8E93]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>总结中...</span>
        </div>
      );
    }

    if (summaryStatus === "success") {
      const cleanSummary = (content.summary || "").replace(/<think>[\s\S]*?<\/think>/, "").trim();
      return (
        <div className="p-3 rounded-lg text-[#1C1C1E] font-normal select-text" style={{ background: "#F9F9F9", border: "0.5px solid rgba(0,0,0,0.06)" }}>
          <div className="flex items-center gap-1.5 font-semibold text-[#8E8E93] mb-1.5 select-none text-[11px]">
            <span>✨ AI 内容要点</span>
          </div>
          <p className="whitespace-pre-line text-[#1C1C1E]" style={{ fontSize: "13px", lineHeight: "1.6" }}>{cleanSummary}</p>
        </div>
      );
    }

    if (summaryStatus === "failed") {
      return (
        <div className="flex items-center justify-between p-3 rounded-lg text-[13px]" style={{ background: "#F9F9F9", border: "0.5px solid rgba(0,0,0,0.06)" }}>
          <span className="text-[#8E8E93]">⚠️ 总结生成失败</span>
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="px-2 py-0.5 rounded bg-white text-[#1C1C1E] hover:bg-gray-50 border border-gray-200 transition-all font-medium active:scale-95 text-xs"
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
        className="relative flex flex-col gap-2 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
        style={{
          borderRadius: "12px",
          border: "0.5px solid rgba(0,0,0,0.06)",
          padding: "16px",
        }}
      >
        <div className="flex gap-3" style={{ touchAction: "manipulation" }}>
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
            width={72}
            height={72}
            className="w-[72px] h-[72px] object-cover shrink-0"
            style={{ borderRadius: "10px", background: "#F2F2F7" }}
          />
          <div className="flex flex-col flex-1 min-w-0 justify-between">
            <h3 className="font-medium leading-snug line-clamp-2 text-[#1C1C1E]" style={{ fontSize: "15px" }}>
              {content.title}
            </h3>
            <div className="flex items-center gap-2 mt-1 select-none">
              <span
                className="text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0"
                style={{
                  backgroundColor: info?.tagBg ?? "#F1F1F1",
                  color: info?.tagText ?? "#1C1C1E",
                }}
              >
                {info?.name ?? content.platform}
              </span>
              <span className="text-xs text-[#8E8E93]">
                {formatRelativeTime(new Date(content.published_at))}
              </span>
              {summaryStatus !== "none" && (
                <button
                  onClick={handleToggleSummary}
                  className="ml-auto flex items-center gap-0.5 text-xs font-normal text-[#8E8E93] hover:text-[#1C1C1E] transition-colors shrink-0 z-10 focus:outline-none"
                >
                  <span>AI 要点</span>
                  <span className={`inline-block transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} style={{ fontSize: "10px", marginLeft: "2px" }}>
                    ▾
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible AI Summary Section */}
        {summaryStatus !== "none" && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="summary-container overflow-hidden transition-[max-height,opacity] duration-300 ease-out cursor-default"
            style={{
              maxHeight: isExpanded ? "1000px" : "0px",
              opacity: isExpanded ? 1 : 0,
              marginTop: isExpanded ? "12px" : "0px",
            }}
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
