import { Suspense } from "react";
import { AppFooter } from "@/components/layout/app-footer";
import { DashboardHeader, DashboardHeaderFallback } from "@/components/layout/dashboard-header";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <Suspense fallback={<DashboardHeaderFallback />}>
        <DashboardHeader />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
