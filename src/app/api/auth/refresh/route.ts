import { NextResponse } from "next/server";
import { clearAuthCookies, clientIp, rotateSession } from "@/lib/auth";
import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const POST = handle(async (req) => {
  await rateLimit(`refresh:ip:${clientIp(req)}`, 60, 60);
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  const r = await rotateSession(req, res);
  if (r.ok) return res;
  const fail = NextResponse.json({ error: "Session expired" }, { status: 401, headers: { "cache-control": "no-store" } });
  clearAuthCookies(fail);
  return fail;
});
