import { describe, expect, it } from "vitest";
import { formatSpanishDate, formatSpanishDateTime } from "@/lib/date-format";

describe("Spanish date formatting", () => {
  it("formats native date values as DD/MM/YYYY without timezone drift", () => {
    expect(formatSpanishDate("2026-03-14")).toBe("14/03/2026");
  });

  it("formats timestamps with Spanish numeric dates and 24-hour time", () => {
    expect(formatSpanishDateTime("2026-10-20T12:30:00.000Z")).toBe("20/10/2026, 14:30");
  });
});
