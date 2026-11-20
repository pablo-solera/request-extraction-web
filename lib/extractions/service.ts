import "server-only";

import { findTableConflict, startLoadForRequest, startReportForRequest } from "@/lib/transformer/service";
import { notifyExtractionFailures } from "@/lib/mail/notifications";
import type { Extraction, ExtractionStatus } from "@/db/schema";
import {
  attachReaderRequest,
  releaseSubmission,
  claimExtractionSubmission,
  insertExtractionsWithCapacity,
  listActiveExtractions,
  getRequestStatus,
  listApprovedRequestExtractions,
  markSubmissionFailed,
  claimReaderProgressPoll,
  updateExtractionState,
  getExtractionWithRequester,
  listRequestExtractions,
  listVisibleExtractions as listVisibleExtractionsRepository,
  listVisibleExtractionsByIds as listVisibleExtractionsByIdsRepository,
  cancelUnsubmittedExtraction,
  markExtractionResumed,
  recordExtractionAction,
} from "@/lib/extractions/repository";
import type { RequestPageOptions } from "@/lib/extractions/repository";
import type { ExtractionFormInput } from "@/lib/extractions/validation";
import type { ExtractionListItem, ExtractionReaderDetail } from "@/lib/extractions/types";
import { ReaderError } from "@/lib/readers/errors";
import { getExtractionReader, getExtractionReaderCapabilities, mapRenaultReaderStatus, type ExtractionReaderCapabilities } from "@/lib/readers/registry";
import { getBmwDevelopmentCodes, getBmwTypekeys } from "@/lib/readers/bmw/client";
import { getMercedesModels } from "@/lib/readers/mercedes/client";
import { getRenaultLabourFamilies } from "@/lib/readers/renault/client";
import { findCoordinatorTeamUserIds, findCoordinatorUser, isUserInCoordinatorTeam } from "@/lib/employees/org-service";
import type { UserRole } from "@/lib/auth/session";
import type { RenaultState } from "@/lib/readers/renault/types";
import { describeError } from "@/lib/logging/describe-error";

export function mapReaderStatus(state: RenaultState): ExtractionStatus {
  return mapRenaultReaderStatus(state);
}

const MAX_SUBMISSION_ATTEMPTS = 5;

/** Readers on the core v1 contract report their own progress, so the web follows them live. */
const usesCoreProgress = (readerKey: string) => readerKey === "bmw-labours" || readerKey === "mercedes-labours";

async function submitExtraction(extraction: Extraction, context?: Awaited<ReturnType<ReturnType<typeof getExtractionReader>["prepareSubmission"]>>) {
  if (extraction.remoteRequestId || extraction.status !== "pending") return extraction;
  const claimed = await claimExtractionSubmission(extraction.id);
  if (!claimed) return extraction;
  try {
    const reader = getExtractionReader(claimed.readerKey);
    const remote = await reader.create(claimed, context);
    const initialReaderState = usesCoreProgress(claimed.readerKey) ? { progress: 0, readerStatus: remote.status ?? "queued" } : undefined;
    return (await attachReaderRequest(claimed.id, remote.requestId, claimed.submittedAt!, initialReaderState)) ?? claimed;
  } catch (error) {
    const readerError = error instanceof ReaderError ? error : null;
    // A temporary reader problem is not the technician's failure: hand the submission back and let the reconciliation try again.
    if (readerError?.retryable && claimed.attemptCount < MAX_SUBMISSION_ATTEMPTS && await releaseSubmission(claimed.id, claimed.submittedAt!)) return claimed;
    if (error instanceof ReaderError && error.code === "READER_CONFIGURATION_ERROR") console.error("Reader integration configuration is invalid.", describeError(error));
    const failed = await markSubmissionFailed(claimed.id, claimed.submittedAt!, {
      errorCode: readerError?.code ?? "INTERNAL_ERROR",
      errorMessage: readerError?.message ?? "No se ha podido iniciar la extracción.",
    });
    if (failed) await notifyExtractionFailures(claimed.requestGroupId);
    return failed ?? claimed;
  }
}

