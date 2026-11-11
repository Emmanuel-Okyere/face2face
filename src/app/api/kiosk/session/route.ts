import { NextResponse } from "next/server";
import { getAdmin, getKiosk } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { COOKIE, cookieOptions } from "@/lib/keys";
import { fmtMin, windowOf } from "@/lib/service-schedule";
import { servicesNow } from "@/lib/services";
import { loadOrg, resolveAdminOrg, tenant } from "@/lib/tenant";

export const GET = handle(async (req) => {
  const [kiosk, admin] = await Promise.all([getKiosk(req), getAdmin(req)]);
  const kioskOrg = kiosk ? await loadOrg({ id: kiosk.orgId }) : null;
  const adminOrg = admin && !admin.mustChangePassword ? await resolveAdminOrg(admin, req) : null;
  // What's open now / next, so the kiosk can wait between services.
  const svc = kioskOrg ? await tenant(kioskOrg.id, (sql) => servicesNow(sql, kioskOrg)) : null;
  return json({
    kiosk:
      kiosk && kioskOrg
        ? {
            id: kiosk.id,
            name: kiosk.name,
            location: kiosk.location,
            allowQr: kiosk.allowQr,
            voiceDefault: kiosk.voiceDefault,
            paused: kiosk.paused,
            org: kioskOrg.name,
            logoUrl: kioskOrg.logoUrl,
            open: svc!.open.map((s) => ({ name: s.name, until: fmtMin(windowOf(s).closes) })),
            next: svc!.next?.label ?? null,
          }
        : null,
    admin: admin ? { name: admin.name, org: adminOrg?.name ?? null } : null,
  });
});

/** Unpair this device. */
export const DELETE = handle(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE.kiosk, "", cookieOptions(0));
  return res;
});
