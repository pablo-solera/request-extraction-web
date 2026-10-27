// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reconcileActiveExtractions: vi.fn(), reconcileTransformer: vi.fn() }));
vi.mock("@/lib/extractions/service", () => ({ reconcileActiveExtractions: mocks.reconcileActiveExtractions }));
vi.mock("@/lib/transformer/service", () => ({ reconcileTransformer: mocks.reconcileTransformer }));

import { POST } from "@/app/api/internal/reconcile/route";

const secret = "s".repeat(40);
const call = (token = secret) => POST(new Request("http://localhost/api/internal/reconcile", { method: "POST", headers: { authorization: `Bearer ${token}` } }));

describe("reconcile route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RECONCILE_SECRET", secret);
    mocks.reconcileActiveExtractions.mockResolvedValue(3);
    mocks.reconcileTransformer.mockResolvedValue({ started: 1, updated: 2 });
  });

  it("rejects a wrong or missing secret without reconciling", async () => {
    expect((await call("x".repeat(40))).status).toBe(401);
    expect(mocks.reconcileActiveExtractions).not.toHaveBeenCalled();
  });

  it("runs both steps and reports their results", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synchronized: 3, transformer: { started: 1, updated: 2 } });
  });

  it("still follows loads and comparisons when the extraction step fails, and reports the failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.reconcileActiveExtractions.mockRejectedValueOnce(new Error("Renault down"));
    const response = await call();
    expect(response.status).toBe(503);
    expect(mocks.reconcileTransformer).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ error: { code: "RECONCILIATION_FAILED" }, transformer: { started: 1, updated: 2 } });
    log.mockRestore();
  });

  it("keeps extractions reconciled when the transformer step fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.reconcileTransformer.mockRejectedValueOnce(new Error("transformer down"));
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synchronized: 3, transformer: { started: 0, updated: 0, failed: true } });
    log.mockRestore();
  });
});
