const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

function hostOf(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hosts the browser may legitimately send as `Origin`: the one it addressed (Host, or X-Forwarded-Host behind a
 * reverse proxy) and the public one in APP_BASE_URL. Only the host is compared because the deployment can sit behind
 * a proxy that changes the scheme.
 */
function allowedHosts(request: Request) {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return new Set([hostOf(forwarded), hostOf(request.headers.get("host")), hostOf(process.env.APP_BASE_URL)].filter((host): host is string => host !== null));
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const originHost = origin && origin !== "null" ? hostOf(origin) : null;
  return originHost !== null && allowedHosts(request).has(originHost);
}

/**
 * Cookie-authenticated, state-changing Route Handlers are not covered by the Server Actions Origin check. Browsers
 * always send `Origin` on a cross-site POST, so a missing or foreign one is rejected. Returns the response to send,
 * or null when the request may continue.
 */
export function rejectCrossOrigin(request: Request) {
  if (isSameOrigin(request)) return null;
  return Response.json({ error: { code: "FORBIDDEN_ORIGIN", message: "Origen no permitido." } }, { status: 403, headers: privateHeaders });
}
