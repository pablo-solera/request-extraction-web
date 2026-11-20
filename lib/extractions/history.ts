import "server-only";

import { z } from "zod";
import type { UserRole } from "@/lib/auth/session";
import { requestCursorSchema } from "@/lib/extractions/cursor";
import { resolveUserIdentities } from "@/lib/employees/identity-service";
import type { RequestCursor } from "@/lib/extractions/repository";
import { extractionDto, getReaderCapabilitiesForExtractions, listExtractionsVisibleToUser } from "@/lib/extractions/service";
import type { ExtractionListItem } from "@/lib/extractions/types";
import { getTransformerInfo } from "@/lib/transformer/service";
import type { TransformerRequestInfo } from "@/lib/transformer/info";

export const historyPageInputSchema = z.object({
  cursor: requestCursorSchema.nullish(),
  query: z.string().trim().max(40).optional(),
});

export type HistoryPage = { items: ExtractionListItem[]; transformer: Record<string, TransformerRequestInfo>; nextCursor: RequestCursor | null };

type HistoryUser = { id: string; oracleEmpId: number | null; role: UserRole };

export async function loadHistoryPage(user: HistoryUser, options: { cursor?: RequestCursor | null; query?: string; requestGroupId?: string } = {}): Promise<HistoryPage> {
  const { rows, nextCursor } = await listExtractionsVisibleToUser(user, { cursor: options.cursor, axCode: options.query, requestGroupId: options.requestGroupId });
  const [identities, capabilities, transformer] = await Promise.all([
    resolveUserIdentities(rows.map(({ requester }) => requester)),
    getReaderCapabilitiesForExtractions(rows),
    getTransformerInfo([...new Set(rows.map((item) => item.extraction.requestGroupId))].slice(0, 100), user).catch(() => ({})),
  ]);
  return {
    items: rows.map((item) => extractionDto(item.extraction, item.requestStatus, identities.get(item.requester.id)?.name ?? item.requester.fallbackName ?? item.requester.fallbackEmail, capabilities.get(item.extraction.readerKey))),
    transformer,
    nextCursor,
  };
}
