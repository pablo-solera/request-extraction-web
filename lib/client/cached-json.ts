const TTL_MS = 5 * 60_000;
const entries = new Map<string, { expires: number; body: unknown }>();

export type CachedJson = { ok: boolean; status: number; body: unknown };

export function clearCachedJson() {
  entries.clear();
}

export async function loadCachedJson(url: string, signal: AbortSignal, accept: (body: unknown) => boolean = () => true): Promise<CachedJson> {
  const hit = entries.get(url);
  if (hit && hit.expires > Date.now()) return { ok: true, status: 200, body: hit.body };
  const response = await fetch(url, { cache: "no-store", signal });
  const body: unknown = await response.json();
  if (response.ok && accept(body)) entries.set(url, { expires: Date.now() + TTL_MS, body });
  return { ok: response.ok, status: response.status, body };
}
