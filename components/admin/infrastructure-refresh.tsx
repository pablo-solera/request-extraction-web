"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function InfrastructureRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (!document.hidden) startTransition(() => router.refresh());
    };
    const interval = window.setInterval(refreshIfVisible, 30_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [router]);

  return <button aria-busy={pending} className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60" disabled={pending} onClick={() => startTransition(() => router.refresh())} type="button">{pending ? "Actualizando…" : "Actualizar"}</button>;
}
