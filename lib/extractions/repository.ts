import "server-only";

import { and, count, desc, eq, getTableColumns, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { extractionActionLogs, extractions, extractionRequests, type Extraction, type ExtractionStatus } from "@/db/schema";
import type { ExtractionFormInput } from "@/lib/extractions/validation";
import { getRenaultReaderCapabilities, getRenaultSettings } from "@/lib/readers/renault/client";
import { users } from "@/db/schema";

const sharedColumns = {
  axCode: extractionRequests.axCode,
  imcEdition: extractionRequests.imcEdition,
  completion: extractionRequests.completion,
  developmentStart: extractionRequests.developmentStart,
  comments: extractionRequests.comments,
  manufacturerGroup: extractionRequests.manufacturerGroup,
  brand: extractionRequests.brand,
};
const extractionColumns = { ...getTableColumns(extractions), ...sharedColumns };

async function loadExtraction(id: string): Promise<Extraction | null> {
  const [row] = await getDb().select(extractionColumns).from(extractions)
    .innerJoin(extractionRequests, eq(extractions.requestGroupId, extractionRequests.requestGroupId))
    .where(eq(extractions.id, id)).limit(1);
  return row ?? null;
}

export async function insertExtractionsWithCapacity(userId: string, input: ExtractionFormInput, maxActive: number, request: { status: "pending" | "approved"; coordinatorId: string | null }) {
  const usesRenault = input.vehicles.some((vehicle) => vehicle.manufacturerGroup === "Renault");
  const renaultCoreCapabilities = usesRenault ? await getRenaultReaderCapabilities() : null;
  const renaultSettings = usesRenault && !renaultCoreCapabilities?.create ? getRenaultSettings() : null;
  const bmwLanguage = process.env.BMW_READER_LANGUAGE?.trim() || "en-GB";
  const mercedesDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const requestGroupId = crypto.randomUUID();

  return getDb().transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const [{ active }] = await transaction
      .select({ active: count() })
      .from(extractions)
      .where(and(eq(extractions.userId, userId), inArray(extractions.status, ["pending", "running"])));

    if (active + input.vehicles.length > maxActive) return null;

    const shared = {
      axCode: input.axCode,
      imcEdition: input.imcEdition,
      completion: input.completion,
      developmentStart: input.laboursDevelopmentStart || null,
      comments: input.comments || null,
      manufacturerGroup: input.vehicles[0]!.manufacturerGroup,
      brand: input.vehicles[0]!.brand,
    };
    const values = input.vehicles.map((vehicle): typeof extractions.$inferInsert => {
      const common = { userId, requestGroupId, domain: "labours" as const, readerParamsVersion: 1, status: "pending" as const };
      if (vehicle.manufacturerGroup === "BMW") {
        return {
          ...common,
          modelDescription: [vehicle.modelDescription, `${vehicle.series} / ${vehicle.developmentCode}`].filter(Boolean).join(" · "),
          modelCode: vehicle.typekey,
          readerKey: "bmw-labours",
          readerParams: { series: vehicle.series, developmentCode: vehicle.developmentCode, typekey: vehicle.typekey, language: bmwLanguage },
        };
      }
      if (vehicle.manufacturerGroup === "Mercedes") {
        return {
          ...common,
          modelDescription: [vehicle.modelDescription, vehicle.series].filter(Boolean).join(" · "),
          modelCode: vehicle.modelCode,
          readerKey: "mercedes-labours",
          // One day for the whole request, so every model lands in the folder the transformer will read.
          readerParams: { series: vehicle.series, date: mercedesDate },
        };
      }
      return {
        ...common,
        modelDescription: vehicle.modelDescription,
        modelCode: vehicle.modelCode,
        readerKey: "renault-labours",
        readerParams: { format: renaultSettings?.format ?? "", language: renaultSettings?.language ?? "", range: renaultSettings?.range ?? "", family: vehicle.modelCode },
      };
    });

    await transaction.insert(extractionRequests).values({ requestGroupId, requesterId: userId, coordinatorId: request.coordinatorId, status: request.status, ...shared });
    const rows = await transaction.insert(extractions).values(values).returning();
    return rows.map((row): Extraction => ({ ...row, ...shared }));
  });
}

