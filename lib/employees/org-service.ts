import "server-only";

import type { UserRole } from "@/lib/auth/session";
import { findOrganizationRows } from "@/lib/employees/org-repository";
import { findTestAccountByEmpId, getTestAccounts } from "@/lib/employees/test-accounts";
import { findUsersByOracleEmpIds } from "@/lib/auth/user-repository";

const DEFAULT_TTL_SECONDS = 60;
type OrganizationSnapshot = { adminEmpIds: Set<number>; coordinatorEmpIds: Set<number>; coordinatorByEmpId: Map<number, number | null>; staffEmpIds: Set<number>; teamByCoordinatorEmpId: Map<number, Set<number>> };
type SnapshotState = { loadedAt: number; promise: Promise<OrganizationSnapshot> | null; snapshot: OrganizationSnapshot | null };

declare global { var __requestExtractionOrganizationSnapshot: SnapshotState | undefined; }
const state: SnapshotState = globalThis.__requestExtractionOrganizationSnapshot ?? { loadedAt: 0, promise: null, snapshot: null };
globalThis.__requestExtractionOrganizationSnapshot = state;

function configuredGroupId(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function getTtlMs() {
  const seconds = Number(process.env.ORG_SNAPSHOT_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("ORG_SNAPSHOT_TTL_SECONDS must be positive.");
  return seconds * 1000;
}

function testOrganization(adminGroupId: number, coordinatorGroupId: number) {
  const accounts = getTestAccounts();
  if (!accounts) return null;
  const admin = accounts.find((account) => account.role === "admin");
  const coordinator = accounts.find((account) => account.role === "coordinator");
  const employee = accounts.find((account) => account.role === "employee");
  if (!admin || !coordinator || !employee) return null;
  return {
    roles: [{ EMP_ID: admin.empId, GROUP_ID: adminGroupId }, { EMP_ID: coordinator.empId, GROUP_ID: coordinatorGroupId }],
    hierarchy: [{ EMP_ID: admin.empId, COORDINATOR_EMP_ID: null }, { EMP_ID: coordinator.empId, COORDINATOR_EMP_ID: null }, { EMP_ID: employee.empId, COORDINATOR_EMP_ID: coordinator.empId }],
  };
}

function buildSnapshot(rows: Awaited<ReturnType<typeof findOrganizationRows>>): OrganizationSnapshot {
  const adminGroupId = configuredGroupId("ORACLE_ADMIN_GROUP_ID", 1024);
  const coordinatorGroupId = configuredGroupId("ORACLE_COORDINATOR_GROUP_ID", 1017);
  const synthetic = testOrganization(adminGroupId, coordinatorGroupId);
  const combined = synthetic ? { roles: [...rows.roles, ...synthetic.roles], hierarchy: [...rows.hierarchy, ...synthetic.hierarchy] } : rows;
  const coordinatorByEmpId = new Map(combined.hierarchy.map((row) => [row.EMP_ID, row.COORDINATOR_EMP_ID]));
  const teamByCoordinatorEmpId = new Map<number, Set<number>>();
  for (const [employeeEmpId, coordinatorEmpId] of coordinatorByEmpId) {
    if (coordinatorEmpId === null) continue;
    const team = teamByCoordinatorEmpId.get(coordinatorEmpId) ?? new Set<number>();
    team.add(employeeEmpId);
    teamByCoordinatorEmpId.set(coordinatorEmpId, team);
  }
  return {
    adminEmpIds: new Set(combined.roles.filter((row) => row.GROUP_ID === adminGroupId).map((row) => row.EMP_ID)),
    coordinatorEmpIds: new Set(combined.roles.filter((row) => row.GROUP_ID === coordinatorGroupId).map((row) => row.EMP_ID)),
    coordinatorByEmpId,
    staffEmpIds: new Set(coordinatorByEmpId.keys()),
    teamByCoordinatorEmpId,
  };
}

async function getOrganizationSnapshot() {
  const now = Date.now();
  if (state.snapshot && now - state.loadedAt < getTtlMs()) return state.snapshot;
  if (state.snapshot) {
    if (!state.promise) {
      state.promise = findOrganizationRows().then(buildSnapshot).catch((error) => {
        console.error("Oracle organization refresh failed; keeping the last known snapshot.", error);
        state.loadedAt = Date.now() - Math.max(0, getTtlMs() - 5_000);
        return state.snapshot!;
      }).then((snapshot) => { state.snapshot = snapshot; state.loadedAt = Date.now(); return snapshot; }).finally(() => { state.promise = null; });
    }
    return state.snapshot;
  }
  if (!state.promise) {
    state.promise = findOrganizationRows().then(buildSnapshot).catch((error) => {
      if (!getTestAccounts()) throw error;
      console.error("Oracle organization unavailable; using test account organization.", error);
      return buildSnapshot({ roles: [], hierarchy: [] });
    }).then((snapshot) => { state.snapshot = snapshot; state.loadedAt = Date.now(); return snapshot; }).finally(() => { state.promise = null; });
  }
  return state.promise;
}

export async function resolveUserRole(user: { oracleEmpId: number | null }): Promise<UserRole> {
  const testAccount = findTestAccountByEmpId(user.oracleEmpId);
  if (testAccount) return testAccount.role;
  if (user.oracleEmpId === null) return "employee";
  const snapshot = await getOrganizationSnapshot();
  return snapshot.adminEmpIds.has(user.oracleEmpId) ? "admin" : snapshot.coordinatorEmpIds.has(user.oracleEmpId) ? "coordinator" : "employee";
}

export async function resolveOrganizationForUsers(input: { id: string; oracleEmpId: number | null }[]) {
  const snapshot = await getOrganizationSnapshot();
  const coordinatorEmpIds = input.flatMap((user) => user.oracleEmpId === null ? [] : [snapshot.coordinatorByEmpId.get(user.oracleEmpId)]).filter((id): id is number => id !== null && id !== undefined);
  const coordinators = await findUsersByOracleEmpIds([...new Set(coordinatorEmpIds)]);
  const byOracleId = new Map(coordinators.map((user) => [user.oracleEmpId, user]));
  return new Map(input.map((user) => {
    const testAccount = findTestAccountByEmpId(user.oracleEmpId);
    const role = testAccount ? testAccount.role : user.oracleEmpId !== null && snapshot.adminEmpIds.has(user.oracleEmpId) ? "admin" : user.oracleEmpId !== null && snapshot.coordinatorEmpIds.has(user.oracleEmpId) ? "coordinator" : "employee";
    const coordinatorEmpId = user.oracleEmpId === null ? null : snapshot.coordinatorByEmpId.get(user.oracleEmpId) ?? null;
    return [user.id, { id: user.id, role, coordinator: coordinatorEmpId === null ? null : byOracleId.get(coordinatorEmpId) ?? null }] as const;
  }));
}

export async function findCoordinatorUser(user: { oracleEmpId: number | null }) {
  if (user.oracleEmpId === null) return null;
  const snapshot = await getOrganizationSnapshot();
  const coordinatorEmpId = snapshot.coordinatorByEmpId.get(user.oracleEmpId);
  if (coordinatorEmpId === null || coordinatorEmpId === undefined) return null;
  const [coordinator] = await findUsersByOracleEmpIds([coordinatorEmpId]);
  return coordinator ?? null;
}

export async function isUserInCoordinatorTeam(coordinator: { oracleEmpId: number | null }, user: { oracleEmpId: number | null }) {
  if (coordinator.oracleEmpId === null || user.oracleEmpId === null) return false;
  const testAccounts = getTestAccounts();
  if (testAccounts?.some((account) => account.empId === coordinator.oracleEmpId && account.role === "coordinator") && testAccounts?.some((account) => account.empId === user.oracleEmpId && account.role === "employee")) return true;
  const snapshot = await getOrganizationSnapshot();
  return snapshot.teamByCoordinatorEmpId.get(coordinator.oracleEmpId)?.has(user.oracleEmpId) ?? false;
}

export async function findCoordinatorTeamUserIds(coordinator: { oracleEmpId: number | null }) {
  if (coordinator.oracleEmpId === null) return [];
  const employeeIds = [...((await getOrganizationSnapshot()).teamByCoordinatorEmpId.get(coordinator.oracleEmpId) ?? [])];
  const users = await findUsersByOracleEmpIds(employeeIds);
  return users.map((user) => user.id);
}

export async function isCurrentCoordinator(user: { id: string; oracleEmpId: number | null }) {
  if (findTestAccountByEmpId(user.oracleEmpId)?.role === "coordinator") return true;
  if (user.oracleEmpId === null) return false;
  return (await getOrganizationSnapshot()).coordinatorEmpIds.has(user.oracleEmpId);
}

export async function findStaffEmpIds() { return (await getOrganizationSnapshot()).staffEmpIds; }
