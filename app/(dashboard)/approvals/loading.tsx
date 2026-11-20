import { Skeleton, SkeletonStatus } from "@/components/common/skeleton";

export default function ApprovalsLoading() {
  return <section aria-busy="true" className="space-y-6"><SkeletonStatus label="Cargando solicitudes…" /><div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-9 w-64" /><Skeleton className="h-4 w-96 max-w-full" /></div>{Array.from({ length: 3 }, (_, index) => <div className="rounded-xl border border-line-soft bg-surface p-6" key={index}><div className="grid gap-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-12" /><Skeleton className="h-20" /></div></div>)}</section>;
}
