import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center"><p className="text-sm font-semibold text-zinc-500">404</p><h1 className="mt-2 text-2xl font-semibold text-zinc-950">No encontramos esa página</h1><Link className={buttonStyles("primary", "mt-5")} href="/">Volver al inicio</Link></main>;
}
