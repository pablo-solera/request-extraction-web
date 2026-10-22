import { AppFooter } from "@/components/layout/app-footer";
import { AppHeader } from "@/components/layout/app-header";
import { requireUser } from "@/lib/auth/guards";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
      <div className="flex min-h-full flex-col bg-zinc-100">
        <AppHeader user={{ email: user.email, name: user.name, role: user.role }} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
