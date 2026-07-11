
export function SkeletonCard() {
  return (
    <div
      className="flex gap-3 animate-pulse"
      style={{
        background: "#FFF",
        borderRadius: "12px",
        border: "0.5px solid rgba(0,0,0,0.06)",
        padding: "16px",
      }}
    >
      <div
        className="w-[72px] h-[72px] shrink-0"
        style={{ background: "#E5E5EA", borderRadius: "10px" }}
      />
      <div className="flex flex-col flex-1 min-w-0 justify-between">
        <div className="h-4 rounded w-3/4" style={{ background: "#E5E5EA" }} />
        <div className="flex gap-2 items-center mt-1">
          <div className="h-4 rounded w-12" style={{ background: "#E5E5EA" }} />
          <div className="h-3 rounded w-16" style={{ background: "#E5E5EA" }} />
        </div>
      </div>
    </div>
  );
}
