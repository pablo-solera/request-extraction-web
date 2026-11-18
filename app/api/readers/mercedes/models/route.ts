import { z } from "zod";
import { requireApiUser } from "@/lib/auth/guards";
import { ReaderError } from "@/lib/readers/errors";
import { getMercedesModels } from "@/lib/readers/mercedes/client";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const querySchema = z.object({ series: z.string().trim().min(1).max(100), productGroup: z.string().trim().min(1).max(100).optional() });

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (!user) return Response.json({ error: { message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ series: params.get("series") ?? "", productGroup: params.get("productGroup") ?? undefined });
  if (!parsed.success) return Response.json({ error: { message: "Selecciona una serie." } }, { status: 400, headers: privateHeaders });

  try {
    const { models, productGroups } = await getMercedesModels(parsed.data.series, parsed.data.productGroup);
    return Response.json({ options: models, productGroups }, { headers: privateHeaders });
  } catch (error) {
    const status = error instanceof ReaderError ? error.status : 502;
    const message = error instanceof ReaderError ? error.message : "No se han podido cargar los modelos Mercedes-Benz.";
    return Response.json({ error: { message } }, { status, headers: privateHeaders });
  }
}
