import "server-only";

import { eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export async function findUserByOracleEmpId(oracleEmpId: number) {
  const [user] = await getDb().select().from(users).where(eq(users.oracleEmpId, oracleEmpId)).limit(1);
  return user ?? null;
}

export async function findUserByFallbackEmail(email: string) {
  const [user] = await getDb().select().from(users).where(eq(users.fallbackEmail, email.trim().toLowerCase())).limit(1);
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
