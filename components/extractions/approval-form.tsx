"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import type { DecisionState } from "@/app/(dashboard)/approvals/actions";

const initialState: DecisionState = {};

export function ApprovalForm({ requestGroupId, axCode, action }: { requestGroupId: string; axCode: string; action: (state: DecisionState, formData: FormData) => Promise<DecisionState> }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [rejecting, setRejecting] = useState(false);
  const comment = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  useEffect(() => {
    if (rejecting) comment.current?.focus();
  }, [rejecting]);

  return <form action={formAction} aria-label={`Decidir solicitud ${axCode}`} className="mt-5 space-y-3">
    <label className="block"><span className="field-label">Comentario</span><textarea aria-describedby={hintId} autoComplete="off" className="field-control min-h-20" maxLength={4000} name="comment" placeholder="Añade un comentario si hace falta…" ref={comment} required={rejecting} /></label>
    <p className="text-meta text-ink-muted" id={hintId}>{rejecting ? "Obligatorio para rechazar: explica el motivo al solicitante." : "Opcional al aprobar."}</p>
    <input name="requestGroupId" type="hidden" value={requestGroupId} />
    <div className="flex flex-wrap gap-2">
      <SubmitButton formNoValidate name="decision" value="approved" pendingLabel="Aprobando…">Aprobar</SubmitButton>
      {rejecting ? <><Button disabled={pending} name="decision" type="submit" value="rejected" variant="danger">{pending ? "Rechazando…" : "Confirmar rechazo"}</Button><Button disabled={pending} onClick={() => setRejecting(false)} variant="ghost">Cancelar</Button></> : <Button disabled={pending} onClick={() => setRejecting(true)} variant="danger">Rechazar…</Button>}
    </div>
    {state.error ? <p className="rounded-lg border border-danger-line bg-danger-wash px-3 py-2 text-body text-danger-ink" role="alert">{state.error}</p> : null}
    {state.success ? <p className="rounded-lg border border-success-line bg-success-wash px-3 py-2 text-body text-success-ink" role="status">{state.success}</p> : null}
  </form>;
}