export async function createExtraction(user: { id: string; oracleEmpId: number | null }, input: ExtractionFormInput, role: UserRole, options: { confirmReplace?: boolean } = {}) {
  await Promise.all([validateBmwSelections(input), validateRenaultFamilies(input), validateMercedesSelections(input)]);
  const first = input.vehicles[0];
  if (first?.manufacturerGroup === "BMW" && !options.confirmReplace && await findTableConflict({ axCode: input.axCode, imcEdition: input.imcEdition, brand: first.brand })) {
    throw new ReaderError("Ya hay datos cargados para este código AX y edición. Confirma que quieres reemplazarlos para continuar.", "TABLE_REPLACE_NOT_CONFIRMED", false, 409);
  }
  const requiresApproval = role === "employee";
  const coordinator = requiresApproval ? await findCoordinatorUser(user) : null;
  if (requiresApproval && !coordinator) throw new ReaderError("No se ha podido resolver un coordinador para la solicitud.", "COORDINATOR_UNAVAILABLE", true);
  const inserted = await insertExtractionsWithCapacity(user.id, input, 50, { status: requiresApproval ? "pending" : "approved", coordinatorId: coordinator?.id ?? null });
  if (!inserted) throw new ReaderError("Has superado el límite de extracciones en curso.", "ACTIVE_EXTRACTION_LIMIT", true, 429);
  return { requestGroupId: inserted[0].requestGroupId, extractions: inserted };
}

async function validateRenaultFamilies(input: ExtractionFormInput) {
  const vehicles = input.vehicles.filter((vehicle) => vehicle.manufacturerGroup === "Renault");
  if (vehicles.length === 0) return;
  const options = await getRenaultLabourFamilies(vehicles[0]!.brand);
  const available = new Set(options.map((option) => option.value));
  for (const vehicle of vehicles) {
    if (!available.has(vehicle.modelCode)) {
      throw new ReaderError("La familia ya no está disponible para el fabricante seleccionado.", "INVALID_RENAULT_SELECTION", false, 400);
    }
  }
}

async function validateMercedesSelections(input: ExtractionFormInput) {
  const vehicles = input.vehicles.filter((vehicle) => vehicle.manufacturerGroup === "Mercedes");
  const series = vehicles[0]?.series;
  if (!series) return;
  const { models } = await getMercedesModels(series);
  const available = new Set(models.map((model) => model.value));
  if (vehicles.some((vehicle) => !available.has(vehicle.modelCode))) {
    throw new ReaderError("El modelo ya no está disponible para la serie seleccionada.", "INVALID_MERCEDES_SELECTION", false, 400);
  }
}

async function validateBmwSelections(input: ExtractionFormInput) {
  const vehicles = input.vehicles.filter((vehicle) => vehicle.manufacturerGroup === "BMW");
  await Promise.all(vehicles.map(async (vehicle) => {
    const [developmentCodes, typekeys] = await Promise.all([
      getBmwDevelopmentCodes(vehicle.brand, vehicle.series),
      getBmwTypekeys(vehicle.brand, vehicle.series, vehicle.developmentCode),
    ]);
    if (!developmentCodes.some((option) => option.value === vehicle.developmentCode)) {
      throw new ReaderError("El código de desarrollo ya no está disponible para la serie seleccionada.", "INVALID_BMW_SELECTION", false, 400);
    }
    if (!typekeys.some((option) => option.value === vehicle.typekey)) {
      throw new ReaderError("El typekey no pertenece al código de desarrollo seleccionado.", "INVALID_BMW_SELECTION", false, 400);
    }
  }));
}

export async function submitNewApprovedRequest(requestGroupId: string) {
  await submitApprovedRequest(requestGroupId);
}

