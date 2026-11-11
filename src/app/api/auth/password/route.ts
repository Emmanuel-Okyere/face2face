import bcrypt from "bcryptjs";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { body, handle, HttpError, passwordSchema, requireAdmin } from "@/lib/http";
import { forgotUrl } from "@/lib/admin-tokens";
import { mailEnabled, mails } from "@/lib/mail";
import { rateLimit } from "@/lib/ratelimit";

const schema = z.object({ current: z.string().min(1).max(200), next: passwordSchema });

/**
 * Change password → every other session is revoked; this device gets a fresh one.
 * Also how a temporary (bootstrap / admin-assigned) password is replaced.
 */
export const POST = handle(async (req) => {
  const me = await requireAdmin(req, { allowPasswordChange: true });
  await rateLimit(`pwchange:${me.id}`, 5, 15 * 60);
  const { current, next } = await body(req, schema);
  const sql = db();
  const [a] = await sql`select password_hash, email from admins where id = ${me.id}`;
  if (!(await bcrypt.compare(current, a.password_hash))) throw new HttpError(400, "Current password is incorrect");
  if (next.toLowerCase().includes(a.email.split("@")[0].toLowerCase())) throw new HttpError(400, "Password must not contain your email name");
  if (await bcrypt.compare(next, a.password_hash)) throw new HttpError(400, "Choose a new password, not the current one");
  const hash = await bcrypt.hash(next, 12);
  const [u] = await sql.begin(async (tx) => {
    await tx`update admin_sessions set revoked_at = now(), revoke_reason = 'password_change' where admin_id = ${me.id} and revoked_at is null`;
    return tx`
      update admins set password_hash = ${hash}, password_changed_at = now(), token_version = token_version + 1,
        must_change_password = false
      where id = ${me.id} returning token_version`;
  });
  // Tell them, in case it wasn't them. Skipped for the first change of a temporary password.
  if (mailEnabled() && !me.mustChangePassword) {
    after(() => mails.passwordChanged(a.email, { name: me.name || a.email, url: forgotUrl(req) }).catch((e) => console.error("[mail]", e)));
  }
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  await createSession(res, req, me.id, u.token_version);
  return res;
});
