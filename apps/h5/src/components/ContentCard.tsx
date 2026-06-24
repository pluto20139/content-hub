import { PLATFORMS, formatRelativeTime, getDeepLink, detectEnvironment } from "@content-hub/shared";

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

function getPlaceholderCover(platform: string): string {
  const colors: Record<string, string> = {
    bilibili: "#FB7299",
    youtube: "#FF0000",
  };
  return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" fill="${colors[platform] ?? "#999"}"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="20">${PLATFORMS[platform]?.name ?? ""}</text></svg>`;
}

function handleClick(content: Content): void {
  const ua = navigator.userAgent;
  const env = detectEnvironment(ua);

  const originalUrl = content.original_url;

  // WeChat / Alipay → skip Deep Link, show fallback directly
  if (env === "wechat" || env === "alipay") {
    navigator.clipboard.writeText(originalUrl).catch(() => {});
    showFallbackModal(originalUrl, "当前环境不支持直接打开 App，请复制链接到系统浏览器");
    return;
  }

  // System browser → try Deep Link
  const deepLink = getDeepLink(content.platform, content.content_type, content.native_id);

  navigator.clipboard.writeText(originalUrl).catch(() => {});

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
      showFallbackModal(originalUrl);
    }, 2000);

    window.location.href = deepLink;
  } else {
    // No Deep Link schema
    window.open(originalUrl, "_blank");
  }
}

let modalEl: HTMLDivElement | null = null;

function showFallbackModal(url: string, customMessage?: string): void {
  if (modalEl) {
    document.body.removeChild(modalEl);
  }

  const message = customMessage ?? "链接已自动复制，打开 App 即可直接看";

  modalEl = document.createElement("div");
  modalEl.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;
    background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;
    z-index:9999;
  `;
  modalEl.innerHTML = `
    <div style="background:white;border-radius:12px;padding:24px;max-width:320px;text-align:center;margin:16px;">
      <p style="margin:0 0 16px;font-size:16px;color:#333;">${message}</p>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button id="modal-open-web" style="padding:8px 16px;border:1px solid #ddd;border-radius:8px;background:white;cursor:pointer;">网页打开</button>
        <button id="modal-close" style="padding:8px 16px;border:none;border-radius:8px;background:#3b82f6;color:white;cursor:pointer;">关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  modalEl.querySelector("#modal-open-web")?.addEventListener("click", () => {
    window.open(url, "_blank");
    document.body.removeChild(modalEl!);
    modalEl = null;
  });

  modalEl.querySelector("#modal-close")?.addEventListener("click", () => {
    document.body.removeChild(modalEl!);
    modalEl = null;
  });

  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) {
      document.body.removeChild(modalEl!);
      modalEl = null;
    }
  });
}

interface Props {
  content: Content;
}

export default function ContentCard({ content }: Props) {
  const info = PLATFORMS[content.platform];
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    e.currentTarget.src = getPlaceholderCover(content.platform);
  };

  return (
    <div
      onClick={() => handleClick(content)}
      className="flex gap-3 p-3 bg-white rounded-lg shadow-sm cursor-pointer active:bg-gray-50 border border-gray-100"
    >
      <img
        src={content.cover_url ?? getPlaceholderCover(content.platform)}
        alt={content.title}
        onError={handleImageError}
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
  );
}
