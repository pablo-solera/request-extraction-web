import "server-only";

import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { comparisonReports, extractionRequests, extractions, users, type TransformerJobStatus } from "@/db/schema";

const requesterColumns = { id: users.id, oracleEmpId: users.oracleEmpId, fallbackName: users.fallbackName, fallbackEmail: users.fallbackEmail };

/** Approved BMW requests whose typekeys have all completed and that have not been sent to the transformer yet. */
export async function listRequestsReadyForLoad(limit = 20, requestGroupId?: string) {
  const requests = await getDb().select().from(extractionRequests).where(and(
    eq(extractionRequests.status, "approved"),
    eq(extractionRequests.manufacturerGroup, "BMW"),
    isNull(extractionRequests.loadStatus),
    requestGroupId ? eq(extractionRequests.requestGroupId, requestGroupId) : undefined,
    sql`EXISTS (SELECT 1 FROM ${extractions} WHERE ${extractions.requestGroupId} = ${extractionRequests.requestGroupId})`,
    sql`NOT EXISTS (SELECT 1 FROM ${extractions} WHERE ${extractions.requestGroupId} = ${extractionRequests.requestGroupId} AND ${extractions.status} <> 'completed')`,
  )).orderBy(extractionRequests.createdAt).limit(limit);
  if (requests.length === 0) return [];
  const items = await getDb().select({ requestGroupId: extractions.requestGroupId, modelCode: extractions.modelCode, readerParams: extractions.readerParams, dataDate: extractions.dataDate })
    .from(extractions).where(inArray(extractions.requestGroupId, requests.map((request) => request.requestGroupId))).orderBy(extractions.createdAt);
  return requests.map((request) => ({ request, items: items.filter((item) => item.requestGroupId === request.requestGroupId) }));
}

/** The newest request whose load put (or is putting) a table for this AX code, edition and brand into BMW_Labour. */
export async function findLoadedTable(input: { axCode: string; imcEdition: string; brand: string }) {
  const [row] = await getDb().select({ requestGroupId: extractionRequests.requestGroupId, loadStatus: extractionRequests.loadStatus, loadedAt: extractionRequests.loadedAt })
    .from(extractionRequests).where(and(
      eq(extractionRequests.manufacturerGroup, "BMW"),
      eq(extractionRequests.brand, input.brand),
      eq(extractionRequests.imcEdition, input.imcEdition),
      sql`upper(${extractionRequests.axCode}) = upper(${input.axCode})`,
      inArray(extractionRequests.loadStatus, ["queued", "running", "completed"]),
    )).orderBy(desc(sql`coalesce(${extractionRequests.loadedAt}, ${extractionRequests.loadRequestedAt})`)).limit(1);
  return row ?? null;
}

export async function markLoadRequested(requestGroupId: string, remoteId: string) {
  const [request] = await getDb().update(extractionRequests).set({
    loadStatus: "queued", loadRemoteId: remoteId, loadError: null, loadRequestedAt: new Date(), loadedAt: null, loadStartFailures: 0,
    loadAttempts: sql`${extractionRequests.loadAttempts} + 1`,
  }).where(and(eq(extractionRequests.requestGroupId, requestGroupId), isNull(extractionRequests.loadStatus))).returning();
  return request ?? null;
}

