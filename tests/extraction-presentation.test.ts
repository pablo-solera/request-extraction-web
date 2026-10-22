import { describe, expect, it } from "vitest";
import { pluralizeModels } from "@/lib/extractions/presentation";

describe("pluralizeModels", () => {
  it("uses the singular form for one model", () => {
    expect(pluralizeModels(1)).toBe("1 modelo");
  });

  it("uses the plural form for zero or several models", () => {
    expect(pluralizeModels(0)).toBe("0 modelos");
    expect(pluralizeModels(3)).toBe("3 modelos");
  });
});
