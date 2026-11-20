import { describe, expect, it } from "vitest";
import { describeError } from "@/lib/logging/describe-error";

describe("describeError", () => {
  it("keeps only the name and code, never the message or stack", () => {
    const error = Object.assign(new Error("password authentication failed for user admin"), { name: "DatabaseError", code: "28P01" });

    expect(describeError(error)).toEqual({ name: "DatabaseError", code: "28P01" });
  });

  it("handles values that are not errors", () => {
    expect(describeError("boom")).toEqual({ name: "string" });
    expect(describeError(null)).toEqual({ name: "object" });
  });
});