/** Counts a failed attempt to reach the transformer for a request that has no load yet; returns the total so far. */
export async function recordLoadStartFailure(requestGroupId: string) {
  const [request] = await getDb().update(extractionRequests).set({ loadStartFailures: sql`${extractionRequests.loadStartFailures} + 1` })
    .where(and(eq(extractionRequests.requestGroupId, requestGroupId), isNull(extractionRequests.loadStatus))).returning({ failures: extractionRequests.loadStartFailures });
  return request?.failures ?? 0;
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

/** Reserves the right to ask the transformer about a load, so concurrent viewers do not all query it. */
export async function claimLoadPoll(requestGroupId: string, staleBefore: Date) {
  const [request] = await getDb().update(extractionRequests).set({ loadPolledAt: new Date() }).where(and(
    eq(extractionRequests.requestGroupId, requestGroupId),
    inArray(extractionRequests.loadStatus, ["queued", "running"]),
    sql`${extractionRequests.loadRemoteId} IS NOT NULL`,
    or(isNull(extractionRequests.loadPolledAt), lte(extractionRequests.loadPolledAt, staleBefore)),
  )).returning();
  return request ?? null;
}

/** Reserves the right to try sending a pending load, so concurrent viewers do not all start it. */
export async function claimLoadStart(requestGroupId: string, staleBefore: Date) {
  const [request] = await getDb().update(extractionRequests).set({ loadPolledAt: new Date() }).where(and(
    eq(extractionRequests.requestGroupId, requestGroupId),
    isNull(extractionRequests.loadStatus),
    or(isNull(extractionRequests.loadPolledAt), lte(extractionRequests.loadPolledAt, staleBefore)),
  )).returning();
  return request ?? null;
}

export async function claimComparisonPoll(id: string, staleBefore: Date) {
  const [row] = await getDb().update(comparisonReports).set({ polledAt: new Date() }).where(and(
    eq(comparisonReports.id, id),
    inArray(comparisonReports.status, ["queued", "running"]),
    sql`${comparisonReports.remoteReportId} IS NOT NULL`,
    or(isNull(comparisonReports.polledAt), lte(comparisonReports.polledAt, staleBefore)),
  )).returning();
  return row ?? null;
}

/** Lets the technician send a failed load again; the next reconciliation picks it up. */
export async function resetFailedLoad(requestGroupId: string) {
  const [request] = await getDb().update(extractionRequests).set({ loadStatus: null, loadError: null, loadRemoteId: null, loadStartFailures: 0, loadPolledAt: null })
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

/** Approved Mercedes-Benz requests whose models have all completed and whose report has not been requested yet. */
export async function listRequestsReadyForReport(limit = 20, requestGroupId?: string) {
  const requests = await getDb().select().from(extractionRequests).where(and(
    eq(extractionRequests.status, "approved"),
    eq(extractionRequests.manufacturerGroup, "Mercedes"),
    isNull(extractionRequests.reportStatus),
    requestGroupId ? eq(extractionRequests.requestGroupId, requestGroupId) : undefined,
    sql`EXISTS (SELECT 1 FROM ${extractions} WHERE ${extractions.requestGroupId} = ${extractionRequests.requestGroupId})`,
    sql`NOT EXISTS (SELECT 1 FROM ${extractions} WHERE ${extractions.requestGroupId} = ${extractionRequests.requestGroupId} AND ${extractions.status} <> 'completed')`,
  )).orderBy(extractionRequests.createdAt).limit(limit);
  if (requests.length === 0) return [];
  const items = await getDb().select({ requestGroupId: extractions.requestGroupId, modelCode: extractions.modelCode, readerParams: extractions.readerParams, dataDate: extractions.dataDate })
    .from(extractions).where(inArray(extractions.requestGroupId, requests.map((request) => request.requestGroupId))).orderBy(extractions.createdAt);
  return requests.map((request) => ({ request, items: items.filter((item) => item.requestGroupId === request.requestGroupId) }));
}

/** Reserves the right to try sending a pending report, so concurrent viewers do not all start it. */
export async function claimReportStart(requestGroupId: string, staleBefore: Date) {
  const [request] = await getDb().update(extractionRequests).set({ reportPolledAt: new Date() }).where(and(
    eq(extractionRequests.requestGroupId, requestGroupId),
    isNull(extractionRequests.reportStatus),
    or(isNull(extractionRequests.reportPolledAt), lte(extractionRequests.reportPolledAt, staleBefore)),
  )).returning();
  return request ?? null;
}

export async function markReportRequested(requestGroupId: string, remoteId: string) {
  const [request] = await getDb().update(extractionRequests).set({
    reportStatus: "queued", reportRemoteId: remoteId, reportError: null, reportRequestedAt: new Date(), reportCompletedAt: null, reportDownloadable: false, reportStartFailures: 0,
    reportAttempts: sql`${extractionRequests.reportAttempts} + 1`,
  }).where(and(eq(extractionRequests.requestGroupId, requestGroupId), isNull(extractionRequests.reportStatus))).returning();
  return request ?? null;
}

/** Counts a failed attempt to reach the transformer for a request that has no report yet; returns the total so far. */
export async function recordReportStartFailure(requestGroupId: string) {
  const [request] = await getDb().update(extractionRequests).set({ reportStartFailures: sql`${extractionRequests.reportStartFailures} + 1` })
    .where(and(eq(extractionRequests.requestGroupId, requestGroupId), isNull(extractionRequests.reportStatus))).returning({ failures: extractionRequests.reportStartFailures });
  return request?.failures ?? 0;
}

export async function markReportFailedToStart(requestGroupId: string, message: string) {
  const [request] = await getDb().update(extractionRequests).set({
    reportStatus: "failed", reportError: message, reportAttempts: sql`${extractionRequests.reportAttempts} + 1`,
  }).where(and(eq(extractionRequests.requestGroupId, requestGroupId), isNull(extractionRequests.reportStatus))).returning();
  return request ?? null;
}

export async function listActiveReports(limit = 50) {
  return getDb().select().from(extractionRequests)
    .where(and(inArray(extractionRequests.reportStatus, ["queued", "running"]), sql`${extractionRequests.reportRemoteId} IS NOT NULL`))
    .orderBy(extractionRequests.reportRequestedAt).limit(limit);
}

/** `downloadable` is whether the transformer holds the Excel: a report whose last step failed can still have it. */
export async function updateReportState(requestGroupId: string, remoteId: string, update: { status: TransformerJobStatus; error?: string | null; downloadable: boolean }) {
  const terminal = update.status === "completed" || update.status === "failed";
  const [request] = await getDb().update(extractionRequests).set({
    reportStatus: update.status,
    reportError: update.status === "failed" ? update.error ?? "El informe ha fallado." : null,
    reportDownloadable: update.downloadable,
    reportCompletedAt: terminal ? new Date() : null,
  }).where(and(
    eq(extractionRequests.requestGroupId, requestGroupId),
    eq(extractionRequests.reportRemoteId, remoteId),
    inArray(extractionRequests.reportStatus, ["queued", "running"]),
  )).returning();
  return request ?? null;
}

/** Reserves the right to ask the transformer about a report, so concurrent viewers do not all query it. */
export async function claimReportPoll(requestGroupId: string, staleBefore: Date) {
  const [request] = await getDb().update(extractionRequests).set({ reportPolledAt: new Date() }).where(and(
    eq(extractionRequests.requestGroupId, requestGroupId),
    inArray(extractionRequests.reportStatus, ["queued", "running"]),
    sql`${extractionRequests.reportRemoteId} IS NOT NULL`,
    or(isNull(extractionRequests.reportPolledAt), lte(extractionRequests.reportPolledAt, staleBefore)),
  )).returning();
  return request ?? null;
}

/** Lets the technician ask for a failed report again; the next reconciliation (or the retry itself) sends it. */
export async function resetFailedReport(requestGroupId: string) {
  const [request] = await getDb().update(extractionRequests).set({ reportStatus: null, reportError: null, reportRemoteId: null, reportDownloadable: false, reportStartFailures: 0, reportPolledAt: null })
    .where(and(eq(extractionRequests.requestGroupId, requestGroupId), eq(extractionRequests.reportStatus, "failed"))).returning();
  return request ?? null;
}
