import { describe, expect, it } from "vitest";
import { retryableItems, summarizeRequest } from "@/lib/extractions/request-summary";

const item = (status: "pending" | "running" | "completed" | "failed" | "cancelled", progress: number | null = null) => ({ status, progress });

describe("summarizeRequest", () => {
  it("reflects the approval state before looking at the items", () => {
    expect(summarizeRequest("pending", [item("pending")]).label).toBe("Pendiente de aprobación");
    expect(summarizeRequest("rejected", [item("failed")]).label).toBe("Rechazada");
  });

  it("is in progress while any item is unfinished and averages progress", () => {
    const summary = summarizeRequest("approved", [item("completed"), item("running", 50), item("pending", null), item("running", 25)]);
    expect(summary).toMatchObject({ status: "running", label: "En proceso", progress: 44, total: 4 });
    expect(summary.description).toBe("1 de 4 typekeys completados");
  });

  it("distinguishes completed, mixed, failed and cancelled outcomes", () => {
    expect(summarizeRequest("approved", [item("completed"), item("completed")]).label).toBe("Completada");
    expect(summarizeRequest("approved", [item("completed"), item("failed")]).label).toBe("Completada con incidencias");
    expect(summarizeRequest("approved", [item("completed"), item("cancelled")]).label).toBe("Completada con incidencias");
    expect(summarizeRequest("approved", [item("failed"), item("cancelled")]).label).toBe("Fallida");
    expect(summarizeRequest("approved", [item("failed"), item("failed")]).label).toBe("Fallida");
    expect(summarizeRequest("approved", [item("cancelled"), item("cancelled")]).label).toBe("Cancelada");
  });

  it("describes counts with correct plurals", () => {
    const mixed = summarizeRequest("approved", [item("completed"), item("completed"), item("completed"), item("failed"), item("completed")]);
    expect(mixed.description).toBe("4 de 5 typekeys completados · 1 fallido");
    expect(mixed.progress).toBe(80);
    expect(summarizeRequest("approved", [item("completed")]).description).toBe("1 de 1 typekey completado");
    expect(summarizeRequest("approved", [item("failed"), item("cancelled"), item("cancelled")], "familia").description).toBe("0 de 3 familias completadas · 1 fallida · 2 canceladas");
  });

  it("handles an empty item list and lists retryable items", () => {
    expect(summarizeRequest("approved", [])).toMatchObject({ progress: 0, total: 0 });
    expect(retryableItems([item("completed"), item("failed"), item("cancelled"), item("running")]).map((entry) => entry.status)).toEqual(["failed", "cancelled"]);
  });
});

describe("summarizeRequest nouns", () => {
  it("counts Mercedes-Benz requests in models", () => {
    expect(summarizeRequest("approved", [item("completed"), item("failed"), item("cancelled")], "modelo").description).toBe("1 de 3 modelos completados · 1 fallido · 1 cancelado");
    expect(summarizeRequest("approved", [item("completed")], "modelo").description).toBe("1 de 1 modelo completado");
    expect(summarizeRequest("approved", [item("completed"), item("failed")], "familia").description).toBe("1 de 2 familias completadas · 1 fallida");
  });
});
