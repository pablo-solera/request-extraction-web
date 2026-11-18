import "server-only";

import { resolveUserIdentities } from "@/lib/employees/identity-service";
import { listRequestExtractions } from "@/lib/extractions/repository";
import { applicationUrl, getMailSettings, isMailEnabled, sendMail } from "@/lib/mail/mailer";
import { claimNotification, listRetryableNotifications, markNotificationFailed, markNotificationSent, markNotificationSkipped } from "@/lib/mail/repository";
import { getComparison, getRequestWithRequester } from "@/lib/transformer/repository";
import { loadCompletedMail, supportMail, type MailContent, type RequestSummary, type SupportEvent } from "@/lib/mail/templates";

type Delivery = { to: string; content: MailContent } | null;

async function requestContext(requestGroupId: string) {
  const rows = await listRequestExtractions(requestGroupId);
  const first = rows[0];
  if (!first) return null;
  const { extraction, requester } = first;
  const identity = (await resolveUserIdentities([requester])).get(requester.id);
  const summary: RequestSummary = { axCode: extraction.axCode, imcEdition: extraction.imcEdition, brand: extraction.brand, typekeys: rows.map((row) => row.extraction.modelCode) };
  return { rows, summary, requesterName: identity?.name ?? "Usuario", requesterEmail: identity?.email ?? null, url: applicationUrl(`/history?request=${requestGroupId}`) };
}

/**
 * Sends one notification at most once per event: the claim in Postgres makes concurrent detections (history, reconciliation)
 * agree, and a failed send is retried on the next detection up to MAX_MAIL_ATTEMPTS. Never throws; logs without addresses.
 */
async function deliver(kind: string, requestGroupId: string, ref: string, build: () => Promise<Delivery>) {
  if (!isMailEnabled()) return false;
  let claimId: string | undefined;
  try {
    const claim = await claimNotification(requestGroupId, kind, ref);
    if (!claim) return false;
    claimId = claim.id;
    const delivery = await build();
    if (!delivery) {
      console.warn(`Mail notification ${kind} skipped: no recipient available.`);
      await markNotificationSkipped(claim.id);
      return false;
    }
    await sendMail({ to: delivery.to, ...delivery.content });
    await markNotificationSent(claim.id);
    return true;
  } catch (error) {
    const { code, name } = (error ?? {}) as { code?: string; name?: string };
    console.error(`Mail notification ${kind} failed (${code ?? name ?? "unknown"}).`);
    if (claimId) await markNotificationFailed(claimId).catch(() => undefined);
    return false;
  }
}

/** The technician's data is loaded in BMW_Labour, so the LST can be uploaded. */
export function notifyLoadCompleted(requestGroupId: string, loadRef: string) {
  return deliver("load_completed", requestGroupId, loadRef, async () => {
    const context = await requestContext(requestGroupId);
    if (!context?.requesterEmail) return null;
    return { to: context.requesterEmail, content: loadCompletedMail({ ...context.summary, requesterName: context.requesterName, url: context.url }) };
  });
}

function supportDelivery(event: SupportEvent, requestGroupId: string, details: (context: NonNullable<Awaited<ReturnType<typeof requestContext>>>) => string[]) {
  return async (): Promise<Delivery> => {
    const context = await requestContext(requestGroupId);
    if (!context) return null;
    return { to: getMailSettings().supportTo, content: supportMail({ ...context.summary, event, requesterName: context.requesterName, details: details(context), url: context.url }) };
  };
}

export function notifyLoadFailed(requestGroupId: string, loadRef: string, error: string | null) {
  return deliver("load_failed", requestGroupId, loadRef, supportDelivery("load_failed", requestGroupId, () => [error ? `Error: ${error}` : "Error desconocido"]));
}

export function notifyComparisonFailed(requestGroupId: string, comparisonId: string, error: string | null) {
  return deliver("comparison_failed", requestGroupId, comparisonId, supportDelivery("comparison_failed", requestGroupId, () => [error ? `Error: ${error}` : "Error desconocido"]));
}

export function notifyReportFailed(requestGroupId: string, reportRef: string, error: string | null) {
  return deliver("report_failed", requestGroupId, reportRef, supportDelivery("report_failed", requestGroupId, () => [error ? `Error: ${error}` : "Error desconocido"]));
}

/** Once every typekey of an approved request has finished, tells support about the ones that failed. */
export async function notifyExtractionFailures(requestGroupId: string) {
  if (!isMailEnabled()) return false;
  try {
    const rows = await listRequestExtractions(requestGroupId);
    if (rows.length === 0 || rows[0]!.requestStatus !== "approved") return false;
    if (rows.some(({ extraction }) => extraction.status === "pending" || extraction.status === "running")) return false;
    const failed = rows.map(({ extraction }) => extraction).filter((extraction) => extraction.status === "failed" && extraction.errorCode !== "REQUEST_REJECTED");
    if (failed.length === 0) return false;
    const ref = failed.map((extraction) => extraction.id).sort().join(",");
    return deliver("extraction_failed", requestGroupId, ref, supportDelivery("extraction_failed", requestGroupId, () =>
      failed.map((extraction) => `${extraction.modelCode}: ${extraction.errorMessage ?? "Error desconocido"}`)));
  } catch {
    console.error("Mail notification extraction_failed failed (lookup).");
    return false;
  }
}

/**
 * Sends again the notifications that failed or were left behind by a crash, at most MAX_MAIL_ATTEMPTS times each.
 * Whatever is no longer true (a load that was reset since) is skipped instead of sent.
 */
export async function retryPendingNotifications() {
  if (!isMailEnabled()) return 0;
  let sent = 0;
  try {
    for (const row of await listRetryableNotifications()) {
      const request = (await getRequestWithRequester(row.requestGroupId))?.request;
      let ok = false;
      if (row.kind === "load_completed") {
        if (request?.loadStatus === "completed" && request.loadRemoteId === row.ref) ok = await notifyLoadCompleted(row.requestGroupId, row.ref);
        else await markNotificationSkipped(row.id);
      } else if (row.kind === "load_failed") {
        ok = await notifyLoadFailed(row.requestGroupId, row.ref, request?.loadError ?? null);
      } else if (row.kind === "comparison_failed") {
        ok = await notifyComparisonFailed(row.requestGroupId, row.ref, (await getComparison(row.ref))?.errorMessage ?? null);
      } else if (row.kind === "report_failed") {
        ok = await notifyReportFailed(row.requestGroupId, row.ref, request?.reportError ?? null);
      } else if (row.kind === "extraction_failed") {
        ok = await notifyExtractionFailures(row.requestGroupId);
      } else await markNotificationSkipped(row.id);
      if (ok) sent++;
    }
  } catch {
    console.error("Mail notification retry failed (lookup).");
  }
  return sent;
}
