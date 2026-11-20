import { z } from "zod";
import { requireApiIdentity } from "@/lib/auth/guards";
import { ReaderError } from "@/lib/readers/errors";
import { downloadComparison } from "@/lib/transformer/service";
import { describeError } from "@/lib/logging/describe-error";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(_request: Request, context: RouteContext<"/api/comparisons/[id]/download">) {
  const user = await requireApiIdentity();
  if (!user) return Response.json({ error: { code: "UNAUTHORIZED", message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: { code: "INVALID_REQUEST", message: "Identificador no válido." } }, { status: 400, headers: privateHeaders });

  try {
    const { file, filename } = await downloadComparison(id, user);
    const headers = new Headers(privateHeaders);
    headers.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    headers.set("Content-Disposition", `attachment; filename="${filename.replace(/[^A-Za-z0-9_.-]/g, "_")}"`);
    const contentLength = file.headers.get("content-length");
    if (contentLength && /^\d+$/.test(contentLength)) headers.set("Content-Length", contentLength);
    return new Response(file.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof ReaderError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 502, headers: privateHeaders });
    console.error("Comparison download failed.", describeError(error));
    return Response.json({ error: { code: "DOWNLOAD_UNAVAILABLE", message: "No se ha podido preparar la descarga." } }, { status: 502, headers: privateHeaders });
  }
}
