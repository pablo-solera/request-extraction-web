"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/common/submit-button";
import type { DecisionState } from "@/app/(dashboard)/approvals/actions";

const initialState: DecisionState = {};

export function ApprovalForm({ requestGroupId, axCode, action }: { requestGroupId: string; axCode: string; action: (state: DecisionState, formData: FormData) => Promise<DecisionState> }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [rejecting, setRejecting] = useState(false);

  return <form action={formAction} aria-label={`Decidir solicitud ${axCode}`} className="mt-5 space-y-3">
    <label className="block"><span className="field-label">Comentario (opcional para aprobar; recomendado para rechazar)</span><textarea autoComplete="off" className="field-control min-h-20" maxLength={4000} name="comment" placeholder="Añade un comentario si hace falta…" /></label>
    <input name="requestGroupId" type="hidden" value={requestGroupId} />
    <div className="flex flex-wrap gap-2">
      <SubmitButton name="decision" value="approved" pendingLabel="Aprobando…">Aprobar</SubmitButton>
      {rejecting ? <><Button disabled={pending} name="decision" type="submit" value="rejected" variant="danger">{pending ? "Rechazando…" : "Confirmar rechazo"}</Button><Button disabled={pending} onClick={() => setRejecting(false)} variant="ghost">Cancelar</Button></> : <Button disabled={pending} onClick={() => setRejecting(true)} variant="danger">Rechazar…</Button>}
    </div>
    {state.error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{state.error}</p> : null}
    {state.success ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{state.success}</p> : null}
  </form>;
}
