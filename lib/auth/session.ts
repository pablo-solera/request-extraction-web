import "server-only";

import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/auth/token";

export type { SessionClaims } from "@/lib/auth/token";
export { createSessionToken, shouldUseSecureCookie, verifySessionToken } from "@/lib/auth/token";

export type UserRole = "admin" | "coordinator" | "employee";

export async function getSessionClaims() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function setSessionCookie(user: { id: string; tokenVersion: number }) {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(user), sessionCookieOptions());
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
