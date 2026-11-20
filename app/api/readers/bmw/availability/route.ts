import { z } from "zod";
import { requireApiUser } from "@/lib/auth/guards";
import { limitReaderUsage } from "@/lib/readers/usage";
import { ReaderError } from "@/lib/readers/errors";
import { getBmwTypekeyAvailability } from "@/lib/readers/bmw/client";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const querySchema = z.object({
  brand: z.enum(["BMW", "MINI"]),
  series: z.string().trim().min(1).max(100),
  developmentCode: z.string().regex(/^[A-Z0-9]{1,20}$/),
  typekey: z.string().regex(/^[A-Z0-9]{4}$/),
});
const queryKeys = ["brand", "series", "developmentCode", "typekey"] as const;

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (!user) return Response.json({ error: { message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });
  const limited = limitReaderUsage(user.id);
  if (limited) return limited;

  const search = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(queryKeys.map((key) => [key, search.get(key)])));
  if (!parsed.success || queryKeys.some((key) => search.getAll(key).length !== 1)) {
    return Response.json({ error: { message: "Indica una marca, serie, código de desarrollo y typekey válidos." } }, { status: 400, headers: privateHeaders });
  }

  try {
    const availability = await getBmwTypekeyAvailability(parsed.data.brand, parsed.data.series, parsed.data.developmentCode, parsed.data.typekey);
    return Response.json({ availability }, { headers: privateHeaders });
  } catch (error) {
    const status = error instanceof ReaderError ? error.status : 502;
    const message = error instanceof ReaderError ? error.message : "No se ha podido comprobar la disponibilidad del typekey.";
    return Response.json({ error: { message } }, { status, headers: privateHeaders });
  }
}