async function syncExtraction(extraction: Extraction) {
  if (extraction.status === "pending" && !extraction.remoteRequestId) return (await getRequestStatus(extraction.requestGroupId)) === "approved" ? submitExtraction(extraction) : extraction;
  if (!extraction.remoteRequestId || extraction.status === "completed" || extraction.status === "failed") return extraction;
  try {
    let current = extraction;
    if (usesCoreProgress(extraction.readerKey)) {
      const claimed = await claimReaderProgressPoll(extraction.id, new Date(Date.now() - 10_000));
      if (!claimed) return extraction;
      current = claimed;
    }
    const reader = getExtractionReader(extraction.readerKey);
    const remote = await reader.getState(extraction.remoteRequestId);
    const status = reader.mapStatus(remote);
    const updated = await updateExtractionState(extraction.id, {
      status,
      errorCode: status === "failed" ? "JOB_FAILED" : null,
      errorMessage: status === "failed" ? reader.failureMessage(remote) : null,
      progress: status === "completed" ? 100 : remote.progress ?? current.progress ?? null,
      readerStatus: remote.status,
      readerStalled: remote.readerStalled ?? false,
      ...(status === "completed" && remote.dataDate ? { dataDate: remote.dataDate } : {}),
    });
    if (status === "completed") {
      await startLoadForRequest(extraction.requestGroupId).catch((error) => console.error("Transformer load could not be started.", describeError(error)));
      await startReportForRequest(extraction.requestGroupId).catch((error) => console.error("Transformer report could not be started.", describeError(error)));
    }
    if (status === "completed" || status === "failed" || status === "cancelled") await notifyExtractionFailures(extraction.requestGroupId);
    return updated;
  } catch (error) {
    if (error instanceof ReaderError && error.retryable) return extraction;
    const readerError = error instanceof ReaderError ? error : null;
    const failed = await updateExtractionState(extraction.id, { status: "failed", errorCode: readerError?.code ?? "STATUS_SYNC_FAILED", errorMessage: "No se ha podido recuperar el estado de la extracción." });
    await notifyExtractionFailures(extraction.requestGroupId);
    return failed;
  }
}

export type ExtractionActor = { id: string; oracleEmpId: number | null; role: UserRole };

function localizedReaderActionError(error: unknown): unknown {
  if (!(error instanceof ReaderError) || error.code !== "READER_CONFLICT") return error;
  const detail = error.message.toLocaleLowerCase("en-US");
  const message = detail.includes("active") || detail.includes("worker")
    ? "El reader todavía detecta actividad. Espera a que termine antes de reanudar."
    : detail.includes("cancel")
      ? "La extracción está cancelada y no se puede reanudar."
      : "El reader no permite esta acción en el estado actual de la extracción.";
  return new ReaderError(message, error.code, error.retryable, error.status);
}

export async function listExtractionsVisibleToUser(actor: ExtractionActor, options?: RequestPageOptions) {
  const teamIds = actor.role === "admin" ? null : actor.role === "coordinator" ? await findCoordinatorTeamUserIds(actor) : [];
  return listVisibleExtractionsRepository(actor.id, teamIds, options);
}

export async function listExtractionsVisibleToUserByIds(actor: ExtractionActor, ids: string[]) {
  const teamIds = actor.role === "admin" ? null : actor.role === "coordinator" ? await findCoordinatorTeamUserIds(actor) : [];
  return listVisibleExtractionsByIdsRepository(actor.id, ids, teamIds);
}

export async function getReaderCapabilitiesForExtractions(rows: Array<{ extraction: Extraction }>) {
  const keys = [...new Set(rows.map(({ extraction }) => extraction.readerKey))];
  const entries = await Promise.all(keys.map(async (key) => [key, await getExtractionReaderCapabilities(key)] as const));
  return new Map(entries);
}

async function canManage(ownerId: string, requester: Parameters<typeof isUserInCoordinatorTeam>[1], actor: ExtractionActor) {
  if (ownerId === actor.id || actor.role === "admin") return true;
  return actor.role === "coordinator" && await isUserInCoordinatorTeam(actor, requester);
}

