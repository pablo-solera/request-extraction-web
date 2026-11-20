"use client";

import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/(dashboard)/actions";
import { GeneratedAvatar } from "@/components/common/generated-avatar";
import { PowerOffIcon } from "@/components/icons/power-off-icon";

type User = { email: string | null; name: string | null; role: "admin" | "coordinator" | "employee" };

const roleLabels: Record<User["role"], string> = {
  admin: "Admin",
  coordinator: "Coordinador",
  employee: "Empleado",
};

export function UserMenu({ user }: { user: User }) {
  const displayName = user.name ?? user.email ?? "Usuario";
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const menuElement = menuRef.current;

    function handlePointerDown(event: PointerEvent) {
      if (menuElement?.contains(event.target as Node)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        menuElement?.querySelector("button")?.focus();
      }
    }

    function handleFocusOut(event: FocusEvent) {
      if (!menuElement?.contains(event.relatedTarget as Node | null)) setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    menuElement?.addEventListener("focusout", handleFocusOut);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      menuElement?.removeEventListener("focusout", handleFocusOut);
    };
  }, [open]);

  return (
    <div className="relative border-l border-zinc-200 pl-4" ref={menuRef}>
      <button
        aria-controls="account-disclosure"
        aria-expanded={open}
        aria-label={`Cuenta de ${displayName}`}
        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-zinc-100"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <GeneratedAvatar name={displayName} />
           <span className="hidden sm:block">
            <span className="block text-sm font-medium text-zinc-950">{displayName}</span>
            <span className="block text-xs text-zinc-500">{roleLabels[user.role]}</span>
        </span>
      </button>

      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg" id="account-disclosure">
          <div className="border-b border-zinc-100 px-4 py-3 sm:hidden">
            <p className="text-sm font-medium text-zinc-950">{displayName}</p>
            <p className="text-xs text-zinc-500">{roleLabels[user.role]}</p>
          </div>
          <form action={logoutAction}>
            <button className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950" type="submit">
              <PowerOffIcon className="size-4 shrink-0" />
              Cerrar sesión
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
