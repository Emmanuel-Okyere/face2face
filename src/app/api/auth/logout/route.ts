import { NextResponse } from "next/server";
import { clearAuthCookies, getAdmin, revokeCurrentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle } from "@/lib/http";

/** POST /api/auth/logout            → end this session
 *  POST /api/auth/logout?all=1      → sign out everywhere (bumps token_version) */
export const POST = handle(async (req) => {
  if (req.nextUrl.searchParams.get("all") === "1") {
    const admin = await getAdmin(req);
    if (admin) {
      await db().begin(async (tx) => {
        await tx`update admins set token_version = token_version + 1 where id = ${admin.id}`;
        await tx`update admin_sessions set revoked_at = now(), revoke_reason = 'logout_all' where admin_id = ${admin.id} and revoked_at is null`;
      });
    }
  } else {
    await revokeCurrentSession(req);
  }
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  clearAuthCookies(res);
  return res;
});
