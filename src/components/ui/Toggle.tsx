"use client";

import clsx from "clsx";

interface ToggleProps {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ enabled, onChange, label, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={clsx(
        "relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        enabled ? "bg-primary" : "bg-border",
        className
      )}
    >
      <span
        className={clsx(
          "pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200",
          enabled ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}
