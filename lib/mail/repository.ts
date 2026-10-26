import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { mailNotifications } from "@/db/schema";

export const MAX_MAIL_ATTEMPTS = 3;

/**
 * Reserves the right to send one notification. Succeeds for a new event, or to retry one that failed fewer than
 * MAX_MAIL_ATTEMPTS times; a notification that is sending or was sent is never claimed again.
 */
export async function claimNotification(requestGroupId: string, kind: string, ref: string) {
  const [row] = await getDb().insert(mailNotifications).values({ requestGroupId, kind, ref }).onConflictDoUpdate({
    target: [mailNotifications.requestGroupId, mailNotifications.kind, mailNotifications.ref],
    set: { status: "sending", attempts: sql`${mailNotifications.attempts} + 1` },
    setWhere: and(eq(mailNotifications.status, "failed"), lt(mailNotifications.attempts, MAX_MAIL_ATTEMPTS)),
  }).returning();
  return row ?? null;
}

export async function markNotificationSent(id: string) {
  await getDb().update(mailNotifications).set({ status: "sent", sentAt: new Date() }).where(eq(mailNotifications.id, id));
}

export async function markNotificationFailed(id: string) {
  await getDb().update(mailNotifications).set({ status: "failed" }).where(eq(mailNotifications.id, id));
}
