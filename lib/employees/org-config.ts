import "server-only";

const DEFAULT_ADMIN_GROUP_ID = 1024;
const DEFAULT_COORDINATOR_GROUP_ID = 1017;
const DEFAULT_STAFF_LINE_IDS = [100, 1600, 1606, 1608, 1611];

function groupId(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export const adminGroupId = () => groupId("ORACLE_ADMIN_GROUP_ID", DEFAULT_ADMIN_GROUP_ID);
export const coordinatorGroupId = () => groupId("ORACLE_COORDINATOR_GROUP_ID", DEFAULT_COORDINATOR_GROUP_ID);

export function staffLineIds() {
  const values = (process.env.ORACLE_STAFF_LINE_IDS ?? "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0);
  return values.length > 0 ? [...new Set(values)] : DEFAULT_STAFF_LINE_IDS;
}
