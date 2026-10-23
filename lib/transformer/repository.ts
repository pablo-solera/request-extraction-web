import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { comparisonReports, extractionRequests, extractions, users, type TransformerJobStatus } from "@/db/schema";

const requesterColumns = { id: users.id, oracleEmpId: users.oracleEmpId, fallbackName: users.fallbackName, fallbackEmail: users.fallbackEmail };

/** Approved BMW requests whose typekeys have all completed and that have not been sent to the transformer yet. */
export async function listRequestsReadyForLoad(limit = 20) {
  const requests = await getDb().select().from(extractionRequests).where(and(
    eq(extractionRequests.status, "approved"),
    eq(extractionRequests.manufacturerGroup, "BMW"),
    isNull(extractionRequests.loadStatus),
    sql`EXISTS (SELECT 1 FROM ${extractions} WHERE ${extractions.requestGroupId} = ${extractionRequests.requestGroupId})`,
    sql`NOT EXISTS (SELECT 1 FROM ${extractions} WHERE ${extractions.requestGroupId} = ${extractionRequests.requestGroupId} AND ${extractions.status} <> 'completed')`,
  )).orderBy(extractionRequests.createdAt).limit(limit);
  if (requests.length === 0) return [];
  const items = await getDb().select({ requestGroupId: extractions.requestGroupId, modelCode: extractions.modelCode, readerParams: extractions.readerParams })
    .from(extractions).where(inArray(extractions.requestGroupId, requests.map((request) => request.requestGroupId))).orderBy(extractions.createdAt);
  return requests.map((request) => ({ request, items: items.filter((item) => item.requestGroupId === request.requestGroupId) }));
}

export async function markLoadRequested(requestGroupId: string, remoteId: string) {
  const [request] = await getDb().update(extractionRequests).set({
    loadStatus: "queued", loadRemoteId: remoteId, loadError: null, loadRequestedAt: new Date(), loadedAt: null,
    loadAttempts: sql`${extractionRequests.loadAttempts} + 1`,
  }).where(and(eq(extractionRequests.requestGroupId, requestGroupId), isNull(extractionRequests.loadStatus))).returning();
  return request ?? null;
}

export async function markLoadFailedToStart(requestGroupId: string, message: string) {
  const [request] = await getDb().update(extractionRequests).set({
    loadStatus: "failed", loadError: message, loadAttempts: sql`${extractionRequests.loadAttempts} + 1`,
  }).where(and(eq(extractionRequests.requestGroupId, requestGroupId), isNull(extractionRequests.loadStatus))).returning();
  return request ?? null;
}

export async function listActiveLoads(limit = 50) {
  return getDb().select().from(extractionRequests)
    .where(and(inArray(extractionRequests.loadStatus, ["queued", "running"]), sql`${extractionRequests.loadRemoteId} IS NOT NULL`))
    .orderBy(extractionRequests.loadRequestedAt).limit(limit);
}

export async function updateLoadState(requestGroupId: string, remoteId: string, update: { status: TransformerJobStatus; error?: string | null }) {
  const [request] = await getDb().update(extractionRequests).set({
    loadStatus: update.status,
    loadError: update.status === "failed" ? update.error ?? "La carga ha fallado." : null,
    loadedAt: update.status === "completed" ? new Date() : null,
  }).where(and(
    eq(extractionRequests.requestGroupId, requestGroupId),
    eq(extractionRequests.loadRemoteId, remoteId),
    inArray(extractionRequests.loadStatus, ["queued", "running"]),
  )).returning();
  return request ?? null;
}

/** Lets the technician send a failed load again; the next reconciliation picks it up. */
export async function resetFailedLoad(requestGroupId: string) {
  const [request] = await getDb().update(extractionRequests).set({ loadStatus: null, loadError: null, loadRemoteId: null })
    .where(and(eq(extractionRequests.requestGroupId, requestGroupId), eq(extractionRequests.loadStatus, "failed"))).returning();
  return request ?? null;
}

export async function getRequestWithRequester(requestGroupId: string) {
  const [row] = await getDb().select({ request: extractionRequests, requester: requesterColumns }).from(extractionRequests)
    .innerJoin(users, eq(users.id, extractionRequests.requesterId))
    .where(eq(extractionRequests.requestGroupId, requestGroupId)).limit(1);
  return row ?? null;
}

export async function listRequestsByIds(requestGroupIds: string[]) {
  const ids = [...new Set(requestGroupIds)].slice(0, 100);
  if (ids.length === 0) return [];
  return getDb().select().from(extractionRequests).where(inArray(extractionRequests.requestGroupId, ids));
}

export async function insertComparison(input: { requestGroupId: string; uploadedById: string; sourceFilename: string }) {
  const [row] = await getDb().insert(comparisonReports).values(input).returning();
  return row!;
}

export async function attachComparisonRemote(id: string, remoteReportId: string) {
  const [row] = await getDb().update(comparisonReports).set({ remoteReportId, updatedAt: new Date() }).where(eq(comparisonReports.id, id)).returning();
  return row ?? null;
}

export async function failComparison(id: string, message: string) {
  const now = new Date();
  const [row] = await getDb().update(comparisonReports).set({ status: "failed", errorMessage: message, updatedAt: now, completedAt: now })
    .where(and(eq(comparisonReports.id, id), inArray(comparisonReports.status, ["queued", "running"]))).returning();
  return row ?? null;
}

export async function updateComparisonState(id: string, update: { status: TransformerJobStatus; error?: string | null }) {
  const now = new Date();
  const terminal = update.status === "completed" || update.status === "failed";
  const [row] = await getDb().update(comparisonReports).set({
    status: update.status,
    errorMessage: update.status === "failed" ? update.error ?? "La comparación ha fallado." : null,
    updatedAt: now,
    completedAt: terminal ? now : null,
  }).where(and(eq(comparisonReports.id, id), inArray(comparisonReports.status, ["queued", "running"]))).returning();
  return row ?? null;
}

export async function listActiveComparisons(limit = 50) {
  return getDb().select().from(comparisonReports)
    .where(and(inArray(comparisonReports.status, ["queued", "running"]), sql`${comparisonReports.remoteReportId} IS NOT NULL`))
    .orderBy(comparisonReports.updatedAt).limit(limit);
}

export async function listComparisonsForRequests(requestGroupIds: string[]) {
  const ids = [...new Set(requestGroupIds)].slice(0, 100);
  if (ids.length === 0) return [];
  return getDb().select().from(comparisonReports).where(inArray(comparisonReports.requestGroupId, ids)).orderBy(desc(comparisonReports.createdAt));
}

export async function getComparison(id: string) {
  const [row] = await getDb().select().from(comparisonReports).where(eq(comparisonReports.id, id)).limit(1);
  return row ?? null;
}
