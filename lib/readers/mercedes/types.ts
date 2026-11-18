import { z } from "zod";

export const MERCEDES_MANUFACTURER = "Mercedes-Benz";

const modelOptionsSchema = z.object({
  filters: z.array(z.object({
    name: z.string(),
    values: z.array(z.object({ value: z.string(), label: z.string().optional() })),
  })),
  models: z.array(z.object({ id: z.string(), label: z.string(), attributes: z.record(z.string(), z.unknown()).optional() })).optional(),
});

export const mercedesCreateResponseSchema = z.object({ requestId: z.uuid(), status: z.string().optional() });

export const mercedesLabourStateSchema = z.object({
  requestId: z.uuid(),
  status: z.enum(["queued", "running", "rate_limited", "paused", "cancelling", "cancelled", "completed", "failed"]),
  progress: z.number().int().min(0).max(100).nullable().optional(),
  stage: z.string().optional(),
  details: z.object({ stalled: z.boolean().optional() }).passthrough().optional(),
  // The reader reports the day (YYYYMMDD) its data is stored under; the transformer needs exactly that day.
  request: z.object({ selection: z.object({ date: z.string().regex(/^\d{8}$/).optional() }).passthrough().optional() }).passthrough().optional(),
  error: z.object({ message: z.string() }).nullable().optional(),
});

export const mercedesLabourActionResponseSchema = z.object({ requestId: z.uuid(), status: z.string() });

export type MercedesLabourState = z.infer<typeof mercedesLabourStateSchema>;
export type MercedesOption = { value: string; label: string };
export type MercedesModelOption = MercedesOption & { productGroup: string | null };
export type MercedesModelOptions = { productGroups: MercedesOption[]; models: MercedesModelOption[] };

function filterValues(parsed: z.infer<typeof modelOptionsSchema>, name: string): MercedesOption[] {
  const filter = parsed.filters.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return (filter?.values ?? []).filter((option) => option.value.length > 0).map((option) => ({ value: option.value, label: option.label || option.value }));
}

export function parseMercedesSeriesOptions(value: unknown): MercedesOption[] {
  const parsed = modelOptionsSchema.parse(value);
  if (!parsed.filters.some((filter) => filter.name.toLowerCase() === "series")) throw new Error("Mercedes no devolvió la lista de series.");
  return filterValues(parsed, "series");
}

/** One option per `modelDesignation`; the reader groups every `mdcId` of a designation into a single model. */
export function parseMercedesModelOptions(value: unknown): MercedesModelOptions {
  const parsed = modelOptionsSchema.parse(value);
  const seen = new Set<string>();
  const models = (parsed.models ?? []).flatMap((model) => {
    const designation = model.attributes?.modelDesignation;
    const modelDesignation = typeof designation === "string" && designation.trim() ? designation.trim() : null;
    if (!modelDesignation || seen.has(modelDesignation)) return [];
    seen.add(modelDesignation);
    const group = model.attributes?.productGroup;
    return [{ value: modelDesignation, label: model.label || modelDesignation, productGroup: typeof group === "string" && group ? group : null }];
  });
  return { productGroups: filterValues(parsed, "productGroup"), models };
}
