import "server-only";

import { getOracleSchema, queryOracle } from "@/db/oracle";

export type OracleEmployee = { empId: number; name: string; email: string; wdNumber: string | null };
type EmployeeRow = { EMP_ID: number; EMP_NOMBRE: string | null; EMP_APELLIDO1: string | null; EMP_APELLIDO2: string | null; EMP_EMAIL: string | null; EMP_TEL1: string | null };
const active = "e.emp_esempleado = 1 AND e.emp_fec_baja IS NULL";

function map(row: EmployeeRow): OracleEmployee {
  const name = [row.EMP_NOMBRE, row.EMP_APELLIDO1, row.EMP_APELLIDO2].filter((part) => part?.trim()).join(" ");
  return { empId: row.EMP_ID, name: name || `Empleado ${row.EMP_ID}`, email: (row.EMP_EMAIL ?? "").trim().toLowerCase(), wdNumber: (row.EMP_TEL1 ?? "").trim() || null };
}

function select() { return `SELECT e.emp_id AS emp_id, e.emp_nombre AS emp_nombre, e.emp_apellido1 AS emp_apellido1, e.emp_apellido2 AS emp_apellido2, e.emp_email AS emp_email, e.emp_tel1 AS emp_tel1 FROM ${getOracleSchema()}.templeados e`; }
export async function findActiveEmployeeByEmail(email: string) { const rows = await queryOracle<EmployeeRow>(`${select()} WHERE ${active} AND LOWER(e.emp_email) = :email`, { email: email.trim().toLowerCase() }); return rows[0] ? map(rows[0]) : null; }
export async function findAllActiveEmployees() { const rows = await queryOracle<EmployeeRow>(`${select()} WHERE ${active} ORDER BY e.emp_nombre, e.emp_apellido1`); return rows.map(map); }
export async function findEmployeesByIds(ids: number[]) {
  if (ids.length === 0) return [];
  const employees: OracleEmployee[] = [];
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const chunk = ids.slice(offset, offset + 1000);
    const binds: Record<string, number> = {};
    const placeholders = chunk.map((id, index) => { binds[`id${index}`] = id; return `:id${index}`; });
    const rows = await queryOracle<EmployeeRow>(`${select()} WHERE e.emp_id IN (${placeholders.join(", ")})`, binds);
    employees.push(...rows.map(map));
  }
  return employees;
}
