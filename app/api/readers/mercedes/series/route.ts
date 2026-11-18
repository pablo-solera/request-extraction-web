import { requireApiUser } from "@/lib/auth/guards";
import { ReaderError } from "@/lib/readers/errors";
import { getMercedesSeries } from "@/lib/readers/mercedes/client";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  const user = await requireApiUser();
  if (!user) return Response.json({ error: { message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });

  try {
    return Response.json({ options: await getMercedesSeries() }, { headers: privateHeaders });
  } catch (error) {
    const status = error instanceof ReaderError ? error.status : 502;
    const message = error instanceof ReaderError ? error.message : "No se han podido cargar las series Mercedes-Benz.";
    return Response.json({ error: { message } }, { status, headers: privateHeaders });
  }
}
