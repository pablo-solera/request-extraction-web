"use client";

import { useActionState, useState } from "react";
import { loginAction, type LoginFormState } from "@/app/(auth)/login/actions";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, action] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);

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
          type={passwordVisible ? "text" : "password"}
        />
        <Button aria-pressed={passwordVisible} className="mt-2 min-h-11" onClick={() => setPasswordVisible((current) => !current)} variant="ghost">
          {passwordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="rounded-lg border border-danger-line bg-danger-wash px-3 py-2 text-body text-danger-ink">
          {state.error}
        </p>
      ) : null}
      <SubmitButton className="w-full" pendingLabel="Entrando…">
        Entrar
      </SubmitButton>
    </form>
  );
}