/** A submission claimed longer ago than this was left behind by a crash between claiming and recording the reader job. */
const STALE_SUBMISSION_MS = 5 * 60 * 1000;
const unclaimedSubmission = () => or(isNull(extractions.submittedAt), lte(extractions.submittedAt, new Date(Date.now() - STALE_SUBMISSION_MS)));

export async function claimExtractionSubmission(id: string) {
  const [extraction] = await getDb().update(extractions).set({
    attemptCount: sql`${extractions.attemptCount} + 1`,
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(extractions.id, id),
    eq(extractions.status, "pending"),
    isNull(extractions.remoteRequestId),
    unclaimedSubmission(),
  )).returning();
  return extraction ? loadExtraction(extraction.id) : null;
}

export async function markSubmissionFailed(id: string, claimedAt: Date, update: { errorCode: string; errorMessage: string }) {
  const now = new Date();
  const [extraction] = await getDb().update(extractions).set({
    status: "failed",
    ...update,
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(extractions.id, id),
    eq(extractions.status, "pending"),
    isNull(extractions.remoteRequestId),
    eq(extractions.submittedAt, claimedAt),
  )).returning();
  return extraction ? loadExtraction(extraction.id) : null;
}

/** Gives a claimed submission back after a temporary reader failure, so the reconciliation sends it again. */
export async function releaseSubmission(id: string, claimedAt: Date) {
  const [extraction] = await getDb().update(extractions).set({ submittedAt: null, updatedAt: new Date() }).where(and(
    eq(extractions.id, id),
    eq(extractions.status, "pending"),
    isNull(extractions.remoteRequestId),
    eq(extractions.submittedAt, claimedAt),
  )).returning();
  return extraction ? loadExtraction(extraction.id) : null;
}

export async function attachReaderRequest(id: string, requestId: string, claimedAt: Date, initialReaderState?: { progress?: number | null; readerStatus?: string | null }) {
  const [extraction] = await getDb().update(extractions).set({
    remoteRequestId: requestId,
    status: "running",
    ...initialReaderState,
    submittedAt: new Date(),
    startedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(extractions.id, id), eq(extractions.status, "pending"), isNull(extractions.remoteRequestId), eq(extractions.submittedAt, claimedAt))).returning();
  return extraction ? loadExtraction(extraction.id) : null;
}

export async function claimReaderProgressPoll(id: string, staleBefore: Date) {
  const [extraction] = await getDb().update(extractions).set({ readerPolledAt: new Date() }).where(and(
    eq(extractions.id, id),
    inArray(extractions.status, ["pending", "running"]),
    isNotNull(extractions.remoteRequestId),
    or(isNull(extractions.readerPolledAt), lte(extractions.readerPolledAt, staleBefore)),
  )).returning();
  return extraction ? loadExtraction(extraction.id) : null;
}

export async function cancelUnsubmittedExtraction(id: string) {
  const now = new Date();
  const [extraction] = await getDb().update(extractions).set({
    status: "cancelled",
    readerStatus: "cancelled",
    readerStalled: false,
    errorCode: null,
    errorMessage: null,
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(extractions.id, id),
    eq(extractions.status, "pending"),
    isNull(extractions.remoteRequestId),
    unclaimedSubmission(),
  )).returning();
  return extraction ? loadExtraction(extraction.id) : null;
}

export async function markExtractionResumed(id: string, readerStatus: string) {
  const now = new Date();
  const [extraction] = await getDb().update(extractions).set({
    status: "running",
    errorCode: null,
    errorMessage: null,
    readerStatus,
    readerStalled: false,
    completedAt: null,
    updatedAt: now,
  }).where(and(
    eq(extractions.id, id),
    inArray(extractions.status, ["pending", "running", "failed"]),
    isNotNull(extractions.remoteRequestId),
  )).returning();
  return extraction ? loadExtraction(extraction.id) : null;
}

export async function recordExtractionAction(input: {
  extractionId: string;
  actorId: string;
  action: "cancel" | "resume" | "force_resume";
  outcome: "succeeded" | "failed";
  readerStatus?: string | null;
}) {
  const [log] = await getDb().insert(extractionActionLogs).values(input).returning();
  return log ?? null;
}

