import "server-only";

import { findEmployeesByIds, type OracleEmployee } from "@/lib/employees/employee-repository";
import { findTestAccountByEmpId } from "@/lib/employees/test-accounts";
import { describeError } from "@/lib/logging/describe-error";
export type UserIdentityInput = { id: string; oracleEmpId: number | null; fallbackName: string | null; fallbackEmail: string | null };

const IDENTITY_TTL_MS = 60_000;
type CachedIdentity = { expiresAt: number; value: OracleEmployee | null };
declare global {
  var __requestExtractionIdentityCache: Map<number, CachedIdentity> | undefined;
  var __requestExtractionIdentityRefreshes: Map<number, Promise<void>> | undefined;
}

const identityCache = globalThis.__requestExtractionIdentityCache ??= new Map();
const identityRefreshes = globalThis.__requestExtractionIdentityRefreshes ??= new Map();

function refreshIdentities(ids: number[]) {
  const refreshedIds = [...ids];
  if (refreshedIds.length === 0) return Promise.resolve();
  const existing = refreshedIds.flatMap((id) => identityRefreshes.has(id) ? [identityRefreshes.get(id)!] : []);
  const missing = refreshedIds.filter((id) => !identityRefreshes.has(id));
  if (missing.length === 0) return Promise.all(existing).then(() => undefined);

  let release!: () => void;
  const marker = new Promise<void>((resolve) => { release = resolve; });
  for (const id of missing) identityRefreshes.set(id, marker);
  const batch = findEmployeesByIds(missing)
    .then((employees) => {
      const byId = new Map(employees.map((employee) => [employee.empId, employee]));
      const expiresAt = Date.now() + IDENTITY_TTL_MS;
      for (const id of missing) identityCache.set(id, { expiresAt, value: byId.get(id) ?? null });
    })
    .catch((error: unknown) => {
      console.error("Employee identity lookup failed; using stored identity fallback.", describeError(error));
    })
    .finally(() => {
      for (const id of missing) identityRefreshes.delete(id);
      release();
    });
  void batch;
  return Promise.all([...existing, marker]).then(() => undefined);
}

export async function resolveUserIdentities(input: UserIdentityInput[]) {
  const ids = [...new Set(input.flatMap((user) => user.oracleEmpId === null || findTestAccountByEmpId(user.oracleEmpId) ? [] : [user.oracleEmpId]))];
  const now = Date.now();
  const missing = ids.filter((id) => (identityCache.get(id)?.expiresAt ?? 0) <= now);
  const cold = missing.filter((id) => !identityCache.has(id));
  const stale = missing.filter((id) => identityCache.has(id));
  if (cold.length > 0) await refreshIdentities(cold);
  if (stale.length > 0) void refreshIdentities(stale);
  return new Map(input.map((user) => {
    const employee = user.oracleEmpId === null || findTestAccountByEmpId(user.oracleEmpId) ? undefined : identityCache.get(user.oracleEmpId)?.value ?? undefined;
    return [user.id, { name: employee?.name ?? user.fallbackName ?? user.fallbackEmail ?? "Usuario", email: employee?.email ?? user.fallbackEmail, wdNumber: employee?.wdNumber ?? null }] as const;
  }));
}
