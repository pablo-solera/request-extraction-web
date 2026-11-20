import { findAllActiveEmployees } from "@/lib/employees/employee-repository";
import { getTestAccounts } from "@/lib/employees/test-accounts";
import { createSyncedUsers, findExistingFallbackEmails, findUsersWithOracleEmpId, syncUserActivation } from "@/lib/auth/user-repository";

export type SyncPlan = { toCreate: { oracleEmpId: number; email: string | null; name: string }[] };
/** `employees` replaces the query to Oracle when the caller already knows the employees to consider. */
export async function buildSyncPlan(options: { employees?: Awaited<ReturnType<typeof findAllActiveEmployees>> } = {}): Promise<SyncPlan> {
  const [employees, mapped, existingEmails] = await Promise.all([options.employees ?? findAllActiveEmployees(), findUsersWithOracleEmpId(), findExistingFallbackEmails()]);
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
export async function runUserSync() {
  const employees = await findAllActiveEmployees();
  const plan = await buildSyncPlan({ employees });
  const created = await createSyncedUsers(plan.toCreate);
  const activeEmpIds = [...employees.map((employee) => employee.empId), ...(getTestAccounts() ?? []).map((account) => account.empId)];
  const activation = await syncUserActivation(activeEmpIds);
  return { created: created.length, ...activation };
}
/**
 * Creates only the users of the test accounts (TEST_ACCOUNTS_ENABLED), without asking Oracle for the employees. A test
 * account can only sign in if its row exists in `users`, and a new database has none. Idempotent.
 */
export async function seedTestAccountUsers(): Promise<{ enabled: boolean; created: number }> {
  if (getTestAccounts() === null) return { enabled: false, created: 0 };
  const plan = await buildSyncPlan({ employees: [] });
  const created = await createSyncedUsers(plan.toCreate);
  return { enabled: true, created: created.length };
}
import "server-only";
