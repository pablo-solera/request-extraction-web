"use client";

import { useState, useTransition } from "react";
import { syncUsersAction } from "@/app/(dashboard)/admin/users/actions";

export function SyncUsersButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <div className="text-right"><button aria-busy={pending} className="min-h-11 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60" disabled={pending} onClick={() => startTransition(async () => { setError(null); try { const result = await syncUsersAction(); setMessage(`Sincronización completada · ${result.created} usuarios nuevos.`); } catch { setError("No se pudo sincronizar. Comprueba las conexiones e inténtalo de nuevo."); } })} type="button">{pending ? "Sincronizando…" : "Sincronizar con TimerTask"}</button>{message ? <p className="mt-2 text-xs text-zinc-600" role="status">{message}</p> : null}{error ? <p className="mt-2 text-xs text-red-700" role="alert">{error}</p> : null}</div>;
}
