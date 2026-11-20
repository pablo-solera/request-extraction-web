"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { ChevronLeftIcon } from "@/components/icons/chevron-left-icon";
import { ChevronRightIcon } from "@/components/icons/chevron-right-icon";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { SyncUsersButton } from "./sync-users-button";

type UserCoordinatorOption = { email: string; id: string; name: string };
export type ManagedUser = { coordinator: UserCoordinatorOption | null; email: string; id: string; name: string; role: "admin" | "coordinator" | "employee"; wdNumber: string | null };
type UsersTableProps = { currentUserId: string; page: number; query: string; totalPages: number; totalUsers: number; users: ManagedUser[] };

const roleLabels: Record<ManagedUser["role"], string> = { admin: "Admin", coordinator: "Coordinador", employee: "Empleado" };
const roleTones: Record<ManagedUser["role"], BadgeTone> = { admin: "solid", coordinator: "info", employee: "neutral" };

export function UsersTable({ currentUserId, page, query, totalPages, totalUsers, users }: UsersTableProps) {
  const [search, setSearch] = useState(query);
  const [previousQuery, setPreviousQuery] = useState(query);
  const debouncedSearch = useDebouncedValue(search);
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams();
    const currentSearch = search.trim();
    if (currentSearch) params.set("query", currentSearch);
    params.set("page", String(nextPage));
    return `${pathname}?${params.toString()}`;
  };

  if (query !== previousQuery) {
    setPreviousQuery(query);
    setSearch(query);
  }
  useEffect(() => {
    if (debouncedSearch === query) return;
    const params = new URLSearchParams(window.location.search);
    const trimmedSearch = debouncedSearch.trim();
    if (trimmedSearch) params.set("query", trimmedSearch); else params.delete("query");
    params.delete("page");
    const nextQuery = params.toString();
    startTransition(() => router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false }));
  }, [debouncedSearch, pathname, query, router]);

  return <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-xl font-semibold text-zinc-950">Usuarios</h2><p className="mt-1 text-sm text-zinc-600">Los roles y coordinadores vienen de TimerTask.</p></div><SyncUsersButton /></div>
    <form aria-busy={isPending} className="mt-5 max-w-md" onSubmit={(event) => event.preventDefault()}><label className="block space-y-2"><span className="text-sm font-medium text-zinc-700">Buscar usuarios</span><input autoComplete="off" id="admin-user-search" name="query" className="field-control" onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, email, rol o coordinador…" spellCheck={false} type="search" value={search} /></label></form>
    <p className="sr-only" role="status">{totalUsers} {totalUsers === 1 ? "usuario" : "usuarios"} encontrados.</p>
    {totalUsers === 0 ? <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center"><p className="text-sm text-zinc-700">No hay usuarios que coincidan con la búsqueda.</p><button className={buttonStyles("secondary", "mt-3")} onClick={() => setSearch("")} type="button">Limpiar búsqueda</button></div> : <>
      <div aria-label="Tabla de usuarios" className="mt-6 overflow-x-auto" role="region" tabIndex={0}><table className="w-full min-w-[56rem] text-left text-sm"><caption className="sr-only">Usuarios y sus roles y coordinadores</caption><thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-600"><tr><th className="py-3 pr-4 font-semibold" scope="col">WD</th><th className="py-3 pr-4 font-semibold" scope="col">Usuario</th><th className="py-3 pr-4 font-semibold" scope="col">Rol</th><th className="py-3 pr-4 font-semibold" scope="col">Coordinador</th></tr></thead><tbody className="divide-y divide-zinc-100">{users.map((user) => <tr key={user.id}><td className="py-4 pr-4 text-zinc-700 tabular-nums" translate="no">{user.wdNumber ?? <span className="text-zinc-500">—</span>}</td><td className="max-w-xs py-4 pr-4"><div className="break-words font-medium text-zinc-950">{user.name}</div><div className="break-all text-xs text-zinc-600">{user.email}</div>{user.id === currentUserId ? <div className="mt-1 text-xs font-medium text-emerald-700">Tu cuenta</div> : null}</td><td className="py-4 pr-4"><Badge icon={false} tone={roleTones[user.role]}>{roleLabels[user.role]}</Badge></td><td className="py-4 pr-4 text-zinc-700">{user.coordinator ? <div><div>{user.coordinator.name}</div><div className="break-all text-xs text-zinc-600">{user.coordinator.email}</div></div> : <span className="text-zinc-600">Sin coordinador</span>}</td></tr>)}</tbody></table></div>
      <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-4"><p className="text-sm text-zinc-700 tabular-nums">{totalUsers} usuarios · Página {page} de {totalPages}</p><nav aria-label="Paginación" className="flex gap-2"><Link aria-disabled={page <= 1} className={buttonStyles("secondary", "min-w-11 px-0 aria-disabled:pointer-events-none aria-disabled:opacity-40")} href={pageHref(Math.max(1, page - 1))} tabIndex={page <= 1 ? -1 : undefined} aria-label="Página anterior"><ChevronLeftIcon className="size-5" /></Link><Link aria-disabled={page >= totalPages} className={buttonStyles("secondary", "min-w-11 px-0 aria-disabled:pointer-events-none aria-disabled:opacity-40")} href={pageHref(Math.min(totalPages, page + 1))} tabIndex={page >= totalPages ? -1 : undefined} aria-label="Página siguiente"><ChevronRightIcon className="size-5" /></Link></nav></div>
    </>}
  </div>;
}