export async function updateExtractionState(id: string, update: {
  status: ExtractionStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  progress?: number | null;
  readerStatus?: string | null;
  readerStalled?: boolean;
  dataDate?: string | null;
}) {
  const now = new Date();
  const [extraction] = await getDb().update(extractions).set({
    ...update,
    ...(typeof update.progress === "number" && (update.status === "pending" || update.status === "running")
      ? { progress: sql`GREATEST(COALESCE(${extractions.progress}, 0), ${update.progress})` }
      : {}),
    updatedAt: now,
    completedAt: update.status === "completed" || update.status === "failed" || update.status === "cancelled" ? now : null,
  }).where(and(
    eq(extractions.id, id),
    inArray(extractions.status, ["pending", "running"]),
    update.status === "failed" && update.errorCode !== "REQUEST_REJECTED" ? sql`${extractions.submittedAt} IS NOT NULL` : undefined,
  )).returning();

  return loadExtraction(extraction?.id ?? id);
}

export async function getExtractionWithRequester(id: string) {
  const [row] = await getDb().select({
    extraction: extractionColumns,
    requestStatus: extractionRequests.status,
    requester: { id: users.id, oracleEmpId: users.oracleEmpId, fallbackName: users.fallbackName, fallbackEmail: users.fallbackEmail },
  }).from(extractions)
    .innerJoin(extractionRequests, eq(extractions.requestGroupId, extractionRequests.requestGroupId))
    .innerJoin(users, eq(extractions.userId, users.id))
    .where(eq(extractions.id, id)).limit(1);
  return row ?? null;
}

export async function getRequestStatus(requestGroupId: string) {
  const [request] = await getDb().select({ status: extractionRequests.status }).from(extractionRequests).where(eq(extractionRequests.requestGroupId, requestGroupId)).limit(1);
  return request?.status ?? "pending";
}

export async function listOwnedExtractions(userId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids)].slice(0, 100);
  if (uniqueIds.length === 0) return [];
  return getDb().select({ extraction: extractionColumns, requestStatus: extractionRequests.status })
    .from(extractions)
    .innerJoin(extractionRequests, eq(extractions.requestGroupId, extractionRequests.requestGroupId))
    .where(and(eq(extractions.userId, userId), inArray(extractions.id, uniqueIds)));
}

async function listAllExtractions() {
  return getDb().select({
    extraction: extractionColumns,
    requestStatus: extractionRequests.status,
    requester: { id: users.id, oracleEmpId: users.oracleEmpId, fallbackName: users.fallbackName, fallbackEmail: users.fallbackEmail },
  }).from(extractions)
    .innerJoin(extractionRequests, eq(extractions.requestGroupId, extractionRequests.requestGroupId))
    .innerJoin(users, eq(extractions.userId, users.id))
    .orderBy(desc(extractions.createdAt));
}

async function listExtractionsForUsers(userIds: string[]) {
  if (userIds.length === 0) return [];
  return getDb().select({
    extraction: extractionColumns,
    requestStatus: extractionRequests.status,
    requester: { id: users.id, oracleEmpId: users.oracleEmpId, fallbackName: users.fallbackName, fallbackEmail: users.fallbackEmail },
  }).from(extractions)
    .innerJoin(extractionRequests, eq(extractions.requestGroupId, extractionRequests.requestGroupId))
    .innerJoin(users, eq(extractions.userId, users.id))
    .where(inArray(extractions.userId, userIds)).orderBy(desc(extractions.createdAt));
}

export async function listVisibleExtractions(userId: string, managedUserIds: string[] | null) {
  if (managedUserIds === null) return listAllExtractions();
  return listExtractionsForUsers([...new Set([userId, ...managedUserIds])]);
}

export async function listVisibleExtractionsByIds(userId: string, ids: string[], managedUserIds: string[] | null) {
  const uniqueIds = [...new Set(ids)].slice(0, 100);
  if (uniqueIds.length === 0) return [];
  const visibility = managedUserIds === null ? undefined : inArray(extractions.userId, [...new Set([userId, ...managedUserIds])]);
  return getDb().select({
    extraction: extractionColumns,
    requestStatus: extractionRequests.status,
    requester: { id: users.id, oracleEmpId: users.oracleEmpId, fallbackName: users.fallbackName, fallbackEmail: users.fallbackEmail },
  }).from(extractions)
    .innerJoin(extractionRequests, eq(extractions.requestGroupId, extractionRequests.requestGroupId))
    .innerJoin(users, eq(extractions.userId, users.id))
    .where(and(inArray(extractions.id, uniqueIds), visibility));
}

