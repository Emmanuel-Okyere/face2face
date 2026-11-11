import { z } from "zod";
import { handle, HttpError } from "@/lib/http";
import { readLogo } from "@/lib/logos";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Public: an organization's logo (it's branding, shown on the public phone
 * check-in page). Versioned URL (?v=n) → safe to cache hard, even on CDNs.
 */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new HttpError(404, "Not found");
  const logo = await readLogo(id.data);
  if (!logo) throw new HttpError(404, "No logo");
  if (_req.headers.get("if-none-match") === logo.etag) return new Response(null, { status: 304, headers: { etag: logo.etag } });
  return new Response(logo.body as BodyInit, {
    headers: {
      "content-type": logo.type,
      "cache-control": "public, max-age=31536000, immutable",
      etag: logo.etag,
      "x-content-type-options": "nosniff",
      // Raster images only, but belt-and-braces: never let it run anything.
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
