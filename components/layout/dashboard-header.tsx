import { AppHeader } from "@/components/layout/app-header";
import { requireUser } from "@/lib/auth/guards";

export async function DashboardHeader() {
  const user = await requireUser();

  return <AppHeader user={{ email: user.email, name: user.name, role: user.role }} />;
}

export function DashboardHeaderFallback() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center px-4 py-4 sm:px-6">
        <span className="text-base font-semibold text-zinc-950">Extracciones</span>
      </div>
    </header>
  );
}