export async function listActiveExtractions(limit = 100) {
  return getDb().select({ extraction: extractionColumns }).from(extractions).innerJoin(extractionRequests, eq(extractions.requestGroupId, extractionRequests.requestGroupId))
    .where(and(inArray(extractions.status, ["pending", "running"]), eq(extractionRequests.status, "approved")))
    .orderBy(extractions.updatedAt).limit(limit).then((rows) => rows.map((row) => row.extraction));
}

export async function listRequestExtractions(requestGroupId: string) {
  return getDb().select({
    extraction: extractionColumns,
    requestStatus: extractionRequests.status,
    requester: { id: users.id, oracleEmpId: users.oracleEmpId, fallbackName: users.fallbackName, fallbackEmail: users.fallbackEmail },
  }).from(extractions)
    .innerJoin(extractionRequests, eq(extractions.requestGroupId, extractionRequests.requestGroupId))
    .innerJoin(users, eq(extractions.userId, users.id))
    .where(eq(extractions.requestGroupId, requestGroupId)).orderBy(extractions.createdAt);
}

export async function listPendingRequests(userId?: string, isAdmin = false) {
  return getDb().select({
    request: { requestGroupId: extractionRequests.requestGroupId, requesterId: extractionRequests.requesterId, coordinatorId: extractionRequests.coordinatorId, status: extractionRequests.status, createdAt: extractionRequests.createdAt, axCode: extractionRequests.axCode, imcEdition: extractionRequests.imcEdition, completion: extractionRequests.completion, developmentStart: extractionRequests.developmentStart, manufacturerGroup: extractionRequests.manufacturerGroup, brand: extractionRequests.brand },
    extraction: { id: extractions.id, modelDescription: extractions.modelDescription },
    requester: { id: users.id, oracleEmpId: users.oracleEmpId, fallbackName: users.fallbackName, fallbackEmail: users.fallbackEmail },
  }).from(extractionRequests)
    .innerJoin(extractions, eq(extractions.requestGroupId, extractionRequests.requestGroupId)).innerJoin(users, eq(users.id, extractionRequests.requesterId))
    .where(and(eq(extractionRequests.status, "pending"), isAdmin ? undefined : eq(extractionRequests.coordinatorId, userId ?? ""))).orderBy(desc(extractionRequests.createdAt)).limit(500);
}

export async function getPendingRequest(requestGroupId: string) {
  const [row] = await getDb().select({ request: extractionRequests, requester: users }).from(extractionRequests)
    .innerJoin(users, eq(users.id, extractionRequests.requesterId))
    .where(and(eq(extractionRequests.requestGroupId, requestGroupId), eq(extractionRequests.status, "pending"))).limit(1);
  return row ?? null;
}

export async function listApprovedRequestExtractions(requestGroupId: string) {
  return getDb().select(extractionColumns).from(extractions).innerJoin(extractionRequests, eq(extractions.requestGroupId, extractionRequests.requestGroupId)).where(and(eq(extractions.requestGroupId, requestGroupId), eq(extractionRequests.status, "approved"), eq(extractions.status, "pending"))).orderBy(extractions.createdAt);
}

export async function decideRequest(groupId: string, deciderId: string, status: "approved" | "rejected", comment: string | null, isAdmin: boolean) {
  return getDb().transaction(async (transaction) => {
    const [request] = await transaction.update(extractionRequests).set({ status, decisionComment: comment, decidedById: deciderId, decidedAt: new Date() }).where(and(eq(extractionRequests.requestGroupId, groupId), eq(extractionRequests.status, "pending"), isAdmin ? sql`true` : eq(extractionRequests.coordinatorId, deciderId))).returning();
    if (!request) return null;
    await transaction.update(extractions).set({ status: status === "approved" ? "pending" : "failed", errorCode: status === "rejected" ? "REQUEST_REJECTED" : null, errorMessage: status === "rejected" ? comment ?? "La solicitud ha sido rechazada." : null, updatedAt: new Date(), completedAt: status === "rejected" ? new Date() : null }).where(and(eq(extractions.requestGroupId, groupId), eq(extractions.status, "pending")));
    return request;
  });
}
