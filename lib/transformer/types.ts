import { z } from "zod";

const errorSchema = z.union([
  z.object({ code: z.string().optional(), message: z.string() }),
  z.string().transform((message) => ({ code: undefined, message })),
]);

export const transformerStateSchema = z.object({
  requestId: z.string().min(1),
  resource: z.string().optional(),
  status: z.string().min(1),
  stage: z.string().optional(),
  progress: z.number().nullable().optional(),
  artifacts: z.array(z.object({ name: z.string(), kind: z.string().optional(), primary: z.boolean().optional() }).passthrough()).optional(),
  error: errorSchema.nullable().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const transformerEnqueuedSchema = z.object({ requestId: z.string().min(1), reused: z.boolean().optional() });

export const transformerInfoSchema = z.object({
  capabilities: z.record(z.string(), z.object({ create: z.boolean().optional() }).passthrough()),
});

export type TransformerState = z.infer<typeof transformerStateSchema>;

export type TransformerResource = "loads" | "reports";

type TransformerTypekey = { typekey: string; series: string; family: string; /** Day (YYYYMMDD) the reader stored that typekey under, so the load uses exactly the data of this request. */ date?: string };

export type TransformerLoadInput = {
  axCode: string;
  imcEdition: string;
  brand: "BMW" | "MINI";
  typekeys: TransformerTypekey[];
};

export type TransformerComparisonInput = { loadId: string; axCode: string; imcEdition: string };

export type TransformerReportInput = { axCode: string; imcEdition: string; language?: string; selection: Record<string, unknown> };
