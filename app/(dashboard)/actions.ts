"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie } from "@/lib/auth/session";
import { getVerifiedUser } from "@/lib/auth/guards";
import { isTheme } from "@/lib/theme";
import { setThemeCookie } from "@/lib/theme-server";

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}

export async function setThemeAction(theme: string) {
  if (!isTheme(theme)) return { ok: false as const };
  if (!(await getVerifiedUser())) return { ok: false as const };
  await setThemeCookie(theme);
  return { ok: true as const };
}
