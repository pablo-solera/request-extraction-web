"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createExtraction, submitNewApprovedRequest } from "@/lib/extractions/service";
import { extractionFormSchema } from "@/lib/extractions/validation";
import { requireUser } from "@/lib/auth/guards";
import { ReaderError } from "@/lib/readers/errors";

export type ExtractionFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: { axCode: string; imcEdition: string; completion: string; laboursDevelopmentStart: string; comments: string };
};

export async function createExtractionAction(
  _previousState: ExtractionFormState,
  formData: FormData,
): Promise<ExtractionFormState> {
  const user = await requireUser();
  const parsed = extractionFormSchema.safeParse({
    axCode: formData.get("axCode"),
    imcEdition: formData.get("imcEdition"),
    completion: formData.get("completion"),
    laboursDevelopmentStart: formData.get("laboursDevelopmentStart"),
    comments: formData.get("comments"),
    vehicles: (() => {
      try { return JSON.parse(String(formData.get("vehicles") ?? "[]")); } catch { return []; }
    })(),
  });

  const values = {
    axCode: String(formData.get("axCode") ?? ""),
    imcEdition: String(formData.get("imcEdition") ?? ""),
    completion: String(formData.get("completion") ?? ""),
    laboursDevelopmentStart: String(formData.get("laboursDevelopmentStart") ?? ""),
    comments: String(formData.get("comments") ?? ""),
  };

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const [field, index, vehicleField] = issue.path;
      const key = field === "vehicles" && typeof index === "number" ? `vehicle.${index}.${String(vehicleField ?? "")}` : String(field ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del formulario.", fieldErrors, values };
  }

  let extraction;

  try {
    extraction = await createExtraction(user, parsed.data, user.role, { confirmReplace: formData.get("confirmReplace") === "true" });
  } catch (error) {
    if (error instanceof ReaderError) {
      return { error: error.code === "READER_CONFIGURATION_ERROR" ? "La integración con el reader no está disponible. Contacta con soporte." : error.message, values };
    }

    console.error("Extraction creation failed.", error);
    return { error: "No se ha podido crear la extracción.", values };
  }

  if (user.role !== "employee") after(async () => {
    try {
      await submitNewApprovedRequest(extraction.requestGroupId);
    } catch (error) {
      console.error("Approved extraction submission failed after response.", error);
    }
  });
  revalidatePath("/history");
  revalidatePath("/approvals");
  redirect(`/history?created=${extraction.requestGroupId}`);
}
