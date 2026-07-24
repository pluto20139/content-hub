import React, { useState } from "react";
import { PLATFORMS, formatRelativeTime, getDeepLink, detectEnvironment, isDesktopBrowser } from "@content-hub/shared";
import { HideButton } from "./HideButton.tsx";
import { UnhideButton } from "./UnhideButton.tsx";
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

function getMainText(content: Content): string {
  const title = content.title?.trim();
  const summary = (content.summary || "").replace(/<think>[\s\S]*?<\/think>/, "").trim();

  if (title) return title;
  if (summary) return summary;
  return "暂无标题";
}

interface Props {
  content: Content;
  onHide?: (id: number) => void;
  onUnhide?: (id: number) => void;
  showHideButton?: boolean;
  showUnhideButton?: boolean;
  isHiding?: boolean;
}

export default function ContentCard({ content, onHide, onUnhide, showHideButton, showUnhideButton, isHiding }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [localStatus, setLocalStatus] = useState<string | null>(null);

  const info = PLATFORMS[content.platform];
  const summaryStatus = localStatus || content.summary_status || "none";
  const mainText = getMainText(content);
  const cleanSummary = (content.summary || "").replace(/<think>[\s\S]*?<\/think>/, "").trim();

  const handleToggleSummary = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  };

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRetrying(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        data?: { content_id: number; previous_status: string };
        error?: { code: string; message: string };
      }>("retry-summary", {
        body: { content_id: content.id },
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error?.message ?? "重试失败");
      }
      setLocalStatus("pending");
    } catch (err: unknown) {
      console.error("Failed to retry summary:", err instanceof Error ? err.message : String(err));
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
      navigator.clipboard?.writeText(originalUrl).catch(() => {});
      setModalMessage("当前环境不支持直接打开 App，请复制链接到系统浏览器");
      setShowModal(true);
      return;
    }

    // Desktop browser → open original URL directly, skip Deep Link + 2.5s fallback
    if (isDesktopBrowser(ua)) {
      window.open(originalUrl, "_blank");
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
      // eslint-disable-next-line prefer-const
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
        navigator.clipboard?.writeText(originalUrl).catch(() => {});
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
      return (
        <div className="p-3 rounded-lg" style={{ background: "#F9F9F9", border: "0.5px solid rgba(0,0,0,0.06)" }}>
          <div className="flex items-center gap-1.5 mb-2 select-none" style={{ fontSize: "11px", color: "#8E8E93", fontWeight: 500 }}>
            <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#1C1C1E", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#FFF", fontSize: "9px", fontWeight: 600 }}>AI</span>
            </div>
            <span>内容要点</span>
          </div>
          <div style={{ borderLeft: "2px solid #1C1C1E", paddingLeft: "12px" }}>
            <p className="whitespace-pre-line select-text" style={{ fontSize: "13px", color: "#1C1C1E", lineHeight: 1.6, margin: 0, fontWeight: 400 }}>
              {cleanSummary}
            </p>
          </div>
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
          {showUnhideButton && onUnhide && (
            <UnhideButton onUnhide={() => onUnhide(content.id)} />
          )}
          <div className="flex flex-col flex-1 min-w-0 justify-between gap-2">
            <div className="flex items-center gap-2 select-none">
              <span
                className="text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0"
                style={{
                  backgroundColor: info?.tagBg ?? "#F1F1F1",
                  color: info?.tagText ?? "#1C1C1E",
                }}
              >
                {info?.name ?? content.platform}
              </span>
              <span className="text-[11px] text-[#8E8E93] truncate min-w-0">
                {content.native_id}
              </span>
              <span className="text-xs text-[#C7C7CC] ml-auto shrink-0">
                {formatRelativeTime(new Date(content.published_at))}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="font-medium leading-snug line-clamp-2 text-[#1C1C1E]" style={{ fontSize: "15px" }}>
                {mainText}
              </h3>
              {content.summary && cleanSummary && mainText !== cleanSummary && (
                <p className="text-[13px] text-[#6E6E73] leading-relaxed line-clamp-3 whitespace-pre-line">
                  {cleanSummary}
                </p>
              )}
            </div>

            {summaryStatus !== "none" && (
              <button
                onClick={handleToggleSummary}
                className="self-start flex items-center gap-0.5 text-xs font-normal text-[#8E8E93] hover:text-[#1C1C1E] transition-colors shrink-0 z-10 focus:outline-none"
              >
                <span>AI 要点</span>
                <span className={`inline-block transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} style={{ fontSize: "10px", marginLeft: "2px" }}>
                  ▾
                </span>
              </button>
            )}
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
