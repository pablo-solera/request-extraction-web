import type { Metadata } from "next";
import { UsersTable, type ManagedUser } from "@/components/admin/users-table";
import { PageHeader } from "@/components/common/page-header";
import { requireAdmin } from "@/lib/auth/guards";
import { resolveUserIdentities } from "@/lib/employees/identity-service";
import { filterVisibleStaff } from "@/lib/employees/staff-service";
import { resolveOrganizationForUsers } from "@/lib/employees/org-service";
import { listManagedUsers } from "@/lib/auth/user-repository";

export const metadata: Metadata = { title: "Gestión de usuarios" };

type AdminUsersPageProps = { searchParams?: Promise<{ page?: string; query?: string }> };

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const params = await searchParams;
  const queryParam = params?.query?.trim() ?? "";
  const query = queryParam.toLowerCase();
  const requestedPage = Number.parseInt(params?.page ?? "1", 10);
  const admin = await requireAdmin();
  const allUsers = await listManagedUsers();
  const [users, organization] = await Promise.all([
    filterVisibleStaff(allUsers, { includeSystemUsers: true }),
    resolveOrganizationForUsers(allUsers),
  ]);
  const coordinatorUsers = [...organization.values()].flatMap((entry) => entry.coordinator ? [entry.coordinator] : []);
  const identityUsers = [...users, ...coordinatorUsers];
  const identityInput = identityUsers.map((user) => ({ id: user.id, oracleEmpId: user.oracleEmpId, fallbackName: user.fallbackName, fallbackEmail: user.fallbackEmail }));
  const identities = await resolveUserIdentities(identityInput);
  const identityOf = (id: string) => identities.get(id) ?? { name: "Usuario", email: null, wdNumber: null };
  const managedUsers: ManagedUser[] = users.map((user) => {
    const identity = identityOf(user.id);
    const organizationUser = organization.get(user.id);
    const coordinator = organizationUser?.coordinator ? identityOf(organizationUser.coordinator.id) : null;
    return {
      coordinator: organizationUser?.coordinator && coordinator ? { id: organizationUser.coordinator.id, name: coordinator.name, email: coordinator.email ?? "" } : null,
      email: identity.email ?? "",
      id: user.id,
      name: identity.name,
      role: organizationUser?.role ?? "employee",
      wdNumber: identity.wdNumber,
    };
  });
  const filteredUsers = query ? managedUsers.filter((user) => [user.name, user.email, user.role, user.coordinator?.name, user.coordinator?.email].filter(Boolean).join(" ").toLowerCase().includes(query)) : managedUsers;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const page = Number.isInteger(requestedPage) ? Math.min(Math.max(requestedPage, 1), totalPages) : 1;
  const pagedUsers = filteredUsers.slice((page - 1) * pageSize, page * pageSize);

  return <section className="space-y-8"><PageHeader><PageHeader.Eyebrow>Administración</PageHeader.Eyebrow><PageHeader.Title>Gestión de usuarios</PageHeader.Title><PageHeader.Description>Consulta las cuentas disponibles en la organización.</PageHeader.Description></PageHeader><UsersTable currentUserId={admin.id} page={page} query={queryParam} totalPages={totalPages} totalUsers={filteredUsers.length} users={pagedUsers} /></section>;
}
