import { z } from "zod";
import { getAdmin, getKiosk } from "@/lib/auth";
import { readAvatar } from "@/lib/avatars";
import { handle, HttpError } from "@/lib/http";
import { resolveAdminOrg, tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Streams a face thumbnail to an admin or paired kiosk *of the person's own
 * organization* (enforced by row-level security). Storage is never exposed.
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new HttpError(404, "Not found");

  let orgId: string | null = null;
  const admin = await getAdmin(req);
  if (admin && !admin.mustChangePassword) orgId = (await resolveAdminOrg(admin, req))?.id ?? null;
  if (!orgId) orgId = (await getKiosk(req))?.orgId ?? null;
  if (!orgId) throw new HttpError(401, "Not signed in");

  const img = await tenant(orgId, async (sql) => {
    const r = await readAvatar(sql, id.data);
    if (r && !(r.body instanceof Uint8Array)) {
      // Blob stream: buffer it (≈5 KB) so it doesn't outlive the transaction.
      return { ...r, body: new Uint8Array(await new Response(r.body).arrayBuffer()) };
    }
    return r;
  });
  if (!img) throw new HttpError(404, "No photo");
  if (req.headers.get("if-none-match") === img.etag) {
    return new Response(null, { status: 304, headers: { etag: img.etag } });
  }
  return new Response(img.body as BodyInit, {
    headers: {
      "content-type": "image/jpeg",
      // URL carries ?v=<version>, so it can be cached hard — but only by this browser.
      "cache-control": "private, max-age=31536000, immutable",
      etag: img.etag,
      "content-disposition": "inline",
      "cross-origin-resource-policy": "same-origin",
    },
  });
});
