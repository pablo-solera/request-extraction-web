import "server-only";

import type { TransformerJobStatus } from "@/db/schema";
import { isUserInCoordinatorTeam } from "@/lib/employees/org-service";
import { ReaderError } from "@/lib/readers/errors";
import { getTransformerClient, MAX_LST_BYTES, type TransformerClient } from "@/lib/transformer/client";
import {
  attachComparisonRemote, claimComparisonPoll, claimLoadPoll, claimLoadStart, failComparison, getComparison, getRequestWithRequester, insertComparison, listActiveComparisons, listActiveLoads,
  listComparisonsForRequests, listRequestsByIds, listRequestsReadyForLoad, markLoadFailedToStart, markLoadRequested, resetFailedLoad, updateComparisonState, updateLoadState,
} from "@/lib/transformer/repository";
import type { TransformerRequestInfo } from "@/lib/transformer/info";
import type { TransformerState } from "@/lib/transformer/types";
import type { UserRole } from "@/lib/auth/session";
import { notifyComparisonFailed, notifyLoadCompleted, notifyLoadFailed } from "@/lib/mail/notifications";

type Actor = { id: string; oracleEmpId: number | null; role: UserRole };

export function isTransformerConfigured() {
  return Boolean(process.env.BMW_TRANSFORMER_BASE_URL?.trim());
}

function mapStatus(state: TransformerState): TransformerJobStatus {
  if (state.status === "completed") return "completed";
  if (state.status === "failed") return "failed";
  return state.status === "queued" ? "queued" : "running";
}

const failureMessage = (state: TransformerState, fallback: string) => state.error?.slice(0, 500) || fallback;

type ReadyRequest = Awaited<ReturnType<typeof listRequestsReadyForLoad>>[number];

async function failToStart(requestGroupId: string, message: string) {
  const failed = await markLoadFailedToStart(requestGroupId, message);
  if (failed) await notifyLoadFailed(requestGroupId, `start-${failed.loadAttempts}`, message);
}

/** Sends one request to the transformer. Returns true when the load was queued; the claim in markLoadRequested keeps a request from being loaded twice. */
async function startLoad(client: TransformerClient, { request, items }: ReadyRequest) {
  const typekeys = items.flatMap((item) => {
    const { typekey, series, developmentCode } = item.readerParams;
    return typekey && series && developmentCode ? [{ typekey, series, family: developmentCode }] : [];
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
    if (error instanceof ReaderError && error.retryable) return false;
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

export const TRANSFORMER_START_INTERVAL_MS = 30_000;

/** Sends ready requests that have no load yet, at most once per interval each, so the history unblocks them without a scheduled job. */
export async function startPendingLoads(requestGroupIds: string[], client: TransformerClient = getTransformerClient(), intervalMs = TRANSFORMER_START_INTERVAL_MS) {
  if (!isTransformerConfigured()) return 0;
  const staleBefore = new Date(Date.now() - intervalMs);
  let started = 0;
  for (const requestGroupId of requestGroupIds) {
    const [ready] = await listRequestsReadyForLoad(1, requestGroupId);
    if (!ready || !await claimLoadStart(requestGroupId, staleBefore)) continue;
    if (await startLoad(client, ready)) started++;
  }
  return started;
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

export const TRANSFORMER_POLL_INTERVAL_MS = 5_000;

/**
 * Asks the transformer about the loads and comparisons of the given requests that are still running, so a technician
 * looking at the history sees the result without waiting for the scheduled reconciliation. Each job is queried at most
 * once per interval, however many people are watching.
 */
export async function syncTransformerStates(requestGroupIds: string[], client: TransformerClient = getTransformerClient(), intervalMs = TRANSFORMER_POLL_INTERVAL_MS) {
  if (!isTransformerConfigured() || requestGroupIds.length === 0) return 0;
  const staleBefore = new Date(Date.now() - intervalMs);
  let updated = 0;
  const requests = await listRequestsByIds(requestGroupIds);
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
export async function reconcileTransformer(client: TransformerClient = getTransformerClient()) {
  if (!isTransformerConfigured()) return { started: 0, updated: 0 };
  const started = await startLoads(client);
  const updated = await pollLoads(client) + await pollComparisons(client);
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

const lstName = /\.(lst|zip)$/i;

export async function uploadComparison(requestGroupId: string, actor: Actor, file: { name: string; bytes: Uint8Array }, client: TransformerClient = getTransformerClient()) {
  const request = await requireManageableRequest(requestGroupId, actor);
  if (request.loadStatus !== "completed" || !request.loadRemoteId) throw new ReaderError("Los datos de la solicitud todavía no están cargados.", "LOAD_NOT_COMPLETED", false, 409);
  if (!lstName.test(file.name)) throw new ReaderError("El fichero debe ser un .LST o un .ZIP con un único .LST.", "INVALID_LST_FILE", false, 400);
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_LST_BYTES) throw new ReaderError("El fichero está vacío o supera el tamaño permitido.", "INVALID_LST_FILE", false, 400);
  const comparison = await insertComparison({ requestGroupId, uploadedById: actor.id, sourceFilename: file.name.slice(0, 200) });
  try {
    const { reportId } = await client.createComparison(request.loadRemoteId, file);
    await attachComparisonRemote(comparison.id, reportId);
  } catch (error) {
    const message = error instanceof ReaderError ? error.message : "No se ha podido iniciar la comparación.";
    if (await failComparison(comparison.id, message)) await notifyComparisonFailed(requestGroupId, comparison.id, message);
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
  const configured = isTransformerConfigured();
  let current = visible;
  let comparisons = await listComparisonsForRequests(visibleIds);
  const running = (status: string | null) => status === "queued" || status === "running";
  const pendingStart = current.filter((request) => request.loadStatus === null && request.manufacturerGroup === "BMW" && request.status === "approved").map((request) => request.requestGroupId);
  if (configured && (pendingStart.length > 0 || current.some((request) => running(request.loadStatus)) || comparisons.some((comparison) => running(comparison.status)))) {
    await startPendingLoads(pendingStart).catch((error) => console.error("Transformer pending load start failed.", error));
    await syncTransformerStates(visibleIds).catch((error) => console.error("Transformer state sync failed.", error));
    current = await listRequestsByIds(visibleIds);
    comparisons = await listComparisonsForRequests(visibleIds);
  }
  return Object.fromEntries(current.map((request) => [request.requestGroupId, {
    requestGroupId: request.requestGroupId,
    applicable: configured && request.manufacturerGroup === "BMW" && request.status === "approved",
    loadStatus: request.loadStatus,
    loadAttempts: request.loadAttempts,
    loadError: request.loadError,
    loadedAt: request.loadedAt?.toISOString() ?? null,
    canRetryLoad: request.loadStatus === "failed",
    canUpload: request.loadStatus === "completed",
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
