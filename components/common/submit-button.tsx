"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  className = "",
  pendingLabel,
  disabled,
  ...buttonProps
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:bg-zinc-700 ${className}`}
      disabled={pending || disabled}
      type="submit"
      {...buttonProps}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
