"use client";

import { useId, useState, type ReactNode } from "react";

export function PopoverMenu({ trigger, triggerLabel, triggerClassName, triggerDisabled, panelLabel, panelClassName = "", children }: {
  trigger: ReactNode;
  triggerLabel: string;
  triggerClassName: string;
  triggerDisabled?: boolean;
  panelLabel: string;
  panelClassName?: string;
  children(closeProps: { popoverTarget: string; popoverTargetAction: "hide" }): ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return <>
    <button aria-controls={id} aria-expanded={open} aria-label={triggerLabel} className={triggerClassName} disabled={triggerDisabled} popoverTarget={id} type="button">{trigger}</button>
    <div
      aria-label={panelLabel}
      className={`popover-menu max-h-[70vh] min-w-52 overflow-y-auto rounded-lg border border-line-soft bg-surface p-1 text-ink shadow-floating ${panelClassName}`}
      id={id}
      onToggle={(event) => setOpen((event.nativeEvent as ToggleEvent).newState === "open")}
      popover="auto"
      role="group"
    >
      {open ? children({ popoverTarget: id, popoverTargetAction: "hide" }) : null}
    </div>
  </>;
}
