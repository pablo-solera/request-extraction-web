import "server-only";

import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export async function findUserByOracleEmpId(oracleEmpId: number) {
  const [user] = await getDb().select().from(users).where(eq(users.oracleEmpId, oracleEmpId)).limit(1);
  return user ?? null;
}

export async function findUserByFallbackEmail(email: string) {
  const [user] = await getDb().select().from(users).where(eq(users.fallbackEmail, email)).limit(1);
  return user ?? null;
}

export async function findUsersWithOracleEmpId() {
  return getDb().select({ id: users.id, oracleEmpId: users.oracleEmpId }).from(users).where(isNotNull(users.oracleEmpId));
}

export async function findExistingFallbackEmails() {
  const rows = await getDb().select({ fallbackEmail: users.fallbackEmail }).from(users).where(isNotNull(users.fallbackEmail));
  return rows.flatMap((row) => row.fallbackEmail ? [row.fallbackEmail] : []);
}

export async function findUserById(id: string) {
  const [user] = await getDb()
    .select({
      id: users.id,
      oracleEmpId: users.oracleEmpId,
      fallbackEmail: users.fallbackEmail,
      fallbackName: users.fallbackName,
      disabledAt: users.disabledAt,
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user ?? null;
}

export async function createSyncedUsers(values: { oracleEmpId: number; email: string | null; name: string }[]) {
  if (values.length === 0) return [];
  return getDb().insert(users).values(values.map((value) => ({
    oracleEmpId: value.oracleEmpId,
    fallbackEmail: value.email?.toLowerCase() || null,
    fallbackName: value.name || null,
  }))).onConflictDoNothing({ target: users.oracleEmpId, where: isNotNull(users.oracleEmpId) }).returning();
}

export async function listManagedUsers() {
  return getDb().select({
    id: users.id,
    oracleEmpId: users.oracleEmpId,
    fallbackEmail: users.fallbackEmail,
    fallbackName: users.fallbackName,
  }).from(users).orderBy(users.fallbackName, users.fallbackEmail);
}

export async function findUsersByOracleEmpIds(oracleEmpIds: number[]) {
  if (oracleEmpIds.length === 0) return [];
  return getDb().select().from(users).where(inArray(users.oracleEmpId, oracleEmpIds));
}

/** Invalidates every session already issued for the user. */
export async function revokeUserSessions(id: string) {
  await getDb().update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, id));
}

/**
 * Disables the users mapped to an Oracle employee that is no longer active (and re-enables those that came back).
 * `activeEmpIds` must be non-empty: an empty list is treated as a failed read and changes nothing.
 */
export async function syncUserActivation(activeEmpIds: number[]) {
  if (activeEmpIds.length === 0) return { disabled: 0, enabled: 0 };
  const db = getDb();
  const disabled = await db.update(users)
    .set({ disabledAt: sql`now()`, tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(and(isNotNull(users.oracleEmpId), notInArray(users.oracleEmpId, activeEmpIds), isNull(users.disabledAt)))
    .returning({ id: users.id });
  const enabled = await db.update(users)
    .set({ disabledAt: null })
    .where(and(inArray(users.oracleEmpId, activeEmpIds), isNotNull(users.disabledAt)))
    .returning({ id: users.id });
  return { disabled: disabled.length, enabled: enabled.length };
}
