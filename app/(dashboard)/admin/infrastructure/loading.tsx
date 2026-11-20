import { Skeleton } from "@/components/common/skeleton";

export default function InfrastructureLoading() {
  return <section aria-busy="true" className="space-y-6"><div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-9 w-64" /><Skeleton className="h-4 w-96 max-w-full" /></div><div className="space-y-4">{Array.from({ length: 3 }, (_, index) => <div className="rounded-xl border border-line-soft bg-surface p-6" key={index}><div className="flex justify-between"><Skeleton className="h-8 w-48" /><Skeleton className="h-7 w-24" /></div><div className="mt-6 grid grid-cols-3 gap-4">{Array.from({ length: 3 }, (_, item) => <Skeleton className="h-12" key={item} />)}</div></div>)}</div></section>;
}
