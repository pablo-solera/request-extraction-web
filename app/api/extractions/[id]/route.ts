import { z } from "zod";
import { requireApiUser } from "@/lib/auth/guards";
import { extractionDto } from "@/lib/extractions/service";
import { listOwnedExtractions } from "@/lib/extractions/repository";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(_request: Request, context: RouteContext<"/api/extractions/[id]">) {
  const user = await requireApiUser();

  if (!user) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });
  }

  const { id } = await context.params;

  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "Identificador no valido." } }, { status: 400, headers: privateHeaders });
  }

  try {
    const [row] = await listOwnedExtractions(user.id, [id]);

    if (!row) {
      return Response.json({ error: { code: "NOT_FOUND", message: "Extracción no encontrada." } }, { status: 404, headers: privateHeaders });
    }

    return Response.json(extractionDto(row.extraction, row.requestStatus), { headers: privateHeaders });
  } catch (error) {
    console.error("Extraction status lookup failed.", error);
    return Response.json({ error: { code: "STATUS_UNAVAILABLE", message: "No se ha podido consultar el estado." } }, { status: 503, headers: privateHeaders });
  }
}