export async function getManageableExtraction(id: string, actor: ExtractionActor) {
  const row = await getExtractionWithRequester(id);
  if (!row) return null;
  return await canManage(row.extraction.userId, row.requester, actor) ? row : null;
}

/** Every typekey of a request that has no work left, for "Volver a solicitar": the data is extracted again in full because it can change from one day to the next. */
export async function getRepeatableRequestItems(requestGroupId: string, actor: ExtractionActor) {
  const rows = await listRequestExtractions(requestGroupId);
  const first = rows[0];
  if (!first || first.requestStatus === "pending" || !await canManage(first.extraction.userId, first.requester, actor)) return null;
  if (rows.some(({ extraction }) => extraction.status === "pending" || extraction.status === "running")) return null;
  return rows.map((row) => row.extraction);
}

export async function performExtractionAction(
  id: string,
  action: "cancel" | "resume",
  actor: ExtractionActor,
  force = false,
) {
  const row = await getManageableExtraction(id, actor);
  if (!row) throw new ReaderError("No se ha encontrado la extracción o no tienes permiso para gestionarla.", "EXTRACTION_NOT_FOUND", false, 404);
  const { extraction } = row;
  const auditAction = action === "resume" && force ? "force_resume" : action;
  const recordAction = async (outcome: "succeeded" | "failed", readerStatus?: string | null) => {
    try {
      await recordExtractionAction({ extractionId: id, actorId: actor.id, action: auditAction, outcome, readerStatus });
    } catch (error) {
      console.error("Extraction action audit could not be saved.", describeError(error));
    }
  };

  try {
  if (action === "cancel") {
    if (extraction.status !== "pending" && extraction.status !== "running") {
      throw new ReaderError("La extracción ya no se puede cancelar en su estado actual.", "ACTION_NOT_AVAILABLE", false, 409);
    }
    if (!extraction.remoteRequestId) {
      const cancelled = await cancelUnsubmittedExtraction(id);
      if (!cancelled) throw new ReaderError("La extracción se está enviando al reader; vuelve a intentarlo en unos segundos.", "ACTION_CONFLICT", true, 409);
      await recordAction("succeeded", "cancelled");
      await notifyExtractionFailures(extraction.requestGroupId);
      return { status: "cancelled" as const, readerStatus: "cancelled" };
    }
    const reader = getExtractionReader(extraction.readerKey);
    if (!reader.cancel) throw new ReaderError("Este reader todavía no permite cancelar extracciones.", "ACTION_NOT_SUPPORTED", false, 501);
    let result: { requestId: string; status: string };
    try { result = await reader.cancel(extraction.remoteRequestId); }
    catch (error) { throw localizedReaderActionError(error); }
    if (result.status === "cancelled") {
      await updateExtractionState(id, { status: "cancelled", errorCode: null, errorMessage: null, readerStatus: "cancelled", readerStalled: false });
      await notifyExtractionFailures(extraction.requestGroupId);
    } else {
      await updateExtractionState(id, { status: "running", errorCode: null, errorMessage: null, readerStatus: "cancelling", readerStalled: false });
    }
    await recordAction("succeeded", result.status);
    return { status: result.status === "cancelled" ? "cancelled" as const : "running" as const, readerStatus: result.status };
  }

  if (!extraction.remoteRequestId) throw new ReaderError("La extracción todavía no se ha enviado al reader y no se puede reanudar.", "ACTION_NOT_AVAILABLE", false, 409);
  const reader = getExtractionReader(extraction.readerKey);
  if (!reader.resume || !reader.getState) throw new ReaderError("Este reader todavía no permite reanudar extracciones.", "ACTION_NOT_SUPPORTED", false, 501);
  const remote = await reader.getState(extraction.remoteRequestId);
  if (remote.status === "cancelled" || remote.status === "cancelling") {
    throw new ReaderError("Las extracciones canceladas no se pueden reanudar.", "ACTION_NOT_AVAILABLE", false, 409);
  }
  if (force && !remote.readerStalled) {
    throw new ReaderError("Solo se puede forzar la reanudación cuando el reader confirma que la extracción está atascada.", "FORCE_RESUME_NOT_ALLOWED", false, 409);
  }
  if (!force && !["failed", "paused", "rate_limited", "queued"].includes(remote.status) && !remote.readerStalled) {
    throw new ReaderError("La extracción no está en un estado que permita reanudarla.", "ACTION_NOT_AVAILABLE", false, 409);
  }
  let result: { requestId: string; status: string };
  try { result = await reader.resume(extraction.remoteRequestId, force); }
  catch (error) { throw localizedReaderActionError(error); }
  const updated = await markExtractionResumed(id, result.status || "queued");
  await recordAction("succeeded", result.status || "queued");
  return { status: updated?.status ?? "running", readerStatus: result.status || "queued" };
  } catch (error) {
    await recordAction("failed", error instanceof ReaderError ? error.code : "ACTION_FAILED");
    throw error;
  }
}

