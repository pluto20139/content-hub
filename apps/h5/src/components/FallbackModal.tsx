
interface FallbackModalProps {
  message: string;
  onOpenWeb: () => void;
  onClose: () => void;
}

export function FallbackModal({ message, onOpenWeb, onClose }: FallbackModalProps) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl p-6 max-w-[320px] text-center mx-4"
      >
        <p className="m-0 mb-4 text-base text-gray-800 leading-normal">{message}</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={onOpenWeb}
            className="px-4 py-2 border border-gray-200 rounded-lg bg-white cursor-pointer text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
          >
            网页打开
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border-none rounded-lg bg-blue-500 text-white cursor-pointer text-sm font-medium hover:bg-blue-600 active:bg-blue-700"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
