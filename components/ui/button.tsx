import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const base = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-body font-semibold transition-colors duration-(--duration-state) disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-wait";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink-strong text-surface hover:bg-hover-fill disabled:bg-ink-muted disabled:opacity-100",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-sunken",
  danger: "border border-danger-line bg-surface text-danger-ink hover:bg-danger-wash",
  ghost: "text-ink-secondary hover:bg-line-soft",
};

export function buttonStyles(variant: ButtonVariant = "secondary", className = "") {
  return `${base} ${variants[variant]}${className ? ` ${className}` : ""}`;
}

export function Button({ variant = "secondary", className, type = "button", ...props }: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={buttonStyles(variant, className)} type={type} {...props} />;
}