export async function getExtractionReaderDetail(id: string, actor: ExtractionActor): Promise<ExtractionReaderDetail> {
  const row = await getManageableExtraction(id, actor);
  if (!row) throw new ReaderError("No se ha encontrado la extracción o no tienes permiso para verla.", "EXTRACTION_NOT_FOUND", false, 404);
  if (!row.extraction.remoteRequestId) throw new ReaderError("Todavía no hay detalles disponibles para esta extracción.", "DETAILS_NOT_AVAILABLE", false, 409);
  const state = await getExtractionReader(row.extraction.readerKey).getState(row.extraction.remoteRequestId);
  const remoteDetails = state.details && typeof state.details === "object" ? state.details as Record<string, unknown> : {};
  const typekeys = Array.isArray(remoteDetails.typekeys) ? remoteDetails.typekeys.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    if (typeof value.typekey !== "string" || !/^[A-Z0-9]{4}$/.test(value.typekey)) return [];
    const numberOrNull = (key: string) => typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] as number : null;
    return [{
      typekey: value.typekey,
      series: typeof value.series === "string" ? value.series.slice(0, 100) : null,
      family: typeof value.family === "string" ? value.family.slice(0, 100) : null,
      completed: numberOrNull("completedAwSheetOIDs"),
      total: numberOrNull("awSheetOIDs"),
      remaining: numberOrNull("remainingAwSheetOIDs"),
      failed: numberOrNull("failedOids"),
      groups: numberOrNull("hgs"),
    }];
  }) : [];
  return {
    status: state.status,
    stage: typeof state.stage === "string" ? state.stage.slice(0, 160) : null,
    progress: typeof state.progress === "number" ? state.progress : row.extraction.progress,
    stalled: state.readerStalled ?? false,
    typekeys,
  };
}

export async function syncLiveReaderProgress<T extends { extraction: Extraction; requestStatus: ExtractionListItem["requestStatus"] }>(rows: T[]): Promise<T[]> {
  const synchronized: typeof rows = [];
  for (let index = 0; index < rows.length; index += 5) {
    const batch = rows.slice(index, index + 5);
    synchronized.push(...await Promise.all(batch.map(async (row) => {
      const { extraction, requestStatus } = row;
      const shouldSync = usesCoreProgress(extraction.readerKey)
        && requestStatus === "approved"
        && (extraction.status === "pending" || extraction.status === "running")
        && Boolean(extraction.remoteRequestId);
      return { ...row, extraction: shouldSync ? await syncExtraction(extraction) : extraction };
    })));
  }
  return synchronized;
}

