import { z } from "zod";
import { requireApiIdentity } from "@/lib/auth/guards";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { ReaderError } from "@/lib/readers/errors";
import { MAX_LST_BYTES } from "@/lib/transformer/client";
import { uploadComparison } from "@/lib/transformer/service";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Content-Length can be absent or false, so the bytes actually read are counted and the stream is cancelled at the limit. */
async function readLimitedBody(request: Request, limit: number) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); return "too-large" as const; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function POST(request: Request, context: RouteContext<"/api/requests/[id]/comparisons">) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const user = await requireApiIdentity();
  if (!user) return Response.json({ error: { code: "UNAUTHORIZED", message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_REQUEST", message: "Identificador no válido." } }, { status: 400, headers: privateHeaders });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_LST_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return Response.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "El fichero supera el tamaño permitido." } }, { status: 413, headers: privateHeaders });
  }

  const body = await readLimitedBody(request, MAX_LST_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (body === "too-large") return Response.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "El fichero supera el tamaño permitido." } }, { status: 413, headers: privateHeaders });

  let form: FormData;
  try { form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { return Response.json({ error: { code: "INVALID_REQUEST", message: "Sube el fichero como multipart/form-data." } }, { status: 400, headers: privateHeaders }); }
  const file = form.get("file");
  if (!file || typeof file === "string") return Response.json({ error: { code: "INVALID_REQUEST", message: "Selecciona un fichero .LST o .ZIP." } }, { status: 400, headers: privateHeaders });

  try {
    const comparisonId = await uploadComparison(id, user, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json({ id: comparisonId }, { status: 202, headers: privateHeaders });
  } catch (error) {
    if (error instanceof ReaderError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 502, headers: privateHeaders });
    console.error("Comparison upload failed.", error);
    return Response.json({ error: { code: "UPLOAD_FAILED", message: "No se ha podido iniciar la comparación." } }, { status: 502, headers: privateHeaders });
  }
}
