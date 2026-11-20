"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ActiveNavLink({ children, href, section = false }: { children: React.ReactNode; href: string; section?: boolean }) {
  const pathname = usePathname();
  const active = section ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href;

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={active
        ? "inline-flex min-h-11 shrink-0 items-center rounded-lg bg-ink-strong px-3 py-2 font-semibold text-surface"
        : "inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 py-2 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
      }
      href={href}
    >
      {children}
    </Link>
  );
}
