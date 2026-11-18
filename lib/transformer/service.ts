import "server-only";

import type { TransformerJobStatus } from "@/db/schema";
import { isUserInCoordinatorTeam } from "@/lib/employees/org-service";
import { ReaderError } from "@/lib/readers/errors";
import { getTransformerClient, MAX_LST_BYTES, type TransformerClient } from "@/lib/transformer/client";
import {
  attachComparisonRemote, claimComparisonPoll, claimLoadPoll, claimLoadStart, failComparison, recordLoadStartFailure, getComparison, getRequestWithRequester, insertComparison, listActiveComparisons, listActiveLoads,
  findLoadedTable, listComparisonsForRequests, listRequestsByIds, listRequestsReadyForLoad, markLoadFailedToStart, markLoadRequested, resetFailedLoad, updateComparisonState, updateLoadState,
  claimReportPoll, claimReportStart, listActiveReports, listRequestsReadyForReport, markReportFailedToStart, markReportRequested, recordReportStartFailure, resetFailedReport, updateReportState,
} from "@/lib/transformer/repository";
import { transformerDefinitions, type TransformerKey } from "@/lib/transformer/registry";
import type { TransformerRequestInfo } from "@/lib/transformer/info";
import type { TransformerState } from "@/lib/transformer/types";
import type { UserRole } from "@/lib/auth/session";
import { notifyComparisonFailed, notifyLoadCompleted, notifyLoadFailed, notifyReportFailed, retryPendingNotifications } from "@/lib/mail/notifications";

type Actor = { id: string; oracleEmpId: number | null; role: UserRole };

function isTransformerConfigured(key: TransformerKey = "bmw") {
  return Boolean(process.env[transformerDefinitions[key].envVar]?.trim());
}

function mapStatus(state: TransformerState): TransformerJobStatus {
  switch (state.status) {
    case "completed": return "completed";
    case "failed":
    case "cancelled": return "failed";
    case "queued": return "queued";
    // Any other status, including one this web does not know yet, means the job is still going.
    default: return "running";
  }
}

const failureMessage = (state: TransformerState, fallback: string) => (state.status === "cancelled" ? "La operación ha sido cancelada." : state.error?.message.slice(0, 500)) || fallback;

const TRANSFORMER_START_INTERVAL_MS = 30_000;
const MAX_LOAD_START_FAILURES = 5;

type ReadyRequest = Awaited<ReturnType<typeof listRequestsReadyForLoad>>[number];

async function failToStart(requestGroupId: string, message: string) {
  const failed = await markLoadFailedToStart(requestGroupId, message);
  if (failed) await notifyLoadFailed(requestGroupId, `start-${failed.loadAttempts}`, message);
}

/** Sends one request to the transformer. Returns true when the load was queued; the claim in markLoadRequested keeps a request from being loaded twice. */
async function startLoad(client: TransformerClient, { request, items }: ReadyRequest) {
  // Every path (last typekey completing, history, reconciliation, retry) claims the request first, so two of them never call the transformer at once.
  if (!await claimLoadStart(request.requestGroupId, new Date(Date.now() - TRANSFORMER_START_INTERVAL_MS))) return false;
  const typekeys = items.flatMap((item) => {
    const { typekey, series, developmentCode } = item.readerParams;
    return typekey && series && developmentCode ? [{ typekey, series, family: developmentCode, ...(item.dataDate ? { date: item.dataDate } : {}) }] : [];
  });
  const brand = request.brand === "MINI" ? "MINI" : request.brand === "BMW" ? "BMW" : null;
  if (!brand || typekeys.length !== items.length) {
    await failToStart(request.requestGroupId, "La solicitud no tiene los datos necesarios para cargarla.");
    return false;
  }
  try {
    const { loadId } = await client.createLoad({ axCode: request.axCode, imcEdition: request.imcEdition, brand, typekeys });
    return Boolean(await markLoadRequested(request.requestGroupId, loadId));
  } catch (error) {
    if (error instanceof ReaderError && error.retryable) {
      if (await recordLoadStartFailure(request.requestGroupId) >= MAX_LOAD_START_FAILURES) await failToStart(request.requestGroupId, "El servicio de carga no responde. Inténtalo de nuevo más tarde con \"Reintentar carga\".");
      return false;
    }
    await failToStart(request.requestGroupId, error instanceof ReaderError ? error.message : "No se ha podido iniciar la carga.");
    return false;
  }
}

async function startLoads(client: TransformerClient) {
  let started = 0;
  for (const ready of await listRequestsReadyForLoad()) if (await startLoad(client, ready)) started++;
  return started;
}

