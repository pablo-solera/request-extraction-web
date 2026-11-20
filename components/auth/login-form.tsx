"use client";

import { useActionState, useState } from "react";
import { loginAction, type LoginFormState } from "@/app/(auth)/login/actions";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert } from "@/components/ui/alert";

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, action] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState<string | null>(null);

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="field-label" htmlFor="email">Email corporativo</label>
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
      </div>
      <div>
        <label className="field-label" htmlFor="password">Contraseña</label>
        <input
          autoComplete="current-password"
          className="field-control"
          id="password"
          name="password"
          required
          type="password"
        />
      </div>
      {state.error ? (
        <Alert role="alert" tone="danger">
          {state.error}
        </Alert>
      ) : null}
      <SubmitButton className="w-full" pendingLabel="Entrando…">
        Entrar
      </SubmitButton>
    </form>
  );
}
