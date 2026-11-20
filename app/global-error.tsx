"use client";

export default function GlobalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <html lang="es"><body className="m-0 min-h-screen bg-zinc-100 font-sans text-zinc-950"><main className="mx-auto my-[10vh] max-w-xl p-8 text-center"><h1 className="text-2xl font-semibold">Ha ocurrido un error</h1><p className="mt-2 text-zinc-700">Actualiza la página o inténtalo de nuevo.</p><button className="mt-5 min-h-11 rounded-lg bg-zinc-950 px-4 py-2 font-semibold text-white" onClick={unstable_retry} type="button">Reintentar</button></main></body></html>;
}
