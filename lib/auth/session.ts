import "server-only";

import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

const SESSION_COOKIE = "request_extraction_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const SESSION_ISSUER = "request-extraction-web";
const SESSION_AUDIENCE = "request-extraction-users";

export type SessionClaims = {
  id: string;
};

export type UserRole = "admin" | "coordinator" | "employee";

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }

  return secret;
}

/**
 * Secure by default in production. A deployment that is only reachable over plain HTTP (internal network without TLS)
 * has to opt out with SESSION_COOKIE_SECURE=false, because browsers drop Secure cookies received over HTTP and nobody
 * could sign in.
 */
export function shouldUseSecureCookie() {
  const configured = process.env.SESSION_COOKIE_SECURE;
  if (process.env.NODE_ENV === "production") return configured !== "false";
  return configured === "true";
}

export function createSessionToken(user: { id: string }) {
  return jwt.sign(
    {},
    getSessionSecret(),
    {
      algorithm: "HS256",
      audience: SESSION_AUDIENCE,
      expiresIn: SESSION_MAX_AGE_SECONDS,
      issuer: SESSION_ISSUER,
      subject: user.id,
    },
  );
}

export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, getSessionSecret(), {
      algorithms: ["HS256"],
      audience: SESSION_AUDIENCE,
      issuer: SESSION_ISSUER,
    });

    if (
      !payload ||
      typeof payload === "string" ||
      typeof payload.sub !== "string"
    ) {
      return null;
    }

    return { id: payload.sub };
  } catch {
    return null;
  }
}

export async function getSessionClaims() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

export async function setSessionCookie(user: { id: string }) {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(user), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    priority: "high",
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