export async function reconcileActiveExtractions() {
  const active = await listActiveExtractions();
  for (let index = 0; index < active.length; index += 5) {
    const batch = active.slice(index, index + 5);
    const pending = batch.filter((extraction) => extraction.status === "pending" && !extraction.remoteRequestId);
    const byReader = new Map<string, Extraction[]>();
    for (const extraction of pending) byReader.set(extraction.readerKey, [...(byReader.get(extraction.readerKey) ?? []), extraction]);
    const submissions = [...byReader.entries()].map(async ([readerKey, extractions]) => {
      const context = await getExtractionReader(readerKey).prepareSubmission();
      await Promise.all(extractions.map((extraction) => submitExtraction(extraction, context)));
    });
    const syncs = batch.filter((extraction) => extraction.status !== "pending" || Boolean(extraction.remoteRequestId)).map(syncExtraction);
    await Promise.all([...submissions, ...syncs]);
  }
  return active.length;
}

export async function submitApprovedRequest(requestGroupId: string) {
  const extractions = await listApprovedRequestExtractions(requestGroupId);
  await submitExtractions(extractions);
}

async function submitExtractions(extractions: Extraction[]) {
  if (extractions.length === 0) return [];
  const submitted: Extraction[] = [];
  const byReader = new Map<string, Extraction[]>();
  for (const extraction of extractions) byReader.set(extraction.readerKey, [...(byReader.get(extraction.readerKey) ?? []), extraction]);
  for (const [readerKey, readerExtractions] of byReader) {
    const context = await getExtractionReader(readerKey).prepareSubmission();
    for (let index = 0; index < readerExtractions.length; index += 5) {
      submitted.push(...await Promise.all(readerExtractions.slice(index, index + 5).map((extraction) => submitExtraction(extraction, context))));
    }
  }
  return submitted;
}

export function extractionDto(
  extraction: Extraction,
  requestStatus: ExtractionListItem["requestStatus"] = "approved",
  requesterName: string | null = null,
  capabilities?: ExtractionReaderCapabilities,
): ExtractionListItem {
  const resolvedCapabilities = capabilities ?? (extraction.readerKey === "bmw-labours"
    ? { cancel: true, resume: true, download: true }
    : extraction.readerKey === "mercedes-labours"
      ? { cancel: true, resume: true, download: false }
      : extraction.readerKey === "renault-labours"
      ? { cancel: false, resume: false, download: true }
      : { cancel: false, resume: false, download: false });
  const canCancel = requestStatus !== "rejected" && (
    (extraction.status === "pending" && !extraction.remoteRequestId && !extraction.submittedAt)
    || (resolvedCapabilities.cancel && (extraction.status === "pending" || extraction.status === "running"))
  );
  const canResume = resolvedCapabilities.resume && requestStatus === "approved" && Boolean(extraction.remoteRequestId)
    && extraction.status !== "cancelled"
    && extraction.readerStatus !== "cancelled" && extraction.readerStatus !== "cancelling"
    && (extraction.status === "failed" || extraction.readerStatus === "paused" || extraction.readerStatus === "rate_limited" || extraction.readerStalled);
  const canViewDetails = Boolean(extraction.remoteRequestId) && (extraction.status === "running" || extraction.status === "completed" || extraction.status === "failed" || extraction.status === "cancelled");
  return {
    id: extraction.id,
    requestGroupId: extraction.requestGroupId,
    axCode: extraction.axCode,
    imcEdition: extraction.imcEdition,
    completion: extraction.completion,
    developmentStart: extraction.developmentStart,
    manufacturerGroup: extraction.manufacturerGroup,
    brand: extraction.brand,
    modelDescription: extraction.modelDescription,
    modelCode: extraction.modelCode,
    domain: extraction.domain,
    status: extraction.status,
    requestStatus,
    errorMessage: extraction.errorMessage,
    progress: extraction.progress,
    readerStatus: extraction.readerStatus,
    createdAt: extraction.createdAt.toISOString(),
    updatedAt: extraction.updatedAt.toISOString(),
    downloadReady: resolvedCapabilities.download && extraction.status === "completed",
    requesterName,
    readerStalled: extraction.readerStalled,
    canCancel,
    canResume,
    canForceResume: canResume && extraction.readerStalled,
    canViewDetails,
  };
}
