export type InfrastructureService = {
  key: string;
  name: string;
  kind: "reader" | "transformer";
  envVar: string;
};

export const infrastructureServices: InfrastructureService[] = [
  { key: "bmw-reader", name: "BMW Reader", kind: "reader", envVar: "BMW_READER_BASE_URL" },
];
import "server-only";
import "server-only";
