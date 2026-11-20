"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { decideRequest, getPendingRequest } from "@/lib/extractions/repository";
import { isCurrentCoordinator, isUserInCoordinatorTeam } from "@/lib/employees/org-service";
import { submitApprovedRequest } from "@/lib/extractions/service";
import { after } from "next/server";
import { describeError } from "@/lib/logging/describe-error";

const requestId = z.uuid();
const comment = z.string().trim().max(4000).nullable();
export type DecisionState = { error?: string; success?: string };

export async function decideExtractionRequest(_previous: DecisionState, formData: FormData): Promise<DecisionState> {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "coordinator") return { error: "No tienes permiso para decidir esta solicitud." };
  const groupResult = requestId.safeParse(formData.get("requestGroupId"));
  const decisionResult = z.enum(["approved", "rejected"]).safeParse(formData.get("decision"));
  const commentResult = comment.safeParse(String(formData.get("comment") ?? "").trim() || null);
  if (!groupResult.success || !decisionResult.success || !commentResult.success) return { error: "No se han podido validar los datos. Actualiza la página e inténtalo de nuevo." };
  const groupId = groupResult.data;
  const decision = decisionResult.data;
  const parsedComment = commentResult.data;
  const pending = await getPendingRequest(groupId);
  if (!pending) return { error: "La solicitud ya no está pendiente. Actualiza la lista." };
  if (user.role === "coordinator" && (!(await isCurrentCoordinator(user)) || !(await isUserInCoordinatorTeam(user, pending.requester)))) return { error: "No estás autorizado para esta solicitud." };
  const decided = await decideRequest(groupId, user.id, decision, parsedComment, user.role === "admin");
  if (!decided) return { error: "La solicitud ya fue procesada. Actualiza la lista." };
  if (decided.status === "approved") after(async () => {
    try {
      await submitApprovedRequest(groupId);
    } catch (error) {
      console.error("Approved request submission failed after response.", describeError(error));
    }
  });
  revalidatePath("/approvals");
  revalidatePath("/history");
  return { success: decision === "approved" ? "Solicitud aprobada." : "Solicitud rechazada." };
}
