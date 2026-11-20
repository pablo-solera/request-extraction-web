import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCachedJson, loadCachedJson } from "@/lib/client/cached-json";

beforeEach(() => clearCachedJson());
afterEach(() => vi.unstubAllGlobals());

describe("loadCachedJson", () => {
  it("serves a repeated successful request from memory", async () => {
    const fetchMock = vi.fn(async () => Response.json({ options: [{ value: "a", label: "A" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { signal } = new AbortController();

    const first = await loadCachedJson("/api/readers/bmw/series?brand=BMW", signal);
    const second = await loadCachedJson("/api/readers/bmw/series?brand=BMW", signal);

    expect(first.body).toEqual(second.body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures or bodies the caller rejects", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "down" } }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ options: "bad" }))
      .mockResolvedValue(Response.json({ options: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { signal } = new AbortController();
    const accept = (body: unknown) => Array.isArray((body as { options?: unknown }).options);

    expect((await loadCachedJson("/x", signal, accept)).ok).toBe(false);
    expect((await loadCachedJson("/x", signal, accept)).body).toEqual({ options: "bad" });
    expect((await loadCachedJson("/x", signal, accept)).body).toEqual({ options: [] });
    await loadCachedJson("/x", signal, accept);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
