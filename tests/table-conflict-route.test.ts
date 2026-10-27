// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireApiIdentity: vi.fn(), findTableConflict: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireApiIdentity: mocks.requireApiIdentity }));
vi.mock("@/lib/transformer/service", () => ({ findTableConflict: mocks.findTableConflict }));

import { GET } from "@/app/api/extractions/table-conflict/route";

const url = (query: string) => new Request(`http://localhost/api/extractions/table-conflict?${query}`);

describe("table conflict route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiIdentity.mockResolvedValue({ id: "u1" });
  });

  it("requires a session and valid parameters", async () => {
    mocks.requireApiIdentity.mockResolvedValueOnce(null);
    expect((await GET(url("axCode=1AF&imcEdition=01/0&brand=MINI"))).status).toBe(401);
    for (const query of ["", "axCode=1AF&imcEdition=1/0&brand=MINI", "axCode=toolong&imcEdition=01/0&brand=MINI", "axCode=1AF&imcEdition=01/0&brand=AUDI"]) {
      expect((await GET(url(query))).status).toBe(400);
    }
    expect(mocks.findTableConflict).not.toHaveBeenCalled();
  });

  it("reports whether a table is already loaded for the AX code, edition and brand", async () => {
    mocks.findTableConflict.mockResolvedValueOnce({ loadedAt: "2026-10-26T14:21:00.000Z", loadStatus: "completed" });
    const found = await GET(url("axCode=1AF&imcEdition=01/0&brand=MINI"));
    expect(await found.json()).toEqual({ conflict: true, loadedAt: "2026-10-26T14:21:00.000Z" });
    expect(mocks.findTableConflict).toHaveBeenCalledWith({ axCode: "1AF", imcEdition: "01/0", brand: "MINI" });
    expect(found.headers.get("cache-control")).toContain("no-store");

    mocks.findTableConflict.mockResolvedValueOnce(null);
    expect(await (await GET(url("axCode=1AF&imcEdition=01/0&brand=BMW"))).json()).toEqual({ conflict: false, loadedAt: null });
  });

  it("answers 503 when the lookup fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.findTableConflict.mockRejectedValueOnce(new Error("db down"));
    expect((await GET(url("axCode=1AF&imcEdition=01/0&brand=MINI"))).status).toBe(503);
    log.mockRestore();
  });
});
