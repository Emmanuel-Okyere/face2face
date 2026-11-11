import { after } from "next/server";
import { z } from "zod";
import { sendReset } from "@/lib/admin-tokens";
import { clientIp } from "@/lib/auth";
import { db } from "@/lib/db";
import { body, handle, HttpError, json } from "@/lib/http";
import { mailEnabled } from "@/lib/mail";
import { rateLimit } from "@/lib/ratelimit";

const schema = z.object({ email: z.email().max(200) });

/**
 * Email a password-reset link. The response is identical whether or not the
 * account exists, and the email is sent after the response, so neither the
 * body nor the timing reveals which addresses are admins.
 */
export const POST = handle(async (req) => {
  if (!mailEnabled()) throw new HttpError(503, "Password reset by email isn't available. Ask another admin to help.");
  await rateLimit(`forgot:ip:${clientIp(req)}`, 10, 15 * 60);
  const { email } = await body(req, schema);
  const em = email.toLowerCase();
  await rateLimit(`forgot:email:${em}`, 3, 60 * 60);

  after(async () => {
    try {
      const [a] = await db()`select id, email, name from admins where lower(email) = ${em}`;
      if (a) await sendReset(req, a as { id: string; email: string; name: string });
    } catch (e) {
      console.error("[mail] reset email failed:", e);
    }
  });
  return json({ ok: true });
});
