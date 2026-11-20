"use client";

import { useFormStatus } from "react-dom";
import { buttonStyles } from "@/components/ui/button";

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
      className={buttonStyles("primary", className)}
      disabled={pending || disabled}
      type="submit"
      {...buttonProps}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
