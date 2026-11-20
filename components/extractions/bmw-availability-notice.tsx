"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  if (entry.state === "loading") return <p className="mt-2 text-body text-ink-muted" role="status">Comprobando disponibilidad en BMW…</p>;
  if (entry.state === "error") {
    return <p className="mt-2 text-body text-pending-ink" role="status">
      No se ha podido comprobar la disponibilidad de {typekey}; se volverá a comprobar al enviar.{" "}
      <Button onClick={onRetry}>Reintentar</Button>
    </p>;
  }

  const notice = describeAvailability(entry.availability);
  if (notice.kind === "available") return null;
  if (notice.kind === "unknown") return <p className="mt-2 text-body text-pending-ink" role="status">{notice.message}</p>;
  return <Alert className="mt-2 space-y-1" role="alert" tone="danger">
    <p className="font-semibold">{typekey}: {notice.message}</p>
    {notice.baseTypeMessage ? <p className={notice.suggestedTypekey ? "text-ink" : "text-danger-ink"}>{notice.baseTypeMessage}</p> : null}
    {notice.suggestedTypekey ? <Button onClick={() => onUseBaseType(notice.suggestedTypekey!)}>Usar tipo base {notice.suggestedTypekey}</Button> : null}
  </Alert>;
}
