import { describe, expect, it } from "vitest";
import { extractionFormSchema } from "@/lib/extractions/validation";

const validInput = {
  axCode: "AX-100",
  imcEdition: "05/0",
  completion: "2026-03-14",
  laboursDevelopmentStart: "2026-03-01",
  comments: "",
  vehicles: [{ manufacturerGroup: "Renault" as const, brand: "Renault", modelDescription: "Clio", modelCode: "X98" }],
};

describe("extractionFormSchema", () => {
  it("accepts an extraction with all common dates", () => {
    expect(extractionFormSchema.safeParse(validInput).success).toBe(true);
  });

  it("requires all common identifiers and dates", () => {
    expect(extractionFormSchema.safeParse({ ...validInput, axCode: "" }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, imcEdition: "" }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, completion: "" }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, laboursDevelopmentStart: "" }).success).toBe(false);
  });

  it("requires a real completion date in the native date field's ISO value format", () => {
    expect(extractionFormSchema.safeParse({ ...validInput, completion: "" }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, completion: "2026-02-30" }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, completion: "14/03/2026" }).success).toBe(false);
  });

  it("validates BMW manufacturer, series, development code and typekey", () => {
    const bmwInput = {
      ...validInput,
      axCode: "AX_100",
      vehicles: [{ manufacturerGroup: "BMW" as const, brand: "BMW" as const, series: "7", developmentCode: "G70", typekey: "11EH", modelDescription: "740i" }],
    };
    expect(extractionFormSchema.safeParse(bmwInput).success).toBe(true);
    expect(extractionFormSchema.safeParse({ ...bmwInput, vehicles: [{ ...bmwInput.vehicles[0], brand: "BMW i" }] }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...bmwInput, axCode: "AX-100" }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...bmwInput, vehicles: [{ ...bmwInput.vehicles[0], typekey: "11E" }] }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...bmwInput, vehicles: [{ ...bmwInput.vehicles[0], developmentCode: "g70" }] }).success).toBe(false);
  });

  it("rejects mixed reader groups, repeated BMW typekeys and invalid common fields", () => {
    const bmwVehicle = { manufacturerGroup: "BMW" as const, brand: "BMW" as const, series: "7", developmentCode: "G70", typekey: "11EH", modelDescription: "" };
    expect(extractionFormSchema.safeParse({ ...validInput, vehicles: [validInput.vehicles[0], bmwVehicle] }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, vehicles: [bmwVehicle, bmwVehicle] }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, vehicles: [bmwVehicle, { ...bmwVehicle, brand: "MINI" as const }] }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, vehicles: [validInput.vehicles[0], { ...validInput.vehicles[0], brand: "Dacia" as const }] }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, vehicles: [validInput.vehicles[0], { ...validInput.vehicles[0], modelCode: "X99" }] }).success).toBe(true);
    expect(extractionFormSchema.safeParse({ ...validInput, imcEdition: "2026.1" }).success).toBe(false);
    expect(extractionFormSchema.safeParse({ ...validInput, imcEdition: "5/0" }).success).toBe(false);
  });

  it("rejects invalid dates", () => {
    expect(
      extractionFormSchema.safeParse({ ...validInput, laboursDevelopmentStart: "27/07/2026" }).success,
    ).toBe(false);
    expect(
      extractionFormSchema.safeParse({ ...validInput, laboursDevelopmentStart: "2026-02-29" }).success,
    ).toBe(false);
  });
});
