"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { getExtractionReaderDetail, performExtractionAction } from "@/lib/extractions/service";
import { historyPageInputSchema, loadHistoryPage } from "@/lib/extractions/history";
import { ReaderError } from "@/lib/readers/errors";
import { describeError } from "@/lib/logging/describe-error";

const inputSchema = z.object({ id: z.uuid(), action: z.enum(["cancel", "resume"]), force: z.boolean().optional() });

export async function extractionAction(input: unknown) {
  const user = await requireUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "La acciÃ³n solicitada no es vÃ¡lida." };

  try {
    const result = await performExtractionAction(parsed.data.id, parsed.data.action, user, parsed.data.force ?? false);
    revalidatePath("/history");
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof ReaderError) return { ok: false as const, message: error.message };
    console.error("Extraction reader action failed.", describeError(error));
    return { ok: false as const, message: "No se ha podido completar la acciÃ³n. IntÃ©ntalo de nuevo." };
  }
}

export async function extractionDetail(input: unknown) {
  const user = await requireUser();
  const parsed = z.uuid().safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "El identificador de la extracciÃ³n no es vÃ¡lido." };
  try {
    return { ok: true as const, detail: await getExtractionReaderDetail(parsed.data, user) };
  } catch (error) {
    if (error instanceof ReaderError) return { ok: false as const, message: error.message };
    console.error("Extraction details lookup failed.", describeError(error));
    return { ok: false as const, message: "No se han podido cargar los detalles de esta extracciÃ³n." };
  }
}

export async function loadHistory(input: unknown) {
  const user = await requireUser();
  const parsed = historyPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "La búsqueda no es válida." };
  try {
    return { ok: true as const, ...await loadHistoryPage(user, parsed.data) };
  } catch (error) {
    console.error("History page lookup failed.", describeError(error));
    return { ok: false as const, message: "No se ha podido cargar el historial. Inténtalo de nuevo." };
  }
}
