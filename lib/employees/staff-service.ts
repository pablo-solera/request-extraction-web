import "server-only";

import { findStaffEmpIds } from "@/lib/employees/org-service";
export async function filterVisibleStaff<T extends { oracleEmpId: number | null }>(users: T[], options: { includeSystemUsers?: boolean } = {}) {
  const { includeSystemUsers = false } = options;
  try {
    const staffEmpIds = await findStaffEmpIds();
    return users.filter((user) => user.oracleEmpId === null ? includeSystemUsers : staffEmpIds.has(user.oracleEmpId));
  } catch (error) {
    console.error("Failed to load staff lines from Oracle; showing mapped users:", error);
    return users.filter((user) => includeSystemUsers || user.oracleEmpId !== null);
  }
}
