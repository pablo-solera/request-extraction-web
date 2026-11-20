import { z } from "zod";
import { requireApiIdentity } from "@/lib/auth/guards";
import { getTransformerInfo } from "@/lib/transformer/service";
import { describeError } from "@/lib/logging/describe-error";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const idSchema = z.uuid();

export async function GET(request: Request) {
  const user = await requireApiIdentity();
  if (!user) return Response.json({ error: { code: "UNAUTHORIZED", message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });

  const ids = new URL(request.url).searchParams.getAll("id");
  if (ids.length > 100 || ids.some((id) => !idSchema.safeParse(id).success)) {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "La lista de solicitudes no es válida." } }, { status: 400, headers: privateHeaders });
  }
  try {
    return Response.json(await getTransformerInfo(ids, user), { headers: privateHeaders });
  } catch (error) {
    console.error("Transformer info lookup failed.", describeError(error));
    return Response.json({ error: { code: "STATUS_UNAVAILABLE", message: "No se ha podido consultar el estado de la carga." } }, { status: 503, headers: privateHeaders });
  }
}
