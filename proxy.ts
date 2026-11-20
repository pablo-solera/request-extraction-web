import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  shouldRenewSession,
  verifySessionToken,
} from "@/lib/auth/token";

function renewSession(request: NextRequest, response: NextResponse) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? verifySessionToken(token) : null;
  if (!claims || !shouldRenewSession(claims)) return;
  response.cookies.set(SESSION_COOKIE, createSessionToken(claims), sessionCookieOptions());
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const connectSources = ["'self'", ...(isDevelopment ? ["ws://localhost:*", "http://localhost:*"] : [])].join(" ");
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-inline'" : ""}`,
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  renewSession(request, response);
  return response;
}
