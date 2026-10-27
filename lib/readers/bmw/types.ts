import { z } from "zod";

export const bmwBrandSchema = z.enum(["BMW", "MINI"]);

const modelOptionsSchema = z.object({
  filters: z.array(z.object({
    name: z.string(),
    values: z.array(z.object({ value: z.string(), label: z.string().optional() })),
  })),
  models: z.array(z.object({ id: z.string(), label: z.string(), attributes: z.record(z.string(), z.unknown()) })).optional(),
});

export const bmwCreateResponseSchema = z.object({ requestId: z.uuid(), status: z.string().optional() });

export const bmwLabourStateSchema = z.object({
  requestId: z.uuid(),
  status: z.enum(["queued", "running", "rate_limited", "paused", "cancelling", "cancelled", "completed", "failed"]),
  progress: z.number().int().min(0).max(100).nullable().optional(),
  stage: z.string().optional(),
  details: z.object({ stalled: z.boolean().optional() }).passthrough().optional(),
  // Once a typekey is being extracted the reader reports the day (YYYYMMDD) its data is stored under.
  request: z.object({ selection: z.object({ date: z.string().regex(/^\d{8}$/).optional() }).passthrough().optional() }).passthrough().optional(),
  error: z.object({ message: z.string() }).nullable().optional(),
});

const availabilityStatusSchema = z.enum(["available", "unavailable", "unknown"]);
export const bmwTypekeyAvailabilitySchema = z.object({
  typekey: z.string().regex(/^[A-Z0-9]{4}$/),
  status: availabilityStatusSchema,
  code: z.string().optional(),
  suggestedTypekey: z.string().regex(/^[A-Z0-9]{4}$/).nullable(),
  baseType: z.object({
    typekey: z.string().regex(/^[A-Z0-9]{4}$/),
    status: availabilityStatusSchema,
    reliable: z.boolean(),
    differences: z.array(z.object({ attribute: z.string(), requested: z.string().nullable(), baseType: z.string().nullable() })),
  }).optional(),
});

export const bmwLabourActionResponseSchema = z.object({ requestId: z.uuid(), status: z.string() });

export type BmwBrand = z.infer<typeof bmwBrandSchema>;
export type BmwLabourState = z.infer<typeof bmwLabourStateSchema>;
export type BmwTypekeyAvailability = z.infer<typeof bmwTypekeyAvailabilitySchema>;
export type BmwSeriesOption = { value: string; label: string };
export type BmwDevelopmentCodeOption = { value: string; label: string };
export type BmwTypekeyOption = { value: string; label: string; baseType?: string; validFrom?: string; validUntil?: string };

export function parseBmwSeriesOptions(value: unknown): BmwSeriesOption[] {
  const parsed = modelOptionsSchema.parse(value);
  const seriesFilter = parsed.filters.find((filter) => filter.name.toLowerCase() === "modelseries");
  if (!seriesFilter) throw new Error("BMW no devolvió la lista de series.");
  return seriesFilter.values
    .filter((option) => option.value.length > 0)
    .map((option) => ({ value: option.value, label: option.label || option.value }));
}

export function parseBmwDevelopmentCodes(value: unknown): BmwDevelopmentCodeOption[] {
  const parsed = modelOptionsSchema.parse(value);
  const filter = parsed.filters.find((item) => item.name.toLowerCase() === "developmentcode");
  if (!filter) return [];
  return filter.values
    .filter((option) => /^[A-Z0-9]+$/.test(option.value))
    .map((option) => ({ value: option.value, label: option.label || option.value }));
}

function utcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function parseBmwValidityDate(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value.replace(/\[UTC\]$/, ""));
  return Number.isFinite(timestamp) ? utcDay(new Date(timestamp)) : null;
}

function displayedDate(day: number) {
  const value = new Date(day);
  return `${String(value.getUTCDate()).padStart(2, "0")}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${value.getUTCFullYear()}`;
}

export function parseBmwTypekeys(value: unknown): BmwTypekeyOption[] {
  const parsed = modelOptionsSchema.parse(value);
  return (parsed.models ?? []).flatMap((model) => {
    if (!/^[A-Z0-9]{4}$/.test(model.id)) return [];
    const validFrom = parseBmwValidityDate(model.attributes.validFrom);
    const validUntil = parseBmwValidityDate(model.attributes.validUntil);

    const details = [model.id];
    const capacity = model.attributes.capacity;
    const capacityUnit = model.attributes.capacityUnit;
    if (typeof capacity === "string" && Number(capacity) > 0) details.push(`${capacity.replace(".", ",")} ${typeof capacityUnit === "string" ? capacityUnit : ""}`.trim());
    const power = model.attributes.power;
    const powerUnit = model.attributes.powerUnit;
    const displayedPowerUnit = typeof powerUnit === "string" && powerUnit.toLowerCase() === "kw" ? "kW" : powerUnit;
    if (typeof power === "string" && Number(power) > 0) details.push(`${power} ${typeof displayedPowerUnit === "string" ? displayedPowerUnit : ""}`.trim());
    if (validFrom !== undefined && validFrom !== null && validUntil !== undefined && validUntil !== null) details.push(`${displayedDate(validFrom)}–${displayedDate(validUntil)}`);
    else if (validFrom !== undefined && validFrom !== null) details.push(`desde ${displayedDate(validFrom)}`);
    else if (validUntil !== undefined && validUntil !== null) details.push(`hasta ${displayedDate(validUntil)}`);

    const rawBaseType = model.attributes.baseType;
    const baseType = typeof rawBaseType === "string" && /^[A-Z0-9]{4}$/.test(rawBaseType) && rawBaseType !== model.id ? rawBaseType : undefined;
    if (baseType) details.push(`tipo base ${baseType}`);

    return [{
      value: model.id,
      label: details.join(" · "),
      ...(baseType ? { baseType } : {}),
      ...(validFrom !== undefined && validFrom !== null ? { validFrom: displayedDate(validFrom) } : {}),
      ...(validUntil !== undefined && validUntil !== null ? { validUntil: displayedDate(validUntil) } : {}),
    }];
  });
}
