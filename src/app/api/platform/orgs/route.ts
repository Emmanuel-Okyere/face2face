import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendInvite, signInUrl, unusablePasswordHash } from "@/lib/admin-tokens";
import { body, handle, HttpError, json, passwordSchema, requirePlatform } from "@/lib/http";
import { COOKIE, cookieOptions } from "@/lib/keys";
import { mailEnabled, mails } from "@/lib/mail";
import { isValidTimeZone } from "@/lib/tenant";

/** Platform admins: every organization on this deployment, with usage. */
export const GET = handle(async (req) => {
  await requirePlatform(req);
  const orgs = await db()`
    select o.id, o.name, o.slug, o.logo_url, o.time_zone, o.self_checkin, o.created_at,
      (select count(*)::int from people p where p.org_id = o.id) as people,
      (select count(distinct e.person_id)::int from face_embeddings e where e.org_id = o.id) as enrolled,
      (select count(*)::int from memberships m where m.org_id = o.id) as admins,
      (select max(a.checked_in_at) from attendance a where a.org_id = o.id) as last_checkin
    from organizations o order by o.created_at desc`;
  return json({ orgs, mailEnabled: mailEnabled() });
});

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers and dashes").min(3).max(48),
  timeZone: z.string().refine(isValidTimeZone, "Unknown time zone").default("UTC"),
  owner: z
    .object({ email: z.email().max(200), name: z.string().trim().min(1).max(100), password: passwordSchema.optional() })
    .optional(),
});

/** Create an organization, optionally with its first owner (new accounts get an invite email, or a temporary password without email). */
export const POST = handle(async (req) => {
  const me = await requirePlatform(req);
  const p = await body(req, schema);
  const invite = !!p.owner && !p.owner.password && mailEnabled();
  let owner = null as { id: string; email: string; name: string; created: boolean } | null;
  const org = await db().begin(async (tx) => {
    const [o] = await tx`
      insert into organizations (name, slug, time_zone, late_after)
      values (${p.name}, ${p.slug}, ${p.timeZone}, '09:00')
      on conflict (slug) do nothing returning id, name, slug`;
    if (!o) throw new HttpError(409, `The address “${p.slug}” is taken`);
    let ownerId = me.id;
    if (p.owner) {
      const email = p.owner.email.toLowerCase();
      let [a] = await tx`select id, name from admins where email = ${email}`;
      let created = false;
      if (!a) {
        if (!p.owner.password && !invite) throw new HttpError(400, "Set a temporary password for the new owner");
        const hash = p.owner.password ? await bcrypt.hash(p.owner.password, 12) : await unusablePasswordHash();
        [a] = await tx`
          insert into admins (email, name, password_hash, must_change_password)
          values (${email}, ${p.owner.name}, ${hash}, ${!!p.owner.password}) returning id, name`;
        created = true;
      }
      ownerId = a.id;
      owner = { id: a.id, email, name: a.name, created };
    }
    await tx`insert into memberships (org_id, admin_id, role) values (${o.id}, ${ownerId}, 'owner') on conflict do nothing`;
    // Works out of the box; owners replace it with their own services.
    await tx`insert into services (org_id, name, kind, start_time, end_time, opens_before, closes_after, late_after)
      values (${o.id}, 'Every day', 'daily', '00:00', '23:59', 0, 0, 540)`;
    return o;
  });
  let emailed = false;
  let emailError: string | undefined;
  if (owner && owner.id !== me.id && mailEnabled()) {
    try {
      if (owner.created && invite) await sendInvite(req, owner, me.name || me.email, org.name);
      else await mails.addedToOrg(owner.email, { name: owner.name || owner.email, by: me.name || me.email, org: org.name, url: signInUrl(req) });
      emailed = true;
    } catch (e) {
      console.error("[mail] owner invite failed:", e);
      emailError = "Couldn't send the email. Resend it from Settings → Team.";
    }
  }
  // Jump straight into the new org.
  const res = NextResponse.json({ org, invited: !!owner?.created && invite, emailed, emailError }, { status: 201, headers: { "cache-control": "no-store" } });
  res.cookies.set(COOKIE.org, org.id, cookieOptions(60 * 60 * 24 * 365));
  return res;
});
