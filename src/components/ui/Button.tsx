import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "accent";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover focus-visible:ring-primary",
  secondary:
    "border border-border bg-surface text-ink hover:bg-aqua/30 focus-visible:ring-primary",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
  ghost:
    "text-muted hover:bg-aqua/30 hover:text-ink focus-visible:ring-primary",
  accent:
    "bg-accent text-ink hover:bg-accent-hover focus-visible:ring-accent",
};

const sizeStyles: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm rounded-lg",
  md: "px-4 py-2 text-sm rounded-lg",
  lg: "px-6 py-3 text-base rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        "min-h-[44px]",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    />
  )
);

Button.displayName = "Button";
