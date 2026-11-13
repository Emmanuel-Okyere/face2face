import "server-only";
import { z } from "zod";
import { recordCheckIn } from "./attendance";
import { distanceM } from "./geo";
import { HttpError } from "./http";
import { toE164 } from "./person-fields";
import { serviceForCheckIn } from "./services";
import type { Org, Tx } from "./tenant";

export const visitorSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your name").max(120),
  phone: z.string().trim().max(40).optional().transform((v) => v || undefined),
  invited_by: z.string().trim().max(120).optional().transform((v) => v || undefined),
  website: z.string().max(500).optional(), // honeypot
});
export type VisitorInput = z.infer<typeof visitorSchema>;

/**
 * Check a visitor in to the service that's open now. A phone number that's
 * already on file is the same person coming back (a returning visitor, or a
 * member who forgot their card), so nobody is saved twice.
 */
type Occ = { serviceId: string; serviceName: string; day: string; late: boolean };

export async function visitorCheckIn(sql: Tx, org: Org, v: VisitorInput, extras: { kioskId?: string; recordedBy?: string; occurrence?: Occ } = {}) {
  let phone: string | null = null;
  if (v.phone) {
    phone = toE164(v.phone, "GH");
    if (!phone) throw new HttpError(400, "That phone number doesn't look right");
  }
  type Row = { id: string; is_visitor: boolean };
  let person: Row | undefined;
  if (phone) person = ((await sql`select id, is_visitor from people where phone = ${phone} and active order by is_visitor, created_at limit 1`) as unknown as Row[])[0];
  const returning = !!person;
  if (!person) {
    person = ((await sql`
      insert into people (full_name, phone, is_visitor, invited_by)
      values (${v.full_name}, ${phone}, true, ${v.invited_by ?? null})
      returning id, is_visitor`) as unknown as Row[])[0];
  }
  let occurrence = extras.occurrence;
  if (!occurrence) {
    const occ = await serviceForCheckIn(sql, org, person!.id);
    if (!occ.service) throw new HttpError(409, occ.next ? `No service is open right now. Next: ${occ.next.label}.` : "No service is open right now.", {}, "no_service");
    occurrence = { serviceId: occ.service.id, serviceName: occ.service.name, day: occ.day, late: occ.late };
  }
  const r = await recordCheckIn(sql, org, person!.id, person!.is_visitor ? "visitor" : "manual", occurrence, {
    kioskId: extras.kioskId,
    recordedBy: extras.recordedBy,
    note: person!.is_visitor ? null : "Checked in from the visitor form",
  });
  const [{ visits }] = await sql`select count(distinct day)::int as visits from attendance where person_id = ${person!.id}`;
  return { ...r, visitor: person!.is_visitor, returning, visits: visits as number };
}

/** The organization's optional location fence (same rule as phone check-in). */
export function checkLocation(org: Org, location?: { lat: number; lng: number; accuracy: number }) {
  if (!(org.geo.required && org.geo.lat !== null && org.geo.lng !== null)) return;
  if (!location) throw new HttpError(400, "Allow location access to check in.", {}, "location_required");
  if (location.accuracy > 1000) throw new HttpError(400, "Your location isn't precise enough. Turn on location services and try again.", {}, "location_imprecise");
  const d = distanceM({ lat: org.geo.lat, lng: org.geo.lng }, location);
  if (d - Math.min(location.accuracy, 100) > org.geo.radiusM) throw new HttpError(403, `You need to be at ${org.name} to check in.`, {}, "too_far");
}
