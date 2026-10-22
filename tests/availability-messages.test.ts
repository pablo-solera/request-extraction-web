import { describe, expect, it } from "vitest";
import { describeAvailability, describeSwapOffer } from "@/lib/extractions/availability-messages";
import type { BmwTypekeyAvailability } from "@/lib/readers/bmw/types";

const unavailable = (overrides: Partial<BmwTypekeyAvailability> = {}): BmwTypekeyAvailability => ({ typekey: "6J02", status: "unavailable", code: "CGWATB0085", suggestedTypekey: null, ...overrides });

describe("typekey availability messages", () => {
  it("stays quiet for available typekeys and explains an unanswered check", () => {
    expect(describeAvailability({ typekey: "6J92", status: "available", suggestedTypekey: null })).toEqual({ kind: "available" });
    expect(describeAvailability({ typekey: "6J92", status: "unknown", suggestedTypekey: null })).toMatchObject({ kind: "unknown" });
  });

  it("reports an unavailable typekey with BMW's code and no base type", () => {
    expect(describeAvailability(unavailable())).toEqual({ kind: "unavailable", message: "No disponible en BMW Flat Rates (CGWATB0085).", baseTypeMessage: "No tiene un tipo base con datos que pueda sustituirlo." });
  });

  it("offers the base type only when the reader found it reliable", () => {
    const notice = describeAvailability(unavailable({ suggestedTypekey: "6J93", baseType: { typekey: "6J93", status: "available", reliable: true, differences: [] } }));
    expect(notice).toMatchObject({ kind: "unavailable", suggestedTypekey: "6J93", baseTypeMessage: "El tipo base 6J93 está disponible y coincide en todas las características." });
  });

  it("offers an available base type that differs and lists what changes, leaving the choice to the technician", () => {
    const availability = unavailable({ baseType: { typekey: "6J92", status: "available", reliable: false, differences: [
      { attribute: "transmission", requested: "AUT", baseType: "MECH" },
      { attribute: "validity", requested: "2015 – 2017", baseType: null },
    ] } });
    expect(describeAvailability(availability)).toEqual({
      kind: "unavailable",
      message: "No disponible en BMW Flat Rates (CGWATB0085).",
      baseTypeMessage: "El tipo base 6J92 está disponible pero difiere en: cambio (automático → manual), periodo de fabricación (2015 – 2017 → sin dato).",
      suggestedTypekey: "6J92",
    });
    expect(describeSwapOffer(availability)).toEqual({ kind: "swap", baseTypekey: "6J92", identical: false, differences: ["cambio (automático → manual)", "periodo de fabricación (2015 – 2017 → sin dato)"] });
  });

  it("describes swap offers for identical, unavailable, unchecked and missing base types", () => {
    expect(describeSwapOffer(unavailable({ baseType: { typekey: "6J93", status: "available", reliable: true, differences: [] } }))).toEqual({ kind: "swap", baseTypekey: "6J93", identical: true, differences: [] });
    expect(describeSwapOffer(unavailable({ baseType: { typekey: "YM91", status: "unavailable", reliable: true, differences: [] } }))).toEqual({ kind: "none", reason: "su tipo base YM91 tampoco tiene datos en BMW" });
    expect(describeSwapOffer(unavailable({ baseType: { typekey: "YM91", status: "unknown", reliable: false, differences: [] } }))).toEqual({ kind: "none", reason: "no se ha podido comprobar su tipo base YM91" });
    expect(describeSwapOffer(unavailable())).toEqual({ kind: "none", reason: "no tiene un tipo base con datos que pueda sustituirlo" });
    expect(describeAvailability(unavailable({ baseType: { typekey: "YM91", status: "unavailable", reliable: true, differences: [] } }))).toMatchObject({ baseTypeMessage: "Su tipo base YM91 tampoco tiene datos en BMW." });
  });
});
