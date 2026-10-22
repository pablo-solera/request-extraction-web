"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate } from "@/lib/auth/authenticate";
import { LdapUnavailableError } from "@/lib/auth/ldap";
import { setSessionCookie } from "@/lib/auth/session";

const loginSchema = z.object({
  email: z.string().trim().pipe(z.email()).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(256),
});

export type LoginFormState = { error?: string; email?: string };

export async function loginAction(
  _previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Introduce un email y una contraseña válidos.", email: String(formData.get("email") ?? "") };
  }

  let user;

  try {
    user = await authenticate(parsed.data.email, parsed.data.password);
  } catch (error) {
    if (error instanceof LdapUnavailableError) {
      return { error: "El servicio de autenticación no está disponible.", email: parsed.data.email };
    }

    console.error("Login failed because an internal dependency is unavailable.", error);
    return { error: "No se ha podido iniciar sesión. Inténtalo de nuevo.", email: parsed.data.email };
  }

  if (!user) {
    return { error: "Email o contraseña incorrectos.", email: parsed.data.email };
  }

  await setSessionCookie(user);
  redirect("/extractions");
}
