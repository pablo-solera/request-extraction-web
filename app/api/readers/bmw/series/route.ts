import { z } from "zod";
import { requireApiUser } from "@/lib/auth/guards";
import { ReaderError } from "@/lib/readers/errors";
import { getBmwModelSeries } from "@/lib/readers/bmw/client";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const querySchema = z.object({ brand: z.enum(["BMW", "MINI"]) });

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (!user) return Response.json({ error: { message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });

  const parsed = querySchema.safeParse({ brand: new URL(request.url).searchParams.get("brand") });
  if (!parsed.success) return Response.json({ error: { message: "Selecciona BMW o MINI." } }, { status: 400, headers: privateHeaders });

  try {
    const options = await getBmwModelSeries(parsed.data.brand);
    return Response.json({ options }, { headers: privateHeaders });
  } catch (error) {
    const status = error instanceof ReaderError ? error.status : 502;
    const message = error instanceof ReaderError ? error.message : "No se han podido cargar las series BMW.";
    return Response.json({ error: { message } }, { status, headers: privateHeaders });
  }
}
