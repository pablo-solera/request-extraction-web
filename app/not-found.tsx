import Link from "next/link";

export default function NotFound() {
  return <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center"><p className="text-sm font-semibold text-zinc-500">404</p><h1 className="mt-2 text-2xl font-semibold text-zinc-950">No encontramos esa página</h1><Link className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800" href="/">Volver al inicio</Link></main>;
}
