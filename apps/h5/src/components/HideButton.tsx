import React from "react";

interface HideButtonProps {
  onHide: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

export const HideButton: React.FC<HideButtonProps> = ({ onHide, disabled }) => {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onHide(e);
      }}
      disabled={disabled}
      type="button"
      className="absolute top-2 right-2 flex items-center justify-center w-11 h-11 -mt-2 -mr-2 bg-transparent border-none outline-none focus:outline-none z-20 group"
      aria-label="隐藏内容"
    >
      <div
        className={`flex items-center justify-center w-7 h-7 rounded-full bg-black/40 text-white font-medium text-sm transition-all ${
          disabled
            ? "opacity-50 scale-95"
            : "hover:bg-black/60 active:scale-90 group-hover:scale-105"
        }`}
      >
        ✕
      </div>
    </button>
  );
};
