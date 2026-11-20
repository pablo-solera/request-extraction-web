import { z } from "zod";
import { requireApiUser } from "@/lib/auth/guards";
import { limitReaderUsage } from "@/lib/readers/usage";
import { ReaderError } from "@/lib/readers/errors";
import { getRenaultLabourFamilies } from "@/lib/readers/renault/client";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const querySchema = z.object({ brand: z.enum(["Renault", "Dacia"]) });

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (!user) return Response.json({ error: { message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });
  const limited = limitReaderUsage(user.id);
  if (limited) return limited;

  const parsed = querySchema.safeParse({ brand: new URL(request.url).searchParams.get("brand") });
  if (!parsed.success) return Response.json({ error: { message: "Selecciona Renault o Dacia." } }, { status: 400, headers: privateHeaders });

  try {
    const options = await getRenaultLabourFamilies(parsed.data.brand);
    return Response.json({ options }, { headers: privateHeaders });
  } catch (error) {
    const status = error instanceof ReaderError ? error.status : 502;
    const message = error instanceof ReaderError ? error.message : `No se han podido cargar las familias de ${parsed.data.brand}.`;
    return Response.json({ error: { message } }, { status, headers: privateHeaders });
  }
}