/** Called when a typekey completes: loads the request right away if that was its last one. Safe to call for any request. */
export async function startLoadForRequest(requestGroupId: string, client: TransformerClient = getTransformerClient()) {
  if (!isTransformerConfigured()) return false;
  const [ready] = await listRequestsReadyForLoad(1, requestGroupId);
  return ready ? startLoad(client, ready) : false;
}

/** Loading replaces the whole table of an AX code and edition, so the form asks for confirmation when one is already there. */
export async function findTableConflict(input: { axCode: string; imcEdition: string; brand: string }) {
  if (!isTransformerConfigured()) return null;
  const row = await findLoadedTable(input);
  return row ? { loadedAt: row.loadedAt?.toISOString() ?? null, loadStatus: row.loadStatus } : null;
}


/** Sends ready requests that have no load yet, at most once per interval each, so the history unblocks them without a scheduled job. */
export async function startPendingLoads(requestGroupIds: string[], client: TransformerClient = getTransformerClient()) {
  if (!isTransformerConfigured()) return 0;
  let started = 0;
  for (const requestGroupId of requestGroupIds) {
    const [ready] = await listRequestsReadyForLoad(1, requestGroupId);
    if (ready && await startLoad(client, ready)) started++;
  }
  return started;
}

type ReadyReport = Awaited<ReturnType<typeof listRequestsReadyForReport>>[number];

async function failReportToStart(requestGroupId: string, message: string) {
  const failed = await markReportFailedToStart(requestGroupId, message);
  if (failed) await notifyReportFailed(requestGroupId, `start-${failed.reportAttempts}`, message);
}

/**
 * Asks mercedes-transformer for the Excel of a finished request. There is no load step: the report is built from the series, the
 * day the reader stored its data under and the model designations of the extractions. The edition goes as stored (`04/0`).
 */
async function startReport(client: TransformerClient, { request, items }: ReadyReport) {
  if (!await claimReportStart(request.requestGroupId, new Date(Date.now() - TRANSFORMER_START_INTERVAL_MS))) return false;
  const series = new Set(items.map((item) => item.readerParams.series));
  const dates = new Set(items.map((item) => item.dataDate ?? item.readerParams.date));
  const [seriesText] = [...series];
  const [date] = [...dates];
  if (series.size !== 1 || !seriesText || dates.size !== 1 || !date) {
    await failReportToStart(request.requestGroupId, "La solicitud no tiene la serie y la fecha de extracción necesarias para generar el informe.");
    return false;
  }
  try {
    const { reportId } = await client.createReport({
      axCode: request.axCode,
      imcEdition: request.imcEdition,
      selection: { series: seriesText, date, models: [...new Set(items.map((item) => item.modelCode))].map((modelDesignation) => ({ modelDesignation })) },
    });
    return Boolean(await markReportRequested(request.requestGroupId, reportId));
  } catch (error) {
    if (error instanceof ReaderError && error.retryable) {
      if (await recordReportStartFailure(request.requestGroupId) >= MAX_LOAD_START_FAILURES) await failReportToStart(request.requestGroupId, "El servicio de informes no responde. Inténtalo de nuevo más tarde con «Reintentar informe».");
      return false;
    }
    await failReportToStart(request.requestGroupId, error instanceof ReaderError ? error.message : "No se ha podido iniciar el informe.");
    return false;
  }
}

async function startReports(client: TransformerClient) {
  let started = 0;
  for (const ready of await listRequestsReadyForReport()) if (await startReport(client, ready)) started++;
  return started;
}

/** Called when a model completes: requests the report right away if that was the last one. Safe to call for any request. */
export async function startReportForRequest(requestGroupId: string, client?: TransformerClient) {
  if (!isTransformerConfigured("mercedes")) return false;
  const [ready] = await listRequestsReadyForReport(1, requestGroupId);
  return ready ? startReport(client ?? getTransformerClient("mercedes"), ready) : false;
}

export async function startPendingReports(requestGroupIds: string[], client: TransformerClient = getTransformerClient("mercedes")) {
  if (!isTransformerConfigured("mercedes")) return 0;
  let started = 0;
  for (const requestGroupId of requestGroupIds) {
    const [ready] = await listRequestsReadyForReport(1, requestGroupId);
    if (ready && await startReport(client, ready)) started++;
  }
  return started;
}

type ActiveReport = Awaited<ReturnType<typeof listActiveReports>>[number];

