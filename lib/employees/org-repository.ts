import "server-only";

import type { BindParameters } from "oracledb";
import { getOracleSchema, queryOracle } from "@/db/oracle";
import { adminGroupId, coordinatorGroupId, staffLineIds } from "@/lib/employees/org-config";

export type OrganizationRows = {
  hierarchy: { EMP_ID: number; COORDINATOR_EMP_ID: number | null }[];
  roles: { EMP_ID: number; GROUP_ID: number }[];
};

function bindList(prefix: string, values: number[]) {
  const binds: BindParameters = {};
  const placeholders = values.map((value, index) => {
    const name = `${prefix}${index}`;
    (binds as Record<string, number>)[name] = value;
    return `:${name}`;
  });
  return { binds, placeholders };
}

export async function findOrganizationRows(): Promise<OrganizationRows> {
  const schema = getOracleSchema();
  const groups = bindList("group", [adminGroupId(), coordinatorGroupId()]);
  const lines = bindList("line", staffLineIds());
  const active = "e.emp_esempleado = 1 AND e.emp_fec_baja IS NULL";
  const [roles, hierarchy] = await Promise.all([
    queryOracle<{ EMP_ID: number; GROUP_ID: number }>(`SELECT DISTINCT eg.emp_id AS emp_id, eg.grupo_id AS group_id FROM ${schema}.templeado_grupos eg JOIN ${schema}.templeados e ON e.emp_id = eg.emp_id WHERE eg.grupo_id IN (${groups.placeholders.join(", ")}) AND eg.fecha_baja IS NULL AND ${active}`, groups.binds),
    queryOracle<{ EMP_ID: number; COORDINATOR_EMP_ID: number | null }>(`SELECT eg.emp_id AS emp_id, MIN(g.grupo_coordinador) AS coordinator_emp_id FROM ${schema}.templeado_grupos eg JOIN ${schema}.tgrupos g ON g.grupo_id = eg.grupo_id JOIN ${schema}.templeados e ON e.emp_id = eg.emp_id WHERE eg.fecha_baja IS NULL AND ${active} AND g.linea_id IN (${lines.placeholders.join(", ")}) GROUP BY eg.emp_id`, lines.binds),
  ]);
  return { roles, hierarchy };
}
