import type { HTMLAttributes } from "react";
import clsx from "clsx";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "sm" | "md" | "lg";
}

const paddingStyles = {
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export function Card({ className, padding = "md", children, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-card border border-border bg-surface shadow-card",
        paddingStyles[padding],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
