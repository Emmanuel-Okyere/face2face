import bcrypt from "bcryptjs";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { forgotUrl, peekToken } from "@/lib/admin-tokens";
import { clientIp, createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { body, handle, HttpError, passwordSchema } from "@/lib/http";
import { mailEnabled, mails } from "@/lib/mail";
import { rateLimit } from "@/lib/ratelimit";

const schema = z.object({
  token: z.string().min(20).max(100),
  // Omitted = just check the link and say whose it is.
  password: passwordSchema.optional(),
});

const EXPIRED = "This link has expired or was already used.";

/** Finish an invite or a password reset from an emailed one-time link, then sign in. */
export const POST = handle(async (req) => {
  await rateLimit(`setpw:ip:${clientIp(req)}`, 20, 15 * 60);
  const { token, password } = await body(req, schema);
  const t = await peekToken(token);
  if (!t) throw new HttpError(400, EXPIRED, {}, "expired");
  if (!password) {
    return NextResponse.json({ email: t.email, name: t.name, purpose: t.purpose }, { headers: { "cache-control": "no-store" } });
  }
  if (password.toLowerCase().includes(t.email.split("@")[0].toLowerCase())) {
    throw new HttpError(400, "Password must not contain your email name");
  }

  const hash = await bcrypt.hash(password, 12);
  const u = await db().begin(async (tx) => {
    // Single use: claim the token first; a concurrent request finds it gone.
    const claimed = await tx`update admin_tokens set used_at = now() where id = ${t.id} and used_at is null and expires_at > now() returning id`;
    if (!claimed.length) throw new HttpError(400, EXPIRED, {}, "expired");
    await tx`delete from admin_tokens where admin_id = ${t.admin_id} and id <> ${t.id}`;
    await tx`update admin_sessions set revoked_at = now(), revoke_reason = 'password_reset' where admin_id = ${t.admin_id} and revoked_at is null`;
    const [row] = await tx`
      update admins set password_hash = ${hash}, password_changed_at = now(), token_version = token_version + 1,
        must_change_password = false, failed_logins = 0, locked_until = null, last_login_at = now()
      where id = ${t.admin_id} returning token_version`;
    return row;
  });

  if (t.purpose === "reset" && mailEnabled()) {
    after(() => mails.passwordChanged(t.email, { name: t.name || t.email, url: forgotUrl(req) }).catch((e) => console.error("[mail]", e)));
  }
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  await createSession(res, req, t.admin_id, u.token_version);
  return res;
});
