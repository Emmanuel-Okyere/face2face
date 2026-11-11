import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendInvite, signInUrl, unusablePasswordHash } from "@/lib/admin-tokens";
import { body, handle, HttpError, json, passwordSchema, requirePlatform } from "@/lib/http";
import { mailEnabled, mails } from "@/lib/mail";
import { rateLimit } from "@/lib/ratelimit";

/**
 * Platform admins can see and manage EVERY organization. Organization admins
 * (memberships) only ever see their own. This route manages the former.
 */
export const GET = handle(async (req) => {
  await requirePlatform(req);
  const admins = await db()`
    select a.id, a.email, a.name, a.created_at, a.last_login_at, a.must_change_password,
      (a.locked_until > now()) as locked,
      (select count(*)::int from memberships m where m.admin_id = a.id) as orgs
    from admins a where a.is_platform_admin
    order by a.created_at`;
  return json({ admins, mailEnabled: mailEnabled() });
});

/** Step-up: granting or revoking platform access requires the acting admin's own password. */
async function confirmSelf(adminId: string, password: string) {
  await rateLimit(`platform-stepup:${adminId}`, 10, 15 * 60);
  const [me] = await db()`select password_hash from admins where id = ${adminId}`;
  if (!me || !(await bcrypt.compare(password, me.password_hash))) throw new HttpError(403, "Your password is incorrect");
}

const grantSchema = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(1).max(100),
  // Only for brand-new accounts when email isn't set up; changed at first sign-in.
  password: passwordSchema.optional(),
  confirmPassword: z.string().min(1).max(200),
});

/** Make someone a platform admin: promotes an existing account or creates a new one. */
export const POST = handle(async (req) => {
  const me = await requirePlatform(req);
  const p = await body(req, grantSchema);
  await confirmSelf(me.id, p.confirmPassword);
  const email = p.email.toLowerCase();
  const invite = !p.password && mailEnabled();
  const result = await db().begin(async (tx) => {
    const [existing] = await tx`select id, name, is_platform_admin from admins where email = ${email}`;
    if (existing?.is_platform_admin) throw new HttpError(409, "Already a platform admin");
    if (existing) {
      await tx`update admins set is_platform_admin = true where id = ${existing.id}`;
      return { id: existing.id as string, name: existing.name as string, created: false };
    }
    if (!p.password && !invite) throw new HttpError(400, "Set a temporary password for the new account");
    const hash = p.password ? await bcrypt.hash(p.password, 12) : await unusablePasswordHash();
    const [a] = await tx`
      insert into admins (email, name, password_hash, is_platform_admin, must_change_password)
      values (${email}, ${p.name}, ${hash}, true, ${!!p.password})
      returning id, name`;
    return { id: a.id as string, name: a.name as string, created: true };
  });
  console.warn(`[platform] ${me.email} granted platform access to ${email}`);

  let emailed = false;
  let emailError: string | undefined;
  if (mailEnabled()) {
    try {
      if (result.created && invite) await sendInvite(req, { id: result.id, email, name: result.name }, me.name || me.email);
      else await mails.addedToOrg(email, { name: result.name || email, by: me.name || me.email, org: "every organization", url: signInUrl(req) });
      emailed = true;
    } catch (e) {
      console.error("[mail] platform invite failed:", e);
      emailError = "Couldn't send the email. They can use “Forgot password” on the sign-in page.";
    }
  }
  return json({ admin: { id: result.id, created: result.created }, invited: result.created && invite, emailed, emailError }, 201);
});

const revokeSchema = z.object({ confirmPassword: z.string().min(1).max(200) });

/** Remove platform access (the account keeps any organization memberships). */
export const DELETE = handle(async (req) => {
  const me = await requirePlatform(req);
  const id = z.uuid().parse(req.nextUrl.searchParams.get("id"));
  const { confirmPassword } = await body(req, revokeSchema);
  await confirmSelf(me.id, confirmPassword);
  if (id === me.id) throw new HttpError(400, "You can't remove your own platform access");
  await db().begin(async (tx) => {
    const [{ n }] = await tx`select count(*)::int as n from admins where is_platform_admin and id <> ${id}`;
    if (n === 0) throw new HttpError(400, "There must be at least one platform admin");
    const [a] = await tx`
      update admins set is_platform_admin = false where id = ${id} and is_platform_admin returning email`;
    if (!a) throw new HttpError(404, "Not a platform admin");
    // Sign them out everywhere so the change is felt immediately in every tab.
    await tx`update admins set token_version = token_version + 1 where id = ${id}`;
    await tx`update admin_sessions set revoked_at = now(), revoke_reason = 'platform_access_revoked' where admin_id = ${id} and revoked_at is null`;
    console.warn(`[platform] ${me.email} revoked platform access from ${a.email}`);
  });
  return json({ ok: true });
});
