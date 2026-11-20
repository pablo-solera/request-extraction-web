import { z } from "zod";
import { requireApiIdentity } from "@/lib/auth/guards";
import { findTableConflict } from "@/lib/transformer/service";
import { describeError } from "@/lib/logging/describe-error";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const querySchema = z.object({
  axCode: z.string().regex(/^[A-Za-z0-9]{3,4}$/),
  imcEdition: z.string().regex(/^\d{2}\/\d$/),
  brand: z.enum(["BMW", "MINI"]),
});

/** Whether loading a request with this AX code, edition and brand would replace a table that is already in BMW_Labour. */
export async function GET(request: Request) {
  const user = await requireApiIdentity();
  if (!user) return Response.json({ error: { code: "UNAUTHORIZED", message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });

  const search = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ axCode: search.get("axCode"), imcEdition: search.get("imcEdition"), brand: search.get("brand") });
  if (!parsed.success) return Response.json({ error: { code: "INVALID_REQUEST", message: "Indica un código AX, una edición y una marca válidos." } }, { status: 400, headers: privateHeaders });

  try {
    const conflict = await findTableConflict(parsed.data);
    return Response.json({ conflict: conflict !== null, loadedAt: conflict?.loadedAt ?? null }, { headers: privateHeaders });
  } catch (error) {
    console.error("Table conflict lookup failed.", describeError(error));
    return Response.json({ error: { code: "LOOKUP_FAILED", message: "No se ha podido comprobar si la tabla ya existe." } }, { status: 503, headers: privateHeaders });
  }
}
