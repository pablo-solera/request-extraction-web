"use client";

import { useActionState, useState } from "react";
import { loginAction, type LoginFormState } from "@/app/(auth)/login/actions";
import { SubmitButton } from "@/components/common/submit-button";

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, action] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState<string | null>(null);

  return (
    <form action={action} className="space-y-5">
      <label className="block space-y-2" htmlFor="email">
        <span className="text-sm font-medium text-zinc-700">Email corporativo</span>
        <input
          autoComplete="username"
          className="field-control"
          id="email"
          name="email"
          placeholder="Ej.: nombre@empresa.com"
          onChange={(event) => setEmail(event.target.value)}
          required
          spellCheck={false}
          type="email"
          value={email ?? state.email ?? ""}
        />
      </label>
      <label className="block space-y-2" htmlFor="password">
        <span className="text-sm font-medium text-zinc-700">Contraseña</span>
        <input
          autoComplete="current-password"
          className="field-control"
          id="password"
          name="password"
          required
          type="password"
        />
      </label>
      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <SubmitButton className="w-full" pendingLabel="Entrando…">
        Entrar
      </SubmitButton>
    </form>
  );
}
