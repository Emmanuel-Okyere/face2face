import { getKiosk } from "@/lib/auth";
import { body, handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { loadOrg, tenant } from "@/lib/tenant";
import { visitorCheckIn, visitorSchema } from "@/lib/visitors";

/** "I'm visiting" at the kiosk: save the visitor and check them in. */
export const POST = handle(async (req) => {
  const kiosk = await getKiosk(req);
  if (!kiosk) throw new HttpError(401, "This device is not a paired kiosk");
  if (kiosk.paused) throw new HttpError(423, "This kiosk is paused by an admin");
  await rateLimit(`visitor:kiosk:${kiosk.id}`, 30, 600);
  const org = await loadOrg({ id: kiosk.orgId });
  if (!org) throw new HttpError(401, "Kiosk organization no longer exists");
  const v = await body(req, visitorSchema);
  if (v.website) return json({ result: "checked_in" });
  const r = await tenant(org.id, (sql) => visitorCheckIn(sql, org, v, { kioskId: kiosk.id }));
  return json({ result: r.status, ...r });
});
