import { after } from "next/server";
import { clientIp } from "@/lib/auth";
import { effectiveForm, EVENT_COLS, eventDays, householdSchema, insertHousehold, normalizeHousehold, queueMessages, sendQueued, type EventRow } from "@/lib/camp/events";
import { db } from "@/lib/db";
import { body, handle, HttpError, json } from "@/lib/http";
import { appOrigin } from "@/lib/mail";
import { rateLimit } from "@/lib/ratelimit";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ token: string }> };
const NOT_FOUND = "This registration link isn't valid.";

/** The public token is the only key: unguessable (122 random bits), one per event. */
async function eventByToken(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new HttpError(404, NOT_FOUND);
  const [e] = await db().unsafe(`select ${EVENT_COLS} from events where public_token = $1 and not archived`, [token]);
  if (!e) throw new HttpError(404, NOT_FOUND);
  const [org] = await db()`select name, logo_url from organizations where id = ${e.org_id}`;
  return { e: e as unknown as EventRow, org };
}

/** Public: what the registration form needs. */
export const GET = handle<Ctx>(async (req, { params }) => {
  await rateLimit(`event-info:${clientIp(req)}`, 120, 600);
  const { e, org } = await eventByToken((await params).token);
  return json({
    org: { name: org.name, logoUrl: org.logo_url },
    event: {
      name: e.name, venue: e.venue, starts_on: e.starts_on, ends_on: e.ends_on, open: e.registration_open,
      churches: e.churches, child_age: e.child_age, age_groups: e.age_groups, unit_label: e.unit_label, form: effectiveForm(e), rooms: e.rooms_enabled, buses: e.buses_enabled,
      days: effectiveForm(e).days ? eventDays(e) : [], questions: (e.questions ?? []).filter((q) => q.enabled !== false),
    },
  });
});

/** Public: register one person, or several who are coming together. Sends the pass link by SMS/email. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const ip = clientIp(req);
  await rateLimit(`event-register:ip:${ip}`, 20, 60 * 60);
  const { e } = await eventByToken((await params).token);
  if (!e.registration_open) throw new HttpError(403, "Registration is closed. Contact the organizers.");
  const input = await body(req, householdSchema);
  if (input.website) return json({ ok: true }); // bot filled the hidden field: pretend success, store nothing
  const h = normalizeHousehold(e, input);
  await rateLimit(`event-register:phone:${e.id}:${h.contact_phone}`, 5, 24 * 60 * 60);
  const origin = appOrigin(req);
  const hh = await tenant(e.org_id, async (sql) => {
    // One registration per contact phone per event (stops accidental double submits).
    const [dup] = await sql`select id from event_households where event_id = ${e.id} and contact_phone = ${h.contact_phone}`;
    if (dup) throw new HttpError(409, "This phone number has already registered. Check your SMS for your pass, or contact the organizers to make changes.");
    const row = await insertHousehold(sql, e, h, "public");
    await queueMessages(sql, e, "registered", origin, { householdIds: [row.id] });
    return row;
  });
  after(() => sendQueued(e.org_id, e.id, 5).catch((err) => console.error("[camp] send", err)));
  return json({ ok: true, code: hh.code, pass: `/pass/${hh.pass_token}` }, 201);
});
