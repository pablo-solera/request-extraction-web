import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/components/layout/app-header", () => ({
  AppHeader: ({ user }: { user: { role: string } }) => <header>role:{user.role}</header>,
}));

import { DashboardHeader } from "@/components/layout/dashboard-header";

describe("DashboardHeader", () => {
  beforeEach(() => vi.resetAllMocks());

  it("authorizes with requireUser and passes the user to the header", async () => {
    mocks.requireUser.mockResolvedValue({ email: "a@x.com", name: "Ana", role: "admin", id: "1" });
    const element = await DashboardHeader();
    expect(renderToStaticMarkup(element)).toContain("role:admin");
    expect(mocks.requireUser).toHaveBeenCalledTimes(1);
  });

  it("propagates the redirect thrown by requireUser", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(DashboardHeader()).rejects.toThrow("NEXT_REDIRECT");
  });
});
