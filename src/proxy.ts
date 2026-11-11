import { NextResponse, type NextRequest } from "next/server";
import { AUD, COOKIE, verifyJwt } from "@/lib/keys";

// Optimistic gate for the admin UI only. Every /api/admin route re-validates the
// session (and the temporary-password flag) against the database; this just
// spares signed-out visitors an empty shell and steers temp-password users.
export async function proxy(req: NextRequest) {
  const access = await verifyJwt<{ pwc?: boolean }>(req.cookies.get(COOKIE.access)?.value, "admin-access", AUD.admin);
  const path = req.nextUrl.pathname;
  if (!access && !req.cookies.has(COOKIE.refresh)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }
  if (access?.pwc && path.startsWith("/admin")) {
    const url = req.nextUrl.clone();
    url.pathname = "/change-password";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/change-password"] };
