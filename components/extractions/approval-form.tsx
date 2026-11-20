"use client";

import { useActionState, useState } from "react";
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
      <SubmitButton className="min-h-11" name="decision" value="approved" pendingLabel="Aprobando…">Aprobar</SubmitButton>
      {rejecting ? <><button className="min-h-11 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60" disabled={pending} name="decision" value="rejected" type="submit">{pending ? "Rechazando…" : "Confirmar rechazo"}</button><button className="min-h-11 rounded-lg px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100" disabled={pending} onClick={() => setRejecting(false)} type="button">Cancelar</button></> : <button className="min-h-11 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" disabled={pending} onClick={() => setRejecting(true)} type="button">Rechazar…</button>}
    </div>
    {state.error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{state.error}</p> : null}
    {state.success ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{state.success}</p> : null}
  </form>;
}
