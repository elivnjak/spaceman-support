import clsx from "clsx";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-page text-muted border-border",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  warning: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  danger: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",
  info: "bg-aqua text-primary border-aqua-dark dark:bg-aqua dark:text-primary dark:border-aqua-dark",
};

export function Badge({ variant = "default", className, children }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
