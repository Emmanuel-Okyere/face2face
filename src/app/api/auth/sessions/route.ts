import { z } from "zod";
import { db } from "@/lib/db";
import { handle, json, requireAdmin } from "@/lib/http";

/** The signed-in admin's active devices. */
export const GET = handle(async (req) => {
  const me = await requireAdmin(req);
  const sessions = await db()`
    select id, created_at, last_used_at, expires_at, ip, user_agent, (id = ${me.sid}) as current
    from admin_sessions
    where admin_id = ${me.id} and revoked_at is null and expires_at > now()
    order by last_used_at desc`;
  return json({ sessions });
});

export const DELETE = handle(async (req) => {
  const me = await requireAdmin(req);
  const id = z.uuid().parse(req.nextUrl.searchParams.get("id"));
  await db()`
    update admin_sessions set revoked_at = now(), revoke_reason = 'revoked_by_user'
    where id = ${id} and admin_id = ${me.id} and revoked_at is null`;
  return json({ ok: true });
});
