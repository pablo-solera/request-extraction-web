"use client";

import { useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
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

  return <Button aria-busy={pending} variant="primary" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Actualizando…" : "Actualizar"}</Button>;
}
