import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { returning, set, update, where, database, loaded } = vi.hoisted(() => {
  const returning = vi.fn();
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const loaded = vi.fn(async (): Promise<unknown[]> => []);
  const select = vi.fn(() => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: loaded }) }) }) }));
  const database = { update, select, transaction: vi.fn() };
  return { returning, set, update, where, database, loaded };
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
    loaded.mockResolvedValueOnce([{ ...row, axCode: "AX_1" }]);

    await expect(claimExtractionSubmission("extraction-1")).resolves.toEqual({ ...row, axCode: "AX_1" });
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
    loaded.mockResolvedValueOnce([row]);

    await expect(claimReaderProgressPoll("extraction-1", new Date("2026-10-20T12:00:00.000Z"))).resolves.toEqual(row);
    expect(set).toHaveBeenCalledWith({ readerPolledAt: expect.any(Date) });
    expect(where).toHaveBeenCalledOnce();
  });
});

describe("insertExtractionsWithCapacity reader persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists BMW series, development code, typekey and development-start metadata without Renault settings", async () => {
    let insertedRows: Array<Record<string, unknown>> = [];
    let requestValues: Record<string, unknown> = {};
    const transaction = {
      execute: vi.fn(),
      select: () => ({ from: () => ({ where: async () => [{ active: 0 }] }) }),
      insert: () => ({ values: (value: unknown) => {
        if (Array.isArray(value)) {
          insertedRows = value as Array<Record<string, unknown>>;
          return { returning: async () => insertedRows };
        }
        requestValues = value as Record<string, unknown>;
        return Promise.resolve(value);
      } }),
    };
    database.transaction.mockImplementationOnce(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction));

    await insertExtractionsWithCapacity("user-1", {
      axCode: "AX12",
      imcEdition: "05/0",
      completion: "2026-03-14",
      comments: "",
      laboursDevelopmentStart: "2026-03-14",
      vehicles: [{ manufacturerGroup: "BMW", brand: "MINI", series: "F56", developmentCode: "F56", typekey: "11EH", modelDescription: "Cooper S" }],
    }, 50, { status: "approved", coordinatorId: null });

    expect(requestValues).toMatchObject({ manufacturerGroup: "BMW", brand: "MINI", axCode: "AX12", imcEdition: "05/0", completion: "2026-03-14", developmentStart: "2026-03-14", comments: null });
    expect(insertedRows[0]).toMatchObject({
      modelCode: "11EH",
      modelDescription: "Cooper S · F56 / F56",
      readerKey: "bmw-labours",
      readerParams: { series: "F56", developmentCode: "F56", typekey: "11EH" },
    });
    expect(transaction.execute).toHaveBeenCalledOnce();
    const lock = new PgDialect().sqlToQuery(transaction.execute.mock.calls[0][0] as SQL);
    expect(lock.sql).toContain("pg_advisory_xact_lock(hashtextextended($1, 0))");
    expect(lock.params).toEqual(["user-1"]);
  });

  it("stores Renault start date as request metadata rather than a reader filter and allows several families for one brand", async () => {
    let insertedRows: Array<Record<string, unknown>> = [];
    let requestValues: Record<string, unknown> = {};
    const transaction = {
      execute: vi.fn(),
      select: () => ({ from: () => ({ where: async () => [{ active: 0 }] }) }),
      insert: () => ({ values: (value: unknown) => {
        if (Array.isArray(value)) {
          insertedRows = value as Array<Record<string, unknown>>;
          return { returning: async () => insertedRows };
        }
        requestValues = value as Record<string, unknown>;
        return Promise.resolve(value);
      } }),
    };
    database.transaction.mockImplementationOnce(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction));

    await insertExtractionsWithCapacity("user-1", {
      axCode: "AX12",
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
    expect(requestValues).toMatchObject({ brand: "Dacia", developmentStart: "2026-03-01" });
    expect(insertedRows[0]?.readerParams).toMatchObject({ family: "B52" });
    expect(insertedRows[0]?.readerParams).not.toHaveProperty("developmentStart");
    expect(insertedRows[0]?.readerParams).not.toHaveProperty("publishedAfter");
  });

  it("stores one Mercedes-Benz extraction per model with the series and a single UTC date for the whole request", async () => {
    let insertedRows: Array<Record<string, unknown>> = [];
    let requestValues: Record<string, unknown> = {};
    const transaction = {
      execute: vi.fn(),
      select: () => ({ from: () => ({ where: async () => [{ active: 0 }] }) }),
      insert: () => ({ values: (value: unknown) => {
        if (Array.isArray(value)) {
          insertedRows = value as Array<Record<string, unknown>>;
          return { returning: async () => insertedRows };
        }
        requestValues = value as Record<string, unknown>;
        return Promise.resolve(value);
      } }),
    };
    database.transaction.mockImplementationOnce(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T23:59:59Z"));
    try {
      await insertExtractionsWithCapacity("user-1", {
        axCode: "3F6", imcEdition: "04/0", completion: "2026-03-14", comments: "", laboursDevelopmentStart: "2026-03-01",
        vehicles: [
          { manufacturerGroup: "Mercedes", brand: "Mercedes-Benz", series: "GLB 248", modelCode: "248642", modelDescription: "248642 GLB 200" },
          { manufacturerGroup: "Mercedes", brand: "Mercedes-Benz", series: "GLB 248", modelCode: "248644", modelDescription: "" },
        ],
      }, 50, { status: "approved", coordinatorId: null });
    } finally {
      vi.useRealTimers();
    }

    expect(requestValues).toMatchObject({ manufacturerGroup: "Mercedes", brand: "Mercedes-Benz", imcEdition: "04/0" });
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0]).toMatchObject({ modelCode: "248642", modelDescription: "248642 GLB 200 · GLB 248", readerKey: "mercedes-labours", readerParams: { series: "GLB 248", date: "20261118" } });
    expect(insertedRows[1]).toMatchObject({ modelCode: "248644", modelDescription: "GLB 248", readerParams: { series: "GLB 248", date: "20261118" } });
  });
});
