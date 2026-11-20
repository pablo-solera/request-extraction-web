import { Skeleton, SkeletonStatus } from "@/components/common/skeleton";

export default function DashboardLoading() {
  return <section aria-busy="true" className="space-y-7"><SkeletonStatus label="Cargando…" /><div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-9 w-64" /><Skeleton className="h-4 w-96 max-w-full" /></div><div className="rounded-xl border border-line-soft bg-surface p-6"><div className="space-y-4"><Skeleton className="h-8 w-56" />{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-12 w-full" key={index} />)}</div></div></section>;
}
