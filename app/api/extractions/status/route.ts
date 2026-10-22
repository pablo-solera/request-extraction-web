import { z } from "zod";
import { requireApiIdentity } from "@/lib/auth/guards";
import { extractionDto, getReaderCapabilitiesForExtractions, syncLiveReaderProgress } from "@/lib/extractions/service";
import { listExtractionsVisibleToUserByIds } from "@/lib/extractions/service";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const idSchema = z.uuid();

export async function GET(request: Request) {
  const user = await requireApiIdentity();
  if (!user) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });
  }

  const ids = new URL(request.url).searchParams.getAll("id");
  if (ids.length > 100 || ids.some((id) => !idSchema.safeParse(id).success)) {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "La lista de extracciones no es válida." } }, { status: 400, headers: privateHeaders });
  }
  if (ids.length === 0) return Response.json([], { headers: privateHeaders });

  try {
    const rows = await listExtractionsVisibleToUserByIds(user, ids);
    const synchronized = await syncLiveReaderProgress(rows);
    const capabilities = await getReaderCapabilitiesForExtractions(synchronized);
    return Response.json(synchronized.map(({ extraction, requestStatus, requester }) => extractionDto(extraction, requestStatus, requester.fallbackName ?? requester.fallbackEmail, capabilities.get(extraction.readerKey))), { headers: privateHeaders });
  } catch (error) {
    console.error("Extraction status batch lookup failed.", error);
    return Response.json({ error: { code: "STATUS_UNAVAILABLE", message: "No se ha podido consultar el estado." } }, { status: 503, headers: privateHeaders });
  }
}
