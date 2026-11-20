"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export type ConfirmOptions = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
};

export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

export function ConfirmDialog({ options, onResolve }: { options: ConfirmOptions | null; onResolve(confirmed: boolean): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (options && dialog && !dialog.open) dialog.showModal();
  }, [options]);

  return <dialog
    aria-describedby={descriptionId}
    aria-labelledby={titleId}
    className="m-auto w-full max-w-md rounded-xl border border-line-soft bg-surface p-6 text-ink shadow-floating backdrop:bg-ink-strong/40"
    onClose={(event) => {
      const confirmed = event.currentTarget.returnValue === "confirm";
      event.currentTarget.returnValue = "";
      onResolve(confirmed);
    }}
    ref={ref}
  >
    {options ? <>
      <h2 className="text-title font-semibold text-ink" id={titleId}>{options.title}</h2>
      <div className="mt-2 text-body text-ink-secondary" id={descriptionId}>{options.description}</div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button onClick={() => ref.current?.close("cancel")}>{options.cancelLabel ?? "Volver"}</Button>
        <Button onClick={() => ref.current?.close("confirm")} variant={options.tone === "primary" ? "primary" : "danger"}>{options.confirmLabel}</Button>
      </div>
    </> : null}
  </dialog>;
}

export function useConfirm(): [Confirm, ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((next) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOptions(next);
  }), []);

  const onResolve = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOptions(null);
  }, []);

  return [confirm, <ConfirmDialog key="confirm-dialog" onResolve={onResolve} options={options} />];
}
