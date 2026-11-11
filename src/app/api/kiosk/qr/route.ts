import { z } from "zod";
import { logAttempt, recordCheckIn } from "@/lib/attendance";
import { getKiosk } from "@/lib/auth";
import { body, handle, HttpError, json } from "@/lib/http";
import { parseBadgeToken } from "@/lib/qr";
import { rateLimit } from "@/lib/ratelimit";
import { serviceForCheckIn } from "@/lib/services";
import { loadOrg, tenant } from "@/lib/tenant";

const schema = z.object({ token: z.string().max(200) });

export const POST = handle(async (req) => {
  const kiosk = await getKiosk(req);
  if (!kiosk) throw new HttpError(401, "This device is not a paired kiosk");
  if (kiosk.paused) throw new HttpError(423, "This kiosk is paused by an admin");
  if (!kiosk.allowQr) throw new HttpError(403, "QR badges are turned off for this kiosk");
  await rateLimit(`qr:${kiosk.id}`, 40, 60);
  const org = await loadOrg({ id: kiosk.orgId });
  if (!org) throw new HttpError(401, "Kiosk organization no longer exists");
  const { token } = await body(req, schema);

  return tenant(org.id, async (sql) => {
    const parsed = parseBadgeToken(token);
    if (!parsed) {
      await logAttempt(sql, org, { kioskId: kiosk.id, outcome: "bad_qr" });
      return json({ result: "bad_qr", reason: "That QR code isn't a Face2Face badge" });
    }
    // RLS: a valid badge from ANOTHER organization simply isn't found here.
    const [p] = await sql`select id, qr_version, active from people where id = ${parsed.personId}`;
    if (!p || !p.active || p.qr_version !== parsed.version) {
      await logAttempt(sql, org, { kioskId: kiosk.id, outcome: "bad_qr", candidate: p?.id ?? null });
      return json({ result: "bad_qr", reason: p ? "This badge has been revoked — please see an admin" : "This badge isn't registered here" });
    }
    // Which service is this for? Nothing open → nothing recorded.
    const occ = await serviceForCheckIn(sql, org, p.id);
    if (!occ.service) return json({ result: "no_service", next: occ.next?.label ?? null });
    const occurrence = { serviceId: occ.service.id, serviceName: occ.service.name, day: occ.day, late: occ.late };
    const r = await recordCheckIn(sql, org, p.id, "qr", occurrence, { kioskId: kiosk.id });
    return json({ result: r.status, ...r });
  });
});
