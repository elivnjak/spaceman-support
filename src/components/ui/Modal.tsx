"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import clsx from "clsx";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizeStyles = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
};

export function Modal({ open, onClose, children, className, size = "md" }: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close modal"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          "relative max-h-[90vh] w-full overflow-y-auto rounded-card bg-surface p-6 shadow-xl",
          sizeStyles[size],
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
