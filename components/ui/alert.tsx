import type { HTMLAttributes } from "react";

export type AlertTone = "danger" | "pending" | "success" | "info";

const tones: Record<AlertTone, string> = {
  danger: "border-danger-line bg-danger-wash text-danger-ink",
  pending: "border-pending-line bg-pending-wash text-pending-ink",
  success: "border-success-line bg-success-wash text-success-ink",
  info: "border-running-line bg-running-wash text-running-ink",
};

export function Alert({ tone, className = "", ...props }: { tone: AlertTone } & HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border px-4 py-3 text-body ${tones[tone]}${className ? ` ${className}` : ""}`} {...props} />;
}
