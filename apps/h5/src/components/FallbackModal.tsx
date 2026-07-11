
interface FallbackModalProps {
  message: string;
  onOpenWeb: () => void;
  onClose: () => void;
}

export function FallbackModal({ message, onOpenWeb, onClose }: FallbackModalProps) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 flex items-center justify-center z-[9999]"
      style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="text-center mx-4"
        style={{
          background: "#FFF",
          borderRadius: "14px",
          padding: "24px",
          maxWidth: "320px",
        }}
      >
        <p style={{ margin: "0 0 20px 0", fontSize: "15px", color: "#1C1C1E", lineHeight: 1.5, fontWeight: 400 }}>
          {message}
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={onOpenWeb}
            className="cursor-pointer"
            style={{
              padding: "8px 16px",
              border: "0.5px solid rgba(0,0,0,0.12)",
              borderRadius: "10px",
              background: "#FFF",
              fontSize: "14px",
              color: "#1C1C1E",
              fontWeight: 400,
            }}
          >
            网页打开
          </button>
          <button
            onClick={onClose}
            className="cursor-pointer"
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: "10px",
              background: "#007AFF",
              fontSize: "14px",
              color: "#FFF",
              fontWeight: 500,
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
