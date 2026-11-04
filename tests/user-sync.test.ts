import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findAllActiveEmployees: vi.fn(),
  getTestAccounts: vi.fn(),
  createSyncedUsers: vi.fn(),
  findExistingFallbackEmails: vi.fn(),
  findUsersWithOracleEmpId: vi.fn(),
}));
vi.mock("@/lib/employees/employee-repository", () => ({ findAllActiveEmployees: mocks.findAllActiveEmployees }));
vi.mock("@/lib/employees/test-accounts", () => ({ getTestAccounts: mocks.getTestAccounts }));
vi.mock("@/lib/auth/user-repository", () => ({
  createSyncedUsers: mocks.createSyncedUsers,
  findExistingFallbackEmails: mocks.findExistingFallbackEmails,
  findUsersWithOracleEmpId: mocks.findUsersWithOracleEmpId,
}));

import { buildSyncPlan, runUserSync, seedTestAccountUsers } from "@/lib/users/sync-service";

const admin = { empId: 3509, email: "test.manager@solera.com", role: "admin" };
const coordinator = { empId: 3510, email: "test.coordinator@solera.com", role: "coordinator" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTestAccounts.mockReturnValue(null);
  mocks.findExistingFallbackEmails.mockResolvedValue([]);
  mocks.findUsersWithOracleEmpId.mockResolvedValue([]);
  mocks.createSyncedUsers.mockImplementation(async (users: unknown[]) => users);
});

describe("user synchronization", () => {
  it("plans only the active employees that do not have a user yet, lowercasing their emails", async () => {
    mocks.findAllActiveEmployees.mockResolvedValue([
      { empId: 1, email: "Ana.Perez@Example.com", name: "Ana Pérez" },
      { empId: 2, email: "bob@example.com", name: "Bob" },
      { empId: 3, email: null, name: "Sin correo" },
    ]);
    mocks.findUsersWithOracleEmpId.mockResolvedValue([{ oracleEmpId: 2 }]);

    expect((await buildSyncPlan()).toCreate).toEqual([{ oracleEmpId: 1, email: "ana.perez@example.com", name: "Ana Pérez" }]);
  });

  it("adds the test accounts and leaves the email empty when it is already taken", async () => {
    mocks.findAllActiveEmployees.mockResolvedValue([{ empId: 1, email: "taken@example.com", name: "Alguien" }]);
    mocks.findExistingFallbackEmails.mockResolvedValue(["Taken@Example.com"]);
    mocks.getTestAccounts.mockReturnValue([admin]);

    expect((await buildSyncPlan()).toCreate).toEqual([
      { oracleEmpId: 1, email: null, name: "Alguien" },
      { oracleEmpId: 3509, email: "test.manager@solera.com", name: "test.manager" },
    ]);
  });

  it("reports how many users it created", async () => {
    mocks.findAllActiveEmployees.mockResolvedValue([{ empId: 1, email: "a@example.com", name: "A" }, { empId: 2, email: "b@example.com", name: "B" }]);
    expect(await runUserSync()).toEqual({ created: 2 });
  });
});

describe("seeding the test account users", () => {
  it("creates only the test accounts and never asks Oracle for the employees", async () => {
    mocks.getTestAccounts.mockReturnValue([admin, coordinator]);

    expect(await seedTestAccountUsers()).toEqual({ enabled: true, created: 2 });
    expect(mocks.findAllActiveEmployees).not.toHaveBeenCalled();
    expect(mocks.createSyncedUsers).toHaveBeenCalledWith([
      { oracleEmpId: 3509, email: "test.manager@solera.com", name: "test.manager" },
      { oracleEmpId: 3510, email: "test.coordinator@solera.com", name: "test.coordinator" },
    ]);
  });

  it("skips the accounts that already have a user, so running it again creates nothing", async () => {
    mocks.getTestAccounts.mockReturnValue([admin, coordinator]);
    mocks.findUsersWithOracleEmpId.mockResolvedValue([{ oracleEmpId: 3509 }, { oracleEmpId: 3510 }]);

    expect(await seedTestAccountUsers()).toEqual({ enabled: true, created: 0 });
  });

  it("does nothing when the test accounts are disabled", async () => {
    expect(await seedTestAccountUsers()).toEqual({ enabled: false, created: 0 });
    expect(mocks.createSyncedUsers).not.toHaveBeenCalled();
    expect(mocks.findUsersWithOracleEmpId).not.toHaveBeenCalled();
  });
});
