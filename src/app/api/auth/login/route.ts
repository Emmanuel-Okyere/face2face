import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { body, handle, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

const schema = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });

// Real bcrypt hash of a random string: unknown emails cost the same time as
// known ones, so response timing doesn't reveal which admin accounts exist.
const DUMMY_HASH = "$2b$12$5LY3M0RF2ylTQ7PU4XDU3.KVfuXrEB1t62Dk/tLAL9TkwBGWm61/O";
const GENERIC = "Wrong email or password, or too many attempts. Try again later.";

export const POST = handle(async (req) => {
  const ip = clientIp(req);
  await rateLimit(`login:ip:${ip}`, 20, 15 * 60);
  const { email, password } = await body(req, schema);
  const em = email.toLowerCase();
  await rateLimit(`login:email:${em}`, 10, 15 * 60);

  const sql = db();
  const [admin] = await sql`
    select id, email, name, password_hash, token_version, must_change_password, (locked_until is not null and locked_until > now()) as locked
    from admins where lower(email) = ${em}`;
  // Always run bcrypt, even for unknown or locked accounts (constant-ish timing).
  const ok = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);

  if (!admin || admin.locked || !ok) {
    if (admin && !admin.locked) {
      // Exponential lockout: 5 failures → 15 min, doubling each further failure, capped at 24 h.
      await sql`
        update admins set failed_logins = failed_logins + 1,
          locked_until = case when failed_logins + 1 >= 5
            then now() + least(interval '15 minutes' * power(2, failed_logins + 1 - 5), interval '24 hours')
            else locked_until end
        where id = ${admin.id}`;
    }
    console.warn(`[auth] failed login for ${em} from ${ip}`);
    throw new HttpError(401, GENERIC);
  }

  await sql`update admins set failed_logins = 0, locked_until = null, last_login_at = now() where id = ${admin.id}`;
  const res = NextResponse.json(
    { ok: true, admin: { id: admin.id, email: admin.email, name: admin.name }, mustChangePassword: admin.must_change_password },
    { headers: { "cache-control": "no-store" } },
  );
  await createSession(res, req, admin.id, admin.token_version, admin.must_change_password);
  return res;
});
