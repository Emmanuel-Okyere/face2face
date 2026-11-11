import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendInvite, signInUrl, unusablePasswordHash } from "@/lib/admin-tokens";
import { body, handle, HttpError, json, passwordSchema, requireOrg } from "@/lib/http";
import { mailEnabled, mails } from "@/lib/mail";
import { rateLimit } from "@/lib/ratelimit";

/** Admins of the current organization. */
export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  const admins = await db()`
    select a.id, a.email, a.name, m.role, a.created_at, a.last_login_at, a.must_change_password,
      (a.locked_until > now()) as locked,
      (select count(*)::int from admin_sessions s where s.admin_id = a.id and s.revoked_at is null and s.expires_at > now()) as sessions
    from memberships m join admins a on a.id = m.admin_id
    where m.org_id = ${org.id}
    order by m.role desc, a.created_at`;
  return json({ admins, myRole: org.role, mailEnabled: mailEnabled() });
});

const schema = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(1).max(100),
  role: z.enum(["owner", "admin"]).default("admin"),
  // Only when email isn't set up: a temporary password for NEW accounts, changed at first sign-in.
  // With email, new admins get a link to set their own password instead.
  password: passwordSchema.optional(),
});

/**
 * Add an admin to this organization (owners only). Existing accounts (e.g. an
 * admin of another org) are just given a membership — their password is untouched.
 */
export const POST = handle(async (req) => {
  const { admin: me, org } = await requireOrg(req, { owner: true });
  const a = await body(req, schema);
  const email = a.email.toLowerCase();
  const invite = !a.password && mailEnabled();
  const sql = db();
  const result = await sql.begin(async (tx) => {
    let [existing] = await tx`select id, name from admins where email = ${email}`;
    let created = false;
    if (!existing) {
      if (!a.password && !invite) throw new HttpError(400, "Set a temporary password for the new admin");
      const hash = a.password ? await bcrypt.hash(a.password, 12) : await unusablePasswordHash();
      [existing] = await tx`
        insert into admins (email, name, password_hash, must_change_password)
        values (${email}, ${a.name}, ${hash}, ${!!a.password}) returning id, name`;
      created = true;
    }
    const m = await tx`
      insert into memberships (org_id, admin_id, role) values (${org.id}, ${existing.id}, ${a.role})
      on conflict do nothing returning admin_id`;
    if (!m.length) throw new HttpError(409, "That person is already an admin here");
    return { id: existing.id as string, name: existing.name as string, created };
  });

  // Email after the account exists. A failed send doesn't undo it: the owner can resend.
  let emailed = false;
  let emailError: string | undefined;
  if (mailEnabled()) {
    const by = me.name || me.email;
    try {
      if (result.created && invite) await sendInvite(req, { id: result.id, email, name: result.name }, by, org.name);
      else await mails.addedToOrg(email, { name: result.name || email, by, org: org.name, url: signInUrl(req) });
      emailed = true;
    } catch (e) {
      console.error("[mail] admin invite failed:", e);
      emailError = "Couldn't send the email. Try again with Resend invite.";
    }
  }
  return json({ admin: { id: result.id, created: result.created }, invited: result.created && invite, emailed, emailError }, 201);
});

const patchSchema = z.object({ action: z.enum(["unlock", "role", "invite"]), role: z.enum(["owner", "admin"]).optional() });

export const PATCH = handle(async (req) => {
  const { admin: me, org } = await requireOrg(req, { owner: true });
  const id = z.uuid().parse(req.nextUrl.searchParams.get("id"));
  const p = await body(req, patchSchema);
  const sql = db();
  const [member] = await sql`select role from memberships where org_id = ${org.id} and admin_id = ${id}`;
  if (!member) throw new HttpError(404, "Not an admin of this organization");
  if (p.action === "invite") {
    // Only for accounts that have never signed in; everyone else uses "Forgot password".
    const [a] = await sql`select id, email, name from admins where id = ${id} and last_login_at is null`;
    if (!a) throw new HttpError(400, "They've already signed in — they can use “Forgot password”");
    if (!mailEnabled()) throw new HttpError(400, "Email isn't set up");
    await rateLimit(`invite:${id}`, 5, 60 * 60);
    await sendInvite(req, a as { id: string; email: string; name: string }, me.name || me.email, org.name);
  } else if (p.action === "unlock") {
    await sql`update admins set failed_logins = 0, locked_until = null where id = ${id}`;
  } else {
    if (!p.role) throw new HttpError(400, "role required");
    if (id === me.id && p.role !== "owner") await assertAnotherOwner(org.id, id);
    await sql`update memberships set role = ${p.role} where org_id = ${org.id} and admin_id = ${id}`;
  }
  return json({ ok: true });
});

/** Remove an admin from this organization (their account survives if they belong elsewhere). */
export const DELETE = handle(async (req) => {
  const { admin: me, org } = await requireOrg(req, { owner: true });
  const id = z.uuid().parse(req.nextUrl.searchParams.get("id"));
  if (id === me.id) throw new HttpError(400, "You can't remove yourself");
  await assertAnotherOwner(org.id, id);
  await db().begin(async (tx) => {
    await tx`delete from memberships where org_id = ${org.id} and admin_id = ${id}`;
    // No org left and not a platform admin → the account is useless; delete it (sessions cascade).
    await tx`
      delete from admins a where a.id = ${id} and not a.is_platform_admin
        and not exists (select 1 from memberships m where m.admin_id = a.id)`;
  });
  return json({ ok: true });
});

async function assertAnotherOwner(orgId: string, leavingId: string) {
  const [r] = await db()`
    select count(*)::int as n from memberships where org_id = ${orgId} and role = 'owner' and admin_id <> ${leavingId}`;
  const [leaving] = await db()`select role from memberships where org_id = ${orgId} and admin_id = ${leavingId}`;
  if (leaving?.role === "owner" && r.n === 0) throw new HttpError(400, "An organization needs at least one owner");
}
