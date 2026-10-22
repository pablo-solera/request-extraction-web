import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ExtractionForm, type ExtractionFormSeed } from "@/components/extractions/extraction-form";
import { requireUser } from "@/lib/auth/guards";
import { getManageableExtraction } from "@/lib/extractions/service";
import { z } from "zod";

export const metadata: Metadata = { title: "Nueva extracción" };

export default async function ExtractionsPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const user = await requireUser();
  const { from } = await searchParams;
  let initialValues: ExtractionFormSeed | undefined;
  if (z.uuid().safeParse(from).success) {
    const row = await getManageableExtraction(from!, user);
    if (row) {
      const { extraction } = row;
      const params = extraction.readerParams;
      if (extraction.manufacturerGroup === "BMW" && (extraction.brand === "BMW" || extraction.brand === "MINI") && params.series && params.developmentCode && params.typekey) {
        const modelSuffix = `${params.series} / ${params.developmentCode}`;
        const suffix = ` · ${modelSuffix}`;
        const modelDescription = extraction.modelDescription === modelSuffix ? "" : extraction.modelDescription.endsWith(suffix) ? extraction.modelDescription.slice(0, -suffix.length) : extraction.modelDescription;
        initialValues = {
          group: "BMW" as const,
          values: { axCode: extraction.axCode, imcEdition: extraction.imcEdition, completion: extraction.completion, laboursDevelopmentStart: extraction.developmentStart ?? params.developmentStart ?? "", comments: extraction.comments ?? "" },
          vehicles: [{ manufacturerGroup: "BMW" as const, brand: extraction.brand, series: params.series, developmentCode: params.developmentCode, typekey: params.typekey, modelDescription }],
        };
      } else if (extraction.manufacturerGroup === "Renault" && (extraction.brand === "Renault" || extraction.brand === "Dacia")) {
        initialValues = {
          group: "Renault" as const,
          values: { axCode: extraction.axCode, imcEdition: extraction.imcEdition, completion: extraction.completion, laboursDevelopmentStart: extraction.developmentStart ?? params.developmentStart ?? params.publishedAfter ?? "", comments: extraction.comments ?? "" },
          vehicles: [{ manufacturerGroup: "Renault" as const, brand: extraction.brand, modelDescription: extraction.modelDescription, modelCode: params.family ?? extraction.modelCode }],
        };
      }
    }
  }
  return (
    <div className="space-y-7">
      <PageHeader>
        <PageHeader.Eyebrow>Readers de fabricantes</PageHeader.Eyebrow>
        <PageHeader.Title>Nueva extracción</PageHeader.Title>
        <PageHeader.Description>Prepara y realiza una exportación técnica desde un único formulario.</PageHeader.Description>
      </PageHeader>
      {initialValues ? <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" role="status">Se cargaron los datos de la extracción anterior. Revísalos y actualiza lo que necesites antes de solicitarla de nuevo.</p> : null}
      <ExtractionForm draftKey={`extraction-draft-v1-${user.id}`} initialValues={initialValues} requiresApproval={user.role === "employee"} />
    </div>
  );
}