async function pollReport(client: TransformerClient, request: ActiveReport) {
  try {
    const state = await client.getReport(request.reportRemoteId!);
    const status = mapStatus(state);
    if (status === request.reportStatus) return false;
    // A report whose last step failed can still hold its Excel, so the artifact decides, not the status.
    const downloadable = status === "completed" || Boolean(state.artifacts?.some((artifact) => artifact.name === "report"));
    const error = failureMessage(state, "El informe ha fallado.");
    const updated = await updateReportState(request.requestGroupId, request.reportRemoteId!, { status, error, downloadable });
    if (updated && status === "failed") await notifyReportFailed(request.requestGroupId, request.reportRemoteId!, error);
    return Boolean(updated);
  } catch (error) {
    if (error instanceof ReaderError && error.retryable) return false;
    const message = error instanceof ReaderError ? error.message : "No se ha podido consultar el informe.";
    if (await updateReportState(request.requestGroupId, request.reportRemoteId!, { status: "failed", error: message, downloadable: false })) await notifyReportFailed(request.requestGroupId, request.reportRemoteId!, message);
    return false;
  }
}

async function pollReports(client: TransformerClient) {
  let updated = 0;
  for (const request of await listActiveReports()) if (await pollReport(client, request)) updated++;
  return updated;
}

type ActiveLoad = Awaited<ReturnType<typeof listActiveLoads>>[number];
type ActiveComparison = Awaited<ReturnType<typeof listActiveComparisons>>[number];

async function pollLoad(client: TransformerClient, request: ActiveLoad) {
  try {
    const state = await client.getLoad(request.loadRemoteId!);
    const status = mapStatus(state);
    if (status === request.loadStatus) return false;
    const error = failureMessage(state, "La carga ha fallado.");
    const updated = await updateLoadState(request.requestGroupId, request.loadRemoteId!, { status, error });
    if (updated && status === "completed") await notifyLoadCompleted(request.requestGroupId, request.loadRemoteId!);
    if (updated && status === "failed") await notifyLoadFailed(request.requestGroupId, request.loadRemoteId!, error);
    return Boolean(updated);
  } catch (error) {
    if (error instanceof ReaderError && error.retryable) return false;
    const message = error instanceof ReaderError ? error.message : "No se ha podido consultar la carga.";
    if (await updateLoadState(request.requestGroupId, request.loadRemoteId!, { status: "failed", error: message })) await notifyLoadFailed(request.requestGroupId, request.loadRemoteId!, message);
    return false;
  }
}

async function pollComparison(client: TransformerClient, comparison: ActiveComparison) {
  try {
    const state = await client.getReport(comparison.remoteReportId!);
    const status = mapStatus(state);
    if (status === comparison.status) return false;
    const error = failureMessage(state, "La comparación ha fallado.");
    const updated = await updateComparisonState(comparison.id, { status, error });
    if (updated && status === "failed") await notifyComparisonFailed(comparison.requestGroupId, comparison.id, error);
    return Boolean(updated);
  } catch (error) {
    if (error instanceof ReaderError && error.retryable) return false;
    const message = error instanceof ReaderError ? error.message : "No se ha podido consultar la comparación.";
    if (await updateComparisonState(comparison.id, { status: "failed", error: message })) await notifyComparisonFailed(comparison.requestGroupId, comparison.id, message);
    return false;
  }
}

async function pollLoads(client: TransformerClient) {
  let updated = 0;
  for (const request of await listActiveLoads()) if (await pollLoad(client, request)) updated++;
  return updated;
}

async function pollComparisons(client: TransformerClient) {
  let updated = 0;
  for (const comparison of await listActiveComparisons()) if (await pollComparison(client, comparison)) updated++;
  return updated;
}

const TRANSFORMER_POLL_INTERVAL_MS = 5_000;

/**
 * Asks the transformer about the loads and comparisons of the given requests that are still running, so a technician
 * looking at the history sees the result without waiting for the scheduled reconciliation. Each job is queried at most
 * once per interval, however many people are watching.
 */
export async function syncTransformerStates(requestGroupIds: string[], client: TransformerClient = getTransformerClient(), intervalMs = TRANSFORMER_POLL_INTERVAL_MS, mercedesClient?: TransformerClient) {
  const bmw = isTransformerConfigured();
  const mercedes = isTransformerConfigured("mercedes");
  if (requestGroupIds.length === 0 || (!bmw && !mercedes)) return 0;
  const staleBefore = new Date(Date.now() - intervalMs);
  let updated = 0;
  const requests = await listRequestsByIds(requestGroupIds);
  if (mercedes) {
    const reports = mercedesClient ?? getTransformerClient("mercedes");
    for (const request of requests) {
      if (request.reportStatus !== "queued" && request.reportStatus !== "running") continue;
      const claimed = await claimReportPoll(request.requestGroupId, staleBefore);
      if (claimed && await pollReport(reports, claimed as ActiveReport)) updated++;
    }
  }
  if (!bmw) return updated;
  for (const request of requests) {
    if (request.loadStatus !== "queued" && request.loadStatus !== "running") continue;
    const claimed = await claimLoadPoll(request.requestGroupId, staleBefore);
    if (claimed && await pollLoad(client, claimed as ActiveLoad)) updated++;
  }
  for (const comparison of await listComparisonsForRequests(requests.map((request) => request.requestGroupId))) {
    if (comparison.status !== "queued" && comparison.status !== "running") continue;
    const claimed = await claimComparisonPoll(comparison.id, staleBefore);
    if (claimed && await pollComparison(client, claimed as ActiveComparison)) updated++;
  }
  return updated;
}

