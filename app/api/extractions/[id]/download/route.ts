import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiIdentity } from "@/lib/auth/guards";
import { getManageableExtraction } from "@/lib/extractions/service";
import { downloadBmwLabourArchive } from "@/lib/readers/bmw/client";
import { getRenaultDownloadLocation, ReaderError } from "@/lib/readers/renault/client";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(_request: Request, context: RouteContext<"/api/extractions/[id]/download">) {
  const user = await requireApiIdentity();

  if (!user) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Inicia sesión." } }, { status: 401, headers: privateHeaders });
  }

  const { id } = await context.params;

  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: { code: "INVALID_REQUEST", message: "Identificador no valido." } }, { status: 400, headers: privateHeaders });
  }

  try {
    const row = await getManageableExtraction(id, user);

    if (!row) {
      return Response.json({ error: { code: "NOT_FOUND", message: "Extracción no encontrada." } }, { status: 404, headers: privateHeaders });
    }

    const { extraction } = row;

    if (extraction.readerKey === "bmw-labours") {
      if (extraction.status !== "completed" || !extraction.remoteRequestId) {
        return Response.json({ error: { code: "JOB_NOT_READY", message: "El ZIP estará disponible cuando la extracción termine." } }, { status: 409, headers: privateHeaders });
      }
      const archive = await downloadBmwLabourArchive(extraction.remoteRequestId);
      const safeAxCode = extraction.axCode.replace(/[^A-Za-z0-9_-]/g, "_");
      const headers = new Headers(privateHeaders);
      headers.set("Content-Type", "application/zip");
      headers.set("Content-Disposition", `attachment; filename="${safeAxCode}_BMW.zip"`);
      const contentLength = archive.headers.get("content-length");
      if (contentLength && /^\d+$/.test(contentLength)) headers.set("Content-Length", contentLength);
      return new Response(archive.body, { status: 200, headers });
    }

    if (extraction.status !== "completed" || !extraction.remoteRequestId) {
      return Response.json({ error: { code: "JOB_NOT_READY", message: "La extracción no está lista." } }, { status: 409, headers: privateHeaders });
    }

    const response = NextResponse.redirect(await getRenaultDownloadLocation(extraction.remoteRequestId), 307);
    response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
    return response;
  } catch (error) {
    const status = error instanceof ReaderError ? error.status : 502;
    const message = error instanceof ReaderError ? error.message : "No se ha podido preparar la descarga.";
    return Response.json({ error: { code: "DOWNLOAD_UNAVAILABLE", message } }, { status, headers: privateHeaders });
  }
}
