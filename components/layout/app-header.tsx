import Link from "next/link";
import { ActiveNavLink } from "@/components/layout/active-nav-link";
import { UserMenu } from "@/components/layout/user-menu";
import type { UserRole } from "@/lib/auth/session";
import type { Theme } from "@/lib/theme";

export function AppHeader({ user, theme }: { user: { email: string | null; name: string | null; role: UserRole }; theme: Theme }) {
  return (
    <header className="border-b border-line-soft bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-4">
          <Link className="cursor-pointer text-title font-semibold text-ink-strong" href="/extractions">
            Extracciones
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <nav aria-label="Principal" className="flex items-center gap-2 text-body">
            <ActiveNavLink href="/extractions" section>Nueva extracción</ActiveNavLink>
            <ActiveNavLink href="/history">Historial</ActiveNavLink>
            {user.role !== "employee" ? <ActiveNavLink href="/approvals">Aprobaciones</ActiveNavLink> : null}
            {user.role === "admin" ? <ActiveNavLink href="/admin/users" section>Usuarios</ActiveNavLink> : null}
            {user.role === "admin" ? <ActiveNavLink href="/admin/infrastructure" section>Infraestructura</ActiveNavLink> : null}
          </nav>
          <UserMenu theme={theme} user={user} />
        </div>
      </div>
    </header>
  );
}
