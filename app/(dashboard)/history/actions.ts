"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { getExtractionReaderDetail, performExtractionAction } from "@/lib/extractions/service";
import { ReaderError } from "@/lib/readers/errors";

const inputSchema = z.object({ id: z.uuid(), action: z.enum(["cancel", "resume"]), force: z.boolean().optional() });

export async function extractionAction(input: unknown) {
  const user = await requireUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "La acción solicitada no es válida." };

  try {
    const result = await performExtractionAction(parsed.data.id, parsed.data.action, user, parsed.data.force ?? false);
    revalidatePath("/history");
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof ReaderError) return { ok: false as const, message: error.message };
    console.error("Extraction reader action failed.", error);
    return { ok: false as const, message: "No se ha podido completar la acción. Inténtalo de nuevo." };
  }
}

export async function extractionDetail(input: unknown) {
  const user = await requireUser();
  const parsed = z.uuid().safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "El identificador de la extracción no es válido." };
  try {
    return { ok: true as const, detail: await getExtractionReaderDetail(parsed.data, user) };
  } catch (error) {
    if (error instanceof ReaderError) return { ok: false as const, message: error.message };
    console.error("Extraction details lookup failed.", error);
    return { ok: false as const, message: "No se han podido cargar los detalles de esta extracción." };
  }
}
