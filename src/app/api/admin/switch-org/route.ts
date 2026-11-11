import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { body, handle, HttpError, requireAdmin } from "@/lib/http";
import { COOKIE, cookieOptions } from "@/lib/keys";

const schema = z.object({ orgId: z.uuid() });

/** Switch the organization this admin is working in (membership re-checked on every request). */
export const POST = handle(async (req) => {
  const admin = await requireAdmin(req);
  const { orgId } = await body(req, schema);
  const [ok] = await db()`
    select 1 from organizations o
    where o.id = ${orgId}
      and (${admin.isPlatform} or exists (select 1 from memberships m where m.org_id = o.id and m.admin_id = ${admin.id}))`;
  if (!ok) throw new HttpError(403, "You don't have access to that organization");
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(COOKIE.org, orgId, cookieOptions(60 * 60 * 24 * 365));
  return res;
});
