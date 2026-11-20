"use client";

import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";

export default function DashboardError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <section aria-labelledby="dashboard-error-title" className="mx-auto max-w-xl rounded-xl border border-danger-line bg-white p-8 text-center" role="alert">
    <h1 className="font-serif text-title font-medium text-zinc-950" id="dashboard-error-title">No se pudo cargar esta página</h1>
    <p className="mt-2 text-body text-zinc-600">Inténtalo de nuevo. Si el problema continúa, contacta con soporte{error.digest ? " e indica este código de referencia:" : "."}</p>
    {error.digest ? <p className="mt-2 font-mono text-code text-ink-secondary" translate="no">{error.digest}</p> : null}
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      <Button onClick={unstable_retry} variant="primary">Reintentar</Button>
      <Link className={buttonStyles("secondary")} href="/extractions">Ir al inicio</Link>
    </div>
  </section>;
}
