"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { syncUsersAction } from "@/app/(dashboard)/admin/users/actions";

export function SyncUsersButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <div className="text-right"><Button aria-busy={pending} variant="primary" disabled={pending} onClick={() => startTransition(async () => { setError(null); try { const result = await syncUsersAction(); setMessage(`Sincronización completada · ${result.created} usuarios nuevos · ${result.disabled} desactivados.`); } catch { setError("No se pudo sincronizar. Comprueba las conexiones e inténtalo de nuevo."); } })} >{pending ? "Sincronizando…" : "Sincronizar con TimerTask"}</Button>{message ? <p className="mt-2 text-body text-ink-muted" role="status">{message}</p> : null}{error ? <p className="mt-2 text-body text-danger-ink" role="alert">{error}</p> : null}</div>;
}
