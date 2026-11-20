import { describe, expect, it } from "vitest";
import { requestCursorSchema } from "@/lib/extractions/cursor";

const requestGroupId = "550e8400-e29b-41d4-a716-446655440000";

describe("requestCursorSchema", () => {
  it("accepts the timestamps Postgres casts to text, with microseconds and offset", () => {
    expect(requestCursorSchema.safeParse({ createdAt: "2026-10-20 12:00:00.123456+00", requestGroupId }).success).toBe(true);
    expect(requestCursorSchema.safeParse({ createdAt: "2026-10-20T12:00:00Z", requestGroupId }).success).toBe(true);
  });

  it("rejects anything that is not a timestamp or a request id", () => {
    expect(requestCursorSchema.safeParse({ createdAt: "now(); drop table", requestGroupId }).success).toBe(false);
    expect(requestCursorSchema.safeParse({ createdAt: "2026-10-20 12:00:00+00", requestGroupId: "x" }).success).toBe(false);
  });
});
