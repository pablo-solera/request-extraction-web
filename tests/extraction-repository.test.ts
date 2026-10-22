import { beforeEach, describe, expect, it, vi } from "vitest";

const { returning, set, update, where, database } = vi.hoisted(() => {
  const returning = vi.fn();
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const database = { update, transaction: vi.fn() };
  return { returning, set, update, where, database };
});

vi.mock("@/db", () => ({ getDb: () => database }));
vi.mock("@/lib/readers/renault/client", () => ({ getRenaultSettings: () => ({ format: "TM01", language: "es", range: "active" }), getRenaultReaderCapabilities: vi.fn(async () => null) }));

import { claimExtractionSubmission, claimReaderProgressPoll, insertExtractionsWithCapacity } from "@/lib/extractions/repository";

describe("claimExtractionSubmission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the claimed row when this caller wins the conditional update", async () => {
    const row = { id: "extraction-1", status: "pending", remoteRequestId: null };
    returning.mockResolvedValueOnce([row]);

    await expect(claimExtractionSubmission("extraction-1")).resolves.toEqual(row);
    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ submittedAt: expect.any(Date) }));
  });

  it("returns null when another request already claimed or changed the row", async () => {
    returning.mockResolvedValueOnce([]);

    await expect(claimExtractionSubmission("extraction-1")).resolves.toBeNull();
  });
});

describe("claimReaderProgressPoll", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomically claims a progress poll and stamps the per-extraction throttle", async () => {
    const row = { id: "extraction-1", readerPolledAt: new Date() };
    returning.mockResolvedValueOnce([row]);

    await expect(claimReaderProgressPoll("extraction-1", new Date("2026-10-20T12:00:00.000Z"))).resolves.toEqual(row);
    expect(set).toHaveBeenCalledWith({ readerPolledAt: expect.any(Date) });
    expect(where).toHaveBeenCalledOnce();
  });
});

describe("insertExtractionsWithCapacity reader persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists BMW series, development code, typekey and development-start metadata without Renault settings", async () => {
    let insertedRows: Array<Record<string, unknown>> = [];
    const transaction = {
      execute: vi.fn(),
      select: () => ({ from: () => ({ where: async () => [{ active: 0 }] }) }),
      insert: () => ({ values: (value: unknown) => {
        if (Array.isArray(value)) {
          insertedRows = value as Array<Record<string, unknown>>;
          return { returning: async () => insertedRows };
        }
        return Promise.resolve(value);
      } }),
    };
    database.transaction.mockImplementationOnce(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction));

    await insertExtractionsWithCapacity("user-1", {
      axCode: "AX_123",
      imcEdition: "05/0",
      completion: "2026-03-14",
      comments: "",
      laboursDevelopmentStart: "2026-03-14",
      vehicles: [{ manufacturerGroup: "BMW", brand: "MINI", series: "F56", developmentCode: "F56", typekey: "11EH", modelDescription: "Cooper S" }],
    }, 50, { status: "approved", coordinatorId: null });

    expect(insertedRows[0]).toMatchObject({
      manufacturerGroup: "BMW",
      brand: "MINI",
      modelCode: "11EH",
      modelDescription: "Cooper S · F56 / F56",
      readerKey: "bmw-labours",
      imcEdition: "05/0",
      completion: "2026-03-14",
      readerParams: { series: "F56", developmentCode: "F56", typekey: "11EH", developmentStart: "2026-03-14" },
    });
    expect(transaction.execute).toHaveBeenCalledOnce();
  });

  it("stores Renault start date as request metadata rather than a reader filter and allows several families for one brand", async () => {
    let insertedRows: Array<Record<string, unknown>> = [];
    const transaction = {
      execute: vi.fn(),
      select: () => ({ from: () => ({ where: async () => [{ active: 0 }] }) }),
      insert: () => ({ values: (value: unknown) => {
        if (Array.isArray(value)) {
          insertedRows = value as Array<Record<string, unknown>>;
          return { returning: async () => insertedRows };
        }
        return Promise.resolve(value);
      } }),
    };
    database.transaction.mockImplementationOnce(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction));

    await insertExtractionsWithCapacity("user-1", {
      axCode: "AX_123",
      imcEdition: "05/0",
      completion: "2026-03-14",
      comments: "",
      laboursDevelopmentStart: "2026-03-01",
      vehicles: [
        { manufacturerGroup: "Renault", brand: "Dacia", modelDescription: "Sandero", modelCode: "B52" },
        { manufacturerGroup: "Renault", brand: "Dacia", modelDescription: "Duster", modelCode: "HJD" },
      ],
    }, 50, { status: "approved", coordinatorId: null });

    expect(insertedRows).toHaveLength(2);
    expect(insertedRows.map((row) => row.brand)).toEqual(["Dacia", "Dacia"]);
    expect(insertedRows[0]?.readerParams).toMatchObject({ family: "B52", developmentStart: "2026-03-01" });
    expect(insertedRows[0]?.readerParams).not.toHaveProperty("publishedAfter");
  });
});
