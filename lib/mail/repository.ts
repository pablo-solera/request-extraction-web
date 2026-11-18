import "server-only";

import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { mailNotifications } from "@/db/schema";

const MAX_MAIL_ATTEMPTS = 3;
/** A notification still marked as sending after this long was left behind by a crash, so it may be sent again. */
const STALE_SENDING_MS = 10 * 60 * 1000;

const retryable = (staleBefore: Date) => and(
  lt(mailNotifications.attempts, MAX_MAIL_ATTEMPTS),
  or(eq(mailNotifications.status, "failed"), and(eq(mailNotifications.status, "sending"), lt(mailNotifications.claimedAt, staleBefore))),
);

/**
 * Reserves the right to send one notification. Succeeds for a new event, or to retry one that failed (or was left
 * sending by a crash) fewer than MAX_MAIL_ATTEMPTS times; a notification that was sent or skipped is never claimed again.
 */
export async function claimNotification(requestGroupId: string, kind: string, ref: string) {
  const [row] = await getDb().insert(mailNotifications).values({ requestGroupId, kind, ref }).onConflictDoUpdate({
    target: [mailNotifications.requestGroupId, mailNotifications.kind, mailNotifications.ref],
    set: { status: "sending", attempts: sql`${mailNotifications.attempts} + 1`, claimedAt: new Date() },
    setWhere: retryable(new Date(Date.now() - STALE_SENDING_MS)),
  }).returning();
  return row ?? null;
}

export async function markNotificationSent(id: string) {
  await getDb().update(mailNotifications).set({ status: "sent", sentAt: new Date() }).where(eq(mailNotifications.id, id));
}

export async function markNotificationFailed(id: string) {
  await getDb().update(mailNotifications).set({ status: "failed" }).where(eq(mailNotifications.id, id));
}

/** The notification has nobody to be sent to; unlike a failure it is not retried. */
export async function markNotificationSkipped(id: string) {
  await getDb().update(mailNotifications).set({ status: "skipped" }).where(eq(mailNotifications.id, id));
}

/** Notifications that failed or were left sending, oldest first, for the reconciliation to send again. */
export async function listRetryableNotifications(limit = 20) {
  return getDb().select().from(mailNotifications)
    .where(and(inArray(mailNotifications.status, ["failed", "sending"]), retryable(new Date(Date.now() - STALE_SENDING_MS))))
    .orderBy(asc(mailNotifications.createdAt)).limit(limit);
}
