import type { ReactNode } from "react";

export type BadgeTone = "pending" | "running" | "success" | "danger" | "issue" | "info" | "neutral" | "solid";

const tones: Record<BadgeTone, string> = {
  pending: "border-pending-line bg-pending-wash text-pending-ink",
  running: "border-running-line bg-running-wash text-running-ink",
  success: "border-success-line bg-success-wash text-success-ink",
  danger: "border-danger-line bg-danger-wash text-danger-ink",
  issue: "border-issue-line bg-issue-wash text-issue-ink",
  info: "border-info-line bg-info-wash text-info-ink",
  neutral: "border-neutral-line bg-neutral-wash text-neutral-ink",
  solid: "border-ink-strong bg-ink-strong text-surface",
};

const icons: Partial<Record<BadgeTone, ReactNode>> = {
  pending: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.3" /></>,
  running: <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.8h-2.8" />,
  success: <path d="m3.5 8.5 3 3 6-6.5" />,
  danger: <path d="m4.5 4.5 7 7m0-7-7 7" />,
  issue: <path d="M8 2.5 14 13H2L8 2.5ZM8 6.5v3M8 11.3v.2" />,
  info: <><circle cx="8" cy="8" r="5.5" /><path d="M8 7.5v3.5M8 5.3v.2" /></>,
  neutral: <path d="M4 8h8" />,
};

export function Badge({ tone, icon = true, children, className = "" }: { tone: BadgeTone; icon?: boolean; children: ReactNode; className?: string }) {
  const glyph = icon ? icons[tone] : null;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-meta font-semibold ${tones[tone]}${className ? ` ${className}` : ""}`}>
    {glyph ? <svg aria-hidden="true" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" viewBox="0 0 16 16">{glyph}</svg> : null}
    {children}
  </span>;
}
