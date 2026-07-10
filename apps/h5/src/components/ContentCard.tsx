import React, { useState } from "react";
import { PLATFORMS, formatRelativeTime, getDeepLink, detectEnvironment } from "@content-hub/shared";
import { HideButton } from "./HideButton.tsx";
import { FallbackModal } from "./FallbackModal.tsx";

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

  const info = PLATFORMS[content.platform];

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    const img = e.currentTarget;
    if (content.cover_url && !img.src.includes("/functions/v1/image-proxy")) {
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/image-proxy?url=${encodeURIComponent(content.cover_url)}`;
      img.src = proxyUrl;
    } else {
      img.src = getPlaceholderCover(content.platform);
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

  return (
    <>
      <div
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        role="button"
        tabIndex={0}
        className="relative flex gap-3 p-3 bg-white rounded-lg shadow-sm cursor-pointer active:bg-gray-50 border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
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
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium text-white shrink-0"
              style={{ backgroundColor: info?.brandColor ?? "#999" }}
            >
              {info?.name ?? content.platform}
            </span>
            <span className="text-xs text-gray-400">
              {formatRelativeTime(new Date(content.published_at))}
            </span>
          </div>
        </div>
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
