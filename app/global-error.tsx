"use client";

import Link from "next/link";
import "./globals.css";
import { Button, buttonStyles } from "@/components/ui/button";

export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <html lang="es"><body className="m-0 min-h-screen bg-canvas font-sans text-ink-strong"><main className="mx-auto my-[10vh] max-w-xl p-8 text-center"><h1 className="text-2xl font-semibold">Ha ocurrido un error</h1><p className="mt-2 text-ink-secondary">Actualiza la página o inténtalo de nuevo.</p>{error.digest ? <p className="mt-2 font-mono text-code text-ink-muted" translate="no">Código de referencia: {error.digest}</p> : null}<div className="mt-5 flex flex-wrap justify-center gap-2"><Button onClick={unstable_retry} variant="primary">Reintentar</Button><Link className={buttonStyles("secondary")} href="/">Ir al inicio</Link></div></main></body></html>;
}
