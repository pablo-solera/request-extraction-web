import { createHash, timingSafeEqual } from "node:crypto";
import { reconcileActiveExtractions } from "@/lib/extractions/service";
import { reconcileTransformer } from "@/lib/transformer/service";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

function isAuthorized(request: Request) {
  const secret = process.env.RECONCILE_SECRET;
  const authorization = request.headers.get("authorization");

  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer ")) {
    return false;
  }

  const provided = authorization.slice("Bearer ".length);
  const expectedBuffer = createHash("sha256").update(secret).digest();
  const providedBuffer = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "No autorizado." } },
      { status: 401, headers: privateHeaders },
    );
  }

  // The two steps are independent: a problem with one reader must not stop loads and comparisons from being followed.
  const [extractions, transformer] = await Promise.allSettled([reconcileActiveExtractions(), reconcileTransformer()]);
  if (extractions.status === "rejected") console.error("Extraction reconciliation failed.", extractions.reason);
  if (transformer.status === "rejected") console.error("Transformer reconciliation failed.", transformer.reason);
  if (extractions.status === "rejected") {
    return Response.json(
      { error: { code: "RECONCILIATION_FAILED", message: "No se ha podido completar la reconciliación." }, transformer: transformer.status === "fulfilled" ? transformer.value : { failed: true } },
      { status: 503, headers: privateHeaders },
    );
  }
  return Response.json({ synchronized: extractions.value, transformer: transformer.status === "fulfilled" ? transformer.value : { started: 0, updated: 0, failed: true } }, { headers: privateHeaders });
}
