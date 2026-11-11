import { randomBytes } from "node:crypto";
import { z } from "zod";
import { clientIp, signSelfChallenge } from "@/lib/auth";
import { config } from "@/lib/config";
import { body, handle, HttpError, json } from "@/lib/http";
import { pickSteps } from "@/lib/liveness-server";
import { normalizeRef } from "@/lib/ids";
import { parseLinkToken } from "@/lib/qr";
import { rateLimit } from "@/lib/ratelimit";
import { safeEqual } from "@/lib/selfcheck";
import { distanceM } from "@/lib/geo";
import { servicesNow } from "@/lib/services";
import { loadOrg, tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

const schema = z.object({
  k: z.string().max(64).optional(), // shared link key (then `code` is required)
  code: z.string().trim().min(1).max(64).optional(),
  p: z.string().max(120).optional(), // personal link token
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000) }).optional(),
});

/**
 * Public step 1 of phone check-in: identify WHO is claiming (personal link, or
 * shared link + ID code) and hand back a signed liveness challenge for that one
 * person. The face itself is checked in /verify.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const ip = clientIp(req);
  await rateLimit(`selfcheck:start:ip:${ip}`, 30, 600);
  const { slug } = await params;
  const input = await body(req, schema);
  const org = await loadOrg({ slug: slug.toLowerCase() });
  if (!org || !org.selfCheckin) throw new HttpError(404, "This check-in link isn't valid");

  // Only while a service is open.
  const { open, next } = await tenant(org.id, (sql) => servicesNow(sql, org));
  if (!open.length) {
    throw new HttpError(409, next ? `No service is open right now. Next: ${next.label}.` : "No service is open right now.", {}, "no_service");
  }

  // Optional location check: the phone must be near the organization.
  if (org.geo.required && org.geo.lat !== null && org.geo.lng !== null) {
    if (!input.location) throw new HttpError(400, "Allow location access to check in.", {}, "location_required");
    if (input.location.accuracy > 1000) throw new HttpError(400, "Your location isn't precise enough. Turn on location services and try again.", {}, "location_imprecise");
    const d = distanceM({ lat: org.geo.lat, lng: org.geo.lng }, input.location);
    // Give the benefit of the doubt for GPS error (up to 100 m).
    if (d - Math.min(input.location.accuracy, 100) > org.geo.radiusM) {
      throw new HttpError(403, `You need to be at ${org.name} to check in.`, {}, "too_far");
    }
  }

  const person = await tenant(org.id, async (sql) => {
    if (input.p) {
      const t = parseLinkToken(input.p);
      if (!t) return null;
      const [r] = await sql`select id from people where id = ${t.personId} and qr_version = ${t.version} and active`;
      return r ?? null;
    }
    if (!input.k || !input.code || !safeEqual(input.k, org.checkinKey)) return null;
    // Either the org's own code or the platform ID (K7QM-4XHT, any case/dashes).
    const [r] = await sql`
      select id from people
      where active and (code = ${input.code} or ref = ${normalizeRef(input.code) ?? ""})
      order by (code = ${input.code}) desc nulls last
      limit 1`;
    return r ?? null;
  });
  // Generic wording: don't confirm which ID codes exist.
  if (!person) throw new HttpError(404, "We couldn't match that ID. Check it, or ask an admin for your personal link.");

  await rateLimit(`selfcheck:start:person:${person.id}`, 10, 600);
  const [{ enrolled }] = await tenant(org.id, (sql) => sql`
    select exists(select 1 from face_embeddings where person_id = ${person.id}) as enrolled`);
  if (!enrolled) throw new HttpError(409, "Your face isn't registered yet. Ask an admin to enroll you, then try again.");

  const steps = pickSteps();
  const token = await signSelfChallenge(org.id, person.id, { nonce: randomBytes(16).toString("base64url"), steps }, config.challengeTtl);
  return json({ token, steps, ttl: config.challengeTtl });
});
