import { beforeEach, describe, expect, it, vi } from "vitest";

const { returning, set, database, loaded } = vi.hoisted(() => {
  const returning = vi.fn();
  const set = vi.fn(() => ({ where: () => ({ returning }) }));
  const loaded = vi.fn(async (): Promise<unknown[]> => [{ id: "e1" }]);
  const database = { update: vi.fn(() => ({ set })), select: vi.fn(() => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: loaded }) }) }) })) };
  return { returning, set, database, loaded };
});

vi.mock("@/db", () => ({ getDb: () => database }));
vi.mock("@/lib/readers/renault/client", () => ({ getRenaultSettings: vi.fn(), getRenaultReaderCapabilities: vi.fn() }));

import { updateExtractionState } from "@/lib/extractions/repository";

describe("updateExtractionState progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    returning.mockResolvedValue([{ id: "e1" }]);
    loaded.mockResolvedValue([{ id: "e1" }]);
  });

  it("only raises the stored progress while the extraction is active", async () => {
    await updateExtractionState("e1", { status: "running", progress: 0, readerStatus: "running" });
    const update = (set.mock.calls[0] as unknown[])[0] as { progress: unknown };
    expect(typeof update.progress).toBe("object");
  });

  it("writes the final value as is for terminal states and leaves progress alone when none is given", async () => {
    await updateExtractionState("e1", { status: "completed", progress: 100 });
    expect(((set.mock.calls[0] as unknown[])[0] as { progress: unknown }).progress).toBe(100);
    await updateExtractionState("e1", { status: "running" });
    expect(((set.mock.calls[1] as unknown[])[0] as Record<string, unknown>)).not.toHaveProperty("progress");
  });
});
