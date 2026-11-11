import { NextResponse } from "next/server";
import { z } from "zod";
import { setKioskCookie } from "@/lib/auth";
import { body, handle, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

const schema = z.object({ name: z.string().trim().min(1).max(80) });

/**
 * Turns the *current browser* into a check-in kiosk for the admin's current
 * organization. The kiosk cookie is long-lived but revocable from /admin/kiosks.
 */
export const POST = handle(async (req) => {
  const { admin, org } = await requireOrg(req);
  const { name } = await body(req, schema);
  const [kiosk] = await tenant(org.id, (sql) => sql`
    insert into kiosks (org_id, name, created_by) values (${org.id}, ${name}, ${admin.id}) returning id, name`);
  const res = NextResponse.json({ kiosk: { ...kiosk, org: org.name } });
  await setKioskCookie(res, { id: kiosk.id });
  return res;
});
