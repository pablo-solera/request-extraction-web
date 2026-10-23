import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ExtractionHistory } from "@/components/extractions/extraction-history";
import { requireUser } from "@/lib/auth/guards";
import { extractionDto, getReaderCapabilitiesForExtractions, listExtractionsVisibleToUser } from "@/lib/extractions/service";
import { resolveUserIdentities } from "@/lib/employees/identity-service";
import { z } from "zod";

export const metadata: Metadata = { title: "Historial" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireUser();
  const [{ created }, extractions] = await Promise.all([
    searchParams,
    listExtractionsVisibleToUser(user),
  ]);
  const [identities, capabilities] = await Promise.all([
    resolveUserIdentities(extractions.map(({ requester }) => requester)),
    getReaderCapabilitiesForExtractions(extractions),
  ]);
  const createdId = z.uuid().safeParse(created).success && extractions.some((item) => item.extraction.requestGroupId === created)
    ? created
    : undefined;

  return (
    <div className="space-y-7">
      <PageHeader>
        <PageHeader.Title>Historial de extracciones</PageHeader.Title>
       <PageHeader.Description>Consulta y administra las solicitudes que tienes permiso para gestionar.</PageHeader.Description>
      </PageHeader>
      <ExtractionHistory createdId={createdId} draftKey={`extraction-draft-v1-${user.id}`} initialItems={extractions.map((item) => extractionDto(item.extraction, item.requestStatus, identities.get(item.requester.id)?.name ?? item.requester.fallbackName ?? item.requester.fallbackEmail, capabilities.get(item.extraction.readerKey)))} />
    </div>
  );
}
