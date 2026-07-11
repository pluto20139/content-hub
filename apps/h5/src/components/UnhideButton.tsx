import React from "react";

interface UnhideButtonProps {
  onUnhide: (e: React.MouseEvent) => void;
}

export const UnhideButton: React.FC<UnhideButtonProps> = ({ onUnhide }) => {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onUnhide(e);
      }}
      type="button"
      className="absolute top-2 right-2 flex items-center justify-center px-2.5 py-1 -mt-2 -mr-2 bg-transparent border-none outline-none focus:outline-none z-20"
      aria-label="恢复显示"
    >
      <div
        className="flex items-center justify-center px-2 h-7 rounded-full bg-black/40 text-white font-normal text-xs transition-all hover:bg-black/60 active:scale-95"
      >
        恢复
      </div>
    </button>
  );
};
