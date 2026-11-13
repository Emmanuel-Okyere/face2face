import { after } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/auth";
import { sendQueued } from "@/lib/camp/events";
import { db } from "@/lib/db";
import { body, handle, HttpError, json } from "@/lib/http";
import { normalizeRef } from "@/lib/ids";
import { smsEnabled } from "@/lib/sms";
import { rateLimit } from "@/lib/ratelimit";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ token: string }> };
const TRIPS = ["out", "back"] as const;
type Trip = (typeof TRIPS)[number];

/** The captain link is the key: unguessable, one per bus, replaceable from the admin side. */
async function busByToken(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new HttpError(404, "This boarding link isn't valid.");
  const [b] = await db()`
    select b.id, b.org_id, b.event_id, b.name, b.seats, b.pickup, b.departs, e.name as event_name, e.archived
    from event_buses b join events e on e.id = b.event_id where b.captain_token = ${token}`;
  if (!b || b.archived) throw new HttpError(404, "This boarding link isn't valid. Ask the organizers for a new one.");
  return b as { id: string; org_id: string; event_id: string; name: string; seats: number; pickup: string | null; departs: string | null; event_name: string };
}

/** Everyone assigned to this bus, plus anyone who boarded it instead of their own. */
async function manifest(bus: Awaited<ReturnType<typeof busByToken>>, trip: Trip) {
  return tenant(bus.org_id, async (sql) => {
    const people = await sql`
      select r.id, r.full_name, r.seat, r.phone, r.code, h.church, h.contact_name, h.contact_phone,
        r.bus_id = ${bus.id} as assigned_here, ob.name as assigned_bus,
        b.method, b.at, b.bus_id as boarded_bus_id, bb.name as boarded_bus
      from event_registrants r
      join event_households h on h.id = r.household_id
      left join event_buses ob on ob.id = r.bus_id
      left join event_boardings b on b.registrant_id = r.id and b.trip = ${trip}
      left join event_buses bb on bb.id = b.bus_id
      where r.event_id = ${bus.event_id} and r.status = 'registered'
        and (r.bus_id = ${bus.id} or b.bus_id = ${bus.id})
      order by r.seat nulls last, r.full_name`;
    return people.map((p) => ({
      id: p.id as string,
      name: p.full_name as string,
      seat: p.assigned_here ? (p.seat as number) : null,
      church: p.church as string,
      // The person's own number if they gave one, else their registration's contact.
      phone: (p.phone ?? p.contact_phone) as string | null,
      via: p.phone ? null : (p.contact_name as string),
      assignedHere: p.assigned_here as boolean,
      assignedBus: p.assigned_bus as string | null,
      status: !p.method ? "missing" : p.method === "skipped" ? "skipped" : p.boarded_bus_id === bus.id ? "on" : "elsewhere",
      boardedBus: p.boarded_bus as string | null,
      at: p.at as string | null,
    }));
  });
}

/** Captain view: this bus, this trip, who's on and who's missing. */
export const GET = handle<Ctx>(async (req, { params }) => {
  await rateLimit(`board:get:${clientIp(req)}`, 600, 600);
  const bus = await busByToken((await params).token);
  const trip = (req.nextUrl.searchParams.get("trip") === "back" ? "back" : "out") as Trip;
  const people = await manifest(bus, trip);
  return json({
    bus: { name: bus.name, seats: bus.seats, pickup: bus.pickup, departs: bus.departs, event: bus.event_name },
    trip,
    people,
    sms: smsEnabled(),
  });
});

