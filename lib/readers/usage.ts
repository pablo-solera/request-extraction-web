const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

declare global { var __requestExtractionReaderUsage: Map<string, number[]> | undefined; }
const usage = globalThis.__requestExtractionReaderUsage ?? new Map<string, number[]>();
globalThis.__requestExtractionReaderUsage = usage;

/**
 * Per-user cap on the calls that reach the external readers (sliding window, kept in this process: the application
 * runs as a single instance). Returns the 429 response to send, or null when the call may continue.
 */
export function limitReaderUsage(userId: string, now = Date.now()) {
  const recent = (usage.get(userId) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    usage.set(userId, recent);
    const retryAfter = Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now) / 1000));
    return Response.json({ error: { message: "Demasiadas consultas. Espera un momento e inténtalo de nuevo." } }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(retryAfter) } });
  }
  recent.push(now);
  usage.set(userId, recent);
  if (usage.size > 1000) for (const [key, timestamps] of usage) if (timestamps.every((timestamp) => now - timestamp >= WINDOW_MS)) usage.delete(key);
  return null;
}

export function resetReaderUsage() { usage.clear(); }
