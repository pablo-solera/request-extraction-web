import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center"><h1 className="font-serif text-display font-medium text-ink-strong">No encontramos esa página</h1><p className="mt-2 text-body text-ink-muted">Error 404. Puede que el enlace esté desactualizado.</p><Link className={buttonStyles("primary", "mt-6")} href="/">Volver al inicio</Link></main>;
}