/** Sends finished BMW requests to the transformer and follows their loads and comparisons. Does nothing when the transformer is not configured. */
export async function reconcileTransformer(client: TransformerClient = getTransformerClient(), mercedesClient?: TransformerClient) {
  const bmw = isTransformerConfigured();
  const mercedes = isTransformerConfigured("mercedes");
  if (!bmw && !mercedes) return { started: 0, updated: 0 };
  let started = 0;
  let updated = 0;
  if (bmw) {
    started += await startLoads(client);
    updated += await pollLoads(client) + await pollComparisons(client);
  }
  if (mercedes) {
    const reports = mercedesClient ?? getTransformerClient("mercedes");
    started += await startReports(reports);
    updated += await pollReports(reports);
  }
  await retryPendingNotifications();
  return { started, updated };
}

async function requireManageableRequest(requestGroupId: string, actor: Actor) {
  const row = await getRequestWithRequester(requestGroupId);
  const allowed = row && (row.request.requesterId === actor.id || actor.role === "admin"
    || (actor.role === "coordinator" && await isUserInCoordinatorTeam(actor, row.requester)));
  if (!row || !allowed) throw new ReaderError("No se ha encontrado la solicitud o no tienes permiso para gestionarla.", "REQUEST_NOT_FOUND", false, 404);
  return row.request;
}

export async function retryRequestLoad(requestGroupId: string, actor: Actor) {
  await requireManageableRequest(requestGroupId, actor);
  if (!await resetFailedLoad(requestGroupId)) throw new ReaderError("Solo se puede reintentar una carga fallida.", "LOAD_NOT_RETRYABLE", false, 409);
  await startLoadForRequest(requestGroupId).catch((error) => console.error("Transformer load could not be restarted.", error));
}

export async function retryRequestReport(requestGroupId: string, actor: Actor) {
  await requireManageableRequest(requestGroupId, actor);
  if (!await resetFailedReport(requestGroupId)) throw new ReaderError("Solo se puede reintentar un informe fallido.", "REPORT_NOT_RETRYABLE", false, 409);
  await startReportForRequest(requestGroupId).catch((error) => console.error("Transformer report could not be restarted.", error));
}

/** The Excel of a Mercedes-Benz request, named after the AX code. A failed report is downloadable when the transformer kept the file. */
export async function downloadRequestReport(requestGroupId: string, actor: Actor, client?: TransformerClient) {
  const request = await requireManageableRequest(requestGroupId, actor);
  if (!request.reportDownloadable || !request.reportRemoteId) throw new ReaderError("El Excel todavía no está listo.", "REPORT_NOT_READY", false, 409);
  const file = await (client ?? getTransformerClient("mercedes")).downloadReport(request.reportRemoteId);
  return { file, filename: `${request.axCode}.xlsx` };
}

const lstName = /\.(lst|zip)$/i;

export async function uploadComparison(requestGroupId: string, actor: Actor, file: { name: string; bytes: Uint8Array }, client: TransformerClient = getTransformerClient()) {
  const request = await requireManageableRequest(requestGroupId, actor);
  if (request.loadStatus !== "completed" || !request.loadRemoteId) throw new ReaderError("Los datos de la solicitud todavía no están cargados.", "LOAD_NOT_COMPLETED", false, 409);
  if (!lstName.test(file.name)) throw new ReaderError("El fichero debe ser un .LST o un .ZIP con un único .LST.", "INVALID_LST_FILE", false, 400);
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_LST_BYTES) throw new ReaderError("El fichero está vacío o supera el tamaño permitido.", "INVALID_LST_FILE", false, 400);
  const comparison = await insertComparison({ requestGroupId, uploadedById: actor.id, sourceFilename: file.name.slice(0, 200) });
  try {
    const { reportId } = await client.createComparison({ loadId: request.loadRemoteId, axCode: request.axCode, imcEdition: request.imcEdition }, file);
    await attachComparisonRemote(comparison.id, reportId);
  } catch (error) {
    const message = error instanceof ReaderError ? error.message : "No se ha podido iniciar la comparación.";
    // A network problem is reported to the technician in the response; support only hears about errors the transformer itself raised.
    const failed = await failComparison(comparison.id, message);
    if (failed && !(error instanceof ReaderError && error.retryable)) await notifyComparisonFailed(requestGroupId, comparison.id, message);
    throw error;
  }
  return comparison.id;
}

