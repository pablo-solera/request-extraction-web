import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { Alert } from "@/components/ui/alert";
import { ExtractionForm, type ExtractionFormSeed } from "@/components/extractions/extraction-form";
import { requireUser } from "@/lib/auth/guards";
import type { Extraction } from "@/db/schema";
import { getRepeatableRequestItems } from "@/lib/extractions/service";
import { z } from "zod";

export const metadata: Metadata = { title: "Nueva extracción" };

function seedFromExtractions(extractions: Extraction[]): ExtractionFormSeed | undefined {
  const first = extractions[0];
  if (!first) return undefined;
  const brand = first.brand;
  const baseValues = { axCode: first.axCode, imcEdition: first.imcEdition, completion: first.completion, comments: first.comments ?? "" };
  if (first.manufacturerGroup === "BMW" && (brand === "BMW" || brand === "MINI")) {
    const bmwBrand: "BMW" | "MINI" = brand;
    const vehicles = extractions.flatMap((extraction) => {
      const params = extraction.readerParams;
      if (!params.series || !params.developmentCode || !params.typekey) return [];
      const modelSuffix = `${params.series} / ${params.developmentCode}`;
      const suffix = ` · ${modelSuffix}`;
      const modelDescription = extraction.modelDescription === modelSuffix ? "" : extraction.modelDescription.endsWith(suffix) ? extraction.modelDescription.slice(0, -suffix.length) : extraction.modelDescription;
      return [{ manufacturerGroup: "BMW" as const, brand: bmwBrand, series: params.series, developmentCode: params.developmentCode, typekey: params.typekey, modelDescription }];
    });
    if (vehicles.length === 0) return undefined;
    return { group: "BMW", values: { ...baseValues, laboursDevelopmentStart: first.developmentStart ?? first.readerParams.developmentStart ?? "" }, vehicles };
  }
  if (first.manufacturerGroup === "Mercedes" && brand === "Mercedes-Benz") {
    const vehicles = extractions.flatMap((extraction) => {
      const series = extraction.readerParams.series;
      if (!series) return [];
      const suffix = ` · ${series}`;
      const modelDescription = extraction.modelDescription === series ? "" : extraction.modelDescription.endsWith(suffix) ? extraction.modelDescription.slice(0, -suffix.length) : extraction.modelDescription;
      return [{ manufacturerGroup: "Mercedes" as const, brand: "Mercedes-Benz" as const, series, modelCode: extraction.modelCode, modelDescription }];
    });
    if (vehicles.length === 0) return undefined;
    return { group: "Mercedes", values: { ...baseValues, laboursDevelopmentStart: first.developmentStart ?? "" }, vehicles };
  }
  if (first.manufacturerGroup === "Renault" && (brand === "Renault" || brand === "Dacia")) {
    const renaultBrand: "Renault" | "Dacia" = brand;
    return {
      group: "Renault",
      values: { ...baseValues, laboursDevelopmentStart: first.developmentStart ?? first.readerParams.developmentStart ?? first.readerParams.publishedAfter ?? "" },
      vehicles: extractions.map((extraction) => ({ manufacturerGroup: "Renault" as const, brand: renaultBrand, modelDescription: extraction.modelDescription, modelCode: extraction.readerParams.family ?? extraction.modelCode })),
    };
  }
  return undefined;
}

export default async function ExtractionsPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const user = await requireUser();
  const { request } = await searchParams;
  let initialValues: ExtractionFormSeed | undefined;
  if (z.uuid().safeParse(request).success) {
    const items = await getRepeatableRequestItems(request!, user);
    if (items) initialValues = seedFromExtractions(items);
  }
  return (
    <div className="space-y-7">
      <PageHeader>
        <PageHeader.Title>Nueva extracción</PageHeader.Title>
        <PageHeader.Description>Prepara y realiza una exportación técnica desde un único formulario.</PageHeader.Description>
      </PageHeader>
      {initialValues ? <Alert role="status" tone="info">Se cargaron los datos comunes y todos los typekeys de la solicitud anterior para extraerlos de nuevo con los datos de hoy. Revísalos y actualiza lo que necesites antes de solicitarla.</Alert> : null}
      <ExtractionForm draftKey={`extraction-draft-v1-${user.id}`} initialValues={initialValues} requiresApproval={user.role === "employee"} />
    </div>
  );
}
