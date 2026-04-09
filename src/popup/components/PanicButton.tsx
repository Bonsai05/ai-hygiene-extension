// src/popup/components/PanicButton.tsx
// Panic button with double-click confirmation to prevent accidental activation

import { useState } from "react";

interface PanicButtonProps {
  onClick: () => void;
}

export function PanicButton({ onClick }: PanicButtonProps) {
  const [confirming, setConfirming] = useState(false);

  const handleClick = () => {
    if (confirming) {
      onClick();
      setConfirming(false);
    } else {
      setConfirming(true);
      // Auto-reset after 3 seconds if user doesn't confirm
      setTimeout(() => setConfirming(false), 3000);
    }
  };

  // Cancel confirmation if user clicks away
  const handleBlur = () => {
    setConfirming(false);
  };

  return (
    <div className="w-full">
      <button
        onClick={handleClick}
        onBlur={handleBlur}
        className={`w-full border-4 border-border transition-colors p-4 font-['Syne'] font-bold text-lg text-white ${
          confirming
            ? "bg-yellow-600 hover:bg-yellow-700 animate-pulse"
            : "bg-destructive hover:bg-destructive/90"
        }`}
      >
        {confirming ? (
          <span className="flex items-center justify-center gap-2">
            <span className="text-xl">❓</span> Click Again to Confirm
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <span className="text-xl">🆘</span> I Think I Messed Up
          </span>
        )}
      </button>
      {confirming && (
        <p className="text-[10px] text-muted-foreground text-center mt-1">
          Click again within 3 seconds to activate recovery
        </p>
      )}
    </div>
  );
}
