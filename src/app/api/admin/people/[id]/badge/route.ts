import { z } from "zod";
import { handle, HttpError, json, requireOrg } from "@/lib/http";
import { makeBadgeToken, makeLinkToken } from "@/lib/qr";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

function payload(origin: string, org: { slug: string; selfCheckin: boolean }, p: { id: string; qr_version: number }) {
  return {
    token: makeBadgeToken(p.id, p.qr_version),
    version: p.qr_version,
    // Personal phone check-in link (only usable while self check-in is on for the org).
    link: org.selfCheckin ? `${origin}/checkin/${org.slug}?p=${makeLinkToken(p.id, p.qr_version)}` : null,
  };
}

export const GET = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const [p] = await tenant(org.id, (sql) => sql`select id, qr_version from people where id = ${id}`);
  if (!p) throw new HttpError(404, "Not found");
  return json(payload(req.nextUrl.origin, org, { id: p.id, qr_version: p.qr_version }));
});

/** Revoke the current badge AND personal link (lost/shared) and issue new ones. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const [p] = await tenant(org.id, (sql) => sql`update people set qr_version = qr_version + 1 where id = ${id} returning id, qr_version`);
  if (!p) throw new HttpError(404, "Not found");
  return json(payload(req.nextUrl.origin, org, { id: p.id, qr_version: p.qr_version }));
});
