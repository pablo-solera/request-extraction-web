"use client";

import { useEffect, useRef } from "react";

/**
 * The fill is set through the CSSOM instead of a `style` prop: the production CSP has no
 * 'unsafe-inline', so an inline `style` attribute in the server HTML would be ignored.
 */
export function ProgressBar({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  const fill = useRef<HTMLDivElement>(null);
  const clamped = Math.min(100, Math.max(0, value));

  useEffect(() => {
    if (fill.current) fill.current.style.transform = `scaleX(${clamped / 100})`;
  }, [clamped]);

  return (
    <div className={className}>
      <div className="mb-1 flex justify-between text-meta text-ink-muted"><span>Progreso</span><span>{value}%</span></div>
      <div aria-label={label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-line-soft" role="progressbar">
        <div className="h-full w-full origin-left bg-focus [transform:scaleX(0)] transition-transform duration-500 motion-reduce:transition-none" ref={fill} />
      </div>
    </div>
  );
}