const actionSchema = z.object({
  trip: z.enum(TRIPS),
  action: z.enum(["board", "skip", "undo", "sms"]),
  code: z.string().max(40).optional(), // scanned pass code
  rid: z.uuid().optional(), // tapped from the list
  force: z.boolean().default(false), // board here although assigned to another bus
  church: z.string().max(120).optional(), // SMS only this church's missing people
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const ip = clientIp(req);
  await rateLimit(`board:post:${ip}`, 900, 600);
  const bus = await busByToken((await params).token);
  const a = await body(req, actionSchema);

  if (a.action === "sms") {
    await rateLimit(`board:sms:${bus.id}:${a.trip}`, 3, 10 * 60); // at most 3 reminders per 10 minutes
    if (!smsEnabled()) throw new HttpError(400, "SMS isn't set up — call them instead.");
    const people = await manifest(bus, a.trip);
    const missing = people.filter((p) => p.status === "missing" && p.assignedHere && (!a.church || p.church === a.church));
    if (!missing.length) return json({ sent: 0 });
    // One SMS per phone number, naming everyone it covers.
    const byPhone = new Map<string, string[]>();
    for (const p of missing) if (p.phone) byPhone.set(p.phone, [...(byPhone.get(p.phone) ?? []), p.name.split(/\s+/)[0]]);
    const bucket = Math.floor(Date.now() / (5 * 60_000)); // the same reminder isn't queued twice in 5 minutes
    const where = bus.pickup ? ` from ${bus.pickup}` : "";
    const n = await tenant(bus.org_id, async (sql) => {
      let queued = 0;
      for (const [phone, names] of byPhone) {
        const who = names.length === 1 ? `${names[0]} is` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are`;
        const text = `${bus.event_name}: ${bus.name} is about to leave${where}. ${who} not on board yet — please come now.`;
        const r = await sql`
          insert into event_messages (event_id, channel, recipient, kind, dedupe, body, subject)
          values (${bus.event_id}, 'sms', ${phone}, 'bus', ${`board:${bus.id}:${a.trip}:${bucket}`}, ${text}, ${bus.event_name})
          on conflict do nothing returning id`;
        queued += r.length;
      }
      return queued;
    });
    after(() => sendQueued(bus.org_id, bus.event_id, 40).catch((e) => console.error("[board] sms", e)));
    return json({ sent: n, noPhone: missing.filter((p) => !p.phone).length });
  }

  // Find the person: by scanned pass code or by id from the list — always within this event.
  const person = await tenant(bus.org_id, async (sql) => {
    if (a.rid) {
      const [p] = await sql`select r.id, r.full_name, r.seat, r.status, r.bus_id, b.name as bus from event_registrants r left join event_buses b on b.id = r.bus_id where r.id = ${a.rid} and r.event_id = ${bus.event_id}`;
      return p;
    }
    const code = normalizeRef(a.code ?? "");
    if (!code) return null;
    const [p] = await sql`select r.id, r.full_name, r.seat, r.status, r.bus_id, b.name as bus from event_registrants r left join event_buses b on b.id = r.bus_id where r.code = ${code} and r.event_id = ${bus.event_id}`;
    return p;
  });
  if (!person) throw new HttpError(404, a.code ? "That pass isn't for this event." : "Person not found.", {}, "unknown");
  if (person.status !== "registered") throw new HttpError(409, `${person.full_name}'s registration was cancelled.`, {}, "cancelled");

  if (a.action === "undo") {
    await tenant(bus.org_id, (sql) => sql`delete from event_boardings where registrant_id = ${person.id} and trip = ${a.trip}`);
    return json({ ok: true, name: person.full_name });
  }

  // Assigned to another bus: ask first (the captain might send them there instead).
  if (a.action === "board" && person.bus_id && person.bus_id !== bus.id && !a.force) {
    return json({ error: `${person.full_name}'s seat is on ${person.bus}.`, code: "other_bus", name: person.full_name, assignedBus: person.bus }, 409);
  }

  const method = a.action === "skip" ? "skipped" : a.code ? "scan" : "tap";
  const res = await tenant(bus.org_id, async (sql) => {
    const [prev] = await sql`select method, bus_id, at from event_boardings where registrant_id = ${person.id} and trip = ${a.trip}`;
    if (prev && prev.method !== "skipped" && method !== "skipped" && prev.bus_id === bus.id) return { already: true, at: prev.at };
    await sql`
      insert into event_boardings (event_id, registrant_id, bus_id, trip, method)
      values (${bus.event_id}, ${person.id}, ${bus.id}, ${a.trip}, ${method})
      on conflict (registrant_id, trip) do update set bus_id = excluded.bus_id, method = excluded.method, at = now()`;
    return { already: false, at: null };
  });
  return json({
    ok: true,
    name: person.full_name,
    seat: person.bus_id === bus.id ? person.seat : null,
    already: res.already,
    skipped: method === "skipped",
  });
});
