import { describe, expect, it } from "vitest";
import { mapReaderStatus } from "@/lib/extractions/service";
import { mapBmwReaderStatus } from "@/lib/readers/registry";

function state(status: string) {
  return { requestId: "7be5f2af-879b-4c61-84d5-6e728f438a02", status };
}

describe("mapReaderStatus", () => {
  it("keeps terminal states", () => {
    expect(mapReaderStatus(state("completed"))).toBe("completed");
    expect(mapReaderStatus(state("failed"))).toBe("failed");
  });

  it("maps reader progress states to a stable running state", () => {
    expect(mapReaderStatus(state("authenticating"))).toBe("running");
    expect(mapReaderStatus(state("waiting"))).toBe("running");
    expect(mapReaderStatus(state("uploading"))).toBe("running");
    expect(mapReaderStatus(state("queued"))).toBe("running");
  });

  it("rejects unknown reader states", () => {
    expect(() => mapReaderStatus(state("expired"))).toThrow("estado desconocido");
  });
});

describe("mapBmwReaderStatus", () => {
  it.each([
    ["queued", "pending"],
    ["running", "running"],
    ["rate_limited", "running"],
    ["paused", "running"],
    ["cancelling", "running"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
  ] as const)("maps BMW status %s to %s", (status, expected) => {
    expect(mapBmwReaderStatus({ requestId: "7be5f2af-879b-4c61-84d5-6e728f438a02", status })).toBe(expected);
  });
});
