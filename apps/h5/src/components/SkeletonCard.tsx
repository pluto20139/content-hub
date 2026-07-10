
export function SkeletonCard() {
  return (
    <div className="flex gap-3 p-3 bg-white rounded-lg border border-gray-100 animate-pulse">
      <div className="w-20 h-14 bg-gray-200 rounded shrink-0" />
      <div className="flex flex-col flex-1 min-w-0 justify-between">
        <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
        <div className="flex gap-2 items-center mt-1">
          <div className="h-4 bg-gray-200 rounded w-12" />
          <div className="h-3 bg-gray-200 rounded w-16" />
        </div>
      </div>
    </div>
  );
}
