import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@/lib/auth/session";
export type TestAccount = { email: string; empId: number; role: UserRole };
const config = [["TEST_ACCOUNT_ADMIN", "admin"], ["TEST_ACCOUNT_COORDINATOR", "coordinator"], ["TEST_ACCOUNT_EMPLOYEE", "employee"]] as const;
export function getTestAccounts(): TestAccount[] | null { if (process.env.TEST_ACCOUNTS_ENABLED !== "true") return null; const accounts = config.map(([variable, role]) => { const match = process.env[variable]?.trim().match(/^(\d+):([^\s@]+@[^\s@]+)$/); if (!match) throw new Error(`${variable} must have the format <employeeId>:<email>.`); return { empId: Number(match[1]), email: match[2].toLowerCase(), role }; }); if (!process.env.TEST_ACCOUNTS_PASSWORD) throw new Error("TEST_ACCOUNTS_PASSWORD is required."); return accounts; }
export function findTestAccountByEmail(email: string) { return getTestAccounts()?.find((account) => account.email === email.trim().toLowerCase()) ?? null; }
export function findTestAccountByEmpId(empId: number | null) { return getTestAccounts()?.find((account) => account.empId === empId) ?? null; }
export function verifyTestAccountPassword(password: string) { const expected = process.env.TEST_ACCOUNTS_PASSWORD; if (!expected) return false; return timingSafeEqual(createHash("sha256").update(password).digest(), createHash("sha256").update(expected).digest()); }
