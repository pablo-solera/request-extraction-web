import Link from "next/link";
import { ActiveNavLink } from "@/components/layout/active-nav-link";
import { UserMenu } from "@/components/layout/user-menu";
import type { UserRole } from "@/lib/auth/session";

export function AppHeader({ user }: { user: { email: string | null; name: string | null; role: UserRole } }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link className="cursor-pointer text-base font-semibold text-zinc-950" href="/extractions">
            Extracciones
          </Link>
        </div>
        <div className="flex max-w-full items-center gap-2 sm:gap-4">
          <nav aria-label="Principal" className="flex max-w-[calc(100vw-9rem)] items-center gap-1 overflow-x-auto overscroll-x-contain text-sm sm:max-w-none sm:gap-2">
            <ActiveNavLink href="/extractions" section>Nueva extracción</ActiveNavLink>
            <ActiveNavLink href="/history">Historial</ActiveNavLink>
            {user.role !== "employee" ? <ActiveNavLink href="/approvals">Aprobaciones</ActiveNavLink> : null}
            {user.role === "admin" ? <ActiveNavLink href="/admin/users" section>Usuarios</ActiveNavLink> : null}
            {user.role === "admin" ? <ActiveNavLink href="/admin/infrastructure" section>Infraestructura</ActiveNavLink> : null}
          </nav>
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
