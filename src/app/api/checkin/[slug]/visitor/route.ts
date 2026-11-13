import { z } from "zod";
import { clientIp } from "@/lib/auth";
import { body, handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { safeEqual } from "@/lib/selfcheck";
import { loadOrg, tenant } from "@/lib/tenant";
import { checkLocation, visitorCheckIn, visitorSchema } from "@/lib/visitors";

type Ctx = { params: Promise<{ slug: string }> };

const schema = visitorSchema.extend({
  k: z.string().max(64),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000) }).optional(),
});

/** "First time here?" on the shared phone check-in link. Same rules as a member check-in: open service, location. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const ip = clientIp(req);
  await rateLimit(`visitor:link:ip:${ip}`, 10, 600);
  const org = await loadOrg({ slug: (await params).slug.toLowerCase() });
  const v = await body(req, schema);
  if (!org || !org.selfCheckin || !safeEqual(v.k, org.checkinKey)) throw new HttpError(404, "This check-in link isn't valid");
  if (v.website) return json({ result: "checked_in" });
  checkLocation(org, v.location);
  const r = await tenant(org.id, (sql) => visitorCheckIn(sql, org, v));
  return json({ result: r.status, ...r });
});
