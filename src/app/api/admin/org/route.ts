import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { isValidTimeZone, type Org } from "@/lib/tenant";

function view(org: Org, origin: string) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    role: org.role,
    timeZone: org.timeZone,
    lateAfter: org.lateAfter,
    selfCheckin: org.selfCheckin,
    logoUrl: org.logoUrl,
    geo: org.geo,
    // Shared link: person types their ID code, then verifies with face + liveness.
    checkinLink: `${origin}/checkin/${org.slug}?k=${org.checkinKey}`,
  };
}

export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  return json({ org: view(org, req.nextUrl.origin) });
});

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  timeZone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone").optional(),
  lateAfter: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"), z.null()]).optional(),
  selfCheckin: z.boolean().optional(),
  geo: z
    .object({
      lat: z.number().min(-90).max(90).nullable(),
      lng: z.number().min(-180).max(180).nullable(),
      radiusM: z.number().int().min(50).max(5000),
      required: z.boolean(),
    })
    .refine((g) => !g.required || (g.lat !== null && g.lng !== null), { message: "Set the location first", path: ["required"] })
    .optional(),
});

export const PATCH = handle(async (req) => {
  const { org } = await requireOrg(req, { owner: true });
  const p = await body(req, schema);
  const sql = db();
  const [o] = await sql`
    update organizations set
      name = coalesce(${p.name ?? null}, name),
      time_zone = coalesce(${p.timeZone ?? null}, time_zone),
      late_after = case when ${p.lateAfter !== undefined} then ${p.lateAfter ?? null} else late_after end,
      self_checkin = coalesce(${p.selfCheckin ?? null}, self_checkin),
      geo_lat = case when ${!!p.geo} then ${p.geo?.lat ?? null}::float8 else geo_lat end,
      geo_lng = case when ${!!p.geo} then ${p.geo?.lng ?? null}::float8 else geo_lng end,
      geo_radius_m = coalesce(${p.geo?.radiusM ?? null}::int, geo_radius_m),
      geo_required = coalesce(${p.geo?.required ?? null}::boolean, geo_required)
    where id = ${org.id}
    returning id, name, slug, time_zone, late_after, self_checkin, checkin_key, geo_lat, geo_lng, geo_radius_m, geo_required`;
  return json({
    org: view(
      {
        ...org,
        name: o.name,
        timeZone: o.time_zone,
        lateAfter: o.late_after,
        selfCheckin: o.self_checkin,
        checkinKey: o.checkin_key,
        geo: { lat: o.geo_lat, lng: o.geo_lng, radiusM: o.geo_radius_m, required: o.geo_required },
      },
      req.nextUrl.origin,
    ),
  });
});

/** POST ?action=rotate-key → the old shared check-in link stops working immediately. */
export const POST = handle(async (req) => {
  const { org } = await requireOrg(req, { owner: true });
  if (req.nextUrl.searchParams.get("action") !== "rotate-key") throw new HttpError(400, "Unknown action");
  const key = randomUUID().replace(/-/g, "");
  await db()`update organizations set checkin_key = ${key} where id = ${org.id}`;
  return json({ org: view({ ...org, checkinKey: key }, req.nextUrl.origin) });
});
