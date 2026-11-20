import "server-only";

import { cookies } from "next/headers";
import { shouldUseSecureCookie } from "@/lib/auth/token";
import { THEME_COOKIE, parseTheme, type Theme } from "@/lib/theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function getTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}

export async function setThemeCookie(theme: Theme) {
  (await cookies()).set(THEME_COOKIE, theme, {
    httpOnly: true,
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
  });
}
