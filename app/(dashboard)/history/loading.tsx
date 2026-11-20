import { Skeleton, SkeletonStatus } from "@/components/common/skeleton";

export default function HistoryLoading() {
  return <section aria-busy="true" className="space-y-7"><SkeletonStatus label="Cargando historial…" /><div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-9 w-72" /><Skeleton className="h-4 w-96 max-w-full" /></div>{Array.from({ length: 4 }, (_, index) => <div className="rounded-xl border border-line-soft bg-surface p-6" key={index}><div className="grid gap-4 md:grid-cols-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-8" /><Skeleton className="h-10" /></div></div>)}</section>;
}
