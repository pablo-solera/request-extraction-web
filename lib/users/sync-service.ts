import { findAllActiveEmployees } from "@/lib/employees/employee-repository";
import { getTestAccounts } from "@/lib/employees/test-accounts";
import { createSyncedUsers, findExistingFallbackEmails, findUsersWithOracleEmpId } from "@/lib/auth/user-repository";

export type SyncPlan = { toCreate: { oracleEmpId: number; email: string | null; name: string }[] };
export async function buildSyncPlan(): Promise<SyncPlan> {
  const [employees, mapped, existingEmails] = await Promise.all([findAllActiveEmployees(), findUsersWithOracleEmpId(), findExistingFallbackEmails()]);
  const mappedIds = new Set(mapped.flatMap((user) => user.oracleEmpId === null ? [] : [user.oracleEmpId]));
  const candidates = new Map<number, { oracleEmpId: number; email: string; name: string }>();
  for (const employee of employees) {
    if (employee.email && !mappedIds.has(employee.empId)) candidates.set(employee.empId, { oracleEmpId: employee.empId, email: employee.email, name: employee.name });
  }
  const testAccounts = getTestAccounts() ?? [];
  for (const account of testAccounts) {
    if (!mappedIds.has(account.empId)) candidates.set(account.empId, { oracleEmpId: account.empId, email: account.email, name: account.email.split("@")[0] ?? account.email });
  }
  const claimedEmails = new Set(existingEmails.map((email) => email.toLowerCase()));
  const toCreate = [...candidates.values()].map((candidate) => {
    const email = candidate.email.toLowerCase();
    if (claimedEmails.has(email)) return { ...candidate, email: null };
    claimedEmails.add(email);
    return { ...candidate, email };
  });
  return { toCreate };
}
export async function runUserSync() { const plan = await buildSyncPlan(); const created = await createSyncedUsers(plan.toCreate); return { created: created.length }; }
import "server-only";
import "server-only";
