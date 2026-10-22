"use client";

import { describeAvailability } from "@/lib/extractions/availability-messages";
import type { AvailabilityEntry } from "@/lib/hooks/use-bmw-availability";

export function BmwAvailabilityNotice({
  entry,
  onRetry,
  onUseBaseType,
  typekey,
}: {
  entry: AvailabilityEntry;
  onRetry: () => void;
  onUseBaseType: (baseTypekey: string) => void;
  typekey: string;
}) {
  if (entry.state === "loading") return <p className="mt-2 text-xs text-zinc-500" role="status">Comprobando disponibilidad en BMW…</p>;
  if (entry.state === "error") {
    return <p className="mt-2 text-xs text-amber-800" role="status">
      No se ha podido comprobar la disponibilidad de {typekey}; se volverá a comprobar al enviar.{" "}
      <button className="font-semibold underline underline-offset-2" onClick={onRetry} type="button">Reintentar</button>
    </p>;
  }

  const notice = describeAvailability(entry.availability);
  if (notice.kind === "available") return null;
  if (notice.kind === "unknown") return <p className="mt-2 text-xs text-amber-800" role="status">{notice.message}</p>;
  return <div className="mt-2 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
    <p className="font-semibold">{typekey}: {notice.message}</p>
    {notice.baseTypeMessage ? <p className={notice.suggestedTypekey ? "text-zinc-800" : "text-red-800"}>{notice.baseTypeMessage}</p> : null}
    {notice.suggestedTypekey ? <button className="min-h-9 rounded-lg border border-sky-700 bg-white px-3 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700" onClick={() => onUseBaseType(notice.suggestedTypekey!)} type="button">Usar tipo base {notice.suggestedTypekey}</button> : null}
  </div>;
}
