import { z } from "zod";

export const transformerStatusSchema = z.enum(["queued", "resolving", "importing", "pivoting", "persisting", "parsing-dda", "reporting", "completed", "failed"]);

export const transformerStateSchema = z.object({
  requestId: z.uuid(),
  status: transformerStatusSchema,
  stage: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  error: z.string().optional(),
  pivotKey: z.string().optional(),
  reportKey: z.string().optional(),
  summary: z.record(z.string(), z.unknown()).optional(),
});

export const transformerEnqueuedSchema = z.object({ requestId: z.uuid(), reused: z.boolean().optional() });

export type TransformerState = z.infer<typeof transformerStateSchema>;

export type TransformerLoadInput = {
  axCode: string;
  imcEdition: string;
  brand: "BMW" | "MINI";
  typekeys: Array<{ typekey: string; series: string; family: string }>;
};
