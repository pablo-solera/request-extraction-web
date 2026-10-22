import { describe, expect, it } from "vitest";
import { describeAvailability } from "@/lib/extractions/availability-messages";
import type { BmwTypekeyAvailability } from "@/lib/readers/bmw/types";

const unavailable = (overrides: Partial<BmwTypekeyAvailability> = {}): BmwTypekeyAvailability => ({ typekey: "6J02", status: "unavailable", code: "CGWATB0085", suggestedTypekey: null, ...overrides });

describe("typekey availability messages", () => {
  it("stays quiet for available typekeys and explains an unanswered check", () => {
    expect(describeAvailability({ typekey: "6J92", status: "available", suggestedTypekey: null })).toEqual({ kind: "available" });
    expect(describeAvailability({ typekey: "6J92", status: "unknown", suggestedTypekey: null })).toMatchObject({ kind: "unknown" });
  });

  it("reports an unavailable typekey with BMW's code and no base type", () => {
    expect(describeAvailability(unavailable())).toEqual({ kind: "unavailable", message: "No disponible en BMW Flat Rates (CGWATB0085)." });
  });

  it("offers the base type only when the reader found it reliable", () => {
    const notice = describeAvailability(unavailable({ suggestedTypekey: "6J93", baseType: { typekey: "6J93", status: "available", reliable: true, differences: [] } }));
    expect(notice).toMatchObject({ kind: "unavailable", suggestedTypekey: "6J93", baseTypeMessage: "El tipo base 6J93 está disponible y coincide en todas las características." });
  });

  it("lists the differences that make an available base type unsuitable and never suggests it", () => {
    const notice = describeAvailability(unavailable({ baseType: { typekey: "6J92", status: "available", reliable: false, differences: [
      { attribute: "transmission", requested: "AUT", baseType: "MECH" },
      { attribute: "validity", requested: "2015 – 2017", baseType: null },
    ] } }));
    expect(notice).toEqual({
      kind: "unavailable",
      message: "No disponible en BMW Flat Rates (CGWATB0085).",
      baseTypeMessage: "Tipo base 6J92 disponible, pero difiere en: cambio (automático → manual), periodo de fabricación (2015 – 2017 → sin dato). No se sugiere.",
    });
    expect(notice).not.toHaveProperty("suggestedTypekey");
  });

  it("explains when the base type is unavailable or could not be checked", () => {
    expect(describeAvailability(unavailable({ baseType: { typekey: "YM91", status: "unavailable", reliable: true, differences: [] } }))).toMatchObject({ baseTypeMessage: "El tipo base YM91 tampoco está disponible en BMW Flat Rates." });
    expect(describeAvailability(unavailable({ baseType: { typekey: "YM91", status: "unknown", reliable: false, differences: [] } }))).toMatchObject({ baseTypeMessage: "No se ha podido comprobar el tipo base YM91." });
  });
});
