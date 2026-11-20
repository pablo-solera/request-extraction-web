"use client";

import { logoutAction } from "@/app/(dashboard)/actions";
import { GeneratedAvatar } from "@/components/common/generated-avatar";
import { PowerOffIcon } from "@/components/icons/power-off-icon";
import { PopoverMenu } from "@/components/ui/popover-menu";

type User = { email: string | null; name: string | null; role: "admin" | "coordinator" | "employee" };

const roleLabels: Record<User["role"], string> = {
  admin: "Admin",
  coordinator: "Coordinador",
  employee: "Empleado",
};

export function UserMenu({ user }: { user: User }) {
  const displayName = user.name ?? user.email ?? "Usuario";

  return (
    <div className="border-l border-line-soft pl-4">
      <PopoverMenu
        panelClassName="w-56"
        panelLabel="Cuenta"
        trigger={<>
          <GeneratedAvatar name={displayName} />
          <span className="block">
            <span className="block text-body font-medium text-ink-strong">{displayName}</span>
            <span className="block text-meta text-ink-muted">{roleLabels[user.role]}</span>
          </span>
        </>}
        triggerClassName="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-line-soft aria-expanded:bg-line-soft"
        triggerLabel={`Cuenta de ${displayName}`}
      >{(close) => <form action={logoutAction}>
        <button {...close} className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-body text-ink-secondary hover:bg-canvas hover:text-ink-strong" type="submit">
          <PowerOffIcon className="size-4 shrink-0" />
          Cerrar sesión
        </button>
      </form>}</PopoverMenu>
    </div>
  );
}
