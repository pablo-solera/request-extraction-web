import { z } from "zod";
import { requireApiUser } from "@/lib/auth/guards";
import { ReaderError } from "@/lib/readers/errors";
import { getBmwTypekeys } from "@/lib/readers/bmw/client";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const querySchema = z.object({
  brand: z.enum(["BMW", "MINI"]),
  series: z.string().trim().min(1).max(100),
  developmentCode: z.string().regex(/^[A-Z0-9]{1,20}$/),
});

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (!user) return Response.json({ error: { message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });

  const search = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    brand: search.get("brand"),
    series: search.get("series"),
    developmentCode: search.get("developmentCode"),
  });
  if (!parsed.success || ["brand", "series", "developmentCode"].some((key) => search.getAll(key).length !== 1)) {
    return Response.json({ error: { message: "Indica una marca, serie y código de desarrollo válidos." } }, { status: 400, headers: privateHeaders });
  }

  try {
    const options = await getBmwTypekeys(parsed.data.brand, parsed.data.series, parsed.data.developmentCode);
    return Response.json({ options }, { headers: privateHeaders });
  } catch (error) {
    const status = error instanceof ReaderError ? error.status : 502;
    const message = error instanceof ReaderError ? error.message : "No se han podido cargar los typekeys BMW.";
    return Response.json({ error: { message } }, { status, headers: privateHeaders });
  }
}
