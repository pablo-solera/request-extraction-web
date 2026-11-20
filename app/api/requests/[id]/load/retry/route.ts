import { z } from "zod";
import { requireApiIdentity } from "@/lib/auth/guards";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { ReaderError } from "@/lib/readers/errors";
import { retryRequestLoad } from "@/lib/transformer/service";
import { describeError } from "@/lib/logging/describe-error";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: Request, context: RouteContext<"/api/requests/[id]/load/retry">) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const user = await requireApiIdentity();
  if (!user) return Response.json({ error: { code: "UNAUTHORIZED", message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_REQUEST", message: "Identificador no válido." } }, { status: 400, headers: privateHeaders });

  try {
    await retryRequestLoad(id, user);
    return Response.json({ ok: true }, { status: 202, headers: privateHeaders });
  } catch (error) {
    if (error instanceof ReaderError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 502, headers: privateHeaders });
    console.error("Transformer load retry failed.", describeError(error));
    return Response.json({ error: { code: "RETRY_FAILED", message: "No se ha podido reintentar la carga." } }, { status: 502, headers: privateHeaders });
  }
}
