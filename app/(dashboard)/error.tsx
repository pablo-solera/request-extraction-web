"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <section aria-labelledby="dashboard-error-title" className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-8 text-center" role="alert"><h1 className="text-xl font-semibold text-zinc-950" id="dashboard-error-title">No se pudo cargar esta página</h1><p className="mt-2 text-sm text-zinc-600">Inténtalo de nuevo. Si el problema continúa, contacta con soporte.</p><Button className="mt-5" onClick={unstable_retry} variant="primary">Reintentar</Button></section>;
}
