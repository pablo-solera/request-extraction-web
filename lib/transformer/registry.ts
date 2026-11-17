import type { TransformerLoadInput, TransformerResource } from "@/lib/transformer/types";

export type TransformerKey = "bmw" | "mercedes";

export type TransformerDefinition = {
  key: TransformerKey;
  /** Value of `manufacturer` in the create body. */
  manufacturer: string;
  group: string;
  envVar: string;
  /** What the web expects the service to offer; the service itself reports it in `GET /v1/info`. */
  resources: readonly TransformerResource[];
};

export const transformerDefinitions: Record<TransformerKey, TransformerDefinition> = {
  bmw: { key: "bmw", manufacturer: "BMW", group: "BMW", envVar: "BMW_TRANSFORMER_BASE_URL", resources: ["loads", "reports"] },
  mercedes: { key: "mercedes", manufacturer: "Mercedes-Benz", group: "Mercedes", envVar: "MERCEDES_TRANSFORMER_BASE_URL", resources: ["reports"] },
};

export function bmwLoadSelection({ brand, typekeys }: Pick<TransformerLoadInput, "brand" | "typekeys">) {
  return { brand, typekeys: typekeys.map(({ typekey, series, family, date }) => ({ typekey, series, family, ...(date ? { date } : {}) })) };
}

export function createBody(definition: TransformerDefinition, input: { axCode: string; imcEdition: string; language?: string; selection: Record<string, unknown> }) {
  return {
    manufacturer: definition.manufacturer,
    axCode: input.axCode,
    edition: input.imcEdition,
    ...(input.language ? { language: input.language } : {}),
    selection: input.selection,
  };
}
