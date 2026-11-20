import jwt from "jsonwebtoken";

export const SESSION_COOKIE = "request_extraction_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 2;
const SESSION_RENEW_AFTER_SECONDS = 60 * 30;
const SESSION_ISSUER = "request-extraction-web";
const SESSION_AUDIENCE = "request-extraction-users";

export type SessionClaims = {
  id: string;
  tokenVersion: number;
  issuedAt: number;
};

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }

  return secret;
}

export function createSessionToken(user: { id: string; tokenVersion: number }) {
  return jwt.sign(
    { ver: user.tokenVersion },
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
      typeof payload.sub !== "string" ||
      typeof payload.ver !== "number" ||
      typeof payload.iat !== "number"
    ) {
      return null;
    }

    return { id: payload.sub, tokenVersion: payload.ver, issuedAt: payload.iat };
  } catch {
    return null;
  }
}

/** Sliding session: a still valid token is reissued once it is older than half an hour. */
export function shouldRenewSession(claims: SessionClaims, nowSeconds = Math.floor(Date.now() / 1000)) {
  return nowSeconds - claims.issuedAt >= SESSION_RENEW_AFTER_SECONDS;
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

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    priority: "high" as const,
    sameSite: "lax" as const,
    secure: shouldUseSecureCookie(),
  };
}
