import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import clsx from "clsx";

const baseStyles =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted transition-colors duration-150 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 min-h-[44px]";

const errorStyles = "border-red-500 focus:border-red-500 focus:ring-red-500/20";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={clsx(baseStyles, error && errorStyles, className)}
      {...props}
    />
  )
);

Input.displayName = "Input";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => (
    <textarea
      ref={ref}
      className={clsx(baseStyles, "min-h-[80px] resize-y", error && errorStyles, className)}
      {...props}
    />
  )
);

Textarea.displayName = "Textarea";
