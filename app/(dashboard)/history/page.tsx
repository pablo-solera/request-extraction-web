import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { ExtractionHistory } from "@/components/extractions/extraction-history";
import { requireUser } from "@/lib/auth/guards";
import { loadHistoryPage } from "@/lib/extractions/history";
import { z } from "zod";

export const metadata: Metadata = { title: "Historial" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; request?: string }>;
}) {
  const user = await requireUser();
  const { created, request } = await searchParams;
  const firstPage = await loadHistoryPage(user);
  const linkedId = [created, request].find((value) => z.uuid().safeParse(value).success && !firstPage.items.some((item) => item.requestGroupId === value));
  const linked = linkedId ? await loadHistoryPage(user, { requestGroupId: linkedId }) : null;
  const items = linked ? [...linked.items, ...firstPage.items] : firstPage.items;
  const transformer = { ...firstPage.transformer, ...linked?.transformer };
  const createdId = z.uuid().safeParse(created).success && items.some((item) => item.requestGroupId === created) ? created : undefined;
  const openId = z.uuid().safeParse(request).success && items.some((item) => item.requestGroupId === request) ? request : undefined;

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeader.Title>Historial de extracciones</PageHeader.Title>
       <PageHeader.Description>Consulta y administra las solicitudes que tienes permiso para gestionar.</PageHeader.Description>
      </PageHeader>
      <ExtractionHistory createdId={createdId} openId={openId} initialTransformer={transformer} initialNextCursor={firstPage.nextCursor} draftKey={`extraction-draft-v1-${user.id}`} initialItems={items} />
    </div>
  );
}
