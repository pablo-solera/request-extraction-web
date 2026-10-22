import "server-only";

import { findLdapIdentity, verifyLdapPassword } from "@/lib/auth/ldap";
import { findUserByFallbackEmail, findUserByOracleEmpId } from "@/lib/auth/user-repository";
import { findActiveEmployeeByEmail } from "@/lib/employees/employee-repository";
import { findTestAccountByEmail, verifyTestAccountPassword } from "@/lib/employees/test-accounts";

export async function authenticate(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const testAccount = findTestAccountByEmail(normalizedEmail);
  if (testAccount && verifyTestAccountPassword(password)) {
    const user = await findUserByFallbackEmail(normalizedEmail);
    return user?.oracleEmpId === testAccount.empId ? user : null;
  }

  const identity = await findLdapIdentity(normalizedEmail);

  if (!identity || !(await verifyLdapPassword(identity.dn, password))) {
    return null;
  }

  const employee = await findActiveEmployeeByEmail(identity.email);
  if (!employee) return null;
  return findUserByOracleEmpId(employee.empId);
}
