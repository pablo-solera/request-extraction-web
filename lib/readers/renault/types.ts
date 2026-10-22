import { z } from "zod";

export const renaultOptionsSchema = z.object({
  queryCode: z.string(),
  range: z.string(),
  families: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      brand: z.string().optional(),
    }),
  ),
  formats: z.array(z.string()),
  languages: z.array(z.string()).nullable(),
});

export const renaultCreateResponseSchema = z.object({
  requestId: z.uuid(),
  status: z.string(),
});

export const renaultStateSchema = z.object({
  requestId: z.uuid(),
  status: z.string(),
  stage: z.string().optional(),
  progress: z.number().int().min(0).max(100).nullable().optional(),
  details: z.object({ stalled: z.boolean().optional() }).passthrough().optional(),
  error: z.union([z.string(), z.object({ message: z.string() })]).nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type RenaultState = z.infer<typeof renaultStateSchema>;
