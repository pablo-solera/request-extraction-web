import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { findUserById } from "@/lib/auth/user-repository";
import { getSessionClaims } from "@/lib/auth/session";
import { resolveUserRole } from "@/lib/employees/org-service";
import { resolveUserIdentities } from "@/lib/employees/identity-service";

/** The session is only valid while the user exists, is not disabled and the token version still matches. */
const findSessionUser = cache(async () => {
  const session = await getSessionClaims();
  if (!session) return null;
  const user = await findUserById(session.id);
  if (!user || user.disabledAt !== null || user.tokenVersion !== session.tokenVersion) return null;
  return user;
});

export const getVerifiedUser = cache(async () => {
  const user = await findSessionUser();
  if (!user) return null;
  const identity = (await resolveUserIdentities([user])).get(user.id);
  return {
    ...user,
    email: identity?.email ?? user.fallbackEmail,
    name: identity?.name ?? user.fallbackName,
    role: await resolveUserRole(user),
  };
});

export async function requireUser() {
  const user = await getVerifiedUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireApiUser() {
  const user = await findSessionUser();
  return user ? { id: user.id } : null;
}

export async function requireApiIdentity() {
  const user = await getVerifiedUser();
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/extractions");
  return user;
}

