"use client";

export default function DashboardError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <section aria-labelledby="dashboard-error-title" className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 text-center" role="alert"><h1 className="text-xl font-semibold text-zinc-950" id="dashboard-error-title">No se pudo cargar esta página</h1><p className="mt-2 text-sm text-zinc-600">Inténtalo de nuevo. Si el problema continúa, contacta con soporte.</p><button className="mt-5 min-h-11 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={unstable_retry} type="button">Reintentar</button></section>;
}
