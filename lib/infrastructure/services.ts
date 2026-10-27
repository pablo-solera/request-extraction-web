import "server-only";

export type InfrastructureService = {
  key: string;
  name: string;
  kind: "reader" | "transformer";
  envVar: string;
};

export type InfrastructureManufacturer = {
  key: string;
  name: string;
  reader: InfrastructureService;
  transformer: InfrastructureService;
};

function manufacturer(key: string, name: string): InfrastructureManufacturer {
  const prefix = key.toUpperCase();
  return {
    key,
    name,
    reader: { key: `${key}-reader`, name: `${name} Reader`, kind: "reader", envVar: `${prefix}_READER_BASE_URL` },
    transformer: { key: `${key}-transformer`, name: `${name} Transformer`, kind: "transformer", envVar: `${prefix}_TRANSFORMER_BASE_URL` },
  };
}

export const infrastructureManufacturers: InfrastructureManufacturer[] = [
  manufacturer("bmw", "BMW"),
  manufacturer("renault", "Renault"),
  manufacturer("vag", "VAG"),
];