export async function downloadComparison(comparisonId: string, actor: Actor, client: TransformerClient = getTransformerClient()) {
  const comparison = await getComparison(comparisonId);
  if (!comparison) throw new ReaderError("No se ha encontrado la comparación.", "COMPARISON_NOT_FOUND", false, 404);
  const request = await requireManageableRequest(comparison.requestGroupId, actor);
  if (comparison.status !== "completed" || !comparison.remoteReportId) throw new ReaderError("El Excel todavía no está listo.", "COMPARISON_NOT_READY", false, 409);
  const file = await client.downloadReport(comparison.remoteReportId);
  return { file, filename: `${request.axCode}_${request.imcEdition.replace(/\//g, "_")}_DDA_contra_BMW.xlsx` };
}

/** What the history shows for each request: the load state and its comparisons. Requests the actor cannot manage are omitted. */
export async function getTransformerInfo(requestGroupIds: string[], actor: Actor): Promise<Record<string, TransformerRequestInfo>> {
  const requests = await listRequestsByIds(requestGroupIds);
  const visible: typeof requests = [];
  for (const request of requests) {
    try { await requireManageableRequest(request.requestGroupId, actor); visible.push(request); } catch { /* not visible to this actor */ }
  }
  const visibleIds = visible.map((request) => request.requestGroupId);
  const bmwConfigured = isTransformerConfigured();
  const mercedesConfigured = isTransformerConfigured("mercedes");
  let current = visible;
  let comparisons = await listComparisonsForRequests(visibleIds);
  const running = (status: string | null) => status === "queued" || status === "running";
  const pendingStart = current.filter((request) => request.loadStatus === null && request.manufacturerGroup === "BMW" && request.status === "approved").map((request) => request.requestGroupId);
  const pendingReports = current.filter((request) => request.reportStatus === null && request.manufacturerGroup === "Mercedes" && request.status === "approved").map((request) => request.requestGroupId);
  const bmwBusy = bmwConfigured && (pendingStart.length > 0 || current.some((request) => running(request.loadStatus)) || comparisons.some((comparison) => running(comparison.status)));
  const mercedesBusy = mercedesConfigured && (pendingReports.length > 0 || current.some((request) => running(request.reportStatus)));
  if (bmwBusy || mercedesBusy) {
    if (bmwBusy) await startPendingLoads(pendingStart).catch((error) => console.error("Transformer pending load start failed.", error));
    if (mercedesBusy) await startPendingReports(pendingReports).catch((error) => console.error("Transformer pending report start failed.", error));
    await syncTransformerStates(visibleIds).catch((error) => console.error("Transformer state sync failed.", error));
    current = await listRequestsByIds(visibleIds);
    comparisons = await listComparisonsForRequests(visibleIds);
  }
  return Object.fromEntries(current.map((request) => [request.requestGroupId, {
    requestGroupId: request.requestGroupId,
    kind: request.manufacturerGroup === "Mercedes" ? "mercedes" as const : "bmw" as const,
    applicable: request.status === "approved" && (request.manufacturerGroup === "BMW" ? bmwConfigured : request.manufacturerGroup === "Mercedes" && mercedesConfigured),
    loadStatus: request.loadStatus,
    loadAttempts: request.loadAttempts,
    loadError: request.loadError,
    loadedAt: request.loadedAt?.toISOString() ?? null,
    canRetryLoad: request.loadStatus === "failed",
    canUpload: request.loadStatus === "completed",
    report: request.manufacturerGroup === "Mercedes" ? {
      status: request.reportStatus,
      attempts: request.reportAttempts,
      error: request.reportError,
      completedAt: request.reportCompletedAt?.toISOString() ?? null,
      downloadReady: request.reportDownloadable,
      canRetry: request.reportStatus === "failed",
    } : null,
    comparisons: comparisons.filter((comparison) => comparison.requestGroupId === request.requestGroupId).map((comparison) => ({
      id: comparison.id,
      filename: comparison.sourceFilename,
      status: comparison.status,
      error: comparison.errorMessage,
      createdAt: comparison.createdAt.toISOString(),
      downloadReady: comparison.status === "completed",
    })),
  }]));
}
