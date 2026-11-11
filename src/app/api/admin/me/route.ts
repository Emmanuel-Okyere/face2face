import { db } from "@/lib/db";
import { handle, json, requireAdmin } from "@/lib/http";
import { mailEnabled } from "@/lib/mail";
import { resolveAdminOrg } from "@/lib/tenant";

/** Who am I, which org am I in, and which orgs can I switch to. */
export const GET = handle(async (req) => {
  const a = await requireAdmin(req, { allowPasswordChange: true });
  const org = a.mustChangePassword ? null : await resolveAdminOrg(a, req);
  const orgs = await db()`
    select o.id, o.name, o.slug, o.logo_url as "logoUrl", coalesce(m.role, 'owner') as role
    from organizations o left join memberships m on m.org_id = o.id and m.admin_id = ${a.id}
    where m.admin_id is not null or ${a.isPlatform}
    order by o.name`;
  return json({
    admin: { id: a.id, email: a.email, name: a.name, isPlatform: a.isPlatform, mustChangePassword: a.mustChangePassword },
    org: org && { id: org.id, name: org.name, slug: org.slug, role: org.role, timeZone: org.timeZone, lateAfter: org.lateAfter, selfCheckin: org.selfCheckin, logoUrl: org.logoUrl },
    orgs,
    mailEnabled: mailEnabled(),
  });
});
